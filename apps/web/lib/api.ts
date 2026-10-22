// import { cache } from "react";
// import { cookies } from "next/headers";
// import { getApiUrl } from "./utils";

// export interface ApiEnvelope<T> {
//   data: T | null;
//   error: { code: string; message: string } | null;
// }

// export const SELECTED_ORG_COOKIE = "ai_sdlc_selected_org";

// async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
//   try {
//     const cookieStore = await cookies();
//     const res = await fetch(`${getApiUrl()}${path}`, {
//       ...init,
//       headers: {
//         ...(init.headers ?? {}),
//         Cookie: cookieStore.toString(),
//       },
//       cache: "no-store",
//     });
//     return (await res.json()) as ApiEnvelope<T>;
//   } catch {
//     return { data: null, error: { code: "NETWORK_ERROR", message: "Failed to reach API" } };
//   }
// }

// export interface CurrentUser {
//   id: string;
//   email: string;
//   name: string | null;
//   avatarUrl: string | null;
//   username: string | null;
// }

// export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
//   const result = await apiFetch<CurrentUser>("/api/auth/me");
//   return result.data;
// });

// export interface OrganizationSummary {
//   id: string;
//   name: string;
//   slug: string;
//   role: string;
// }

// export const getOrganizations = cache(async (): Promise<OrganizationSummary[]> => {
//   const result = await apiFetch<OrganizationSummary[]>("/api/organizations");
//   return result.data ?? [];
// });

// export async function getSelectedOrganization(
//   organizations: OrganizationSummary[],
// ): Promise<OrganizationSummary | null> {
//   if (organizations.length === 0) {
//     return null;
//   }
//   const cookieStore = await cookies();
//   const selectedId = cookieStore.get(SELECTED_ORG_COOKIE)?.value;
//   return organizations.find((org) => org.id === selectedId) ?? organizations[0] ?? null;
// }

// export interface OverviewMetrics {
//   aiAssistedPullRequests: number;
//   highRiskChanges: number;
//   criticalChanges: number;
//   blockedChanges: number;
//   reviewRequiredChanges: number;
//   totalPassports: number;
// }

// export async function getOverview(organizationId: string): Promise<OverviewMetrics | null> {
//   const result = await apiFetch<OverviewMetrics>(`/api/organizations/${organizationId}/overview`);
//   return result.data;
// }

// export interface PullRequestSummary {
//   id: string;
//   number: number;
//   title: string;
//   state: string;
//   author: string | null;
//   repository: string;
//   repositoryId: string;
//   aiAgent: string | null;
//   aiInvolvement: "YES" | "NO" | "UNKNOWN";
//   aiConfidence: number | null;
//   riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
//   riskScore: number | null;
//   policyAction: "ALLOW" | "REVIEW" | "BLOCK" | null;
//   createdAt: string;
// }

// export async function getPullRequests(
//   organizationId: string,
//   filters: { repositoryId?: string; state?: string } = {},
// ): Promise<PullRequestSummary[]> {
//   const params = new URLSearchParams();
//   if (filters.repositoryId) params.set("repositoryId", filters.repositoryId);
//   if (filters.state) params.set("state", filters.state);
//   const query = params.toString() ? `?${params.toString()}` : "";

//   const result = await apiFetch<PullRequestSummary[]>(
//     `/api/organizations/${organizationId}/pull-requests${query}`,
//   );
//   return result.data ?? [];
// }

// export interface CodeChangeRecord {
//   id: string;
//   filePath: string;
//   sensitiveAreas: string[];
//   additions: number;
//   deletions: number;
//   status: string;
// }

// export interface AIActivityRecord {
//   id: string;
//   agent: string;
//   model: string | null;
//   involvement: "YES" | "NO" | "UNKNOWN";
//   confidence: number;
//   source: string;
// }

// export interface RiskAssessmentRecord {
//   id: string;
//   score: number;
//   level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
//   explanation: string | null;
//   modelVersion: string;
// }

// export interface PolicyDecisionRecord {
//   id: string;
//   action: "ALLOW" | "REVIEW" | "BLOCK";
//   matchedRuleIds: string[];
//   requiredApprovals: string[];
//   explanation: string | null;
// }

// export interface EvidenceRecord {
//   id: string;
//   type: string;
//   status: "PASS" | "FAIL" | "UNKNOWN" | "NOT_RUN" | "NOT_APPLICABLE";
//   source: string;
//   details: string | null;
//   createdAt: string;
// }

// export interface SecurityFindingRecord {
//   id: string;
//   provider: string;
//   category: string | null;
//   severity: string;
//   title: string;
//   status: string;
// }

// export interface PullRequestDetail {
//   id: string;
//   number: number;
//   title: string;
//   state: string;
//   authorLogin: string | null;
//   repository: { owner: string; name: string; criticality: string };
//   aiActivities: AIActivityRecord[];
//   riskAssessments: RiskAssessmentRecord[];
//   policyDecisions: PolicyDecisionRecord[];
//   codeChanges: CodeChangeRecord[];
//   findings: SecurityFindingRecord[];
//   evidence: EvidenceRecord[];
// }

// export async function getPullRequestDetail(
//   organizationId: string,
//   pullRequestId: string,
// ): Promise<PullRequestDetail | null> {
//   const result = await apiFetch<PullRequestDetail>(
//     `/api/organizations/${organizationId}/pull-requests/${pullRequestId}`,
//   );
//   return result.data;
// }

// export interface RepositorySummary {
//   id: string;
//   owner: string;
//   name: string;
//   criticality: string;
//   enabled: boolean;
//   _count: { pullRequests: number };
// }

// export async function getRepositories(organizationId: string): Promise<RepositorySummary[]> {
//   const result = await apiFetch<RepositorySummary[]>(`/api/organizations/${organizationId}/repositories`);
//   return result.data ?? [];
// }

// export interface PolicyRuleRecord {
//   id: string;
//   type: string;
//   field: string | null;
//   operator: string | null;
//   precedence: number;
// }

// export interface PolicySummary {
//   id: string;
//   name: string;
//   description: string | null;
//   enabled: boolean;
//   version: string;
//   policyRules: PolicyRuleRecord[];
// }

// export async function getPolicies(organizationId: string): Promise<PolicySummary[]> {
//   const result = await apiFetch<PolicySummary[]>(`/api/organizations/${organizationId}/policies`);
//   return result.data ?? [];
// }

// export async function getEvidence(
//   organizationId: string,
//   filters: { pullRequestId?: string } = {},
// ): Promise<EvidenceRecord[]> {
//   const params = new URLSearchParams();
//   if (filters.pullRequestId) params.set("pullRequestId", filters.pullRequestId);
//   const query = params.toString() ? `?${params.toString()}` : "";

//   const result = await apiFetch<EvidenceRecord[]>(`/api/organizations/${organizationId}/evidence${query}`);
//   return result.data ?? [];
// }

// export interface AgentSummary {
//   agent: string;
//   pullRequestCount: number;
//   repositoryCount: number;
//   averageRiskScore: number | null;
//   blockedCount: number;
//   reviewRequiredCount: number;
// }

// export async function getAgents(organizationId: string): Promise<AgentSummary[]> {
//   const result = await apiFetch<AgentSummary[]>(`/api/organizations/${organizationId}/agents`);
//   return result.data ?? [];
// }

// export interface InstallationSummary {
//   id: string;
//   githubInstallationId: string;
//   accountLogin: string | null;
//   accountType: string | null;
//   active: boolean;
//   createdAt: string;
// }

// export async function getInstallations(organizationId: string): Promise<InstallationSummary[]> {
//   const result = await apiFetch<InstallationSummary[]>(`/api/organizations/${organizationId}/installations`);
//   return result.data ?? [];
// }

// export interface AuditEventSummary {
//   id: string;
//   eventType: string;
//   actor: string | null;
//   metadata: Record<string, unknown> | null;
//   createdAt: string;
// }

// export async function getAuditEvents(organizationId: string): Promise<AuditEventSummary[]> {
//   const result = await apiFetch<AuditEventSummary[]>(`/api/organizations/${organizationId}/audit-events`);
//   return result.data ?? [];
// }
import { cache } from "react";
import { cookies } from "next/headers";
import type { PolicyCondition } from "@ai-sdlc/policy";
import { getApiUrl } from "./utils";

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

export const SELECTED_ORG_COOKIE = "ai_sdlc_selected_org";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Cookie: cookieStore.toString(),
      },
      cache: "no-store",
    });
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    return { data: null, error: { code: "NETWORK_ERROR", message: "Failed to reach API" } };
  }
}

/**
 * For Route Handlers performing a mutation (POST/PATCH/DELETE) against the
 * API — same cookie-forwarding as apiFetch, but sends a JSON body and
 * surfaces whether the response was ok (2xx) so the caller can decide how
 * to redirect.
 */
export async function mutateApi<T = unknown>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{
  ok: boolean;
  status: number | null;
  data: T | null;
  error: { code: string; message: string } | null;
}> {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${getApiUrl()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieStore.toString(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json()) as ApiEnvelope<T>;
    return { ok: res.ok, status: res.status, data: json.data, error: json.error };
  } catch {
    return {
      ok: false,
      status: null,
      data: null,
      error: { code: "NETWORK_ERROR", message: "Failed to reach API" },
    };
  }
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  username: string | null;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const result = await apiFetch<CurrentUser>("/api/auth/me");
  return result.data;
});

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  policyApprovalQuorum: number;
  ssoEnforced: boolean;
}

export interface CommercialPlanOffer {
  id: "FREE_ASSESSMENT" | "PROFESSIONAL" | "ENTERPRISE";
  name: string;
  description: string;
  displayPrice: string;
  interval: "none" | "month" | "year" | "custom";
  selfServeCheckout: boolean;
  entitlements: {
    maxRepositories: number;
    assessmentsPerMonth: number;
    analysisJobsPerMonth: number;
    continuousAnalysis: boolean;
    policyEnforcement: boolean;
    retentionDays: number;
    dataExport: boolean;
    maxTeamMembers: number;
    enterpriseIntegrations: boolean;
  };
}

export const getCommercialPlans = cache(async (): Promise<CommercialPlanOffer[]> => {
  const result = await apiFetch<CommercialPlanOffer[]>("/api/billing/plans");
  return result.data ?? [];
});

export const getOrganizations = cache(async (): Promise<OrganizationSummary[]> => {
  const result = await apiFetch<OrganizationSummary[]>("/api/organizations");
  return result.data ?? [];
});

export interface OrganizationMemberSummary {
  id: string;
  userId: string;
  role: string;
  email: string;
  name: string | null;
  username: string | null;
  externalId: string | null;
  active: boolean;
  lastLoginAt: string | null;
}

export async function getOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMemberSummary[]> {
  const result = await apiFetch<OrganizationMemberSummary[]>(
    `/api/organizations/${organizationId}/members`,
  );
  return result.data ?? [];
}

export async function getSelectedOrganization(
  organizations: OrganizationSummary[],
): Promise<OrganizationSummary | null> {
  if (organizations.length === 0) {
    return null;
  }
  const cookieStore = await cookies();
  const selectedId = cookieStore.get(SELECTED_ORG_COOKIE)?.value;
  return organizations.find((org) => org.id === selectedId) ?? organizations[0] ?? null;
}

export interface OverviewMetrics {
  aiAssistedPullRequests: number;
  unattributedPullRequests: number;
  highRiskChanges: number;
  criticalChanges: number;
  blockedChanges: number;
  reviewRequiredChanges: number;
  totalPassports: number;
}

export async function getOverview(organizationId: string): Promise<OverviewMetrics | null> {
  const result = await apiFetch<OverviewMetrics>(`/api/organizations/${organizationId}/overview`);
  return result.data;
}

export interface GovernanceAnalytics {
  days: 7 | 30 | 90;
  periodStart: string;
  openFindings: number;
  openFindingsBySeverity: Record<string, number>;
  overdueFindings: number;
  activeRiskAcceptances: number;
  expiredRiskAcceptances: number;
  resolvedFindings: number;
  averageRemediationDays: number | null;
  completedReviews: number;
  reviewApprovalRate: number | null;
  newPullRequests: number;
  enabledRepositories: number;
  recentlyAssessedRepositories: number;
  repositoryAssessmentCoveragePercent: number | null;
  pullRequestsInPeriod: number;
  analyzedPullRequests: number;
  changeAnalysisCoveragePercent: number | null;
  unknownProvenancePullRequests: number;
  provenanceUnknownPercent: number | null;
  connectedSourceControlIntegrations: number;
  disconnectedSourceControlIntegrations: number;
  policyDecisionsByAction: Record<string, number>;
  failedSecurityGates: number;
  evidenceByStatus: Record<string, number>;
  notificationEmailStatuses: Record<string, number>;
  pullRequestsWithPassports: number;
  passportAvailabilityPercent: number | null;
  trends: {
    pullRequests: Array<{ day: string; count: number }>;
    reviewsCompleted: Array<{ day: string; count: number }>;
    findingsResolved: Array<{ day: string; count: number }>;
  };
}

export async function getGovernanceAnalytics(
  organizationId: string,
  days: 7 | 30 | 90 = 30,
): Promise<GovernanceAnalytics | null> {
  const result = await apiFetch<GovernanceAnalytics>(
    `/api/organizations/${organizationId}/governance-analytics?days=${days}`,
  );
  return result.data;
}

export interface NotificationSummary {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  emailStatus: "PENDING" | "SENT" | "SKIPPED" | "FAILED";
  category: string;
  severity: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationSummary[];
  nextCursor: string | null;
  unreadCount: number;
}

export async function getNotifications(organizationId: string): Promise<NotificationPage> {
  const result = await apiFetch<NotificationPage>(
    `/api/organizations/${organizationId}/notifications?limit=50`,
  );
  return result.data ?? { items: [], nextCursor: null, unreadCount: 0 };
}

export interface NotificationDeliveryOperations {
  periodStart: string;
  statusCounts: Record<string, number>;
  attempts: Array<{
    id: string;
    attempt: number;
    status: string;
    attemptedAt: string;
    completedAt: string | null;
    latencyMs: number | null;
    errorCode: string | null;
    notification: { id: string; type: string; createdAt: string };
  }>;
}

export async function getNotificationDeliveryOperations(
  organizationId: string,
): Promise<NotificationDeliveryOperations | null> {
  const result = await apiFetch<NotificationDeliveryOperations>(
    `/api/organizations/${organizationId}/notification-delivery-operations`,
  );
  return result.data;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  securityEmailEnabled: boolean;
  assessmentsEmailEnabled: boolean;
  governanceEmailEnabled: boolean;
  integrationsEmailEnabled: boolean;
  accountEmailEnabled: boolean;
}

export async function getNotificationPreference(
  organizationId: string,
): Promise<NotificationPreferences> {
  const result = await apiFetch<NotificationPreferences>(
    `/api/organizations/${organizationId}/notification-preferences`,
  );
  return (
    result.data ?? {
      emailEnabled: true,
      securityEmailEnabled: true,
      assessmentsEmailEnabled: true,
      governanceEmailEnabled: true,
      integrationsEmailEnabled: true,
      accountEmailEnabled: true,
    }
  );
}

export interface FindingActivityRecord {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  comment: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; username: string | null } | null;
}

export interface SecurityFindingWorkflowRecord {
  id: string;
  provider: string;
  category: string | null;
  severity: string;
  title: string;
  description: string | null;
  file: string | null;
  line: number | null;
  status: string;
  resolutionVerification: "NOT_VERIFIED" | "USER_REPORTED" | "VERIFIED";
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: { id: string; name: string | null; email: string; username: string | null } | null;
  repository: { owner: string; name: string } | null;
  pullRequest: { id: string; number: number; title: string } | null;
  activities: FindingActivityRecord[];
  riskAcceptances: Array<{ expiresAt: string | null; reason: string | null }>;
}

export async function getSecurityFindings(
  organizationId: string,
  filters: { status?: string; severity?: string; overdue?: boolean } = {},
): Promise<SecurityFindingWorkflowRecord[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.overdue) params.set("overdue", "true");
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const result = await apiFetch<SecurityFindingWorkflowRecord[]>(
    `/api/organizations/${organizationId}/findings${query}`,
  );
  return result.data ?? [];
}

export interface PullRequestSummary {
  id: string;
  number: number;
  title: string;
  state: string;
  author: string | null;
  repository: string;
  repositoryId: string;
  aiAgent: string | null;
  aiInvolvement: "YES" | "NO" | "UNKNOWN";
  aiConfidence: number | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  riskScore: number | null;
  policyAction: "ALLOW" | "REVIEW" | "BLOCK" | null;
  createdAt: string;
}

export async function getPullRequests(
  organizationId: string,
  filters: { repositoryId?: string; state?: string } = {},
): Promise<PullRequestSummary[]> {
  const params = new URLSearchParams();
  if (filters.repositoryId) params.set("repositoryId", filters.repositoryId);
  if (filters.state) params.set("state", filters.state);
  const query = params.toString() ? `?${params.toString()}` : "";

  const result = await apiFetch<PullRequestSummary[]>(
    `/api/organizations/${organizationId}/pull-requests${query}`,
  );
  return result.data ?? [];
}

export interface CodeChangeRecord {
  id: string;
  filePath: string;
  sensitiveAreas: string[];
  additions: number;
  deletions: number;
  status: string;
}

export interface AIActivityRecord {
  id: string;
  agent: string;
  model: string | null;
  involvement: "YES" | "NO" | "UNKNOWN";
  confidence: number;
  source: string;
  metadata: Record<string, unknown> | null;
}

export interface RiskAssessmentRecord {
  id: string;
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  explanation: string | null;
  modelVersion: string;
  factors: unknown;
}

export interface PolicyDecisionRecord {
  id: string;
  action: "ALLOW" | "REVIEW" | "BLOCK";
  matchedRuleIds: string[];
  requiredApprovals: string[];
  explanation: string | null;
}

export interface EvidenceRecord {
  id: string;
  type: string;
  status: "PASS" | "FAIL" | "UNKNOWN" | "NOT_RUN" | "NOT_APPLICABLE";
  source: string;
  details: string | null;
  metadata: Record<string, unknown> | null;
  pullRequestId: string | null;
  pullRequest: {
    id: string;
    number: number;
    title: string;
    repository: { owner: string; name: string };
  } | null;
  createdAt: string;
}

export interface SecurityFindingRecord {
  id: string;
  provider: string;
  category: string | null;
  severity: string;
  title: string;
  status: string;
}

export interface ReviewRecord {
  id: string;
  reviewerId: string | null;
  reviewer: { id: string; name: string | null; username: string | null } | null;
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | null;
  status: string;
  comment: string | null;
  reviewedHeadSha: string | null;
  requirement: string;
  createdAt: string;
}

export interface PullRequestDetail {
  id: string;
  number: number;
  title: string;
  state: string;
  headSha: string | null;
  authorLogin: string | null;
  repository: { owner: string; name: string; criticality: string };
  aiActivities: AIActivityRecord[];
  riskAssessments: RiskAssessmentRecord[];
  policyDecisions: PolicyDecisionRecord[];
  reviews: ReviewRecord[];
  codeChanges: CodeChangeRecord[];
  findings: SecurityFindingRecord[];
  evidence: EvidenceRecord[];
  passports: Array<{ id: string; status: string; updatedAt: string }>;
}

export async function getPullRequestDetail(
  organizationId: string,
  pullRequestId: string,
): Promise<PullRequestDetail | null> {
  const result = await apiFetch<PullRequestDetail>(
    `/api/organizations/${organizationId}/pull-requests/${pullRequestId}`,
  );
  return result.data;
}

export interface RepositorySummary {
  id: string;
  provider: string;
  owner: string;
  name: string;
  criticality: string;
  enabled: boolean;
  _count: { pullRequests: number };
  installation: { permissions: Record<string, string> | null } | null;
}

export async function getRepositories(organizationId: string): Promise<RepositorySummary[]> {
  const result = await apiFetch<RepositorySummary[]>(
    `/api/organizations/${organizationId}/repositories`,
  );
  return result.data ?? [];
}

export interface AssessmentRecord {
  id: string;
  status:
    | "CREATED"
    | "AUTHORIZATION_PENDING"
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "COMPLETED_WITH_LIMITATIONS"
    | "FAILED"
    | "CANCELLED";
  windowStart: string;
  windowEnd: string;
  progress: number;
  totalPullRequests: number;
  processedPullRequests: number;
  report: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  repositories: Array<{ id: string; owner: string; name: string }>;
}

export async function getAssessments(organizationId: string): Promise<AssessmentRecord[]> {
  const result = await apiFetch<AssessmentRecord[]>(
    `/api/organizations/${organizationId}/assessments`,
  );
  return result.data ?? [];
}

// Matches the persisted policy rule shape, including validated nested conditions.
export interface PolicyRuleRecord {
  id: string;
  name: string;
  aiInvolved: boolean | null;
  conditionExpression: PolicyCondition | null;
  sensitiveAreas: string[];
  riskAtLeast: number | null;
  repositoryCriticalityIn: string[];
  action: "ALLOW" | "REVIEW" | "BLOCK";
  requiredApprovals: string[];
  reason: string | null;
  precedence: number;
}

export type PolicyMode = "ENFORCING" | "DRY_RUN" | "DISABLED";

export interface PolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  mode: PolicyMode;
  version: string;
  policyRules: PolicyRuleRecord[];
  enforcementApproval: {
    requiredApprovals: number;
    approvalCount: number;
    approved: boolean;
    revisionAuthorId?: string | null;
    approverIds?: string[];
  };
  revisions?: Array<{
    id: string;
    version: string;
    actorId: string | null;
    snapshot: unknown;
    createdAt: string;
  }>;
}

export async function getPolicies(organizationId: string): Promise<PolicySummary[]> {
  const result = await apiFetch<PolicySummary[]>(`/api/organizations/${organizationId}/policies`);
  return result.data ?? [];
}

export async function getEvidence(
  organizationId: string,
  filters: { pullRequestId?: string } = {},
): Promise<EvidenceRecord[]> {
  const params = new URLSearchParams();
  if (filters.pullRequestId) params.set("pullRequestId", filters.pullRequestId);
  const query = params.toString() ? `?${params.toString()}` : "";

  const result = await apiFetch<EvidenceRecord[]>(
    `/api/organizations/${organizationId}/evidence${query}`,
  );
  return result.data ?? [];
}

export interface AgentSummary {
  agent: string;
  pullRequestCount: number;
  repositoryCount: number;
  averageRiskScore: number | null;
  blockedCount: number;
  reviewRequiredCount: number;
}

export async function getAgents(organizationId: string): Promise<AgentSummary[]> {
  const result = await apiFetch<AgentSummary[]>(`/api/organizations/${organizationId}/agents`);
  return result.data ?? [];
}

export interface InstallationSummary {
  id: string;
  githubInstallationId: string;
  accountLogin: string | null;
  accountType: string | null;
  active: boolean;
  createdAt: string;
}

export async function getInstallations(organizationId: string): Promise<InstallationSummary[]> {
  const result = await apiFetch<InstallationSummary[]>(
    `/api/organizations/${organizationId}/installations`,
  );
  return result.data ?? [];
}

export interface OrganizationDeletionRequestSummary {
  status: string;
  createdAt: string;
}

export async function getOrganizationDeletionRequest(
  organizationId: string,
): Promise<OrganizationDeletionRequestSummary | null> {
  const result = await apiFetch<OrganizationDeletionRequestSummary>(
    `/api/organizations/${organizationId}/settings/data-deletion`,
  );
  return result.data;
}

export interface AuditEventSummary {
  id: string;
  eventType: string;
  actor: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function getAuditEvents(organizationId: string): Promise<AuditEventSummary[]> {
  const result = await apiFetch<AuditEventSummary[]>(
    `/api/organizations/${organizationId}/audit-events`,
  );
  return result.data ?? [];
}
