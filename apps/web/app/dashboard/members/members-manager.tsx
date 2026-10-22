"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { OrganizationMemberSummary } from "@/lib/api";

const ROLES = [
  "OWNER",
  "ADMIN",
  "SECURITY_ADMIN",
  "SECURITY_ANALYST",
  "ENGINEER",
  "SENIOR_ENGINEER",
  "PLATFORM_ENGINEER",
  "REVIEWER",
  "AUDITOR",
  "VIEWER",
] as const;

const ROLE_PRIORITY: Record<string, number> = {
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
const ADMIN_PRIORITY = 8;

interface ApiResponse {
  data: unknown;
  error: { code: string; message: string } | null;
}

export function MembersManager({
  organizationId,
  actorRole,
  currentUserId,
  members,
}: {
  organizationId: string;
  actorRole: string;
  currentUserId: string;
  members: OrganizationMemberSummary[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("REVIEWER");
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const actorPriority = ROLE_PRIORITY[actorRole] ?? 0;
  const path = `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/member-invitations`;
  const allowedRoles = ROLES.filter((role) => (ROLE_PRIORITY[role] ?? 0) <= actorPriority);

  async function send(
    key: string,
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
    successMessage?: string,
  ) {
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = (await response.json()) as ApiResponse;
      if (!response.ok) {
        setError(result.error?.message ?? "The member change could not be completed.");
        return;
      }
      setNotice(successMessage ?? "Member details updated.");
      router.refresh();
    } catch (cause) {
      console.error("[members] membership request failed:", cause);
      setError("The server could not be reached. Your change was not confirmed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter the member's email address.");
      return;
    }
    await send(
      "add",
      path,
      "POST",
      { email: normalizedEmail, role: newRole },
      "Invitation created. The invitee must sign in with this email address and accept it.",
    );
    setEmail("");
  }

  return (
    <div className="space-y-6">
      {actorPriority >= ADMIN_PRIORITY && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Add a member</h2>
          <p className="mt-1 text-sm text-slate-600">
            Nomalog links access to the verified email used for GitHub sign-in. This does not send
            an invitation email.
          </p>
          <form
            onSubmit={addMember}
            className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]"
          >
            <label className="sr-only" htmlFor="member-email">
              Member email
            </label>
            <input
              id="member-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="colleague@company.com"
              className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
            <label className="sr-only" htmlFor="member-role">
              Organization role
            </label>
            <select
              id="member-role"
              value={allowedRoles.includes(newRole as (typeof ROLES)[number]) ? newRole : "VIEWER"}
              onChange={(event) => setNewRole(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              {allowedRoles.map((role) => (
                <option key={role} value={role}>
                  {role.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busyKey !== null}
              className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busyKey === "add" ? "Adding…" : "Add member"}
            </button>
          </form>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Organization members</h2>
          <p className="mt-1 text-sm text-slate-500">
            Role changes and access deactivation are written to the organization audit log.
          </p>
        </div>
        {members.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No members are listed for this organization.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Member</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Access</th>
                  <th className="px-5 py-3 font-semibold">Last sign-in</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((member) => {
                  const canManage =
                    actorPriority >= (ROLE_PRIORITY[member.role] ?? Number.POSITIVE_INFINITY);
                  const selection = roleSelections[member.id] ?? member.role;
                  const options = ROLES.filter(
                    (role) => (ROLE_PRIORITY[role] ?? 0) <= actorPriority,
                  );
                  const rowBusy = busyKey === member.id;
                  return (
                    <tr key={member.id} className={!member.active ? "bg-slate-50/70" : undefined}>
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-900">
                          {member.name ?? member.username ?? member.email}
                          {member.userId === currentUserId && (
                            <span className="ml-2 text-xs font-normal text-slate-500">You</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {member.email}
                          {member.username ? ` · @${member.username}` : ""}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        {actorPriority >= ADMIN_PRIORITY ? (
                          <select
                            aria-label={`Role for ${member.email}`}
                            value={
                              options.includes(selection as (typeof ROLES)[number])
                                ? selection
                                : member.role
                            }
                            disabled={!canManage || !member.active || busyKey !== null}
                            onChange={(event) =>
                              setRoleSelections((current) => ({
                                ...current,
                                [member.id]: event.target.value,
                              }))
                            }
                            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs disabled:opacity-60"
                          >
                            {!options.includes(member.role as (typeof ROLES)[number]) && (
                              <option value={member.role}>
                                {member.role.replaceAll("_", " ")}
                              </option>
                            )}
                            {options.map((role) => (
                              <option key={role} value={role}>
                                {role.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-700">{member.role.replaceAll("_", " ")}</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            member.active
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {member.active ? "Active" : "Deactivated"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {member.lastLoginAt ? (
                          <time dateTime={member.lastLoginAt}>
                            {new Date(member.lastLoginAt)
                              .toISOString()
                              .replace("T", " ")
                              .slice(0, 16)}{" "}
                            UTC
                          </time>
                        ) : (
                          "No sign-in recorded"
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {actorPriority >= ADMIN_PRIORITY && canManage ? (
                          <div className="flex justify-end gap-2">
                            {member.active && selection !== member.role && (
                              <button
                                type="button"
                                disabled={busyKey !== null}
                                onClick={() =>
                                  void send(
                                    member.id,
                                    `${path}/${encodeURIComponent(member.id)}`,
                                    "PATCH",
                                    { role: selection },
                                    "Member role updated.",
                                  )
                                }
                                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                Save role
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => {
                                if (
                                  member.active &&
                                  !window.confirm(
                                    `Deactivate ${member.email}'s organization access?`,
                                  )
                                ) {
                                  return;
                                }
                                void send(
                                  member.id,
                                  `${path}/${encodeURIComponent(member.id)}`,
                                  "PATCH",
                                  { active: !member.active },
                                  member.active
                                    ? "Organization access deactivated."
                                    : "Organization access reactivated.",
                                );
                              }}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {rowBusy ? "Saving…" : member.active ? "Deactivate" : "Reactivate"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Read only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
