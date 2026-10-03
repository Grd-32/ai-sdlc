import type { BadgeProps } from "@/components/ui/badge";

export function riskBadgeVariant(level: string | null | undefined): BadgeProps["variant"] {
  switch (level) {
    case "CRITICAL":
      return "destructive";
    case "HIGH":
      return "warning";
    case "MEDIUM":
      return "secondary";
    case "LOW":
      return "success";
    default:
      return "outline";
  }
}

export function policyBadgeVariant(action: string | null | undefined): BadgeProps["variant"] {
  switch (action) {
    case "BLOCK":
      return "destructive";
    case "REVIEW":
      return "warning";
    case "ALLOW":
      return "success";
    default:
      return "outline";
  }
}

export function evidenceBadgeVariant(status: string | null | undefined): BadgeProps["variant"] {
  switch (status) {
    case "PASS":
      return "success";
    case "FAIL":
      return "destructive";
    case "UNKNOWN":
    case "NOT_RUN":
      return "warning";
    case "NOT_APPLICABLE":
      return "outline";
    default:
      return "outline";
  }
}