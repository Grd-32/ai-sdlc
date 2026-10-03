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

export type PolicyAction = "ALLOW" | "REVIEW" | "BLOCK";

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
  requiredApprovals: ApprovalRequirement[];
  reasons: string[];
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

export interface PolicyRule {
  id: string;
  name: string;
  conditions: PolicyRuleCondition;
  action: PolicyAction;
  requiredApprovals: ApprovalRequirement[];
  reason: string;
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
      { type: "SECURITY_REVIEW", description: "Security review required for AI-modified payment code." },
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
      { type: "SENIOR_ENGINEER_REVIEW", description: "Senior engineer review required for AI-modified authentication code." },
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
      { type: "SECURITY_REVIEW", description: "Security review required for AI-modified infrastructure code." },
      { type: "PLATFORM_REVIEW", description: "Platform review required for AI-modified infrastructure code." },
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
      { type: "SECURITY_REVIEW", description: "Security review required for high-risk AI changes." },
    ],
    reason: "AI involved change is high risk.",
  },
];

export const POLICY_ACTION_PRECEDENCE: Record<PolicyAction, number> = {
  BLOCK: 3,
  REVIEW: 2,
  ALLOW: 1,
};

function conditionMatches(input: PolicyEvaluationInput, condition: PolicyRuleCondition): boolean {
  if (condition.aiInvolved !== undefined) {
    const involved = input.aiInvolvement === "YES";
    if (condition.aiInvolved !== involved) {
      return false;
    }
  }

  if (condition.sensitiveAreasInclude) {
    const matchesSensitiveArea = condition.sensitiveAreasInclude.some((area) =>
      input.sensitiveAreas.includes(area),
    );
    if (!matchesSensitiveArea) {
      return false;
    }
  }

  if (condition.riskAtLeast !== undefined) {
    if (input.riskScore < condition.riskAtLeast) {
      return false;
    }
  }

  if (condition.repositoryCriticalityIn) {
    if (!condition.repositoryCriticalityIn.includes(input.repositoryCriticality)) {
      return false;
    }
  }

  return true;
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

  for (const policy of allRules) {
    if (conditionMatches(input, policy.conditions)) {
      matchedPolicies.push({
        policyId: policy.id,
        policyName: policy.name,
        matchedConditions: Object.keys(policy.conditions).filter((key) => {
          const conditionValue = (policy.conditions as Record<string, unknown>)[key];
          return conditionValue !== undefined && conditionValue !== null;
        }),
        action: policy.action,
      });
    }
  }

  const action = matchedPolicies.reduce<PolicyAction>(
    (current, candidate) =>
      POLICY_ACTION_PRECEDENCE[candidate.action] > POLICY_ACTION_PRECEDENCE[current] ? candidate.action : current,
    "ALLOW",
  );

  const requiredApprovalMap = new Map<string, ApprovalRequirement>();
  const reasons: string[] = [];

  for (const policy of allRules) {
    if (conditionMatches(input, policy.conditions)) {
      reasons.push(policy.reason);
      for (const approval of policy.requiredApprovals) {
        requiredApprovalMap.set(approval.type, approval);
      }
    }
  }

  const requiredApprovals = [...requiredApprovalMap.values()];

  if (matchedPolicies.length === 0) {
    reasons.push("No policy rules matched; defaulting to ALLOW.");
  }

  return {
    action,
    matchedPolicies,
    requiredApprovals,
    reasons,
  };
}

export const POLICY_PACKAGE_VERSION = "0.1.0";