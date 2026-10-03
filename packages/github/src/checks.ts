/**
 * GitHub Check Run publishing.
 *
 * Phase 12: turns a policy decision + risk + provenance summary into a
 * GitHub Check Run. Prefers Check Runs over PR comments (README §41/§79).
 *
 * Idempotency: callers pass `existingCheckRunId` (persisted on PullRequest
 * after the first publish). If present we PATCH the same check run instead
 * of creating a new one on every re-analysis — this mirrors the "webhooks
 * may be delivered more than once, never create duplicate logical records"
 * rule (README §66) applied to Check Runs specifically.
 */

import { githubApiRequest } from "./client.js";

export type PolicyActionLike = "ALLOW" | "REVIEW" | "BLOCK";
export type RiskLevelLike = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type CheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "action_required"
  | "cancelled"
  | "timed_out";

const CHECK_RUN_NAME = "AI-SDLC Security";

/** Deterministic mapping — never let an LLM decide the Check Run conclusion (README §35/§70). */
export function mapPolicyActionToCheckRunConclusion(action: PolicyActionLike): CheckRunConclusion {
  switch (action) {
    case "BLOCK":
      return "failure";
    case "REVIEW":
      return "action_required";
    case "ALLOW":
    default:
      return "success";
  }
}

export interface CheckRunSummaryInput {
  aiInvolvement: "YES" | "NO" | "UNKNOWN";
  aiAgent?: string;
  aiConfidence: number;
  riskScore: number;
  riskLevel: RiskLevelLike;
  sensitiveAreas: string[];
  policyAction: PolicyActionLike;
  policyReasons: string[];
  requiredApprovals: string[];
  passportUrl?: string;
}

export function buildCheckRunTitle(input: CheckRunSummaryInput): string {
  const conclusion = mapPolicyActionToCheckRunConclusion(input.policyAction);
  if (conclusion === "failure") {
    return `${CHECK_RUN_NAME} — Blocked`;
  }
  if (conclusion === "action_required") {
    return `${CHECK_RUN_NAME} — Review required`;
  }
  return `${CHECK_RUN_NAME} — Allowed`;
}

/** Human-readable, actionable summary — see README §79 ("why / what was detected / what must happen next"). */
export function buildCheckRunSummary(input: CheckRunSummaryInput): string {
  const lines: string[] = [
    `**AI involvement:** ${input.aiInvolvement}${input.aiAgent ? ` (${input.aiAgent})` : ""} — ${(
      input.aiConfidence * 100
    ).toFixed(0)}% confidence`,
    `**Risk:** ${input.riskLevel} (score ${input.riskScore.toFixed(0)})`,
    `**Sensitive areas:** ${input.sensitiveAreas.length > 0 ? input.sensitiveAreas.join(", ") : "None detected"}`,
    `**Policy:** ${input.policyAction}`,
  ];

  if (input.requiredApprovals.length > 0) {
    lines.push(`**Required approvals:** ${input.requiredApprovals.join(", ")}`);
  }

  if (input.policyReasons.length > 0) {
    lines.push("", "**Why:**", ...input.policyReasons.map((reason) => `- ${reason}`));
  }

  if (input.passportUrl) {
    lines.push("", `[View AI Change Passport](${input.passportUrl})`);
  }

  return lines.join("\n");
}

export interface PublishCheckRunParams {
  githubInstallationId: string;
  owner: string;
  repo: string;
  headSha: string;
  /** Pass the previously-stored GitHub check run id to update in place instead of creating a duplicate. */
  existingCheckRunId?: string | null;
  summaryInput: CheckRunSummaryInput;
}

export interface PublishCheckRunResult {
  checkRunId: string;
  conclusion: CheckRunConclusion;
}

export async function publishCheckRun(params: PublishCheckRunParams): Promise<PublishCheckRunResult> {
  const conclusion = mapPolicyActionToCheckRunConclusion(params.summaryInput.policyAction);

  const body = {
    name: CHECK_RUN_NAME,
    head_sha: params.headSha,
    status: "completed" as const,
    conclusion,
    output: {
      title: buildCheckRunTitle(params.summaryInput),
      summary: buildCheckRunSummary(params.summaryInput),
    },
  };

  if (params.existingCheckRunId) {
    await githubApiRequest(
      params.githubInstallationId,
      `/repos/${params.owner}/${params.repo}/check-runs/${params.existingCheckRunId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );

    return { checkRunId: params.existingCheckRunId, conclusion };
  }

  const created = await githubApiRequest<{ id: number }>(
    params.githubInstallationId,
    `/repos/${params.owner}/${params.repo}/check-runs`,
    { method: "POST", body: JSON.stringify(body) },
  );

  return { checkRunId: String(created.id), conclusion };
}

export const GITHUB_CHECKS_MODULE_VERSION = "0.1.0";