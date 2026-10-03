import { describe, it, expect } from "vitest";
import {
  classifyFilePath,
  classifyFilePaths,
  evaluateRisk,
  RISK_MODEL_VERSION,
  RISK_PACKAGE_VERSION,
} from "./index.js";

describe("@ai-sdlc/risk", () => {
  it("exports risk model version", () => {
    expect(RISK_MODEL_VERSION).toBe("risk-v1");
  });

  it("exports package version", () => {
    expect(RISK_PACKAGE_VERSION).toBe("0.1.0");
  });

  it("classifies authentication file paths", () => {
    expect(classifyFilePath("src/auth/session.ts")).toEqual(["AUTHENTICATION"]);
  });

  it("classifies payments and authorization from multiple file paths", () => {
    expect(classifyFilePaths(["src/payments/refund.ts", "src/authorization/policy.ts"]).sort()).toEqual([
      "AUTHORIZATION",
      "PAYMENTS",
    ]);
  });

  it("supports multiple categories for a single path", () => {
    expect(classifyFilePath("src/auth/payments/authorization.ts").sort()).toEqual([
      "AUTHENTICATION",
      "AUTHORIZATION",
      "PAYMENTS",
    ]);
  });

  it("assigns LOW risk when AI is NO and repository is LOW criticality", () => {
    const result = evaluateRisk({
      repositoryCriticality: "LOW",
      aiInvolvement: "NO",
      aiConfidence: 0,
      sensitiveAreas: [],
      additions: 5,
      deletions: 2,
    });

    expect(result.level).toBe("LOW");
    expect(result.score).toBeLessThan(35);
  });

  it("assigns elevated risk for AI-involved payment changes in critical repositories", () => {
    const result = evaluateRisk({
      repositoryCriticality: "CRITICAL",
      aiInvolvement: "YES",
      aiConfidence: 0.9,
      sensitiveAreas: ["PAYMENTS", "AUTHORIZATION"],
      additions: 80,
      deletions: 20,
      newDependencies: 1,
      securityFindings: [
        { severity: "HIGH", count: 1 },
      ],
    });

    expect(["HIGH", "CRITICAL"]).toContain(result.level);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.factors.some((factor) => factor.name === "Sensitive areas")).toBe(true);
  });
});
