import { createHash } from "node:crypto";
import {
  SourceControlProviderError,
  type CapabilityReport,
  type NormalizedChangeRequest,
  type NormalizedChangedFile,
  type NormalizedPipeline,
  type NormalizedRepository,
  type NormalizedReview,
  type ProviderCollection,
  type ProviderEvidenceReference,
} from "./index.js";

const GITLAB_API_BASE = "https://gitlab.com/api/v4";
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string | null;
  visibility: "private" | "internal" | "public";
  web_url: string;
}

interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  state: "opened" | "closed" | "merged";
  author?: { username?: string };
  source_branch?: string;
  target_branch?: string;
  sha?: string;
  diff_refs?: { head_sha?: string };
  changes_count?: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  web_url: string;
}

interface GitLabApproval {
  user?: { username?: string };
  approved_at?: string | null;
}

interface GitLabPipeline {
  id: number;
  status: string;
  ref?: string;
  sha?: string;
  web_url?: string;
  created_at?: string;
}

interface GitLabPipelineJob {
  id: number;
  name: string;
  status: string;
}

export interface GitLabNativeFinding {
  id: string;
  reportType: string;
  severity: string;
  title: string;
  file: string | null;
  line: number | null;
  ruleId: string | null;
  status: string;
  scanner: string | null;
  pipelineId: string;
  headSha: string;
}

export interface GitLabProtectedBranch {
  name: string;
  allowForcePush: boolean;
  codeOwnerApprovalRequired: boolean;
  pushAccessLevels: number[];
  mergeAccessLevels: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArray<T>(value: unknown, parseItem: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new SourceControlProviderError(
      "GitLab returned an invalid collection.",
      "INVALID_RESPONSE",
    );
  }
  return value.map(parseItem);
}

function parseProject(value: unknown): GitLabProject {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "number" ||
    typeof value["name"] !== "string" ||
    typeof value["path_with_namespace"] !== "string" ||
    (typeof value["default_branch"] !== "string" && value["default_branch"] !== null) ||
    !["private", "internal", "public"].includes(String(value["visibility"])) ||
    typeof value["web_url"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "GitLab returned a project with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  return {
    id: value["id"],
    name: value["name"],
    path_with_namespace: value["path_with_namespace"],
    default_branch: value["default_branch"],
    visibility: value["visibility"] as GitLabProject["visibility"],
    web_url: value["web_url"],
  };
}

function parseMergeRequest(value: unknown): GitLabMergeRequest {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "number" ||
    typeof value["iid"] !== "number" ||
    typeof value["title"] !== "string" ||
    !["opened", "closed", "merged"].includes(String(value["state"])) ||
    typeof value["created_at"] !== "string" ||
    typeof value["updated_at"] !== "string" ||
    (typeof value["merged_at"] !== "string" && value["merged_at"] !== null) ||
    typeof value["web_url"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "GitLab returned a merge request with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const author = isRecord(value["author"]) ? value["author"] : undefined;
  const diffRefs = isRecord(value["diff_refs"]) ? value["diff_refs"] : undefined;
  return {
    id: value["id"],
    iid: value["iid"],
    title: value["title"],
    state: value["state"] as GitLabMergeRequest["state"],
    author: typeof author?.["username"] === "string" ? { username: author["username"] } : undefined,
    source_branch: typeof value["source_branch"] === "string" ? value["source_branch"] : undefined,
    target_branch: typeof value["target_branch"] === "string" ? value["target_branch"] : undefined,
    sha: typeof value["sha"] === "string" ? value["sha"] : undefined,
    diff_refs:
      typeof diffRefs?.["head_sha"] === "string" ? { head_sha: diffRefs["head_sha"] } : undefined,
    changes_count: typeof value["changes_count"] === "string" ? value["changes_count"] : undefined,
    created_at: value["created_at"],
    updated_at: value["updated_at"],
    merged_at: value["merged_at"],
    web_url: value["web_url"],
  };
}

function parseChangedFiles(value: unknown): {
  changes: Array<{
    old_path: string;
    new_path: string;
    new_file?: boolean;
    deleted_file?: boolean;
    renamed_file?: boolean;
    collapsed?: boolean;
    too_large?: boolean;
    diff?: string;
  }>;
} {
  if (!isRecord(value)) {
    throw new SourceControlProviderError(
      "GitLab returned invalid merge-request changes.",
      "INVALID_RESPONSE",
    );
  }
  return {
    changes: parseArray(value["changes"], (change) => {
      if (
        !isRecord(change) ||
        typeof change["old_path"] !== "string" ||
        typeof change["new_path"] !== "string" ||
        (change["diff"] !== undefined && typeof change["diff"] !== "string")
      ) {
        throw new SourceControlProviderError(
          "GitLab returned a changed file with an invalid shape.",
          "INVALID_RESPONSE",
        );
      }
      return {
        old_path: change["old_path"],
        new_path: change["new_path"],
        new_file: change["new_file"] === true,
        deleted_file: change["deleted_file"] === true,
        renamed_file: change["renamed_file"] === true,
        collapsed: change["collapsed"] === true,
        too_large: change["too_large"] === true,
        diff: typeof change["diff"] === "string" ? change["diff"] : undefined,
      };
    }),
  };
}

function parseApprovals(value: unknown): {
  approved_by?: GitLabApproval[];
  approvals_required?: number;
} {
  if (!isRecord(value)) {
    throw new SourceControlProviderError(
      "GitLab returned invalid approval information.",
      "INVALID_RESPONSE",
    );
  }
  return {
    approved_by:
      value["approved_by"] === undefined
        ? undefined
        : parseArray(value["approved_by"], (approval) => {
            if (!isRecord(approval)) {
              throw new SourceControlProviderError(
                "GitLab returned an invalid approval entry.",
                "INVALID_RESPONSE",
              );
            }
            const user = isRecord(approval["user"]) ? approval["user"] : undefined;
            return {
              user:
                typeof user?.["username"] === "string" ? { username: user["username"] } : undefined,
              approved_at:
                typeof approval["approved_at"] === "string" || approval["approved_at"] === null
                  ? approval["approved_at"]
                  : undefined,
            };
          }),
    approvals_required:
      typeof value["approvals_required"] === "number" ? value["approvals_required"] : undefined,
  };
}

function parsePipeline(value: unknown): GitLabPipeline {
  if (!isRecord(value) || typeof value["id"] !== "number" || typeof value["status"] !== "string") {
    throw new SourceControlProviderError(
      "GitLab returned a pipeline with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  return {
    id: value["id"],
    status: value["status"],
    ref: typeof value["ref"] === "string" ? value["ref"] : undefined,
    sha: typeof value["sha"] === "string" ? value["sha"] : undefined,
    web_url: typeof value["web_url"] === "string" ? value["web_url"] : undefined,
    created_at: typeof value["created_at"] === "string" ? value["created_at"] : undefined,
  };
}

function parsePipelineJob(value: unknown): GitLabPipelineJob {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "number" ||
    typeof value["name"] !== "string" ||
    typeof value["status"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "GitLab returned a pipeline job with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  return { id: value["id"], name: value["name"], status: value["status"] };
}

function parseNativeFinding(
  value: unknown,
  pipelineId: string,
  headSha: string,
): GitLabNativeFinding {
  if (
    !isRecord(value) ||
    (typeof value["uuid"] !== "string" &&
      typeof value["id"] !== "string" &&
      typeof value["id"] !== "number") ||
    typeof value["report_type"] !== "string" ||
    typeof value["severity"] !== "string" ||
    (typeof value["name"] !== "string" && value["report_type"] !== "secret_detection") ||
    typeof value["state"] !== "string"
  ) {
    throw new SourceControlProviderError(
      "GitLab returned a vulnerability finding with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const location = isRecord(value["location"]) ? value["location"] : null;
  const scanner = isRecord(value["scanner"]) ? value["scanner"] : null;
  const startLine = location?.["start_line"];
  const reportType = value["report_type"];
  const findingId = typeof value["uuid"] === "string" ? value["uuid"] : String(value["id"]);
  const isSecret = reportType.toLowerCase() === "secret_detection";
  return {
    id: isSecret ? createHash("sha256").update(findingId).digest("hex") : findingId,
    reportType,
    severity: value["severity"],
    title: isSecret
      ? "Secret detected"
      : typeof value["name"] === "string"
        ? value["name"]
        : "Unknown finding",
    file: typeof location?.["file"] === "string" ? location["file"] : null,
    line: typeof startLine === "number" && Number.isSafeInteger(startLine) ? startLine : null,
    ruleId: typeof scanner?.["external_id"] === "string" ? scanner["external_id"] : null,
    status: value["state"],
    scanner: typeof scanner?.["name"] === "string" ? scanner["name"] : null,
    pipelineId,
    headSha,
  };
}

function parseProtectedBranch(value: unknown): GitLabProtectedBranch {
  if (
    !isRecord(value) ||
    typeof value["name"] !== "string" ||
    typeof value["allow_force_push"] !== "boolean" ||
    typeof value["code_owner_approval_required"] !== "boolean"
  ) {
    throw new SourceControlProviderError(
      "GitLab returned a protected branch with an invalid shape.",
      "INVALID_RESPONSE",
    );
  }
  const accessLevels = (key: "push_access_levels" | "merge_access_levels"): number[] => {
    const raw = value[key];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) =>
      isRecord(entry) && typeof entry["access_level"] === "number" ? [entry["access_level"]] : [],
    );
  };
  return {
    name: value["name"],
    allowForcePush: value["allow_force_push"],
    codeOwnerApprovalRequired: value["code_owner_approval_required"],
    pushAccessLevels: accessLevels("push_access_levels"),
    mergeAccessLevels: accessLevels("merge_access_levels"),
  };
}

function parseSecretDetectionReport(
  value: unknown,
  pipelineId: string,
  headSha: string,
): GitLabNativeFinding[] {
  if (!isRecord(value)) {
    throw new SourceControlProviderError(
      "GitLab returned an invalid secret-detection report.",
      "INVALID_RESPONSE",
    );
  }
  return parseArray(value["vulnerabilities"], (entry) => {
    if (!isRecord(entry)) {
      throw new SourceControlProviderError(
        "GitLab returned an invalid secret-detection finding.",
        "INVALID_RESPONSE",
      );
    }
    const location = isRecord(entry["location"]) ? entry["location"] : null;
    const startLine = location?.["start_line"];
    const title = typeof entry["category"] === "string" ? entry["category"] : "Secret detected";
    const file = typeof location?.["file"] === "string" ? location["file"] : null;
    const line =
      typeof startLine === "number" && Number.isSafeInteger(startLine) ? startLine : null;
    const identityFields = [
      typeof entry["id"] === "string" || typeof entry["id"] === "number" ? String(entry["id"]) : "",
      typeof entry["uuid"] === "string" ? entry["uuid"] : "",
      typeof entry["cve"] === "string" ? entry["cve"] : "",
      typeof entry["category"] === "string" ? entry["category"] : "",
      file ?? "",
      line === null ? "" : String(line),
    ];
    if (typeof entry["severity"] !== "string" || identityFields.every((field) => !field)) {
      throw new SourceControlProviderError(
        "GitLab returned a secret-detection finding with an invalid shape.",
        "INVALID_RESPONSE",
      );
    }
    return {
      id: createHash("sha256").update(identityFields.join(":")).digest("hex"),
      reportType: "secret_detection",
      severity: entry["severity"],
      title,
      file,
      line,
      ruleId: typeof entry["category"] === "string" ? entry["category"] : null,
      status: typeof entry["state"] === "string" ? entry["state"] : "detected",
      scanner: "GitLab Secret Detection",
      pipelineId,
      headSha,
    };
  });
}

export interface GitLabClientOptions {
  accessToken: string;
  fetchImplementation?: typeof fetch;
}

function evidence(
  externalId: string,
  collectedAt: string,
  url?: string,
): ProviderEvidenceReference {
  return {
    provider: "GITLAB",
    externalId,
    collectedAt,
    ...(url ? { url } : {}),
  };
}

function parseInteger(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeRepository(project: GitLabProject, collectedAt: string): NormalizedRepository {
  const separator = project.path_with_namespace.lastIndexOf("/");
  if (separator < 1 || separator === project.path_with_namespace.length - 1) {
    throw new SourceControlProviderError(
      "GitLab returned a project without a valid namespace path.",
      "INVALID_RESPONSE",
    );
  }
  return {
    provider: "GITLAB",
    externalId: String(project.id),
    owner: project.path_with_namespace.slice(0, separator),
    name: project.path_with_namespace.slice(separator + 1),
    defaultBranch: project.default_branch,
    private: project.visibility !== "public",
    webUrl: project.web_url,
    original: evidence(String(project.id), collectedAt, project.web_url),
  };
}

function normalizeMergeRequest(
  projectId: string,
  request: GitLabMergeRequest,
  collectedAt: string,
): NormalizedChangeRequest {
  const state =
    request.state === "merged" ? "MERGED" : request.state === "closed" ? "CLOSED" : "OPEN";
  return {
    provider: "GITLAB",
    externalId: String(request.id),
    number: request.iid,
    title: request.title,
    state,
    author: request.author?.username ?? null,
    sourceBranch: request.source_branch ?? null,
    targetBranch: request.target_branch ?? null,
    headSha: request.diff_refs?.head_sha ?? request.sha ?? null,
    additions: null,
    deletions: null,
    changedFilesCount: parseInteger(request.changes_count),
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    mergedAt: request.merged_at,
    webUrl: request.web_url,
    original: evidence(`${projectId}!${request.iid}`, collectedAt, request.web_url),
  };
}

function isTrustedArtifactHost(hostname: string): boolean {
  return (
    hostname === "gitlab.com" ||
    hostname.endsWith(".gitlab.com") ||
    hostname === "storage.googleapis.com" ||
    hostname.endsWith(".storage.googleapis.com") ||
    hostname.endsWith(".amazonaws.com")
  );
}

export class GitLabClient {
  private readonly accessToken: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: GitLabClientOptions) {
    if (!options.accessToken.trim()) {
      throw new SourceControlProviderError("GitLab access token is required.", "AUTHENTICATION");
    }
    this.accessToken = options.accessToken;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async getCurrentUser(): Promise<{ id: string; username: string; name: string | null }> {
    const user = await this.request("/user", (value) => {
      if (
        !isRecord(value) ||
        typeof value["id"] !== "number" ||
        typeof value["username"] !== "string"
      ) {
        throw new SourceControlProviderError(
          "GitLab returned an invalid user profile.",
          "INVALID_RESPONSE",
        );
      }
      return {
        id: value["id"],
        username: value["username"],
        name: typeof value["name"] === "string" ? value["name"] : undefined,
      };
    });
    if (!Number.isSafeInteger(user.id) || !user.username) {
      throw new SourceControlProviderError(
        "GitLab returned an invalid user profile.",
        "INVALID_RESPONSE",
      );
    }
    return { id: String(user.id), username: user.username, name: user.name ?? null };
  }

  async listRepositories(): Promise<ProviderCollection<NormalizedRepository>> {
    const { items, complete } = await this.paginate(
      "/projects?membership=true&order_by=last_activity_at&sort=desc",
      parseProject,
    );
    const collectedAt = new Date().toISOString();
    return {
      items: items.map((project) => normalizeRepository(project, collectedAt)),
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: complete
          ? "Membership-visible GitLab.com projects were enumerated."
          : "Repository enumeration reached the provider pagination safety limit.",
        checkedAt: collectedAt,
      },
    };
  }

  async listMergeRequests(
    projectId: string,
    window: { start: Date; end: Date },
  ): Promise<ProviderCollection<NormalizedChangeRequest>> {
    const project = encodeURIComponent(projectId);
    const params = new URLSearchParams({
      scope: "all",
      state: "all",
      updated_after: window.start.toISOString(),
      updated_before: window.end.toISOString(),
      order_by: "updated_at",
      sort: "asc",
    });
    const { items, complete } = await this.paginate(
      `/projects/${project}/merge_requests?${params.toString()}`,
      parseMergeRequest,
    );
    const collectedAt = new Date().toISOString();
    return {
      items: items.map((item) => normalizeMergeRequest(projectId, item, collectedAt)),
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: complete
          ? "Merge requests updated in the requested time window were enumerated."
          : "Merge-request enumeration reached the provider pagination safety limit.",
        checkedAt: collectedAt,
      },
    };
  }

  async getMergeRequestFiles(
    projectId: string,
    mergeRequestIid: number,
  ): Promise<ProviderCollection<NormalizedChangedFile>> {
    const project = encodeURIComponent(projectId);
    const body = await this.request(
      `/projects/${project}/merge_requests/${mergeRequestIid}/changes`,
      parseChangedFiles,
    );
    const collectedAt = new Date().toISOString();
    return {
      items: body.changes.map((change) => {
        const patch = change.diff ?? "";
        const isTruncated =
          change.collapsed === true ||
          change.too_large === true ||
          !patch ||
          (patch.includes("<!--") && patch.includes("diff truncated"));
        const status = change.new_file
          ? "ADDED"
          : change.deleted_file
            ? "DELETED"
            : change.renamed_file
              ? "RENAMED"
              : "MODIFIED";
        const path = change.new_path || change.old_path;
        if (!path) {
          throw new SourceControlProviderError(
            "GitLab returned a changed file without a path.",
            "INVALID_RESPONSE",
          );
        }
        const additions = patch
          ? patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"))
              .length
          : null;
        const deletions = patch
          ? patch.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"))
              .length
          : null;
        return {
          path,
          status,
          additions: isTruncated ? null : additions,
          deletions: isTruncated ? null : deletions,
          patch: patch || null,
        };
      }),
      complete: body.changes.every(
        (change) =>
          Boolean(change.diff) &&
          change.collapsed !== true &&
          change.too_large !== true &&
          !(change.diff?.includes("<!--") && change.diff.includes("diff truncated")),
      ),
      capability: {
        status: body.changes.every(
          (change) =>
            Boolean(change.diff) &&
            change.collapsed !== true &&
            change.too_large !== true &&
            !(change.diff?.includes("<!--") && change.diff.includes("diff truncated")),
        )
          ? "SUPPORTED"
          : "PARTIALLY_SUPPORTED",
        detail: "GitLab may omit or truncate diffs for large files or oversized merge requests.",
        checkedAt: collectedAt,
      },
    };
  }

  async listMergeRequestApprovals(
    projectId: string,
    mergeRequestIid: number,
  ): Promise<ProviderCollection<NormalizedReview>> {
    const project = encodeURIComponent(projectId);
    const body = await this.request(
      `/projects/${project}/merge_requests/${mergeRequestIid}/approvals`,
      parseApprovals,
    );
    const collectedAt = new Date().toISOString();
    const items = (body.approved_by ?? []).map((approval, index) => ({
      provider: "GITLAB" as const,
      externalId: `${projectId}!${mergeRequestIid}:approval:${index}`,
      actor: approval.user?.username ?? null,
      state: "APPROVED" as const,
      submittedAt: approval.approved_at ?? null,
      commitSha: null,
      original: evidence(`${projectId}!${mergeRequestIid}:approval:${index}`, collectedAt),
    }));
    return {
      items,
      complete: Array.isArray(body.approved_by),
      capability: {
        status: "PARTIALLY_SUPPORTED",
        detail:
          "GitLab approval state is available, but this endpoint does not expose every discussion or prove approvals target the current head commit.",
        checkedAt: collectedAt,
      },
    };
  }

  async listMergeRequestPipelines(
    projectId: string,
    mergeRequestIid: number,
  ): Promise<ProviderCollection<NormalizedPipeline>> {
    const project = encodeURIComponent(projectId);
    const body = await this.request(
      `/projects/${project}/merge_requests/${mergeRequestIid}/pipelines`,
      (value) => parseArray(value, parsePipeline),
    );
    const collectedAt = new Date().toISOString();
    return {
      items: body.map((pipeline) => ({
        provider: "GITLAB",
        externalId: String(pipeline.id),
        status: pipeline.status,
        ref: pipeline.ref ?? null,
        sha: pipeline.sha ?? null,
        webUrl: pipeline.web_url ?? null,
        original: evidence(String(pipeline.id), collectedAt, pipeline.web_url),
      })),
      complete: true,
      capability: {
        status: "SUPPORTED",
        detail: "Pipeline status associated with the merge request was collected.",
        checkedAt: collectedAt,
      },
    };
  }

  async listPipelineJobs(
    projectId: string,
    pipelineId: string,
  ): Promise<ProviderCollection<GitLabPipelineJob>> {
    const project = encodeURIComponent(projectId);
    const pipeline = encodeURIComponent(pipelineId);
    const { items, complete } = await this.paginate(
      `/projects/${project}/pipelines/${pipeline}/jobs`,
      parsePipelineJob,
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: "Jobs associated with the specified GitLab pipeline were enumerated.",
        checkedAt,
      },
    };
  }

  async listPipelineVulnerabilityFindings(
    projectId: string,
    pipelineId: string,
    headSha: string,
  ): Promise<ProviderCollection<GitLabNativeFinding>> {
    const project = encodeURIComponent(projectId);
    const pipeline = encodeURIComponent(pipelineId);
    const { items, complete } = await this.paginate(
      `/projects/${project}/vulnerability_findings?scope=all&pipeline_id=${pipeline}`,
      (value) => parseNativeFinding(value, pipelineId, headSha),
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: complete
          ? "GitLab vulnerability findings for the specified pipeline were collected."
          : "GitLab vulnerability finding pagination reached its safety limit.",
        checkedAt,
      },
    };
  }

  async getSecretDetectionReport(
    projectId: string,
    jobId: string,
    pipelineId: string,
    headSha: string,
  ): Promise<ProviderCollection<GitLabNativeFinding>> {
    const project = encodeURIComponent(projectId);
    const job = encodeURIComponent(jobId);
    const artifactUrl = `${GITLAB_API_BASE}/projects/${project}/jobs/${job}/artifacts?file_type=secret_detection`;
    const headers = {
      Accept: "application/json",
      "PRIVATE-TOKEN": this.accessToken,
    };
    let response = await this.fetchImplementation(artifactUrl, {
      headers,
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SourceControlProviderError(
          "GitLab redirected the secret-detection report without a destination.",
          "INVALID_RESPONSE",
        );
      }
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, artifactUrl);
      } catch {
        throw new SourceControlProviderError(
          "GitLab returned an invalid secret-report redirect.",
          "INVALID_RESPONSE",
        );
      }
      if (
        redirectUrl.protocol !== "https:" ||
        redirectUrl.username ||
        redirectUrl.password ||
        !isTrustedArtifactHost(redirectUrl.hostname)
      ) {
        throw new SourceControlProviderError(
          "GitLab returned an untrusted secret-report redirect.",
          "INVALID_RESPONSE",
        );
      }
      response = await this.fetchImplementation(redirectUrl, {
        headers: { Accept: "application/json" },
        redirect: "error",
      });
    }
    if (response.status === 401) {
      throw new SourceControlProviderError(
        "GitLab authorization expired or was revoked.",
        "AUTHENTICATION",
      );
    }
    if (response.status === 403) {
      throw new SourceControlProviderError(
        "GitLab denied access to the secret-detection report.",
        "PERMISSION",
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new SourceControlProviderError(
        "GitLab rate limit reached.",
        "RATE_LIMITED",
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (!response.ok) {
      throw new SourceControlProviderError(
        `GitLab secret-report request failed with status ${response.status}.`,
        response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
      throw new SourceControlProviderError(
        "GitLab secret-detection report exceeds the supported size limit.",
        "INVALID_RESPONSE",
      );
    }
    let report: unknown;
    try {
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > 5 * 1024 * 1024) {
        throw new SourceControlProviderError(
          "GitLab secret-detection report exceeds the supported size limit.",
          "INVALID_RESPONSE",
        );
      }
      report = JSON.parse(body) as unknown;
    } catch (error) {
      if (error instanceof SourceControlProviderError) throw error;
      throw new SourceControlProviderError(
        "GitLab returned invalid JSON for its secret-detection report.",
        "INVALID_RESPONSE",
      );
    }
    const findings = parseSecretDetectionReport(report, pipelineId, headSha);
    const checkedAt = new Date().toISOString();
    return {
      items: findings,
      complete: true,
      capability: {
        status: "SUPPORTED",
        detail:
          "GitLab secret-detection report was collected from the selected pipeline job; secret values are excluded from normalized findings.",
        checkedAt,
      },
    };
  }

  async listProtectedBranches(
    projectId: string,
  ): Promise<ProviderCollection<GitLabProtectedBranch>> {
    const project = encodeURIComponent(projectId);
    const { items, complete } = await this.paginate(
      `/projects/${project}/protected_branches`,
      parseProtectedBranch,
    );
    const checkedAt = new Date().toISOString();
    return {
      items,
      complete,
      capability: {
        status: complete ? "SUPPORTED" : "PARTIALLY_SUPPORTED",
        detail: complete
          ? "GitLab protected-branch settings were collected."
          : "Protected-branch pagination reached its safety limit.",
        checkedAt,
      },
    };
  }

  getCapabilities(): CapabilityReport {
    const checkedAt = new Date().toISOString();
    return {
      provider: "GITLAB",
      capabilities: {
        repository_discovery: {
          status: "SUPPORTED",
          detail: "GitLab.com membership projects.",
          checkedAt,
        },
        change_request_discovery: { status: "SUPPORTED", detail: "Merge requests.", checkedAt },
        commit_metadata: {
          status: "NOT_YET_IMPLEMENTED",
          detail: "Commit collection adapter is not yet wired into Nomalog.",
          checkedAt,
        },
        changed_files: {
          status: "PARTIALLY_SUPPORTED",
          detail: "Merge-request diffs may be omitted or truncated.",
          checkedAt,
        },
        review_evidence: {
          status: "PARTIALLY_SUPPORTED",
          detail:
            "Approvals are available; discussion review and current-head linkage are incomplete.",
          checkedAt,
        },
        branch_policy: {
          status: "SUPPORTED",
          detail:
            "GitLab protected branches, force-push settings, and code-owner approval requirement can be collected; approval-rule details remain partial.",
          checkedAt,
        },
        ci_status: { status: "SUPPORTED", detail: "Merge-request pipeline status.", checkedAt },
        webhooks: {
          status: "PARTIALLY_SUPPORTED",
          detail:
            "Authenticated merge-request webhook ingestion is implemented; project registration is manual and other event classes are not processed.",
          checkedAt,
        },
        security_findings: {
          status: "PARTIALLY_SUPPORTED",
          detail:
            "Pipeline-scoped vulnerability findings require GitLab Ultimate permissions; secret-detection reports are read from configured job artifacts. Missing scans and denied access remain unavailable.",
          checkedAt,
        },
      },
    };
  }

  private async paginate<T>(
    initialPath: string,
    parseItem: (item: unknown) => T,
  ): Promise<{ items: T[]; complete: boolean }> {
    const all: T[] = [];
    let path: string | null = initialPath;
    let pageCount = 0;
    while (path && pageCount < MAX_PAGES) {
      const separator = path.includes("?") ? "&" : "?";
      const pagePath: string = `${path}${separator}per_page=${PAGE_SIZE}`;
      const response = await this.requestWithHeaders(pagePath, (body) =>
        parseArray(body, parseItem),
      );
      all.push(...response.body);
      const nextPage: string | null = response.headers.get("x-next-page");
      path = nextPage ? setPage(path, nextPage) : null;
      pageCount += 1;
    }
    return { items: all, complete: path === null };
  }

  private async request<T>(path: string, parse: (body: unknown) => T): Promise<T> {
    return (await this.requestWithHeaders(path, parse)).body;
  }

  private async requestWithHeaders<T>(
    path: string,
    parse: (body: unknown) => T,
  ): Promise<{ body: T; headers: Headers }> {
    const response = await this.fetchImplementation(`${GITLAB_API_BASE}${path}`, {
      headers: {
        Accept: "application/json",
        "PRIVATE-TOKEN": this.accessToken,
      },
      redirect: "error",
    });
    if (response.status === 401) {
      throw new SourceControlProviderError(
        "GitLab authorization expired or was revoked.",
        "AUTHENTICATION",
      );
    }
    if (response.status === 403) {
      throw new SourceControlProviderError(
        "GitLab denied this operation; required permissions may be unavailable.",
        "PERMISSION",
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new SourceControlProviderError(
        "GitLab rate limit reached.",
        "RATE_LIMITED",
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (!response.ok) {
      throw new SourceControlProviderError(
        `GitLab API request failed with status ${response.status}.`,
        response.status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE",
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SourceControlProviderError("GitLab returned invalid JSON.", "INVALID_RESPONSE");
    }
    return { body: parse(body), headers: response.headers };
  }
}

function setPage(path: string, page: string): string {
  const url = new URL(path, GITLAB_API_BASE);
  url.searchParams.set("page", page);
  return `${url.pathname}${url.search}`;
}
