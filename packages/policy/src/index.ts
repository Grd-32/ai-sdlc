// /**
//  * Deterministic policy engine package.
//  * Phase 8+: ALLOW / REVIEW / BLOCK with explainable decisions.
//  */

// import type { RepositoryCriticality, RiskLevel, SensitiveArea } from "@ai-sdlc/risk";

// export type PolicyAction = "ALLOW" | "REVIEW" | "BLOCK";

// export interface MatchedPolicy {
//   policyId: string;
//   policyName: string;
//   matchedConditions: string[];
//   action: PolicyAction;
// }

// export interface ApprovalRequirement {
//   type: string;
//   description: string;
// }

// export interface PolicyDecisionResult {
//   action: PolicyAction;
//   matchedPolicies: MatchedPolicy[];
//   requiredApprovals: ApprovalRequirement[];
//   reasons: string[];
// }

// export interface PolicyEvaluationInput {
//   organizationId?: string;
//   repositoryId?: string;
//   aiInvolvement: "YES" | "NO" | "UNKNOWN";
//   aiConfidence: number;
//   sensitiveAreas: SensitiveArea[];
//   riskScore: number;
//   riskLevel: RiskLevel;
//   repositoryCriticality: RepositoryCriticality;
// }

// export interface PolicyRuleCondition {
//   aiInvolved?: boolean;
//   sensitiveAreasInclude?: SensitiveArea[];
//   riskAtLeast?: number;
//   repositoryCriticalityIn?: RepositoryCriticality[];
// }

// export interface PolicyRule {
//   id: string;
//   name: string;
//   conditions: PolicyRuleCondition;
//   action: PolicyAction;
//   requiredApprovals: ApprovalRequirement[];
//   reason: string;
// }

// const STATIC_POLICY_RULES: PolicyRule[] = [
//   {
//     id: "policy-payment-security-review",
//     name: "AI Payment Protection",
//     conditions: {
//       aiInvolved: true,
//       sensitiveAreasInclude: ["PAYMENTS"],
//     },
//     action: "REVIEW",
//     requiredApprovals: [
//       { type: "SECURITY_REVIEW", description: "Security review required for AI-modified payment code." },
//     ],
//     reason: "AI involved change touches payment code.",
//   },
//   {
//     id: "policy-authentication-senior-review",
//     name: "AI Authentication Protection",
//     conditions: {
//       aiInvolved: true,
//       sensitiveAreasInclude: ["AUTHENTICATION"],
//     },
//     action: "REVIEW",
//     requiredApprovals: [
//       { type: "SENIOR_ENGINEER_REVIEW", description: "Senior engineer review required for AI-modified authentication code." },
//     ],
//     reason: "AI involved change touches authentication code.",
//   },
//   {
//     id: "policy-infrastructure-platform-review",
//     name: "AI Infrastructure Protection",
//     conditions: {
//       aiInvolved: true,
//       sensitiveAreasInclude: ["INFRASTRUCTURE"],
//     },
//     action: "REVIEW",
//     requiredApprovals: [
//       { type: "SECURITY_REVIEW", description: "Security review required for AI-modified infrastructure code." },
//       { type: "PLATFORM_REVIEW", description: "Platform review required for AI-modified infrastructure code." },
//     ],
//     reason: "AI involved change touches infrastructure code.",
//   },
//   {
//     id: "policy-secrets-block",
//     name: "AI Secret Protection",
//     conditions: {
//       aiInvolved: true,
//       sensitiveAreasInclude: ["SECRETS"],
//     },
//     action: "BLOCK",
//     requiredApprovals: [],
//     reason: "AI involved change touches secrets.",
//   },
//   {
//     id: "policy-high-risk-review",
//     name: "AI High Risk Protection",
//     conditions: {
//       aiInvolved: true,
//       riskAtLeast: 80,
//     },
//     action: "REVIEW",
//     requiredApprovals: [
//       { type: "SECURITY_REVIEW", description: "Security review required for high-risk AI changes." },
//     ],
//     reason: "AI involved change is high risk.",
//   },
// ];

// export const POLICY_ACTION_PRECEDENCE: Record<PolicyAction, number> = {
//   BLOCK: 3,
//   REVIEW: 2,
//   ALLOW: 1,
// };

// function conditionMatches(input: PolicyEvaluationInput, condition: PolicyRuleCondition): boolean {
//   if (condition.aiInvolved !== undefined) {
//     const involved = input.aiInvolvement === "YES";
//     if (condition.aiInvolved !== involved) {
//       return false;
//     }
//   }

//   if (condition.sensitiveAreasInclude) {
//     const matchesSensitiveArea = condition.sensitiveAreasInclude.some((area) =>
//       input.sensitiveAreas.includes(area),
//     );
//     if (!matchesSensitiveArea) {
//       return false;
//     }
//   }

//   if (condition.riskAtLeast !== undefined) {
//     if (input.riskScore < condition.riskAtLeast) {
//       return false;
//     }
//   }

//   if (condition.repositoryCriticalityIn) {
//     if (!condition.repositoryCriticalityIn.includes(input.repositoryCriticality)) {
//       return false;
//     }
//   }

//   return true;
// }

// export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecisionResult {
//   const matchedPolicies: MatchedPolicy[] = [];

//   for (const policy of STATIC_POLICY_RULES) {
//     if (conditionMatches(input, policy.conditions)) {
//       matchedPolicies.push({
//         policyId: policy.id,
//         policyName: policy.name,
//         matchedConditions: Object.keys(policy.conditions).filter((key) => {
//           const conditionValue = (policy.conditions as Record<string, unknown>)[key];
//           return conditionValue !== undefined && conditionValue !== null;
//         }),
//         action: policy.action,
//       });
//     }
//   }

//   const action = matchedPolicies.reduce<PolicyAction>(
//     (current, candidate) =>
//       POLICY_ACTION_PRECEDENCE[candidate.action] > POLICY_ACTION_PRECEDENCE[current] ? candidate.action : current,
//     "ALLOW",
//   );

//   const requiredApprovalMap = new Map<string, ApprovalRequirement>();
//   const reasons: string[] = [];

//   for (const policy of STATIC_POLICY_RULES) {
//     if (conditionMatches(input, policy.conditions)) {
//       reasons.push(policy.reason);
//       for (const approval of policy.requiredApprovals) {
//         requiredApprovalMap.set(approval.type, approval);
//       }
//     }
//   }

//   const requiredApprovals = [...requiredApprovalMap.values()];

//   if (matchedPolicies.length === 0) {
//     reasons.push("No policy rules matched; defaulting to ALLOW.");
//   }

//   return {
//     action,
//     matchedPolicies,
//     requiredApprovals,
//     reasons,
//   };
// }

// export const POLICY_PACKAGE_VERSION = "0.1.0";
/**
 * Deterministic policy engine package.
 * Phase 8+: ALLOW / REVIEW / BLOCK with explainable decisions.
 * Phase 14: evaluatePolicy accepts additionalRules — org-defined DB policies
 * layered on top of the static baseline, never replacing it. The baseline
 * rules (secrets always BLOCK, payments/auth/infra always REVIEW, high risk
 * always REVIEW) are permanent platform-level security floors; an org
 * cannot silently disable them by defining conflicting DB rules, since both
 * rule sets are evaluated and the strongest matching action always wins
 * (BLOCK > REVIEW > ALLOW), same as if they were all static rules.
 */

import type { RepositoryCriticality, RiskLevel, SensitiveArea } from "@ai-sdlc/risk";
export type { RepositoryCriticality, RiskLevel, SensitiveArea } from "@ai-sdlc/risk";

export type PolicyAction = "ALLOW" | "REVIEW" | "BLOCK";
export type PolicyMode = "ENFORCING" | "DRY_RUN" | "DISABLED";

export interface MatchedPolicy {
  policyId: string;
  policyName: string;
  matchedConditions: string[];
  action: PolicyAction;
}

export interface ApprovalRequirement {
  type: string;
  description: string;
}

export interface PolicyDecisionResult {
  action: PolicyAction;
  matchedPolicies: MatchedPolicy[];
  indeterminatePolicies: Array<Pick<MatchedPolicy, "policyId" | "policyName">>;
  requiredApprovals: ApprovalRequirement[];
  reasons: string[];
}

export interface PolicySimulationRecord extends PolicyEvaluationInput {
  team?: string;
  repository?: string;
  pullRequestId?: string;
  pullRequestNumber?: number;
  pullRequestTitle?: string;
  previousAction?: PolicyAction;
}

export interface PolicySimulatedDecision {
  repository?: string;
  team?: string;
  pullRequestId?: string;
  pullRequestNumber?: number;
  pullRequestTitle?: string;
  action: PolicyAction;
  previousAction?: PolicyAction;
  changed: boolean;
  mode: PolicyMode;
  riskScore: number;
  riskLevel: RiskLevel;
  reason: string;
}

export interface PolicySimulationResult {
  mode: PolicyMode;
  totalEvaluated: number;
  allow: number;
  review: number;
  block: number;
  affectedTeams: string[];
  affectedRepositories: string[];
  affectedPullRequests: string[];
  decisions: PolicySimulatedDecision[];
}

export interface PolicyEvaluationInput {
  organizationId?: string;
  repositoryId?: string;
  aiInvolvement: "YES" | "NO" | "UNKNOWN";
  aiConfidence: number;
  sensitiveAreas: SensitiveArea[];
  riskScore: number;
  riskLevel: RiskLevel;
  repositoryCriticality: RepositoryCriticality;
}

export interface PolicyRuleCondition {
  aiInvolved?: boolean;
  sensitiveAreasInclude?: SensitiveArea[];
  riskAtLeast?: number;
  repositoryCriticalityIn?: RepositoryCriticality[];
}

export type PolicyCondition =
  | { op: "AND" | "OR"; conditions: PolicyCondition[] }
  | { op: "NOT"; condition: PolicyCondition }
  | { field: "AI_INVOLVEMENT"; equals: "YES" | "NO" | "UNKNOWN" }
  | { field: "SENSITIVE_AREAS"; includes: SensitiveArea[] }
  | { field: "RISK_SCORE"; atLeast: number }
  | { field: "REPOSITORY_CRITICALITY"; in: RepositoryCriticality[] };

export interface PolicyRule {
  id: string;
  name: string;
  conditions: PolicyRuleCondition;
  conditionExpression?: PolicyCondition;
  action: PolicyAction;
  requiredApprovals: ApprovalRequirement[];
  reason: string;
}

const POLICY_SENSITIVE_AREAS = [
  "AUTHENTICATION",
  "AUTHORIZATION",
  "PAYMENTS",
  "CRYPTOGRAPHY",
  "SECRETS",
  "DATABASE",
  "PERSONAL_DATA",
  "INFRASTRUCTURE",
  "NETWORKING",
  "API",
  "DEPENDENCIES",
  "CI_CD",
  "CONTAINERS",
  "LOGGING",
  "FRONTEND",
  "TESTING",
  "DOCUMENTATION",
] as const satisfies readonly SensitiveArea[];

const REPOSITORY_CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isSensitiveArea(value: unknown): value is SensitiveArea {
  return (
    typeof value === "string" &&
    POLICY_SENSITIVE_AREAS.some((sensitiveArea) => sensitiveArea === value)
  );
}

function isRepositoryCriticality(value: unknown): value is RepositoryCriticality {
  return (
    typeof value === "string" &&
    REPOSITORY_CRITICALITIES.some((criticality) => criticality === value)
  );
}

/**
 * Returns a validation message when a condition expression is malformed.
 * The limits bound evaluation cost for user-authored policy trees.
 */
export function validatePolicyCondition(value: unknown): string | null {
  let nodes = 0;

  function validate(node: unknown, depth: number): string | null {
    nodes += 1;
    if (nodes > 32) return "Condition expressions may contain at most 32 nodes.";
    if (depth > 8) return "Condition expressions may be at most 8 levels deep.";
    if (!isRecord(node)) return "Each condition must be an object.";

    if (node["op"] === "AND" || node["op"] === "OR") {
      if (!hasExactKeys(node, ["op", "conditions"]) || !Array.isArray(node["conditions"])) {
        return `${node["op"]} requires only a conditions array.`;
      }
      if (node["conditions"].length === 0 || node["conditions"].length > 10) {
        return `${node["op"]} must contain between 1 and 10 conditions.`;
      }
      for (const child of node["conditions"]) {
        const error = validate(child, depth + 1);
        if (error) return error;
      }
      return null;
    }

    if (node["op"] === "NOT") {
      if (!hasExactKeys(node, ["op", "condition"])) return "NOT requires only one condition.";
      return validate(node["condition"], depth + 1);
    }

    if (node["field"] === "AI_INVOLVEMENT") {
      return hasExactKeys(node, ["field", "equals"]) &&
        (node["equals"] === "YES" || node["equals"] === "NO" || node["equals"] === "UNKNOWN")
        ? null
        : "AI_INVOLVEMENT requires equals to be YES, NO, or UNKNOWN.";
    }

    if (node["field"] === "SENSITIVE_AREAS") {
      return hasExactKeys(node, ["field", "includes"]) &&
        Array.isArray(node["includes"]) &&
        node["includes"].length > 0 &&
        node["includes"].every(isSensitiveArea)
        ? null
        : "SENSITIVE_AREAS requires one or more supported area names.";
    }

    if (node["field"] === "RISK_SCORE") {
      return hasExactKeys(node, ["field", "atLeast"]) &&
        typeof node["atLeast"] === "number" &&
        Number.isFinite(node["atLeast"]) &&
        node["atLeast"] >= 0 &&
        node["atLeast"] <= 100
        ? null
        : "RISK_SCORE requires atLeast to be a number from 0 to 100.";
    }

    if (node["field"] === "REPOSITORY_CRITICALITY") {
      return hasExactKeys(node, ["field", "in"]) &&
        Array.isArray(node["in"]) &&
        node["in"].length > 0 &&
        node["in"].every(isRepositoryCriticality)
        ? null
        : "REPOSITORY_CRITICALITY requires one or more supported criticality levels.";
    }

    return "Condition field or operator is not supported.";
  }

  return validate(value, 1);
}

export function parsePolicyCondition(
  value: unknown,
): { valid: true; condition: PolicyCondition } | { valid: false; error: string } {
  const error = validatePolicyCondition(value);
  return error ? { valid: false, error } : { valid: true, condition: value as PolicyCondition };
}

const STATIC_POLICY_RULES: PolicyRule[] = [
  {
    id: "policy-payment-security-review",
    name: "AI Payment Protection",
    conditions: {
      aiInvolved: true,
      sensitiveAreasInclude: ["PAYMENTS"],
    },
    action: "REVIEW",
    requiredApprovals: [
      {
        type: "SECURITY_REVIEW",
        description: "Security review required for AI-modified payment code.",
      },
    ],
    reason: "AI involved change touches payment code.",
  },
  {
    id: "policy-authentication-senior-review",
    name: "AI Authentication Protection",
    conditions: {
      aiInvolved: true,
      sensitiveAreasInclude: ["AUTHENTICATION"],
    },
    action: "REVIEW",
    requiredApprovals: [
      {
        type: "SENIOR_ENGINEER_REVIEW",
        description: "Senior engineer review required for AI-modified authentication code.",
      },
    ],
    reason: "AI involved change touches authentication code.",
  },
  {
    id: "policy-infrastructure-platform-review",
    name: "AI Infrastructure Protection",
    conditions: {
      aiInvolved: true,
      sensitiveAreasInclude: ["INFRASTRUCTURE"],
    },
    action: "REVIEW",
    requiredApprovals: [
      {
        type: "SECURITY_REVIEW",
        description: "Security review required for AI-modified infrastructure code.",
      },
      {
        type: "PLATFORM_REVIEW",
        description: "Platform review required for AI-modified infrastructure code.",
      },
    ],
    reason: "AI involved change touches infrastructure code.",
  },
  {
    id: "policy-secrets-block",
    name: "AI Secret Protection",
    conditions: {
      aiInvolved: true,
      sensitiveAreasInclude: ["SECRETS"],
    },
    action: "BLOCK",
    requiredApprovals: [],
    reason: "AI involved change touches secrets.",
  },
  {
    id: "policy-high-risk-review",
    name: "AI High Risk Protection",
    conditions: {
      aiInvolved: true,
      riskAtLeast: 80,
    },
    action: "REVIEW",
    requiredApprovals: [
      {
        type: "SECURITY_REVIEW",
        description: "Security review required for high-risk AI changes.",
      },
    ],
    reason: "AI involved change is high risk.",
  },
];

export const POLICY_ACTION_PRECEDENCE: Record<PolicyAction, number> = {
  BLOCK: 3,
  REVIEW: 2,
  ALLOW: 1,
};

export function resolvePolicyMode(action: PolicyAction, mode: PolicyMode): PolicyAction {
  switch (mode) {
    case "DISABLED":
      return "ALLOW";
    case "DRY_RUN":
      return action === "BLOCK" ? "REVIEW" : action;
    case "ENFORCING":
    default:
      return action;
  }
}

export function simulatePolicyHistory(
  history: PolicySimulationRecord[],
  mode: PolicyMode = "DRY_RUN",
  additionalRules: PolicyRule[] = [],
): PolicySimulationResult {
  const decisions = history.map((item) => {
    const decision = evaluatePolicy(item, additionalRules);
    const effectiveAction = resolvePolicyMode(decision.action, mode);

    return {
      repository: item.repository,
      team: item.team,
      pullRequestId: item.pullRequestId,
      pullRequestNumber: item.pullRequestNumber,
      pullRequestTitle: item.pullRequestTitle,
      action: effectiveAction,
      previousAction: item.previousAction,
      changed: item.previousAction !== undefined && item.previousAction !== effectiveAction,
      mode,
      riskScore: item.riskScore,
      riskLevel: item.riskLevel,
      reason: decision.reasons.join("; ") || "No policy triggers",
    };
  });

  const allow = decisions.filter((decision) => decision.action === "ALLOW").length;
  const review = decisions.filter((decision) => decision.action === "REVIEW").length;
  const block = decisions.filter((decision) => decision.action === "BLOCK").length;

  const affectedTeams = [...new Set(decisions.filter((x) => x.team).map((x) => x.team as string))];
  const affectedRepositories = [
    ...new Set(decisions.filter((x) => x.repository).map((x) => x.repository as string)),
  ];
  const affectedPullRequests = [
    ...new Set(decisions.filter((x) => x.pullRequestId).map((x) => x.pullRequestId as string)),
  ];

  return {
    mode,
    totalEvaluated: decisions.length,
    allow,
    review,
    block,
    affectedTeams,
    affectedRepositories,
    affectedPullRequests,
    decisions,
  };
}

type ConditionResult = "MATCH" | "NO_MATCH" | "INDETERMINATE";

function conditionMatches(
  input: PolicyEvaluationInput,
  condition: PolicyRuleCondition,
): ConditionResult {
  let indeterminate = false;

  if (condition.aiInvolved !== undefined) {
    if (input.aiInvolvement === "UNKNOWN") {
      indeterminate = true;
    } else {
      const involved = input.aiInvolvement === "YES";
      if (condition.aiInvolved !== involved) {
        return "NO_MATCH";
      }
    }
  }

  if (condition.sensitiveAreasInclude) {
    const matchesSensitiveArea = condition.sensitiveAreasInclude.some((area) =>
      input.sensitiveAreas.includes(area),
    );
    if (!matchesSensitiveArea) {
      return "NO_MATCH";
    }
  }

  if (condition.riskAtLeast !== undefined) {
    if (input.riskScore < condition.riskAtLeast) {
      return "NO_MATCH";
    }
  }

  if (condition.repositoryCriticalityIn) {
    if (!condition.repositoryCriticalityIn.includes(input.repositoryCriticality)) {
      return "NO_MATCH";
    }
  }

  return indeterminate ? "INDETERMINATE" : "MATCH";
}

function expressionMatches(
  input: PolicyEvaluationInput,
  condition: PolicyCondition,
): ConditionResult {
  if ("op" in condition) {
    if (condition.op === "NOT") {
      const result = expressionMatches(input, condition.condition);
      return result === "MATCH" ? "NO_MATCH" : result === "NO_MATCH" ? "MATCH" : result;
    }

    const results = condition.conditions.map((child) => expressionMatches(input, child));
    if (condition.op === "AND") {
      if (results.includes("NO_MATCH")) return "NO_MATCH";
      return results.includes("INDETERMINATE") ? "INDETERMINATE" : "MATCH";
    }

    if (results.includes("MATCH")) return "MATCH";
    return results.includes("INDETERMINATE") ? "INDETERMINATE" : "NO_MATCH";
  }

  switch (condition.field) {
    case "AI_INVOLVEMENT":
      if (input.aiInvolvement === condition.equals) return "MATCH";
      return input.aiInvolvement === "UNKNOWN" && condition.equals !== "UNKNOWN"
        ? "INDETERMINATE"
        : "NO_MATCH";
    case "SENSITIVE_AREAS":
      return condition.includes.some((area) => input.sensitiveAreas.includes(area))
        ? "MATCH"
        : "NO_MATCH";
    case "RISK_SCORE":
      return input.riskScore >= condition.atLeast ? "MATCH" : "NO_MATCH";
    case "REPOSITORY_CRITICALITY":
      return condition.in.includes(input.repositoryCriticality) ? "MATCH" : "NO_MATCH";
  }
}

function evaluateRuleCondition(input: PolicyEvaluationInput, policy: PolicyRule): ConditionResult {
  return policy.conditionExpression
    ? expressionMatches(input, policy.conditionExpression)
    : conditionMatches(input, policy.conditions);
}

/**
 * @param additionalRules Org-defined rules from the database (Policy +
 *   PolicyRule), already filtered to enabled policies. Evaluated alongside
 *   the static baseline — never in place of it. Defaults to none, so every
 *   existing caller (including packages/policy's own tests) behaves
 *   identically without passing this argument.
 */
export function evaluatePolicy(
  input: PolicyEvaluationInput,
  additionalRules: PolicyRule[] = [],
): PolicyDecisionResult {
  const allRules = [...STATIC_POLICY_RULES, ...additionalRules];
  const matchedPolicies: MatchedPolicy[] = [];
  const indeterminatePolicies: PolicyDecisionResult["indeterminatePolicies"] = [];

  for (const policy of allRules) {
    const result = evaluateRuleCondition(input, policy);
    if (result === "MATCH") {
      matchedPolicies.push({
        policyId: policy.id,
        policyName: policy.name,
        matchedConditions: policy.conditionExpression
          ? ["conditionExpression"]
          : Object.keys(policy.conditions).filter((key) => {
              const conditionValue = (policy.conditions as Record<string, unknown>)[key];
              return conditionValue !== undefined && conditionValue !== null;
            }),
        action: policy.action,
      });
    } else if (result === "INDETERMINATE") {
      indeterminatePolicies.push({ policyId: policy.id, policyName: policy.name });
    }
  }

  const matchedAction = matchedPolicies.reduce<PolicyAction>(
    (current, candidate) =>
      POLICY_ACTION_PRECEDENCE[candidate.action] > POLICY_ACTION_PRECEDENCE[current]
        ? candidate.action
        : current,
    "ALLOW",
  );
  const action =
    indeterminatePolicies.length > 0 && matchedAction === "ALLOW" ? "REVIEW" : matchedAction;

  const requiredApprovalMap = new Map<string, ApprovalRequirement>();
  const reasons: string[] = [];

  for (const policy of allRules) {
    if (evaluateRuleCondition(input, policy) === "MATCH") {
      reasons.push(policy.reason);
      for (const approval of policy.requiredApprovals) {
        requiredApprovalMap.set(approval.type, approval);
      }
    }
  }

  const requiredApprovals = [...requiredApprovalMap.values()];

  if (indeterminatePolicies.length > 0) {
    const fallback = matchedPolicies.length === 0 ? " Defaulting to REVIEW." : "";
    reasons.push(
      `Policy evaluation is indeterminate for: ${indeterminatePolicies.map((policy) => policy.policyName).join(", ")}.${fallback}`,
    );
  } else if (matchedPolicies.length === 0) {
    reasons.push("No policy rules matched; defaulting to ALLOW.");
  }

  return {
    action,
    matchedPolicies,
    indeterminatePolicies,
    requiredApprovals,
    reasons,
  };
}

export const POLICY_PACKAGE_VERSION = "0.1.0";

export * from "./review-approval.js";
