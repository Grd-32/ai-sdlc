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
): Promise<{ ok: boolean; data: T | null; error: { code: string; message: string } | null }> {
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
    return { ok: res.ok, data: json.data, error: json.error };
  } catch {
    return { ok: false, data: null, error: { code: "NETWORK_ERROR", message: "Failed to reach API" } };
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
}

export const getOrganizations = cache(async (): Promise<OrganizationSummary[]> => {
  const result = await apiFetch<OrganizationSummary[]>("/api/organizations");
  return result.data ?? [];
});

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
}

export interface RiskAssessmentRecord {
  id: string;
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  explanation: string | null;
  modelVersion: string;
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

export interface PullRequestDetail {
  id: string;
  number: number;
  title: string;
  state: string;
  authorLogin: string | null;
  repository: { owner: string; name: string; criticality: string };
  aiActivities: AIActivityRecord[];
  riskAssessments: RiskAssessmentRecord[];
  policyDecisions: PolicyDecisionRecord[];
  codeChanges: CodeChangeRecord[];
  findings: SecurityFindingRecord[];
  evidence: EvidenceRecord[];
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
  owner: string;
  name: string;
  criticality: string;
  enabled: boolean;
  _count: { pullRequests: number };
}

export async function getRepositories(organizationId: string): Promise<RepositorySummary[]> {
  const result = await apiFetch<RepositorySummary[]>(`/api/organizations/${organizationId}/repositories`);
  return result.data ?? [];
}

// Matches the redesigned PolicyRule schema (Phase 14) — a fixed condition
// shape, not a generic field/operator/value DSL. See POLICY_RULE_SCHEMA_CHANGE.md.
export interface PolicyRuleRecord {
  id: string;
  name: string;
  aiInvolved: boolean | null;
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

  const result = await apiFetch<EvidenceRecord[]>(`/api/organizations/${organizationId}/evidence${query}`);
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
  const result = await apiFetch<InstallationSummary[]>(`/api/organizations/${organizationId}/installations`);
  return result.data ?? [];
}

export interface AuditEventSummary {
  id: string;
  eventType: string;
  actor: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function getAuditEvents(organizationId: string): Promise<AuditEventSummary[]> {
  const result = await apiFetch<AuditEventSummary[]>(`/api/organizations/${organizationId}/audit-events`);
  return result.data ?? [];
}