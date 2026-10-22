export type ReviewRole =
  | "OWNER"
  | "ADMIN"
  | "SECURITY"
  | "SECURITY_ADMIN"
  | "SECURITY_ANALYST"
  | "ENGINEER"
  | "SENIOR_ENGINEER"
  | "PLATFORM_ENGINEER"
  | "REVIEWER"
  | "VIEWER"
  | "AUDITOR";

export type ReviewDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
export type ReviewAction = "ALLOW" | "REVIEW" | "BLOCK";

export interface ReviewApprovalRequirement {
  token: string;
  minimumRole: ReviewRole;
  label: string;
  eligibleRoles?: readonly ReviewRole[];
}

export interface RecordedApproval {
  reviewerId: string;
  role: ReviewRole;
  decision: ReviewDecision | null;
  status: string;
}

const ROLE_PRIORITY: Record<ReviewRole, number> = {
  OWNER: 9,
  ADMIN: 8,
  SECURITY: 7,
  SECURITY_ADMIN: 7,
  SECURITY_ANALYST: 6,
  ENGINEER: 5,
  SENIOR_ENGINEER: 5,
  PLATFORM_ENGINEER: 5,
  REVIEWER: 4,
  AUDITOR: 3,
  VIEWER: 2,
};

const REQUIREMENTS: Record<string, Omit<ReviewApprovalRequirement, "token">> = {
  REVIEWER_APPROVAL: { minimumRole: "REVIEWER", label: "Reviewer approval" },
  REVIEWER_REVIEW: { minimumRole: "REVIEWER", label: "Reviewer approval" },
  ENGINEER_REVIEW: { minimumRole: "ENGINEER", label: "Engineer review" },
  SENIOR_ENGINEER_REVIEW: {
    minimumRole: "SENIOR_ENGINEER",
    label: "Senior engineer review",
    eligibleRoles: ["OWNER", "ADMIN", "SENIOR_ENGINEER"],
  },
  SECURITY_REVIEW: { minimumRole: "SECURITY_ANALYST", label: "Security review" },
  SECURITY_ANALYST_REVIEW: { minimumRole: "SECURITY_ANALYST", label: "Security analyst review" },
  PLATFORM_REVIEW: {
    minimumRole: "PLATFORM_ENGINEER",
    label: "Platform engineering review",
    eligibleRoles: ["OWNER", "ADMIN", "PLATFORM_ENGINEER"],
  },
};

function canonicalToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function resolveApprovalRequirements(
  configured: readonly string[],
): ReviewApprovalRequirement[] | null {
  if (configured.length === 0) {
    const requirement = REQUIREMENTS["REVIEWER_APPROVAL"];
    if (!requirement) throw new Error("REVIEWER_APPROVAL is not configured.");
    return [{ token: "REVIEWER_APPROVAL", ...requirement }];
  }

  const result = new Map<string, ReviewApprovalRequirement>();
  for (const configuredToken of configured) {
    const token = canonicalToken(configuredToken);
    const requirement = REQUIREMENTS[token];
    if (!requirement) {
      return null;
    }
    result.set(token, { token, ...requirement });
  }
  return [...result.values()];
}

export function roleMeetsApprovalRequirement(
  role: ReviewRole,
  requirement: ReviewApprovalRequirement,
): boolean {
  const normalizedRole = role === "SECURITY" ? "SECURITY_ADMIN" : role;
  if (requirement.eligibleRoles) {
    return requirement.eligibleRoles.includes(normalizedRole);
  }
  return ROLE_PRIORITY[normalizedRole] >= ROLE_PRIORITY[requirement.minimumRole];
}

export function resolveReviewAction(
  configuredRequirements: readonly string[],
  reviews: readonly RecordedApproval[],
): ReviewAction | null {
  const requirements = resolveApprovalRequirements(configuredRequirements);
  if (!requirements) {
    return null;
  }

  if (reviews.some((review) => review.status === "COMPLETED" && review.decision === "REJECTED")) {
    return "BLOCK";
  }
  if (
    reviews.some(
      (review) => review.status === "COMPLETED" && review.decision === "CHANGES_REQUESTED",
    )
  ) {
    return "REVIEW";
  }

  const approved = reviews.filter(
    (review) => review.status === "COMPLETED" && review.decision === "APPROVED",
  );
  const usedReviewerIds = new Set<string>();
  const orderedRequirements = [...requirements].sort(
    (left, right) => ROLE_PRIORITY[right.minimumRole] - ROLE_PRIORITY[left.minimumRole],
  );

  for (const requirement of orderedRequirements) {
    const eligibleApproval = approved.find(
      (review) =>
        !usedReviewerIds.has(review.reviewerId) &&
        roleMeetsApprovalRequirement(review.role, requirement),
    );
    if (!eligibleApproval) {
      return "REVIEW";
    }
    usedReviewerIds.add(eligibleApproval.reviewerId);
  }

  return "ALLOW";
}

export function isEligibleForApprovalRequirement(
  role: ReviewRole,
  configuredRequirements: readonly string[],
  requirementToken: string,
): boolean {
  const requirements = resolveApprovalRequirements(configuredRequirements);
  if (!requirements) {
    return false;
  }
  const requirement = requirements.find((candidate) => candidate.token === requirementToken);
  return requirement !== undefined && roleMeetsApprovalRequirement(role, requirement);
}
