import type { Metadata } from "next";
import {
  getAssessments,
  getCurrentUser,
  getOrganizations,
  getRepositories,
  getSelectedOrganization,
} from "@/lib/api";
import { AssessmentConsole } from "./assessment-console";

export const metadata: Metadata = {
  title: "AI Risk Assessment",
  robots: { index: false, follow: false },
};

export default async function DashboardAssessmentPage() {
  const [user, organizations] = await Promise.all([getCurrentUser(), getOrganizations()]);
  if (!user) return null;
  const organization = await getSelectedOrganization(organizations);
  if (!organization) return null;

  const [repositories, assessments] = await Promise.all([
    getRepositories(organization.id),
    getAssessments(organization.id),
  ]);

  return (
    <AssessmentConsole
      organizationId={organization.id}
      repositories={repositories}
      initialAssessments={assessments}
      canManage={["OWNER", "ADMIN"].includes(organization.role.toUpperCase())}
    />
  );
}
