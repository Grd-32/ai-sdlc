import { describe, expect, it } from "vitest";
import {
  buildCheckRunSummary,
  mapPolicyActionToCheckRunConclusion,
  type CheckRunSummaryInput,
} from "./checks.js";

const summaryInput: CheckRunSummaryInput = {
  aiInvolvement: "UNKNOWN",
  aiConfidence: 0,
  riskScore: 50,
  riskLevel: "MEDIUM",
  sensitiveAreas: [],
  policyAction: "BLOCK",
  policyReasons: ["A required rule matched."],
  requiredApprovals: [],
};

describe("GitHub policy check runs", () => {
  it("maps policy decisions to deterministic GitHub conclusions", () => {
    expect(mapPolicyActionToCheckRunConclusion("BLOCK")).toBe("failure");
    expect(mapPolicyActionToCheckRunConclusion("REVIEW")).toBe("action_required");
    expect(mapPolicyActionToCheckRunConclusion("ALLOW")).toBe("success");
  });

  it("does not claim that a BLOCK decision alone prevents merges", () => {
    expect(buildCheckRunSummary(summaryInput)).toContain(
      "GitHub only uses this result as a merge gate when repository rules require this check",
    );
  });
});
