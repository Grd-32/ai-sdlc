import { describe, expect, it } from "vitest";
import { authorize, canManageRole, normalizeRole, roleAtLeast } from "./authorize.js";

describe("@ai-sdlc/db authorization", () => {
  it("normalizes the legacy SECURITY role to SECURITY_ADMIN for comparisons", () => {
    expect(normalizeRole("SECURITY")).toBe("SECURITY_ADMIN");
  });

  it("treats SECURITY as policy-admin for policy writes", () => {
    expect(authorize({ role: "SECURITY", resource: "policy", action: "write" })).toEqual({
      allowed: true,
    });
  });

  it("keeps least-privilege checks strict for non-admin users", () => {
    expect(roleAtLeast("ENGINEER", "SECURITY_ADMIN")).toBe(false);
    expect(authorize({ role: "ENGINEER", resource: "policy", action: "write" }).allowed).toBe(
      false,
    );
    expect(authorize({ role: "AUDITOR", resource: "audit_event", action: "read" }).allowed).toBe(
      true,
    );
  });

  it("prevents a role administrator from granting or managing a higher role", () => {
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(true);
    expect(canManageRole("OWNER", "ADMIN")).toBe(true);
    expect(canManageRole("SECURITY", "SECURITY_ADMIN")).toBe(true);
  });
});
