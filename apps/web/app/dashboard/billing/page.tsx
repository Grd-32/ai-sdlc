import type { Metadata } from "next";
import { getOrganizations, getSelectedOrganization } from "@/lib/api";
import { BillingConsole } from "./billing-console";

export const metadata: Metadata = {
  title: "Billing",
  robots: { index: false, follow: false },
};

export default async function BillingPage() {
  const organizations = await getOrganizations();
  const organization = await getSelectedOrganization(organizations);
  if (!organization) return null;
  return (
    <BillingConsole
      organizationId={organization.id}
      organizationName={organization.name}
      organizationRole={organization.role}
    />
  );
}
