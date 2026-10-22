import { describe, expect, it } from "vitest";
import {
  getAzureDevOpsFindingEvidenceResult,
  getEffectivePolicyMode,
  buildGitHubCheckProtectionEvidence,
  getGitLabFindingEvidenceResult,
  shouldPublishCheckRun,
} from "./analyze.js";

describe("assessment analysis mode", () => {
  it("keeps enforcement in dry-run until the current revision is approved", () => {
    expect(getEffectivePolicyMode("ENFORCING", false)).toBe("DRY_RUN");
    expect(getEffectivePolicyMode("ENFORCING", true)).toBe("ENFORCING");
    expect(getEffectivePolicyMode("DRY_RUN", false)).toBe("DRY_RUN");
    expect(getEffectivePolicyMode("DISABLED", false)).toBe("DISABLED");
  });

  it("does not publish GitHub checks from a free assessment", () => {
    expect(shouldPublishCheckRun(true, "head-sha", true)).toBe(false);
  });

  it("distinguishes a configured required GitHub check from an unproven merge block", () => {
    const requiredCheckEvidence = buildGitHubCheckProtectionEvidence({
      status: "AVAILABLE",
      requiredChecks: ["Nomalog Security"],
      headSha: "head-1",
      targetBranch: "main",
    });
    expect(requiredCheckEvidence.result).toBe("PASS");
    expect(requiredCheckEvidence.metadata).toMatchObject({
      headSha: "head-1",
      required: true,
    });
    const limitation = requiredCheckEvidence.metadata?.["limitation"];
    expect(typeof limitation).toBe("string");
    if (typeof limitation === "string") {
      expect(limitation).toContain("does not prove GitHub prevented a merge");
    }

    const missingRequiredCheckEvidence = buildGitHubCheckProtectionEvidence({
      status: "AVAILABLE",
      requiredChecks: [],
      headSha: "head-1",
      targetBranch: "main",
    });
    expect(missingRequiredCheckEvidence.result).toBe("UNKNOWN");
    expect(missingRequiredCheckEvidence.metadata).toMatchObject({ required: false });

    const unavailableProtectionEvidence = buildGitHubCheckProtectionEvidence({
      status: "UNKNOWN",
      reason: "Permission denied",
      headSha: "head-1",
      targetBranch: "main",
    });
    expect(unavailableProtectionEvidence.result).toBe("NOT_RUN");
    expect(unavailableProtectionEvidence.metadata).toMatchObject({
      reason: "Permission denied",
    });

    const missingBranchEvidence = buildGitHubCheckProtectionEvidence({
      status: "AVAILABLE",
      requiredChecks: ["Nomalog Security"],
      headSha: "head-1",
      targetBranch: null,
    });
    expect(missingBranchEvidence.result).toBe("NOT_RUN");
  });

  describe("GitLab vulnerability-finding evidence", () => {
    it("never treats an empty finding collection as a clean scan", () => {
      expect(getGitLabFindingEvidenceResult(0)).toBe("UNKNOWN");
    });

    describe("Azure DevOps Advanced Security evidence", () => {
      it("does not treat an empty active-alert response as a clean scan", () => {
        expect(getAzureDevOpsFindingEvidenceResult(0)).toBe("UNKNOWN");
      });

      it("fails evidence when active security alerts are present", () => {
        expect(getAzureDevOpsFindingEvidenceResult(1)).toBe("FAIL");
      });
    });

    it("fails evidence when vulnerabilities are present", () => {
      expect(getGitLabFindingEvidenceResult(1)).toBe("FAIL");
    });
  });

  it("publishes checks for normal analysis only when installation and head SHA exist", () => {
    expect(shouldPublishCheckRun(true, "head-sha", false)).toBe(true);
    expect(shouldPublishCheckRun(false, "head-sha", false)).toBe(false);
    expect(shouldPublishCheckRun(true, undefined, false)).toBe(false);
  });
});
