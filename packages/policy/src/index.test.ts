import { describe, it, expect } from "vitest";
import {
  evaluatePolicy,
  POLICY_ACTION_PRECEDENCE,
  POLICY_PACKAGE_VERSION,
  resolvePolicyMode,
  simulatePolicyHistory,
  validatePolicyCondition,
} from "./index.js";

describe("@ai-sdlc/policy", () => {
  it("defines correct action precedence", () => {
    expect(POLICY_ACTION_PRECEDENCE.BLOCK).toBeGreaterThan(POLICY_ACTION_PRECEDENCE.REVIEW);
    expect(POLICY_ACTION_PRECEDENCE.REVIEW).toBeGreaterThan(POLICY_ACTION_PRECEDENCE.ALLOW);
  });

  it("exports package version", () => {
    expect(POLICY_PACKAGE_VERSION).toBe("0.1.0");
  });

  it("allows changes when no policy rule matches", () => {
    const result = evaluatePolicy({
      aiInvolvement: "NO",
      aiConfidence: 0,
      sensitiveAreas: [],
      riskScore: 10,
      riskLevel: "LOW",
      repositoryCriticality: "LOW",
    });

    expect(result.action).toBe("ALLOW");
    expect(result.matchedPolicies).toHaveLength(0);
    expect(result.requiredApprovals).toHaveLength(0);
  });

  it("requires review for AI payment changes", () => {
    const result = evaluatePolicy({
      aiInvolvement: "YES",
      aiConfidence: 0.9,
      sensitiveAreas: ["PAYMENTS"],
      riskScore: 55,
      riskLevel: "MEDIUM",
      repositoryCriticality: "MEDIUM",
    });

    expect(result.action).toBe("REVIEW");
    expect(result.requiredApprovals).toEqual([
      expect.objectContaining({ type: "SECURITY_REVIEW" }),
    ]);
    expect(result.matchedPolicies).toHaveLength(1);
    expect(result.matchedPolicies[0]?.policyName).toContain("Payment");
  });

  it("blocks AI changes touching secrets", () => {
    const result = evaluatePolicy({
      aiInvolvement: "YES",
      aiConfidence: 0.9,
      sensitiveAreas: ["SECRETS"],
      riskScore: 70,
      riskLevel: "HIGH",
      repositoryCriticality: "HIGH",
    });

    expect(result.action).toBe("BLOCK");
    expect(result.requiredApprovals).toHaveLength(0);
    expect(result.reasons).toContain("AI involved change touches secrets.");
  });

  it("reviews when unknown AI provenance could satisfy a rule", () => {
    const result = evaluatePolicy(
      {
        aiInvolvement: "UNKNOWN",
        aiConfidence: 0,
        sensitiveAreas: [],
        riskScore: 10,
        riskLevel: "LOW",
        repositoryCriticality: "LOW",
      },
      [
        {
          id: "confirmed-non-ai",
          name: "Confirmed non-AI only",
          conditions: { aiInvolved: false },
          action: "ALLOW",
          requiredApprovals: [],
          reason: "Only allow changes confirmed as non-AI.",
        },
      ],
    );

    expect(result.action).toBe("REVIEW");
    expect(result.matchedPolicies).toHaveLength(0);
    expect(result.indeterminatePolicies).toEqual([
      { policyId: "confirmed-non-ai", policyName: "Confirmed non-AI only" },
    ]);
    expect(result.reasons.join(" ")).toContain("Defaulting to REVIEW.");
  });

  it("treats a known nonmatching condition as NO_MATCH even when AI provenance is unknown", () => {
    const result = evaluatePolicy(
      {
        aiInvolvement: "UNKNOWN",
        aiConfidence: 0,
        sensitiveAreas: [],
        riskScore: 10,
        riskLevel: "LOW",
        repositoryCriticality: "LOW",
      },
      [
        {
          id: "payments-only",
          name: "Payments only",
          conditions: { aiInvolved: true, sensitiveAreasInclude: ["PAYMENTS"] },
          action: "BLOCK",
          requiredApprovals: [],
          reason: "Payment changes are blocked.",
        },
      ],
    );

    expect(result.action).toBe("ALLOW");
    expect(result.indeterminatePolicies).toHaveLength(0);
  });

  it("evaluates nested AND, OR, and NOT expressions", () => {
    const result = evaluatePolicy(
      {
        aiInvolvement: "YES",
        aiConfidence: 0.9,
        sensitiveAreas: ["PAYMENTS"],
        riskScore: 60,
        riskLevel: "MEDIUM",
        repositoryCriticality: "HIGH",
      },
      [
        {
          id: "nested-rule",
          name: "Nested rule",
          conditions: {},
          conditionExpression: {
            op: "AND",
            conditions: [
              { field: "AI_INVOLVEMENT", equals: "YES" },
              {
                op: "OR",
                conditions: [
                  { field: "SENSITIVE_AREAS", includes: ["PAYMENTS"] },
                  { op: "NOT", condition: { field: "RISK_SCORE", atLeast: 80 } },
                ],
              },
            ],
          },
          action: "BLOCK",
          requiredApprovals: [],
          reason: "Nested condition matched.",
        },
      ],
    );

    expect(result.action).toBe("BLOCK");
    expect(result.matchedPolicies.map((policy) => policy.policyId)).toContain("nested-rule");
  });

  it("lets rules explicitly match unknown AI provenance", () => {
    const result = evaluatePolicy(
      {
        aiInvolvement: "UNKNOWN",
        aiConfidence: 0,
        sensitiveAreas: [],
        riskScore: 10,
        riskLevel: "LOW",
        repositoryCriticality: "LOW",
      },
      [
        {
          id: "unknown-provenance",
          name: "Unknown provenance",
          conditions: {},
          conditionExpression: { field: "AI_INVOLVEMENT", equals: "UNKNOWN" },
          action: "BLOCK",
          requiredApprovals: [],
          reason: "Unknown provenance is explicitly blocked.",
        },
      ],
    );

    expect(result.action).toBe("BLOCK");
    expect(result.indeterminatePolicies).toHaveLength(0);
  });

  it("validates expression shape and bounds", () => {
    expect(
      validatePolicyCondition({
        op: "OR",
        conditions: [
          { field: "AI_INVOLVEMENT", equals: "UNKNOWN" },
          { op: "NOT", condition: { field: "RISK_SCORE", atLeast: 80 } },
        ],
      }),
    ).toBeNull();
    expect(
      validatePolicyCondition({
        field: "RISK_SCORE",
        atLeast: 101,
      }),
    ).toContain("0 to 100");
    expect(
      validatePolicyCondition({
        op: "AND",
        conditions: [],
      }),
    ).toContain("between 1 and 10");
  });

  it("converts blocking rules to review in dry-run mode", () => {
    expect(resolvePolicyMode("BLOCK", "DRY_RUN")).toBe("REVIEW");
    expect(resolvePolicyMode("REVIEW", "DRY_RUN")).toBe("REVIEW");
    expect(resolvePolicyMode("ALLOW", "DISABLED")).toBe("ALLOW");
  });

  it("simulates a policy batch and summarizes action counts", () => {
    const result = simulatePolicyHistory(
      [
        {
          aiInvolvement: "YES",
          aiConfidence: 0.9,
          sensitiveAreas: ["SECRETS"],
          riskScore: 90,
          riskLevel: "CRITICAL",
          repositoryCriticality: "HIGH",
          repository: "payments-service",
          team: "platform-security",
          pullRequestId: "pr-101",
        },
        {
          aiInvolvement: "YES",
          aiConfidence: 0.7,
          sensitiveAreas: ["PAYMENTS"],
          riskScore: 60,
          riskLevel: "MEDIUM",
          repositoryCriticality: "MEDIUM",
          repository: "billing-api",
          team: "payments",
          pullRequestId: "pr-102",
        },
        {
          aiInvolvement: "NO",
          aiConfidence: 0,
          sensitiveAreas: [],
          riskScore: 10,
          riskLevel: "LOW",
          repositoryCriticality: "LOW",
          repository: "docs",
          team: "docs",
          pullRequestId: "pr-103",
        },
      ],
      "DRY_RUN",
    );

    expect(result.mode).toBe("DRY_RUN");
    expect(result.totalEvaluated).toBe(3);
    expect(result.block).toBe(0);
    expect(result.review).toBe(2);
    expect(result.allow).toBe(1);
    expect(result.affectedTeams).toEqual(
      expect.arrayContaining(["platform-security", "payments", "docs"]),
    );
    expect(result).not.toHaveProperty("falsePositiveEstimate");
  });
});
