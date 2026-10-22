import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowRight, Check, ExternalLink, ShieldCheck } from "lucide-react";
import { getCurrentUser, getOrganizations } from "@/lib/api";
import { ProductEventLink } from "@/components/product-analytics";
import { SsoSignInForm } from "./sso-sign-in";

export const metadata: Metadata = {
  title: "Create your workspace",
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_name: "Enter an organization name to continue.",
  create_failed: "We couldn't create the organization. Please try again.",
};
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "GitHub sign-in was cancelled. You can try again when you're ready.",
  failed: "GitHub sign-in could not be completed. Check the GitHub App configuration or retry.",
  expired: "The sign-in request expired or could not be verified. Start sign-in again.",
  "account-conflict":
    "We couldn't safely match this GitHub account to an existing Nomalog account. Use the GitHub account with the verified email on your invitation. If you still can't sign in, ask an organization administrator to check the invitation email.",
  "sso-failed": "Organization SSO could not be completed. Check the provider configuration or try again.",
  "sso-provider-selection-required": "Choose an enabled sign-in provider for your organization.",
  "sso-not-provisioned": "Your account is not an active member of this organization. Ask an administrator to provision access first.",
  "sso-domain-not-verified": "The verified email from your identity provider does not match a domain verified by this organization.",
  "sso-configuration": "The organization identity provider is not configured correctly. Contact its administrator.",
  "sso-https-required": "Organization SSO requires a secure HTTPS connection.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; authError?: string }>;
}) {
  const user = await getCurrentUser();
  const organizations = user ? await getOrganizations() : [];
  if (user && organizations.length > 0) {
    redirect("/dashboard");
  }

  const { error, authError } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;
  const authErrorMessage = authError ? AUTH_ERROR_MESSAGES[authError] : undefined;

  return (
    <main className="min-h-screen bg-[#fbfaf8] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-orange-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="text-sm font-bold tracking-tight">Nomalog</span>
          </Link>
          <Link
            href="/docs/quickstart"
            className="text-sm font-medium text-slate-600 hover:text-slate-950"
          >
            Setup guide
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-10 sm:px-8 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <aside>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">
            Workspace setup · 1 of 3
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950">
            Let’s set up your organization.
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Create the workspace that will own your connected repositories, governance policies, and
            change evidence.
          </p>

          <ol className="mt-8 space-y-5">
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
                <Check className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Sign in with GitHub</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  {user
                    ? "Your account is authenticated and ready to create a workspace."
                    : "Sign in with GitHub to create a workspace."}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-orange-500 bg-white text-xs font-bold text-orange-800">
                1
              </span>
              <div>
                <p className="text-sm font-semibold">Create your workspace</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  Set the organization that will own connected repositories and policies.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-500">
                2
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-600">Connect GitHub</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  Install the GitHub App and choose a test repository.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-500">
                3
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-600">Review a pull request</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  Explore risk, policies, attribution, and evidence in context.
                </p>
              </div>
            </li>
          </ol>
        </aside>

        <section className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-800">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Step 1 · Workspace
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Create your workspace</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use the name your engineering team will recognize. You can connect repositories and
            configure governance after creation.
          </p>
          {authErrorMessage && (
            <p
              role="alert"
              className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              {authErrorMessage}
            </p>
          )}

          {errorMessage && (
            <p
              role="alert"
              className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errorMessage}
            </p>
          )}

          {user ? (
            <form action="/api/onboarding/organizations" method="post" className="mt-6 space-y-4">
              <label
                htmlFor="organization-name"
                className="block text-sm font-semibold text-slate-800"
              >
                Organization name
                <input
                  id="organization-name"
                  name="name"
                  type="text"
                  autoComplete="organization"
                  maxLength={120}
                  required
                  autoFocus
                  className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-3 text-sm shadow-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="Acme Engineering"
                />
              </label>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
              >
                Create organization <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <ProductEventLink
              href="/api/auth/github/login?redirectTo=/onboarding"
              event="signup_started"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700"
            >
              Sign in with GitHub <ArrowRight className="h-4 w-4" />
            </ProductEventLink>
          )}

          <SsoSignInForm />

          <div className="mt-6 border-t border-slate-200 pt-5">
            <p className="text-xs leading-5 text-slate-500">
              Expected to join an existing organization? Ask its owner to add your GitHub account
              instead of creating another workspace.
            </p>
            <Link
              href="/docs/quickstart"
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-orange-800 hover:text-orange-950"
            >
              Read the setup guide <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
