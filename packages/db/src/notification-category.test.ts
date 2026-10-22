import { describe, expect, it } from "vitest";
import {
  getNotificationCategory,
  getNotificationEmailPreferenceField,
} from "./notification-category.js";

describe("notification category mapping", () => {
  it.each([
    ["FINDING_HIGH", "SECURITY", "securityEmailEnabled"],
    ["ASSESSMENT_COMPLETED", "ASSESSMENTS", "assessmentsEmailEnabled"],
    ["POLICY_BLOCKED", "GOVERNANCE", "governanceEmailEnabled"],
    ["SOURCE_CONTROL_CONNECTED", "INTEGRATIONS", "integrationsEmailEnabled"],
    ["BILLING_UPDATED", "ACCOUNT", "accountEmailEnabled"],
    ["UNCLASSIFIED", "OTHER", null],
  ] as const)("maps %s to %s and its email preference", (type, category, field) => {
    expect(getNotificationCategory(type)).toBe(category);
    expect(getNotificationEmailPreferenceField(type)).toBe(field);
  });
});
