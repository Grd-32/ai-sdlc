export const NOTIFICATION_EMAIL_PREFERENCE_FIELDS = {
  SECURITY: "securityEmailEnabled",
  ASSESSMENTS: "assessmentsEmailEnabled",
  GOVERNANCE: "governanceEmailEnabled",
  INTEGRATIONS: "integrationsEmailEnabled",
  ACCOUNT: "accountEmailEnabled",
} as const;

export type NotificationEmailPreferenceField =
  (typeof NOTIFICATION_EMAIL_PREFERENCE_FIELDS)[keyof typeof NOTIFICATION_EMAIL_PREFERENCE_FIELDS];

export type NotificationCategory = keyof typeof NOTIFICATION_EMAIL_PREFERENCE_FIELDS | "OTHER";

export function getNotificationCategory(type: string): NotificationCategory {
  if (type.startsWith("ASSESSMENT_")) return "ASSESSMENTS";
  if (type.startsWith("SECURITY_") || type.startsWith("FINDING_")) return "SECURITY";
  if (
    type.startsWith("POLICY_") ||
    type.startsWith("RISK_ACCEPTANCE_") ||
    type.startsWith("REVIEW_") ||
    type.startsWith("CHANGE_PASSPORT_")
  ) {
    return "GOVERNANCE";
  }
  if (type.startsWith("INTEGRATION_") || type.startsWith("SOURCE_CONTROL_")) {
    return "INTEGRATIONS";
  }
  if (
    type.startsWith("ACCOUNT_") ||
    type.startsWith("BILLING_") ||
    type.startsWith("ORGANIZATION_INVITATION_")
  ) {
    return "ACCOUNT";
  }
  return "OTHER";
}

export function getNotificationEmailPreferenceField(
  type: string,
): NotificationEmailPreferenceField | null {
  const category = getNotificationCategory(type);
  return category === "OTHER" ? null : NOTIFICATION_EMAIL_PREFERENCE_FIELDS[category];
}
