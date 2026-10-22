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

const API_BASE = "https://api.bitbucket.org/2.0";
const API_ORIGIN = new URL(API_BASE).origin;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;
const MAX_DIFF_BYTES = 5 * 1024 * 1024;
const MAX_PULL_REQUEST_COMMITS = 10_000;

interface BitbucketPage<T> {
  values: T[];
  next: string | null;
}

export interface BitbucketWorkspace {
  uuid: string;
  slug: string;
  name: string;
}

export interface BitbucketUser {
  uuid: string;
  username: string;
  displayName: string;
}

export interface BitbucketBranchRestriction {
  id: number;
  kind: string;
  pattern: string;
  value: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}

function dateAt(value: unknown, key: string): string {
  const date = stringAt(value, key);
  if (!date || Number.isNaN(Date.parse(date))) {
    throw new SourceControlProviderError(
      "Bitbucket returned an invalid timestamp.",
      "INVALID_RESPONSE",
    );
  }
  return date;
}

function parsePage<T>(value: unknown, parseItem: (item: unknown) => T): BitbucketPage<T> {
  if (!isRecord(value) || !Array.isArray(value["values"])) {
    throw new SourceControlProviderError(
      "Bitbucket returned an invalid collection.",
      "INVALID_RESPONSE",
    );
  }
  return {
    values: value["values"].map(parseItem),
    next: typeof value["next"] === "string" ? value["next"] : null,
  };
}

function parseRepository(value: unknown): NormalizedRepository {
  const workspace = isRecord(value) && isRecord(value["workspace"]) ? value["workspace"] : null;
  const mainBranch = isRecord(value) && isRecord(value["mainbranch"]) ? value["mainbranch"] : null;
  const links = isRecord(value) && isRecord(value["links"]) ? value["links"] : null;
  const html = links && isRecord(links["html"]) ? links["html"] : null;
  if (
    !isRecord(value) ||
    typeof value["uuid"] !== "string" ||
    typeof value["name"] !== "string" ||
    typeof workspace?.["slug"] !== "string" ||
    typeof value["is_private"] !== "boolean" ||
    typeof html?.["href"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Bitbucket returned a repository with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const collectedAt = new Date().toISOString();
  return {
    provider: "BITBUCKET",
    externalId: value["uuid"],
    owner: workspace["slug"],
    name: value["name"],
    defaultBranch: typeof mainBranch?.["name"] === "string" ? mainBranch["name"] : null,
    private: value["is_private"],
    webUrl: html["href"],
    original: {
      provider: "BITBUCKET",
      externalId: value["uuid"],
      url: html["href"],
      collectedAt,
    },
  };
}

function parseWorkspace(value: unknown): BitbucketWorkspace {
  if (
    !isRecord(value) ||
    typeof value["uuid"] !== "string" ||
    typeof value["slug"] !== "string" ||
    typeof value["name"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Bitbucket returned a workspace with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  return { uuid: value["uuid"], slug: value["slug"], name: value["name"] };
}

function parseUser(value: unknown): BitbucketUser {
  if (
    !isRecord(value) ||
    typeof value["uuid"] !== "string" ||
    typeof value["display_name"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "Bitbucket returned an invalid user profile.",
      "INVALID_RESPONSE",
    );
  }
  return {
    uuid: value["uuid"],
    username:
      (typeof value["username"] === "string" && value["username"]) ||
      (typeof value["nickname"] === "string" && value["nickname"]) ||
      value["display_name"],
    displayName: value["display_name"],
  };
}

function parsePullRequest(value: unknown): NormalizedChangeRequest {
  const source = isRecord(value) && isRecord(value["source"]) ? value["source"] : null;
  const target = isRecord(value) && isRecord(value["destination"]) ? value["destination"] : null;
  const sourceBranch = source && isRecord(source["branch"]) ? source["branch"] : null;
  const targetBranch = target && isRecord(target["branch"]) ? target["branch"] : null;
  const sourceCommit = source && isRecord(source["commit"]) ? source["commit"] : null;
  const author = isRecord(value) && isRecord(value["author"]) ? value["author"] : null;
  const links = isRecord(value) && isRecord(value["links"]) ? value["links"] : null;
  const html = links && isRecord(links["html"]) ? links["html"] : null;
  const state = stringAt(value, "state");
  if (
    !isRecord(value) ||
    typeof value["id"] !== "number" ||
    !Number.isSafeInteger(value["id"]) ||
    value["id"] < 1 ||
    typeof value["title"] !== "string" ||
    typeof value["created_on"] !== "string" ||
    typeof value["updated_on"] !== "string" ||
    typeof html?.["href"] !== "string" ||
    !["OPEN", "MERGED", "DECLINED", "SUPERSEDED"].includes(state ?? "")
  ) {
    throw new SourceControlProviderError(
      "Bitbucket returned a pull request with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const externalId = String(value["id"]);
  const collectedAt = new Date().toISOString();
  const stateNormalized = state === "OPEN" ? "OPEN" : state === "MERGED" ? "MERGED" : "CLOSED";
  return {
    provider: "BITBUCKET",
    externalId,
    number: value["id"],
    title: value["title"],
    state: stateNormalized,
    author: stringAt(author, "display_name") ?? stringAt(author, "nickname"),
    sourceBranch: stringAt(sourceBranch, "name"),
    targetBranch: stringAt(targetBranch, "name"),
    headSha: stringAt(sourceCommit, "hash"),
    additions: null,
    deletions: null,
    changedFilesCount: null,
    createdAt: dateAt(value, "created_on"),
    updatedAt: dateAt(value, "updated_on"),
    mergedAt: state === "MERGED" ? stringAt(value, "closed_on") : null,
    webUrl: html["href"],
    original: {
      provider: "BITBUCKET",
      externalId,
      url: html["href"],
      collectedAt,
    },
  };
}

function parseChangedFile(value: unknown): NormalizedChangedFile {
  if (!isRecord(value)) {
    throw new SourceControlProviderError(
      "Bitbucket returned an invalid pull-request diff entry.",
      "INVALID_RESPONSE",
    );
  }
  const old = isRecord(value["old"]) ? value["old"] : null;
  const next = isRecord(value["new"]) ? value["new"] : null;
  const path = stringAt(next, "path") ?? stringAt(old, "path");
  const status = stringAt(value, "status");
  if (!path || !["added", "modified", "removed", "renamed"].includes(status ?? "")) {
    throw new SourceControlProviderError(
      "Bitbucket returned a pull-request diff entry with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const additions = typeof value["lines_added"] === "number" ? value["lines_added"] : null;
  const deletions = typeof value["lines_removed"] === "number" ? value["lines_removed"] : null;
  return {
    path,
    status:
      status === "added"
        ? "ADDED"
        : status === "removed"
          ? "DELETED"
          : status === "renamed"
            ? "RENAMED"
            : "MODIFIED",
    additions,
    deletions,
    patch: null,
  };
}

function decodeGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const encoded = value.slice(1, -1);
  let decoded = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character === undefined) {
      throw new SourceControlProviderError(
        "Bitbucket returned an invalid quoted diff path.",
        "INVALID_RESPONSE",
      );
    }
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const next = encoded[index + 1];
    if (!next) {
      throw new SourceControlProviderError(
        "Bitbucket returned an invalid quoted diff path.",
        "INVALID_RESPONSE",
      );
    }
    if (/[0-7]/.test(next)) {
      const octal = encoded.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0];
      if (!octal) {
        throw new SourceControlProviderError(
          "Bitbucket returned an invalid quoted diff path.",
          "INVALID_RESPONSE",
        );
      }
      decoded += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    const escapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      a: "\u0007",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\u000b",
    };
    const replacement = escapes[next];
    if (replacement === undefined) {
      throw new SourceControlProviderError(
        "Bitbucket returned an unsupported quoted diff path.",
        "INVALID_RESPONSE",
      );
    }
    decoded += replacement;
    index += 1;
  }
  return decoded;
}

function parseUnifiedDiff(value: string): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const sections = value.split(/^diff --git /m).slice(1);
  for (const section of sections) {
    const header = section.split("\n", 1)[0] ?? "";
    const separator = header.lastIndexOf(" b/");
    if (separator < 0) {
      throw new SourceControlProviderError(
        "Bitbucket returned a diff with an invalid file header.",
        "INVALID_RESPONSE",
      );
    }
    let headerPath: string;
    try {
      headerPath = decodeGitPath(header.slice(separator + 3));
    } catch (error) {
      if (error instanceof SourceControlProviderError) throw error;
      throw new SourceControlProviderError(
        "Bitbucket returned an invalid diff path.",
        "INVALID_RESPONSE",
      );
    }
    const plusLine = section.match(/^\+\+\+ (.+)$/m)?.[1];
    const minusLine = section.match(/^--- (.+)$/m)?.[1];
    let path = headerPath;
    const marker = plusLine && plusLine !== "/dev/null" ? plusLine : minusLine;
    if (marker && marker !== "/dev/null") {
      const prefixedPath = marker.startsWith("b/")
        ? marker.slice(2)
        : marker.startsWith("a/")
          ? marker.slice(2)
          : marker;
      try {
        path = decodeGitPath(prefixedPath);
      } catch (error) {
        if (error instanceof SourceControlProviderError) throw error;
        throw new SourceControlProviderError(
          "Bitbucket returned an invalid diff path.",
          "INVALID_RESPONSE",
        );
      }
    }
    const hunks = section.match(/^@@ .*? @@.*(?:\n(?!(?:diff --git )).*)*/gim);
    const patchBody = hunks?.join("\n").trim() ?? "";
    result.set(path, patchBody || null);
  }
  return result;
}

function parseParticipant(value: unknown, index: number): NormalizedReview {
  const user = isRecord(value) && isRecord(value["user"]) ? value["user"] : null;
  if (!isRecord(value) || typeof value["approved"] !== "boolean" || !user) {
    throw new SourceControlProviderError(
      "Bitbucket returned an invalid pull-request participant.",
      "INVALID_RESPONSE",
    );
  }
  const actor = stringAt(user, "nickname") ?? stringAt(user, "display_name");
  const collectedAt = new Date().toISOString();
  return {
    provider: "BITBUCKET",
    externalId: `participant:${index}:${actor ?? "unknown"}`,
    actor,
    state: value["approved"] ? "APPROVED" : "UNKNOWN",
    submittedAt: null,
    commitSha: null,
    original: {
      provider: "BITBUCKET",
      externalId: `participant:${index}:${actor ?? "unknown"}`,
      collectedAt,
    },
  };
}

function parsePipeline(value: unknown): NormalizedPipeline {
  const target = isRecord(value) && isRecord(value["target"]) ? value["target"] : null;
  const commit = target && isRecord(target["commit"]) ? target["commit"] : null;
  const links = isRecord(value) && isRecord(value["links"]) ? value["links"] : null;
  const html = links && isRecord(links["html"]) ? links["html"] : null;
  const uuid = stringAt(value, "uuid");
  const state = isRecord(value) && isRecord(value["state"]) ? value["state"] : null;
  const result = state && isRecord(state["result"]) ? state["result"] : null;
  if (!uuid || typeof state?.["name"] !== "string") {
    throw new SourceControlProviderError(
      "Bitbucket returned a pipeline with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const status = [state["name"], stringAt(result, "name")].filter(Boolean).join(":");
  const collectedAt = new Date().toISOString();
  return {
    provider: "BITBUCKET",
    externalId: uuid,
    status,
    ref: stringAt(target, "ref_name"),
    sha: stringAt(commit, "hash"),
    webUrl: stringAt(html, "href"),
    original: {
      provider: "BITBUCKET",
      externalId: uuid,
      url: stringAt(html, "href") ?? undefined,
      collectedAt,
    },
  };
}

function parseCommit(value: unknown): NormalizedCommit {
  const author = isRecord(value) && isRecord(value["author"]) ? value["author"] : null;
  const authorUser = author && isRecord(author["user"]) ? author["user"] : null;
  const links = isRecord(value) && isRecord(value["links"]) ? value["links"] : null;
  const html = links && isRecord(links["html"]) ? links["html"] : null;
  const hash = stringAt(value, "hash");
  const message = stringAt(value, "message");
  const date = stringAt(value, "date");
  if (!hash || !message || !date || Number.isNaN(Date.parse(date))) {
    throw new SourceControlProviderError(
      "Bitbucket returned a commit with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const collectedAt = new Date().toISOString();
  const webUrl = stringAt(html, "href");
  return {
    provider: "BITBUCKET",
    sha: hash,
    message,
    authorName:
      stringAt(authorUser, "display_name") ??
      stringAt(author, "raw")?.replace(/\s*<[^>]*>\s*$/, "") ??
      null,
    committedAt: date,
    webUrl,
    original: {
      provider: "BITBUCKET",
      externalId: hash,
      ...(webUrl ? { url: webUrl } : {}),
      collectedAt,
    },
  };
}

export interface BitbucketClientOptions {
  accessToken: string;
  fetchImplementation?: typeof fetch;
}

export class BitbucketClient {
  private readonly accessToken: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: BitbucketClientOptions) {
    if (!options.accessToken.trim()) {
      throw new SourceControlProviderError("Bitbucket access token is required.", "AUTHENTICATION");
    }
    this.accessToken = options.accessToken;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async getCurrentUser(): Promise<BitbucketUser> {
    const { body } = await this.request(`${API_BASE}/user`);
    return parseUser(body);
  }

  async listWorkspaces(): Promise<ProviderCollection<BitbucketWorkspace>> {
    const { items, complete } = await this.paginate("/workspaces", parseWorkspace);
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Workspaces visible to the authorized Bitbucket account were listed.",
        checkedAt,
      },
    };
  }

  async listRepositories(workspace: string): Promise<ProviderCollection<NormalizedRepository>> {
    const { items, complete } = await this.paginate(
      `/repositories/${encodeURIComponent(workspace)}`,
      parseRepository,
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Repositories visible to the authorized Bitbucket workspace were listed.",
        checkedAt,
      },
    };
  }

  async listPullRequests(
    workspace: string,
    repository: string,
    window: { start: Date; end: Date },
  ): Promise<ProviderCollection<NormalizedChangeRequest>> {
    if (window.start > window.end) {
      throw new SourceControlProviderError(
        "Invalid Bitbucket change-request window.",
        "INVALID_RESPONSE",
      );
    }
    const q = `updated_on >= "${window.start.toISOString()}" AND updated_on <= "${window.end.toISOString()}"`;
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&q=${encodeURIComponent(q)}`;
    const { items, complete } = await this.paginate(path, parsePullRequest);
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Pull requests updated in the requested window were collected.",
        checkedAt,
      },
    };
  }

  async listBranchRestrictions(
    workspace: string,
    repository: string,
  ): Promise<ProviderCollection<BitbucketBranchRestriction>> {
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/branch-restrictions`;
    const { items, complete } = await this.paginate(path, (value) => {
      if (
        !isRecord(value) ||
        typeof value["id"] !== "number" ||
        !Number.isSafeInteger(value["id"]) ||
        typeof value["kind"] !== "string" ||
        typeof value["pattern"] !== "string"
      ) {
        throw new SourceControlProviderError(
          "Bitbucket returned a branch restriction with an invalid shape.",
          "INVALID_RESPONSE",
        );
      }
      return {
        id: value["id"],
        kind: value["kind"],
        pattern: value["pattern"],
        value: typeof value["value"] === "number" ? value["value"] : null,
      };
    });
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail:
          "Bitbucket branch-restriction configurations were collected; this data alone does not verify effective branch protection or enforcement.",
        checkedAt,
      },
    };
  }

  async getPullRequestFiles(
    workspace: string,
    repository: string,
    pullRequestId: number,
  ): Promise<ProviderCollection<NormalizedChangedFile>> {
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/pullrequests/${pullRequestId}`;
    const { items: stats, complete } = await this.paginate(`${path}/diffstat`, parseChangedFile);
    if (!complete) {
      throw new SourceControlProviderError(
        "Bitbucket returned an incomplete diffstat; analysis cannot establish the full changed-file set.",
        "INVALID_RESPONSE",
      );
    }
    const diff = await this.requestText(`${API_BASE}${path}/diff`);
    const patches = parseUnifiedDiff(diff);
    const missingPaths = stats.filter((file) => !patches.has(file.path));
    if (missingPaths.length > 0) {
      throw new SourceControlProviderError(
        "Bitbucket diff content did not include every changed file; analysis cannot safely calculate complete change evidence.",
        "INVALID_RESPONSE",
      );
    }
    const items = stats.map((file) => ({ ...file, patch: patches.get(file.path) ?? null }));
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: "SUPPORTED",
        detail: "Complete diffstat and unified diff content were collected for every changed path.",
        checkedAt,
      },
    };
  }

  async listPullRequestCommits(
    workspace: string,
    repository: string,
    pullRequestId: number,
  ): Promise<ProviderCollection<NormalizedCommit>> {
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/pullrequests/${pullRequestId}/commits`;
    const { items, complete } = await this.paginate(
      path,
      parseCommit,
      MAX_PULL_REQUEST_COMMITS,
      "Bitbucket pull request exceeds the 10,000-commit safety limit.",
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
    workspace: string,
    repository: string,
    pullRequestId: number,
  ): Promise<ProviderCollection<NormalizedReview>> {
    const id = encodeURIComponent(String(pullRequestId));
    const { body } = await this.request(
      `${API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/pullrequests/${id}`,
    );
    if (!isRecord(body) || !Array.isArray(body["participants"])) {
      throw new SourceControlProviderError(
        "Bitbucket returned invalid pull-request participants.",
        "INVALID_RESPONSE",
      );
    }
    const flattened = body["participants"].map(parseParticipant);
    const checkedAt = new Date().toISOString();
    return {
      items: flattened,
      complete: true,
      capability: {
        status: "PARTIALLY_SUPPORTED",
        detail:
          "Participant approval state is available, but Bitbucket does not provide a matching approval commit or reliable approval timestamp here.",
        checkedAt,
      },
    };
  }

  async listPipelines(
    workspace: string,
    repository: string,
    headSha: string,
  ): Promise<ProviderCollection<NormalizedPipeline>> {
    const query = `target.commit.hash="${headSha}"`;
    const path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/pipelines/?q=${encodeURIComponent(query)}`;
    const { items, complete } = await this.paginate(path, parsePipeline);
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Bitbucket pipelines matching the requested commit were collected.",
        checkedAt,
      },
    };
  }

  private async paginate<T>(
    path: string,
    parse: (value: unknown) => T | T[],
    maxItems = Number.MAX_SAFE_INTEGER,
    maxItemsError = "Bitbucket returned more items than the configured safety limit.",
  ): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = [];
    let next: string | null =
      `${API_BASE}${path}${path.includes("?") ? "&" : "?"}pagelen=${PAGE_SIZE}`;
    let count = 0;
    while (next && count < MAX_PAGES) {
      const url = new URL(next);
      if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/2.0/")) {
        throw new SourceControlProviderError(
          "Bitbucket returned a pagination URL outside its API host.",
          "INVALID_RESPONSE",
        );
      }
      const { body, nextUrl } = await this.request(url.toString());
      const page = parsePage(body, parse);
      if (items.length + page.values.length > maxItems) {
        throw new SourceControlProviderError(maxItemsError, "INVALID_RESPONSE");
      }
      items.push(...page.values.flatMap((value) => (Array.isArray(value) ? value : [value])));
      next = page.next ?? nextUrl;
      count += 1;
    }
    return { items, complete: next === null };
  }

  private async request(url: string): Promise<{ body: unknown; nextUrl: string | null }> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${this.accessToken}` },
        redirect: "error",
      });
    } catch {
      throw new SourceControlProviderError("Bitbucket API is unavailable.", "UNAVAILABLE");
    }
    if (response.status === 401) {
      throw new SourceControlProviderError(
        "Bitbucket authorization expired or was revoked.",
        "AUTHENTICATION",
      );
    }
    if (response.status === 403) {
      throw new SourceControlProviderError(
        "Bitbucket denied this operation; required permissions may be unavailable.",
        "PERMISSION",
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new SourceControlProviderError(
        "Bitbucket rate limit reached.",
        "RATE_LIMITED",
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (!response.ok) {
      throw new SourceControlProviderError(
        `Bitbucket API request failed with status ${response.status}.`,
        response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SourceControlProviderError("Bitbucket returned invalid JSON.", "INVALID_RESPONSE");
    }
    const links = isRecord(body) && isRecord(body["links"]) ? body["links"] : null;
    const nextLink = stringAt(links, "next");
    return { body, nextUrl: nextLink };
  }

  private async requestText(url: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { Accept: "text/plain", Authorization: `Bearer ${this.accessToken}` },
        redirect: "error",
      });
    } catch {
      throw new SourceControlProviderError("Bitbucket API is unavailable.", "UNAVAILABLE");
    }
    if (response.status === 401) {
      throw new SourceControlProviderError(
        "Bitbucket authorization expired or was revoked.",
        "AUTHENTICATION",
      );
    }
    if (response.status === 403) {
      throw new SourceControlProviderError(
        "Bitbucket denied this operation; required permissions may be unavailable.",
        "PERMISSION",
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new SourceControlProviderError(
        "Bitbucket rate limit reached.",
        "RATE_LIMITED",
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (!response.ok) {
      throw new SourceControlProviderError(
        `Bitbucket API request failed with status ${response.status}.`,
        response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DIFF_BYTES) {
      throw new SourceControlProviderError(
        "Bitbucket pull-request diff exceeds the supported 5 MiB analysis limit.",
        "INVALID_RESPONSE",
      );
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_DIFF_BYTES) {
      throw new SourceControlProviderError(
        "Bitbucket pull-request diff exceeds the supported 5 MiB analysis limit.",
        "INVALID_RESPONSE",
      );
    }
    return body;
  }
}
