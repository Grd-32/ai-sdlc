import { describe, it, expect } from "vitest";
import {
  evaluatePolicy,
  POLICY_ACTION_PRECEDENCE,
  POLICY_PACKAGE_VERSION,
  resolvePolicyMode,
  simulatePolicyHistory,
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
    expect(result.affectedTeams).toEqual(expect.arrayContaining(["platform-security", "payments", "docs"]));
    expect(result.falsePositiveEstimate).toBeGreaterThanOrEqual(0);
  });
});
