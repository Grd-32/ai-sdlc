export type SourceControlProviderId = "GITHUB" | "GITLAB" | "BITBUCKET" | "AZURE_DEVOPS";

export type CapabilityStatus =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "UNSUPPORTED"
  | "UNAVAILABLE_DUE_TO_PERMISSIONS"
  | "UNAVAILABLE_DUE_TO_PROVIDER_CONFIGURATION"
  | "NOT_YET_IMPLEMENTED";

export interface ProviderCapability {
  status: CapabilityStatus;
  detail: string;
  checkedAt: string;
}

export type SourceControlCapability =
  | "repository_discovery"
  | "change_request_discovery"
  | "commit_metadata"
  | "changed_files"
  | "review_evidence"
  | "branch_policy"
  | "ci_status"
  | "webhooks"
  | "security_findings";

export interface CapabilityReport {
  provider: SourceControlProviderId;
  capabilities: Partial<Record<SourceControlCapability, ProviderCapability>>;
}

export interface ProviderEvidenceReference {
  provider: SourceControlProviderId;
  externalId: string;
  url?: string;
  collectedAt: string;
}

export interface NormalizedRepository {
  provider: SourceControlProviderId;
  externalId: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean;
  webUrl: string;
  original: ProviderEvidenceReference;
}

export interface NormalizedChangeRequest {
  provider: SourceControlProviderId;
  externalId: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  headSha: string | null;
  additions: number | null;
  deletions: number | null;
  changedFilesCount: number | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  webUrl: string;
  original: ProviderEvidenceReference;
}

export interface NormalizedCommit {
  provider: SourceControlProviderId;
  sha: string;
  message: string;
  authorName: string | null;
  committedAt: string | null;
  webUrl: string | null;
  original: ProviderEvidenceReference;
}

export interface NormalizedChangedFile {
  path: string;
  status: "ADDED" | "MODIFIED" | "DELETED" | "RENAMED" | "UNKNOWN";
  additions: number | null;
  deletions: number | null;
  patch: string | null;
}

export interface NormalizedReview {
  provider: SourceControlProviderId;
  externalId: string;
  actor: string | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "UNKNOWN";
  submittedAt: string | null;
  commitSha: string | null;
  original: ProviderEvidenceReference;
}

export interface NormalizedPipeline {
  provider: SourceControlProviderId;
  externalId: string;
  status: string;
  ref: string | null;
  sha: string | null;
  webUrl: string | null;
  original: ProviderEvidenceReference;
}

export interface ProviderCollection<T> {
  items: T[];
  capability: ProviderCapability;
  complete: boolean;
}

export class SourceControlProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      "AUTHENTICATION" | "PERMISSION" | "RATE_LIMITED" | "UNAVAILABLE" | "INVALID_RESPONSE",
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SourceControlProviderError";
  }
}

export {
  decryptSourceControlSecret,
  decryptSourceControlCredentials,
  encryptSourceControlSecret,
  encryptSourceControlCredentials,
  validateSourceControlEncryptionKey,
  type SourceControlOAuthCredentials,
  decryptGitLabCredentials,
  encryptGitLabCredentials,
  validateGitLabEncryptionKey,
  type GitLabOAuthCredentials,
} from "./credentials.js";
export {
  exchangeGitLabOAuthCode,
  refreshGitLabOAuthToken,
  revokeGitLabOAuthToken,
  type GitLabOAuthToken,
} from "./gitlab-oauth.js";
export { GitLabClient } from "./gitlab.js";
export { BitbucketClient, type BitbucketBranchRestriction } from "./bitbucket.js";
export { AzureDevOpsClient } from "./azure-devops.js";
export type { AzureDevOpsBranchPolicy, AzureDevOpsSecurityAlert } from "./azure-devops.js";
export {
  exchangeBitbucketOAuthCode,
  getBitbucketAuthorizationUrl,
  refreshBitbucketOAuthToken,
  revokeBitbucketOAuthToken,
  type BitbucketOAuthToken,
} from "./bitbucket-oauth.js";
export {
  exchangeAzureDevOpsOAuthCode,
  getAzureDevOpsAuthorizationUrl,
  refreshAzureDevOpsOAuthToken,
  type AzureDevOpsOAuthToken,
} from "./azure-devops-oauth.js";
