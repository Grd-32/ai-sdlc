import { describe, expect, it } from "vitest";
import {
  isEligibleForApprovalRequirement,
  resolveApprovalRequirements,
  resolveReviewAction,
} from "./review-approval.js";

describe("human review approval policy", () => {
  it("uses a reviewer approval when a REVIEW rule has no explicit requirements", () => {
    expect(resolveApprovalRequirements([])).toEqual([
      { token: "REVIEWER_APPROVAL", minimumRole: "REVIEWER", label: "Reviewer approval" },
    ]);
    expect(
      resolveReviewAction(
        [],
        [{ reviewerId: "r1", role: "REVIEWER", decision: "APPROVED", status: "COMPLETED" }],
      ),
    ).toBe("ALLOW");
  });

  it("maps legacy policy labels to the nearest supported organization role", () => {
    expect(resolveApprovalRequirements(["SENIOR_ENGINEER_REVIEW", "SECURITY_REVIEW"])).toEqual([
      {
        token: "SENIOR_ENGINEER_REVIEW",
        minimumRole: "SENIOR_ENGINEER",
        label: "Senior engineer review",
        eligibleRoles: ["OWNER", "ADMIN", "SENIOR_ENGINEER"],
      },
      { token: "SECURITY_REVIEW", minimumRole: "SECURITY_ANALYST", label: "Security review" },
    ]);
    expect(
      isEligibleForApprovalRequirement("SECURITY_ANALYST", ["SECURITY_REVIEW"], "SECURITY_REVIEW"),
    ).toBe(true);
    expect(
      isEligibleForApprovalRequirement("ENGINEER", ["SECURITY_REVIEW"], "SECURITY_REVIEW"),
    ).toBe(false);
    expect(
      isEligibleForApprovalRequirement(
        "SENIOR_ENGINEER",
        ["SENIOR_ENGINEER_REVIEW"],
        "SENIOR_ENGINEER_REVIEW",
      ),
    ).toBe(true);
    expect(
      isEligibleForApprovalRequirement(
        "ENGINEER",
        ["SENIOR_ENGINEER_REVIEW"],
        "SENIOR_ENGINEER_REVIEW",
      ),
    ).toBe(false);
    expect(
      isEligibleForApprovalRequirement("PLATFORM_ENGINEER", ["PLATFORM_REVIEW"], "PLATFORM_REVIEW"),
    ).toBe(true);
    expect(
      isEligibleForApprovalRequirement("ENGINEER", ["PLATFORM_REVIEW"], "PLATFORM_REVIEW"),
    ).toBe(false);
    expect(resolveApprovalRequirements(["PLATFORM_REVIEW"])).toEqual([
      {
        token: "PLATFORM_REVIEW",
        minimumRole: "PLATFORM_ENGINEER",
        label: "Platform engineering review",
        eligibleRoles: ["OWNER", "ADMIN", "PLATFORM_ENGINEER"],
      },
    ]);
  });

  it("requires distinct eligible reviewers for each configured approval", () => {
    const oneSecurityApproval = [
      {
        reviewerId: "r1",
        role: "SECURITY_ANALYST" as const,
        decision: "APPROVED" as const,
        status: "COMPLETED",
      },
    ];
    expect(
      resolveReviewAction(["SECURITY_REVIEW", "SENIOR_ENGINEER_REVIEW"], oneSecurityApproval),
    ).toBe("REVIEW");
    expect(
      resolveReviewAction(
        ["SECURITY_REVIEW", "SENIOR_ENGINEER_REVIEW"],
        [
          ...oneSecurityApproval,
          {
            reviewerId: "r2",
            role: "SENIOR_ENGINEER",
            decision: "APPROVED",
            status: "COMPLETED",
          },
        ],
      ),
    ).toBe("ALLOW");
  });

  it("never turns a rejection or an unknown approval label into an approval", () => {
    expect(
      resolveReviewAction(
        [],
        [
          { reviewerId: "r1", role: "OWNER", decision: "REJECTED", status: "COMPLETED" },
          { reviewerId: "r2", role: "OWNER", decision: "APPROVED", status: "COMPLETED" },
        ],
      ),
    ).toBe("BLOCK");
    expect(resolveApprovalRequirements(["CUSTOM_REVIEW"])).toBeNull();
    expect(resolveReviewAction(["CUSTOM_REVIEW"], [])).toBeNull();
  });

  it("keeps the check in review when an assigned reviewer requests changes", () => {
    expect(
      resolveReviewAction(
        [],
        [
          {
            reviewerId: "r1",
            role: "OWNER",
            decision: "APPROVED",
            status: "COMPLETED",
          },
          {
            reviewerId: "r2",
            role: "REVIEWER",
            decision: "CHANGES_REQUESTED",
            status: "COMPLETED",
          },
        ],
      ),
    ).toBe("REVIEW");
  });

  it("ignores pending and incomplete reviews", () => {
    expect(
      resolveReviewAction(
        [],
        [{ reviewerId: "r1", role: "OWNER", decision: null, status: "PENDING" }],
      ),
    ).toBe("REVIEW");
  });
});
