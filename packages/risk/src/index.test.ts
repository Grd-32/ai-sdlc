import { describe, it, expect } from "vitest";
import {
  classifyFilePath,
  classifyFilePaths,
  evaluateRisk,
  isDependencyManifestPath,
  RISK_MODEL_VERSION,
  RISK_PACKAGE_VERSION,
} from "./index.js";

describe("@ai-sdlc/risk", () => {
  it("exports risk model version", () => {
    expect(RISK_MODEL_VERSION).toBe("risk-v2");
  });

  it("exports package version", () => {
    expect(RISK_PACKAGE_VERSION).toBe("0.1.0");
  });

  it("classifies authentication file paths", () => {
    expect(classifyFilePath("src/auth/session.ts")).toEqual(["AUTHENTICATION"]);
  });

  it("classifies payments and authorization from multiple file paths", () => {
    expect(
      classifyFilePaths(["src/payments/refund.ts", "src/authorization/policy.ts"]).sort(),
    ).toEqual(["AUTHORIZATION", "PAYMENTS"]);
  });

  it("supports multiple categories for a single path", () => {
    expect(classifyFilePath("src/auth/payments/authorization.ts").sort()).toEqual([
      "AUTHENTICATION",
      "AUTHORIZATION",
      "PAYMENTS",
    ]);
  });

  it("recognizes dependency manifests without claiming dependency versions changed", () => {
    expect(isDependencyManifestPath("packages/app/package.json")).toBe(true);
    expect(isDependencyManifestPath("go.sum")).toBe(true);
    expect(isDependencyManifestPath("src/dependencies/handler.ts")).toBe(false);
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
      dependencyManifestFilesChanged: 1,
      securityFindings: [{ severity: "HIGH", count: 1 }],
    });

    expect(["HIGH", "CRITICAL"]).toContain(result.level);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.factors.some((factor) => factor.name === "Sensitive areas")).toBe(true);
    expect(
      result.factors.some((factor) => factor.name === "Dependency manifest files changed"),
    ).toBe(true);
  });

  it("includes actual finding counts and evidence outcomes in risk factors", () => {
    const result = evaluateRisk({
      repositoryCriticality: "LOW",
      aiInvolvement: "NO",
      aiConfidence: 0,
      sensitiveAreas: [],
      additions: 0,
      deletions: 0,
      securityFindings: [{ severity: "HIGH", count: 2 }],
      evidenceSummary: [
        { result: "FAIL", count: 1 },
        { result: "NOT_RUN", count: 2 },
      ],
    });

    expect(result.modelVersion).toBe("risk-v2");
    expect(result.factors.find((factor) => factor.name === "Security findings")?.weight).toBe(30);
    expect(result.factors.find((factor) => factor.name === "Evidence uncertainty")?.weight).toBe(
      20,
    );
    expect(result.explanation).toContain("security findings 2");
    expect(result.explanation).toContain("evidence signals 3");
  });
});
