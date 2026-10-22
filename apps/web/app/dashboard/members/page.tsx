import { Users } from "lucide-react";
import {
  getCurrentUser,
  getOrganizationMembers,
  getOrganizations,
  getSelectedOrganization,
} from "@/lib/api";
import { MembersManager } from "./members-manager";

export default async function MembersPage() {
  const organizations = await getOrganizations();
  const organization = await getSelectedOrganization(organizations);
  const user = await getCurrentUser();
  if (!organization || !user) {
    return null;
  }

  const members = await getOrganizationMembers(organization.id);
  const activeCount = members.filter((member) => member.active).length;
  const administrators = members.filter(
    (member) => member.active && ["OWNER", "ADMIN"].includes(member.role),
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <Users className="h-4 w-4" />
            Organization access
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Members and roles
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Control who can access {organization.name} and which governance actions they can take.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-md border border-slate-200 bg-white px-4 py-2">
            <p className="text-xs text-slate-500">Active members</p>
            <p className="text-lg font-semibold text-slate-900">{activeCount}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-2">
            <p className="text-xs text-slate-500">Owners and admins</p>
            <p className="text-lg font-semibold text-slate-900">{administrators}</p>
          </div>
        </div>
      </div>
      <MembersManager
        organizationId={organization.id}
        actorRole={organization.role}
        currentUserId={user.id}
        members={members}
      />
    </div>
  );
}
