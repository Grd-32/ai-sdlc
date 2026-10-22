"use client";

import { useState, type FormEvent } from "react";

type SsoProvider = { id: string; name: string; type: "OIDC" | "SAML" };

export function SsoSignInForm() {
  const [organization, setOrganization] = useState("");
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function findProviders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setProviders([]);
    try {
      const response = await fetch(
        `/api/backend/api/auth/sso/providers?organization=${encodeURIComponent(organization.trim())}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        data: SsoProvider[] | null;
        error: { message: string } | null;
      };
      if (!response.ok || result.error) {
        throw new Error(result.error?.message ?? "Could not look up SSO providers.");
      }
      const available = result.data ?? [];
      if (available.length === 0) {
        setMessage("No enabled SSO provider was found. Check the organization slug with its administrator.");
        return;
      }
      if (available.length === 1) {
        window.location.assign(signInUrl(organization.trim(), available[0]!.id));
        return;
      }
      setProviders(available);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not look up SSO providers.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5 border-t border-slate-200 pt-5">
      <h3 className="text-sm font-semibold text-slate-800">Sign in with organization SSO</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        Enter the organization slug provided by your administrator.
      </p>
      <form onSubmit={findProviders} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="sso-organization">Organization slug</label>
        <input
          id="sso-organization"
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          autoComplete="organization"
          placeholder="acme-engineering"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Looking up…" : "Continue"}
        </button>
      </form>
      {message && <p role="status" className="mt-2 text-sm text-slate-600">{message}</p>}
      {providers.length > 1 && (
        <ul className="mt-3 space-y-2">
          {providers.map((provider) => (
            <li key={provider.id}>
              <a
                className="block rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-orange-800 hover:bg-orange-50"
                href={signInUrl(organization.trim(), provider.id)}
              >
                Continue with {provider.name} ({provider.type})
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function signInUrl(organization: string, providerId: string): string {
  return `/api/auth/sso/start?organization=${encodeURIComponent(organization)}&provider=${encodeURIComponent(providerId)}`;
}
