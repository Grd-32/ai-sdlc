import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import { getCurrentUser, getOrganizations } from "@/lib/api";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_name: "Enter an organization name to continue.",
  create_failed: "We couldn't create the organization. Please try again.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/api/auth/github/login?redirectTo=/onboarding");
  }

  const organizations = await getOrganizations();
  if (organizations.length > 0) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Shield className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Create your organization</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Set up the organization you’ll use to connect repositories and manage AI-assisted
          development. You’ll become its owner and can invite teammates later.
        </p>
        {errorMessage && (
          <p
            role="alert"
            className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}
        <form action="/api/onboarding/organizations" method="post" className="mt-6 space-y-4">
          <label htmlFor="organization-name" className="block text-sm font-medium text-slate-700">
            Organization name
            <input
              id="organization-name"
              name="name"
              type="text"
              autoComplete="organization"
              maxLength={120}
              required
              autoFocus
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              placeholder="Acme Engineering"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            Create organization
          </button>
        </form>
        <p className="mt-5 text-xs leading-5 text-slate-500">
          If you expected to join an existing organization, ask its owner to add your GitHub account
          instead of creating a separate one.
        </p>
      </section>
    </main>
  );
}
