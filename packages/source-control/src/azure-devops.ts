import {
  SourceControlProviderError,
  type NormalizedChangeRequest,
  type NormalizedChangedFile,
  type NormalizedCommit,
  type NormalizedPipeline,
  type NormalizedRepository,
  type NormalizedReview,
  type ProviderCollection,
} from "./index.js";

const API_ORIGIN = "https://dev.azure.com";
const ADVANCED_SECURITY_ORIGIN = "https://advsec.dev.azure.com";
const API_VERSION = "7.1";
const ADVANCED_SECURITY_API_VERSION = "7.2-preview.1";
const MAX_PAGES = 100;
const MAX_DIFF_BYTES = 5 * 1024 * 1024;
const MAX_DIFF_CELLS = 250_000;
const MAX_CHANGED_FILES = 200;
const MAX_SECURITY_ALERTS = 10_000;
const MAX_PULL_REQUEST_COMMITS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}

function parseTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new SourceControlProviderError(
      `Azure DevOps returned an invalid ${field}.`,
      "INVALID_RESPONSE",
    );
  }
  return value;
}

function parseRepository(
  value: unknown,
  organization: string,
  project: string,
): NormalizedRepository {
  const projectData = isRecord(value) && isRecord(value["project"]) ? value["project"] : null;
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["name"] !== "string") {
    throw new SourceControlProviderError(
      "Azure DevOps returned a repository with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const collectedAt = new Date().toISOString();
  const defaultBranch = stringAt(value, "defaultBranch");
  const webUrl =
    stringAt(value, "webUrl") ??
    `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(value["name"])}`;
  return {
    provider: "AZURE_DEVOPS",
    externalId: value["id"],
    owner: `${organization}/${stringAt(projectData, "name") ?? project}`,
    name: value["name"],
    defaultBranch: defaultBranch?.replace(/^refs\/heads\//, "") ?? null,
    private: true,
    webUrl,
    original: {
      provider: "AZURE_DEVOPS",
      externalId: value["id"],
      url: webUrl,
      collectedAt,
    },
  };
}

function parsePullRequest(value: unknown, organization: string): NormalizedChangeRequest {
  const repository = isRecord(value) && isRecord(value["repository"]) ? value["repository"] : null;
  const project = repository && isRecord(repository["project"]) ? repository["project"] : null;
  const createdBy = isRecord(value) && isRecord(value["createdBy"]) ? value["createdBy"] : null;
  const sourceRef = stringAt(value, "sourceRefName");
  const targetRef = stringAt(value, "targetRefName");
  const lastMergeSourceCommit =
    isRecord(value) && isRecord(value["lastMergeSourceCommit"])
      ? value["lastMergeSourceCommit"]
      : null;
  const status = stringAt(value, "status");
  const links = isRecord(value) && isRecord(value["_links"]) ? value["_links"] : null;
  const webLink = links && isRecord(links["web"]) ? links["web"] : null;
  const id = isRecord(value) ? value["pullRequestId"] : null;
  if (
    !isRecord(value) ||
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    typeof value["title"] !== "string" ||
    !["active", "completed", "abandoned"].includes(status ?? "") ||
    typeof repository?.["id"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Azure DevOps returned a pull request with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const projectName = stringAt(project, "name") ?? "unknown";
  const repoName = stringAt(repository, "name") ?? repository["id"];
  const externalId = `${projectName}/${repoName}/${id}`;
  const collectedAt = new Date().toISOString();
  const webUrl =
    stringAt(webLink, "href") ??
    `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}/pullrequest/${id}`;
  return {
    provider: "AZURE_DEVOPS",
    externalId,
    number: id,
    title: value["title"],
    state: status === "active" ? "OPEN" : status === "completed" ? "MERGED" : "CLOSED",
    author: stringAt(createdBy, "displayName") ?? stringAt(createdBy, "uniqueName"),
    sourceBranch: sourceRef?.replace(/^refs\/heads\//, "") ?? null,
    targetBranch: targetRef?.replace(/^refs\/heads\//, "") ?? null,
    headSha: stringAt(lastMergeSourceCommit, "commitId"),
    additions: null,
    deletions: null,
    changedFilesCount: null,
    createdAt: parseTimestamp(value["creationDate"], "pull-request creation date"),
    updatedAt: parseTimestamp(value["creationDate"], "pull-request creation date"),
    mergedAt:
      status === "completed" && typeof value["closedDate"] === "string"
        ? parseTimestamp(value["closedDate"], "pull-request close date")
        : null,
    webUrl,
    original: {
      provider: "AZURE_DEVOPS",
      externalId,
      url: webUrl,
      collectedAt,
    },
  };
}

function parseChangedFile(value: unknown): NormalizedChangedFile {
  const item = isRecord(value) && isRecord(value["item"]) ? value["item"] : null;
  const path = stringAt(item, "path");
  const changeType = stringAt(value, "changeType")?.toLowerCase();
  if (
    !path ||
    !changeType ||
    !["delete", "rename", "sourcerename", "targetrename", "add", "edit"].includes(changeType)
  ) {
    throw new SourceControlProviderError(
      "Azure DevOps returned an invalid pull-request change entry.",
      "INVALID_RESPONSE",
    );
  }

  return {
    path,
    status: changeType.includes("delete")
      ? "DELETED"
      : changeType.includes("rename")
        ? "RENAMED"
        : changeType.includes("add")
          ? "ADDED"
          : changeType.includes("edit")
            ? "MODIFIED"
            : "UNKNOWN",
    additions: null,
    deletions: null,
    patch: null,
  };
}

function splitDiffLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function createUnifiedPatch(
  path: string,
  before: string,
  after: string,
  previousPath = path,
): {
  patch: string | null;
  additions: number;
  deletions: number;
} {
  if (/[\r\n\0]/.test(path) || /[\r\n\0]/.test(previousPath)) {
    throw new SourceControlProviderError(
      "Azure DevOps returned a changed-file path that cannot be represented safely in a diff.",
      "INVALID_RESPONSE",
    );
  }
  const oldLines = splitDiffLines(before);
  const newLines = splitDiffLines(after);
  let prefixLength = 0;
  while (
    prefixLength < oldLines.length &&
    prefixLength < newLines.length &&
    oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < oldLines.length - prefixLength &&
    suffixLength < newLines.length - prefixLength &&
    oldLines[oldLines.length - suffixLength - 1] === newLines[newLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }
  const oldMiddle = oldLines.slice(prefixLength, oldLines.length - suffixLength);
  const newMiddle = newLines.slice(prefixLength, newLines.length - suffixLength);
  if ((oldMiddle.length + 1) * (newMiddle.length + 1) > MAX_DIFF_CELLS) {
    throw new SourceControlProviderError(
      "Azure DevOps changed-file diff exceeds the safe comparison limit.",
      "UNAVAILABLE",
    );
  }
  const width = newMiddle.length + 1;
  const table = new Uint32Array((oldMiddle.length + 1) * width);
  for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex -= 1) {
      const cell = oldIndex * width + newIndex;
      table[cell] =
        oldMiddle[oldIndex] === newMiddle[newIndex]
          ? (table[(oldIndex + 1) * width + newIndex + 1] ?? 0) + 1
          : Math.max(
              table[(oldIndex + 1) * width + newIndex] ?? 0,
              table[oldIndex * width + newIndex + 1] ?? 0,
            );
    }
  }
  const operations: Array<{ kind: " " | "+" | "-"; line: string }> = [];
  for (let index = 0; index < prefixLength; index += 1) {
    operations.push({ kind: " ", line: oldLines[index] ?? "" });
  }
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
    if (
      oldIndex < oldMiddle.length &&
      newIndex < newMiddle.length &&
      oldMiddle[oldIndex] === newMiddle[newIndex]
    ) {
      operations.push({ kind: " ", line: oldMiddle[oldIndex] ?? "" });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      oldIndex < oldMiddle.length &&
      (newIndex >= newMiddle.length ||
        (table[(oldIndex + 1) * width + newIndex] ?? 0) >=
          (table[oldIndex * width + newIndex + 1] ?? 0))
    ) {
      operations.push({ kind: "-", line: oldMiddle[oldIndex] ?? "" });
      oldIndex += 1;
    } else {
      operations.push({ kind: "+", line: newMiddle[newIndex] ?? "" });
      newIndex += 1;
    }
  }
  for (let index = suffixLength; index > 0; index -= 1) {
    operations.push({
      kind: " ",
      line: oldLines[oldLines.length - index] ?? "",
    });
  }
  const additions = operations.filter((operation) => operation.kind === "+").length;
  const deletions = operations.filter((operation) => operation.kind === "-").length;
  if (additions === 0 && deletions === 0) {
    return { patch: null, additions, deletions };
  }
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const patch = [
    `--- a/${previousPath}`,
    `+++ b/${path}`,
    `@@ -${oldCount === 0 ? 0 : 1},${oldCount} +${newCount === 0 ? 0 : 1},${newCount} @@`,
    ...operations.map(({ kind, line }) => `${kind}${line}`),
  ].join("\n");
  return { patch, additions, deletions };
}

function parseIterationCommits(value: unknown): {
  id: number;
  sourceCommit: string;
  commonCommit: string;
} {
  const source =
    isRecord(value) && isRecord(value["sourceRefCommit"]) ? value["sourceRefCommit"] : null;
  const common =
    isRecord(value) && isRecord(value["commonRefCommit"]) ? value["commonRefCommit"] : null;
  if (
    !isRecord(value) ||
    typeof value["id"] !== "number" ||
    !Number.isSafeInteger(value["id"]) ||
    value["id"] < 1 ||
    typeof source?.["commitId"] !== "string" ||
    typeof common?.["commitId"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Azure DevOps returned an iteration without valid source and common-base commits.",
      "INVALID_RESPONSE",
    );
  }
  return {
    id: value["id"],
    sourceCommit: source["commitId"],
    commonCommit: common["commitId"],
  };
}

function parseCommit(value: unknown): NormalizedCommit {
  const author = isRecord(value) && isRecord(value["author"]) ? value["author"] : null;
  const commitId = stringAt(value, "commitId");
  const message = stringAt(value, "comment");
  if (!commitId || message === null) {
    throw new SourceControlProviderError(
      "Azure DevOps returned a commit with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const authorName = stringAt(author, "name");
  const committedAt =
    author && typeof author["date"] === "string"
      ? parseTimestamp(author["date"], "commit author date")
      : null;
  const webUrl = stringAt(value, "remoteUrl");
  const collectedAt = new Date().toISOString();
  return {
    provider: "AZURE_DEVOPS",
    sha: commitId,
    message,
    authorName,
    committedAt,
    webUrl,
    original: {
      provider: "AZURE_DEVOPS",
      externalId: commitId,
      ...(webUrl ? { url: webUrl } : {}),
      collectedAt,
    },
  };
}

function parseReviewer(value: unknown, pullRequestId: number): NormalizedReview {
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["vote"] !== "number") {
    throw new SourceControlProviderError(
      "Azure DevOps returned an invalid pull-request reviewer.",
      "INVALID_RESPONSE",
    );
  }
  const actor = stringAt(value, "displayName") ?? stringAt(value, "uniqueName");
  const externalId = `${pullRequestId}:reviewer:${value["id"]}`;
  const collectedAt = new Date().toISOString();
  return {
    provider: "AZURE_DEVOPS",
    externalId,
    actor,
    state:
      value["vote"] === 10
        ? "APPROVED"
        : value["vote"] === -10
          ? "CHANGES_REQUESTED"
          : value["vote"] === 0
            ? "COMMENTED"
            : "UNKNOWN",
    submittedAt: null,
    commitSha: null,
    original: {
      provider: "AZURE_DEVOPS",
      externalId,
      collectedAt,
    },
  };
}

function parsePullRequestStatus(value: unknown, pullRequestId: number): NormalizedPipeline {
  if (!isRecord(value) || typeof value["id"] !== "number" || typeof value["state"] !== "string") {
    throw new SourceControlProviderError(
      "Azure DevOps returned an invalid pull-request status.",
      "INVALID_RESPONSE",
    );
  }
  const context = isRecord(value["context"]) ? value["context"] : null;
  const externalId = `${pullRequestId}:status:${value["id"]}`;
  const collectedAt = new Date().toISOString();
  return {
    provider: "AZURE_DEVOPS",
    externalId,
    status: `${stringAt(context, "name") ?? "status"}:${value["state"]}`,
    ref: stringAt(context, "genre"),
    sha: null,
    webUrl: stringAt(value, "targetUrl"),
    original: {
      provider: "AZURE_DEVOPS",
      externalId,
      url: stringAt(value, "targetUrl") ?? undefined,
      collectedAt,
    },
  };
}

function parseSecurityAlert(value: unknown): AzureDevOpsSecurityAlert {
  if (
    !isRecord(value) ||
    (typeof value["alertId"] !== "number" && typeof value["alertId"] !== "string") ||
    (typeof value["alertId"] === "number" && !Number.isSafeInteger(value["alertId"])) ||
    typeof value["alertType"] !== "string" ||
    typeof value["severity"] !== "string" ||
    typeof value["state"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Azure DevOps Advanced Security returned an invalid alert.",
      "INVALID_RESPONSE",
    );
  }
  const id = String(value["alertId"]);
  if (!/^[1-9]\d*$/.test(id)) {
    throw new SourceControlProviderError(
      "Azure DevOps Advanced Security returned an invalid alert ID.",
      "INVALID_RESPONSE",
    );
  }
  const alertType = value["alertType"].toLowerCase();
  return {
    id,
    type: alertType,
    severity: value["severity"],
    title:
      alertType === "secret"
        ? "Secret detected"
        : (stringAt(value, "title") ?? "Azure DevOps security alert"),
    status: value["state"],
    firstSeenAt:
      typeof value["firstSeenDate"] === "string" &&
      !Number.isNaN(Date.parse(value["firstSeenDate"]))
        ? value["firstSeenDate"]
        : null,
  };
}

export interface AzureDevOpsClientOptions {
  accessToken: string;
  organization: string;
  fetchImplementation?: typeof fetch;
}

export interface AzureDevOpsBranchPolicy {
  id: number;
  name: string;
  enabled: boolean;
  blocking: boolean;
  branchRef: string | null;
}

export interface AzureDevOpsProject {
  id: string;
  name: string;
}

export interface AzureDevOpsSecurityAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  status: string;
  firstSeenAt: string | null;
}

export class AzureDevOpsClient {
  private readonly accessToken: string;
  private readonly organization: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: AzureDevOpsClientOptions) {
    if (!options.accessToken.trim() || !options.organization.trim()) {
      throw new SourceControlProviderError(
        "Azure DevOps access token and organization are required.",
        "AUTHENTICATION",
      );
    }
    this.accessToken = options.accessToken;
    this.organization = options.organization;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async listProjects(): Promise<ProviderCollection<AzureDevOpsProject>> {
    const path = `/${encodeURIComponent(this.organization)}/_apis/projects?api-version=${API_VERSION}`;
    const { items, complete } = await this.paginate(path, (value) => {
      if (
        !isRecord(value) ||
        typeof value["id"] !== "string" ||
        typeof value["name"] !== "string"
      ) {
        throw new SourceControlProviderError(
          "Azure DevOps returned a project with an invalid shape.",
          "INVALID_RESPONSE",
        );
      }
      return { id: value["id"], name: value["name"] };
    });
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Projects visible to the authorized Azure DevOps account were listed.",
        checkedAt,
      },
    };
  }

  async listRepositories(project: string): Promise<ProviderCollection<NormalizedRepository>> {
    const path = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API_VERSION}`;
    const { items, complete } = await this.paginate(path, (item) =>
      parseRepository(item, this.organization, project),
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Repositories within the explicitly selected Azure DevOps project were listed.",
        checkedAt,
      },
    };
  }

  async listPullRequests(
    project: string,
    repositoryId: string,
    window: { start: Date; end: Date },
  ): Promise<ProviderCollection<NormalizedChangeRequest>> {
    if (window.start > window.end) {
      throw new SourceControlProviderError(
        "Invalid Azure DevOps change-request window.",
        "INVALID_RESPONSE",
      );
    }
    const path = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests?searchCriteria.status=all&searchCriteria.minTime=${encodeURIComponent(window.start.toISOString())}&searchCriteria.maxTime=${encodeURIComponent(window.end.toISOString())}&api-version=${API_VERSION}`;
    const { items, complete } = await this.paginate(path, (value) =>
      parsePullRequest(value, this.organization),
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail:
          "Azure DevOps pull requests were filtered by the provider's minTime/maxTime query. The query is creation-time based, not a complete event history.",
        checkedAt,
      },
    };
  }

  async getPullRequestFiles(
    project: string,
    repositoryId: string,
    pullRequestId: number,
  ): Promise<ProviderCollection<NormalizedChangedFile>> {
    const basePath = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${pullRequestId}`;
    const iterations = await this.request(
      `${API_ORIGIN}${basePath}/iterations?api-version=${API_VERSION}`,
    );
    if (!isRecord(iterations.body) || !Array.isArray(iterations.body["value"])) {
      throw new SourceControlProviderError(
        "Azure DevOps returned invalid pull-request iterations.",
        "INVALID_RESPONSE",
      );
    }
    const parsedIterations = iterations.body["value"].map(parseIterationCommits);
    const iteration = parsedIterations.reduce<(typeof parsedIterations)[number] | null>(
      (latest, candidate) => (!latest || candidate.id > latest.id ? candidate : latest),
      null,
    );
    if (!iteration) {
      throw new SourceControlProviderError(
        "Azure DevOps returned no pull-request iterations.",
        "INVALID_RESPONSE",
      );
    }

    const changedFiles: NormalizedChangedFile[] = [];
    let skip = 0;
    let pageCount = 0;
    let complete = false;
    let totalBytes = 0;
    while (pageCount < MAX_PAGES) {
      const url = new URL(`${API_ORIGIN}${basePath}/iterations/${iteration.id}/changes`);
      url.searchParams.set("$top", "2000");
      url.searchParams.set("api-version", API_VERSION);
      if (skip > 0) url.searchParams.set("$skip", String(skip));
      const { body } = await this.request(url.toString());
      if (!isRecord(body) || !Array.isArray(body["changeEntries"])) {
        throw new SourceControlProviderError(
          "Azure DevOps returned invalid pull-request iteration changes.",
          "INVALID_RESPONSE",
        );
      }
      const entries = body["changeEntries"];
      if (changedFiles.length + entries.length > MAX_CHANGED_FILES) {
        throw new SourceControlProviderError(
          "Azure DevOps pull request exceeds the 200 changed-file safety limit.",
          "UNAVAILABLE",
        );
      }
      const processEntry = async (entry: unknown): Promise<NormalizedChangedFile> => {
        const changedFile = parseChangedFile(entry);
        const oldPath = stringAt(entry, "originalPath") ?? changedFile.path;
        const newPath = changedFile.path;
        const accountBytes = (size: number) => {
          totalBytes += size;
          if (totalBytes > MAX_DIFF_BYTES) {
            throw new SourceControlProviderError(
              "Azure DevOps pull-request diff exceeds the 5 MiB safety limit.",
              "UNAVAILABLE",
            );
          }
        };
        const oldContent =
          changedFile.status === "ADDED"
            ? ""
            : await this.getFileContent(
                project,
                repositoryId,
                oldPath,
                iteration.commonCommit,
                accountBytes,
              );
        const newContent =
          changedFile.status === "DELETED"
            ? ""
            : await this.getFileContent(
                project,
                repositoryId,
                newPath,
                iteration.sourceCommit,
                accountBytes,
              );
        const contentIsBinary = oldContent === null || newContent === null;
        const diff = contentIsBinary
          ? { patch: null, additions: null, deletions: null }
          : createUnifiedPatch(newPath, oldContent, newContent, oldPath);
        return {
          ...changedFile,
          path: newPath,
          status: changedFile.status,
          additions: diff.additions,
          deletions: diff.deletions,
          patch: diff.patch,
        };
      };
      for (let offset = 0; offset < entries.length; offset += 8) {
        changedFiles.push(
          ...(await Promise.all(entries.slice(offset, offset + 8).map(processEntry))),
        );
      }
      const nextSkip = body["nextSkip"];
      if (typeof nextSkip !== "number" || !Number.isSafeInteger(nextSkip) || nextSkip <= skip) {
        complete = true;
        break;
      }
      skip = nextSkip;
      pageCount += 1;
    }
    const checkedAt = new Date().toISOString();
    const diffComplete = complete && changedFiles.every((file) => file.patch !== null);
    return {
      items: changedFiles,
      complete: diffComplete,
      capability: {
        status: diffComplete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: diffComplete
          ? "Complete current-iteration changed paths and bounded text diffs were collected."
          : "The current-iteration changed-file set or one or more text diffs are incomplete; binary files cannot be analyzed as text.",
        checkedAt,
      },
    };
  }

  async listPullRequestCommits(
    project: string,
    repositoryId: string,
    pullRequestId: number,
  ): Promise<ProviderCollection<NormalizedCommit>> {
    const path = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${pullRequestId}/commits?api-version=${API_VERSION}`;
    const { items, complete } = await this.paginate(
      path,
      parseCommit,
      API_ORIGIN,
      MAX_PULL_REQUEST_COMMITS,
      "Azure DevOps pull request exceeds the 10,000-commit safety limit.",
      "INVALID_RESPONSE",
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Commit metadata for the pull request was collected.",
        checkedAt,
      },
    };
  }

  async listPullRequestReviews(
    project: string,
    repositoryId: string,
    pullRequestId: number,
  ): Promise<ProviderCollection<NormalizedReview>> {
    const path = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${pullRequestId}?api-version=${API_VERSION}`;
    const { body } = await this.request(`${API_ORIGIN}${path}`);
    if (!isRecord(body) || !Array.isArray(body["reviewers"])) {
      throw new SourceControlProviderError(
        "Azure DevOps returned invalid reviewer information.",
        "INVALID_RESPONSE",
      );
    }
    const items = body["reviewers"].map((reviewer) => parseReviewer(reviewer, pullRequestId));
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete: true,
      capability: {
        status: "PARTIALLY_SUPPORTED",
        detail:
          "Reviewer votes were collected, but the API response does not establish when each vote was submitted or bind it to the current PR iteration.",
        checkedAt,
      },
    };
  }

  async listPullRequestStatuses(
    project: string,
    repositoryId: string,
    pullRequestId: number,
  ): Promise<ProviderCollection<NormalizedPipeline>> {
    const path = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${pullRequestId}/statuses?api-version=${API_VERSION}`;
    const { items, complete } = await this.paginate(path, (value) =>
      parsePullRequestStatus(value, pullRequestId),
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail:
          "Azure DevOps pull-request status records were collected; these are not a complete inventory of pipeline runs.",
        checkedAt,
      },
    };
  }

  async listBranchPolicies(project: string): Promise<ProviderCollection<AzureDevOpsBranchPolicy>> {
    const path = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/policy/configurations?api-version=${API_VERSION}`;
    const { items, complete } = await this.paginate(path, (value) => {
      if (
        !isRecord(value) ||
        typeof value["id"] !== "number" ||
        typeof value["isEnabled"] !== "boolean" ||
        typeof value["isBlocking"] !== "boolean"
      ) {
        throw new SourceControlProviderError(
          "Azure DevOps returned an invalid branch-policy configuration.",
          "INVALID_RESPONSE",
        );
      }
      const type = isRecord(value["type"]) ? value["type"] : null;
      const settings = isRecord(value["settings"]) ? value["settings"] : null;
      const scope = settings && Array.isArray(settings["scope"]) ? settings["scope"] : [];
      const exactBranch = scope
        .filter(isRecord)
        .map((entry) => stringAt(entry, "refName"))
        .find((refName): refName is string => refName !== null);
      return {
        id: value["id"],
        name: stringAt(type, "displayName") ?? "Azure DevOps policy",
        enabled: value["isEnabled"],
        blocking: value["isBlocking"],
        branchRef: exactBranch ?? null,
      };
    });
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail:
          "Azure DevOps policy configurations were collected; only explicitly returned branch scopes are represented.",
        checkedAt,
      },
    };
  }

  async listSecurityAlerts(
    project: string,
    repositoryId: string,
  ): Promise<ProviderCollection<AzureDevOpsSecurityAlert>> {
    const path = `/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/alert/repositories/${encodeURIComponent(repositoryId)}/alerts?criteria.states=active&top=100&expand=minimal&api-version=${ADVANCED_SECURITY_API_VERSION}`;
    const { items, complete } = await this.paginate(
      path,
      parseSecurityAlert,
      ADVANCED_SECURITY_ORIGIN,
      MAX_SECURITY_ALERTS,
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail:
          "Active Azure DevOps Advanced Security alerts were collected for this repository; an empty result does not prove that scanning is enabled or complete.",
        checkedAt,
      },
    };
  }

  private async paginate<T>(
    path: string,
    parse: (value: unknown) => T,
    origin = API_ORIGIN,
    maxItems = Number.MAX_SAFE_INTEGER,
    maxItemsError = "Azure DevOps returned more security alerts than the assessment safety limit.",
    maxItemsErrorKind: "UNAVAILABLE" | "INVALID_RESPONSE" = "UNAVAILABLE",
  ): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = [];
    let continuationToken: string | null = null;
    let pageCount = 0;
    while (pageCount < MAX_PAGES) {
      const url = new URL(`${origin}${path}`);
      if (continuationToken) url.searchParams.set("continuationToken", continuationToken);
      const { body, headers } = await this.request(url.toString(), origin);
      if (!isRecord(body) || !Array.isArray(body["value"])) {
        throw new SourceControlProviderError(
          "Azure DevOps returned an invalid collection.",
          "INVALID_RESPONSE",
        );
      }
      if (items.length + body["value"].length > maxItems) {
        throw new SourceControlProviderError(maxItemsError, maxItemsErrorKind);
      }
      items.push(...body["value"].map(parse));
      continuationToken = headers.get("x-ms-continuationtoken");
      pageCount += 1;
      if (!continuationToken) return { items, complete: true };
    }
    return { items, complete: false };
  }

  private async getFileContent(
    project: string,
    repositoryId: string,
    path: string,
    commit: string,
    onBytes: (size: number) => void,
  ): Promise<string | null> {
    const url = new URL(
      `${API_ORIGIN}/${encodeURIComponent(this.organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items`,
    );
    url.searchParams.set("path", path);
    url.searchParams.set("versionDescriptor.version", commit);
    url.searchParams.set("versionDescriptor.versionType", "commit");
    url.searchParams.set("api-version", API_VERSION);
    const response = await this.requestText(url.toString());
    onBytes(response.bytes.byteLength);
    if (/application\/octet-stream|application\/x-git/i.test(response.contentType)) {
      return null;
    }
    if (/application\/json/i.test(response.contentType)) {
      throw new SourceControlProviderError(
        "Azure DevOps returned a JSON item instead of raw file content.",
        "INVALID_RESPONSE",
      );
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
    } catch {
      return null;
    }
  }

  private async requestText(url: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
  }> {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.origin !== API_ORIGIN ||
      !parsedUrl.pathname.startsWith(`/${encodeURIComponent(this.organization)}/`)
    ) {
      throw new SourceControlProviderError(
        "Azure DevOps request escaped the configured organization API scope.",
        "INVALID_RESPONSE",
      );
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(parsedUrl, {
        headers: {
          Accept: "text/plain, application/octet-stream",
          Authorization: "Bearer " + this.accessToken,
        },
        redirect: "error",
      });
    } catch {
      throw new SourceControlProviderError("Azure DevOps API is unavailable.", "UNAVAILABLE");
    }
    if (response.status === 401) {
      throw new SourceControlProviderError(
        "Azure DevOps authorization expired or was revoked.",
        "AUTHENTICATION",
      );
    }
    if (response.status === 403) {
      throw new SourceControlProviderError(
        "Azure DevOps denied this operation; required permissions may be unavailable.",
        "PERMISSION",
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new SourceControlProviderError(
        "Azure DevOps rate limit reached.",
        "RATE_LIMITED",
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (!response.ok) {
      throw new SourceControlProviderError(
        `Azure DevOps API request failed with status ${response.status}.`,
        response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DIFF_BYTES) {
      throw new SourceControlProviderError(
        "Azure DevOps changed-file content exceeds the 5 MiB safety limit.",
        "UNAVAILABLE",
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new SourceControlProviderError(
        "Azure DevOps returned unreadable file content.",
        "INVALID_RESPONSE",
      );
    }
    if (bytes.byteLength > MAX_DIFF_BYTES) {
      throw new SourceControlProviderError(
        "Azure DevOps changed-file content exceeds the 5 MiB safety limit.",
        "UNAVAILABLE",
      );
    }
    return {
      bytes,
      contentType: response.headers.get("content-type") ?? "",
    };
  }

  private async request(
    url: string,
    expectedOrigin = API_ORIGIN,
  ): Promise<{ body: unknown; headers: Headers }> {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.origin !== expectedOrigin ||
      !parsedUrl.pathname.startsWith(`/${encodeURIComponent(this.organization)}/`)
    ) {
      throw new SourceControlProviderError(
        "Azure DevOps request escaped the configured organization API scope.",
        "INVALID_RESPONSE",
      );
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(parsedUrl, {
        headers: { Accept: "application/json", Authorization: `Bearer ${this.accessToken}` },
        redirect: "error",
      });
    } catch {
      throw new SourceControlProviderError("Azure DevOps API is unavailable.", "UNAVAILABLE");
    }
    if (response.status === 401) {
      throw new SourceControlProviderError(
        "Azure DevOps authorization expired or was revoked.",
        "AUTHENTICATION",
      );
    }
    if (response.status === 403) {
      throw new SourceControlProviderError(
        "Azure DevOps denied this operation; required permissions may be unavailable.",
        "PERMISSION",
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new SourceControlProviderError(
        "Azure DevOps rate limit reached.",
        "RATE_LIMITED",
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (!response.ok) {
      throw new SourceControlProviderError(
        `Azure DevOps API request failed with status ${response.status}.`,
        response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SourceControlProviderError(
        "Azure DevOps returned invalid JSON.",
        "INVALID_RESPONSE",
      );
    }
    return { body, headers: response.headers };
  }
}
