"use client";

import { useEffect, useState, type FormEvent } from "react";

type IdentityProvider = {
  id: string;
  type: "OIDC" | "SAML";
  name: string;
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  secretConfigured: boolean;
  ssoTestedAt: string | null;
};

type OrganizationDomain = {
  id: string;
  domain: string;
  verified: boolean;
};

type Envelope<T> = {
  data: T | null;
  error: { message: string } | null;
};

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const envelope = (await response.json()) as Envelope<T>;
  if (!response.ok || envelope.error || envelope.data === null) {
    throw new Error(envelope.error?.message ?? `Request failed (${response.status}).`);
  }
  return envelope.data;
}

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100";
const buttonClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export function SsoSettings({
  organizationId,
  organizationSlug,
  initiallyEnforced,
}: {
  organizationId: string;
  organizationSlug: string;
  initiallyEnforced: boolean;
}) {
  const root = `/api/backend/api/organizations/${encodeURIComponent(organizationId)}`;
  const [providers, setProviders] = useState<IdentityProvider[]>([]);
  const [domains, setDomains] = useState<OrganizationDomain[]>([]);
  const [domain, setDomain] = useState("");
  const [challenge, setChallenge] = useState<{ name: string; value: string } | null>(null);
  const [providerType, setProviderType] = useState<"OIDC" | "SAML">("OIDC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ssoEnforced, setSsoEnforced] = useState(initiallyEnforced);

  async function refresh() {
    const [providerList, domainList] = await Promise.all([
      request<IdentityProvider[]>(`${root}/identity-providers`),
      request<OrganizationDomain[]>(`${root}/domains`),
    ]);
    setProviders(providerList);
    setDomains(domainList);
  }

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not load SSO settings.");
    });
    // The organization is fixed for this server-rendered settings page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const result = await request<{
        dnsRecord: { name: string; value: string };
      }>(`${root}/domains`, "POST", { domain });
      setChallenge(result.dnsRecord);
      setDomain("");
      await refresh();
      setNotice("Add the TXT record below in your DNS provider, then verify the domain.");
    });
  }

  async function addProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      const payload =
        providerType === "OIDC"
          ? {
              type: providerType,
              name: String(form.get("name") ?? ""),
              issuer: String(form.get("issuer") ?? ""),
              clientId: String(form.get("clientId") ?? ""),
              clientSecret: String(form.get("clientSecret") ?? ""),
            }
          : {
              type: providerType,
              name: String(form.get("name") ?? ""),
              issuer: String(form.get("idpIssuer") ?? ""),
              metadata: {
                entryPoint: String(form.get("entryPoint") ?? ""),
                idpIssuer: String(form.get("idpIssuer") ?? ""),
                idpCertificate: String(form.get("idpCertificate") ?? ""),
              },
            };
      await request<IdentityProvider>(`${root}/identity-providers`, "POST", payload);
      formElement.reset();
      await refresh();
      setNotice("Identity provider saved. Use its sign-in link to test before enforcing SSO.");
    });
  }

  async function verifyDomain(domainId: string) {
    await run(async () => {
      await request(`${root}/domains/${encodeURIComponent(domainId)}/verify`, "POST", {});
      setChallenge(null);
      await refresh();
      setNotice("Domain verified.");
    });
  }

  async function toggleProvider(provider: IdentityProvider) {
    await run(async () => {
      await request(
        `${root}/identity-providers/${encodeURIComponent(provider.id)}`,
        "PATCH",
        { enabled: !provider.enabled },
      );
      await refresh();
    });
  }

  async function removeProvider(provider: IdentityProvider) {
    if (!window.confirm(`Delete the ${provider.name} identity provider? Existing federated sessions will be revoked.`)) {
      return;
    }
    await run(async () => {
      await request(
        `${root}/identity-providers/${encodeURIComponent(provider.id)}`,
        "DELETE",
      );
      await refresh();
      setNotice("Identity provider deleted.");
    });
  }

  async function removeDomain(item: OrganizationDomain) {
    if (!window.confirm(`Remove the ${item.domain} domain from this organization?`)) return;
    await run(async () => {
      await request(`${root}/domains/${encodeURIComponent(item.id)}`, "DELETE");
      await refresh();
      setNotice("Domain removed.");
    });
  }

  async function toggleEnforcement() {
    await run(async () => {
      const result = await request<{ ssoEnforced: boolean }>(
        `${root}/sso-settings`,
        "PATCH",
        { ssoEnforced: !ssoEnforced },
      );
      setSsoEnforced(result.ssoEnforced);
      setNotice(
        result.ssoEnforced
          ? "SSO enforcement is enabled. Members must use the configured identity provider."
          : "SSO enforcement is disabled.",
      );
    });
  }

  return (
    <section className="space-y-6" aria-labelledby="sso-heading">
      <div>
        <h2 id="sso-heading" className="text-lg font-semibold text-slate-900">
          Enterprise single sign-on
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Configure OIDC or SAML, verify the organization&apos;s email domain, and test sign-in
          before enforcing SSO. Users must already be active members; this does not provision
          accounts.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="font-medium text-slate-900">Verified email domains</h3>
        <p className="mt-1 text-sm text-slate-600">
          Only verified domains may be used to match an existing organization member during SSO.
        </p>
        <form onSubmit={addDomain} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="sso-domain">Email domain</label>
          <input
            id="sso-domain"
            className={`${inputClass} mt-0`}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="example.com"
            required
          />
          <button className={buttonClass} disabled={busy}>Request TXT challenge</button>
        </form>
        {challenge && (
          <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm">
            <p className="font-medium">Publish this DNS TXT record:</p>
            <dl className="mt-2 grid gap-1 sm:grid-cols-[5rem_1fr]">
              <dt className="text-slate-500">Name</dt><dd className="break-all font-mono">{challenge.name}</dd>
              <dt className="text-slate-500">Value</dt><dd className="break-all font-mono">{challenge.value}</dd>
            </dl>
          </div>
        )}
        <ul className="mt-4 divide-y divide-slate-100">
          {domains.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span>{item.domain}</span>
              {item.verified ? (
                <span className="text-emerald-700">Verified</span>
              ) : (
                <button className={buttonClass} disabled={busy} onClick={() => void verifyDomain(item.id)}>
                  Verify TXT record
                </button>
              )}
              <button className={buttonClass} disabled={busy} onClick={() => void removeDomain(item)}>
                Remove
              </button>
            </li>
          ))}
          {domains.length === 0 && <li className="py-3 text-sm text-slate-500">No domains configured.</li>}
        </ul>
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="font-medium text-slate-900">Identity providers</h3>
        <ul className="mt-3 divide-y divide-slate-100">
          {providers.map((provider) => (
            <li key={provider.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {provider.name} <span className="font-normal text-slate-500">({provider.type})</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {provider.enabled ? "Enabled" : "Disabled"} ·{" "}
                  {provider.ssoTestedAt ? "Sign-in tested" : "Not tested"}
                </p>
                {provider.type === "SAML" && (
                  <a
                    className="mt-1 inline-block text-xs text-orange-800 underline"
                    href={`/api/auth/sso/saml/metadata/${encodeURIComponent(provider.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Service-provider metadata
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                {provider.enabled && (
                  <a
                    className={`${buttonClass} inline-block`}
                    href={`/api/auth/sso/start?organization=${encodeURIComponent(organizationSlug)}&provider=${encodeURIComponent(provider.id)}&redirectTo=%2Fdashboard%2Fsettings`}
                  >
                    Test sign-in
                  </a>
                )}
                <button className={buttonClass} disabled={busy} onClick={() => void toggleProvider(provider)}>
                  {provider.enabled ? "Disable" : "Enable"}
                </button>
                <button className={buttonClass} disabled={busy} onClick={() => void removeProvider(provider)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
          {providers.length === 0 && <li className="py-3 text-sm text-slate-500">No identity providers configured.</li>}
        </ul>

        <form onSubmit={addProvider} className="mt-5 space-y-3 border-t border-slate-200 pt-4">
          <h4 className="font-medium text-slate-900">Add an identity provider</h4>
          <label className="block text-sm">
            Protocol
            <select
              className={inputClass}
              value={providerType}
              onChange={(event) => setProviderType(event.target.value as "OIDC" | "SAML")}
            >
              <option value="OIDC">OpenID Connect</option>
              <option value="SAML">SAML 2.0</option>
            </select>
          </label>
          <label className="block text-sm">Display name<input className={inputClass} name="name" required maxLength={120} /></label>
          {providerType === "OIDC" ? (
            <>
              <label className="block text-sm">Issuer URL<input className={inputClass} name="issuer" type="url" placeholder="https://idp.example.com" required /></label>
              <label className="block text-sm">Client ID<input className={inputClass} name="clientId" required /></label>
              <label className="block text-sm">Client secret<input className={inputClass} name="clientSecret" type="password" autoComplete="new-password" required /></label>
              <p className="text-xs text-slate-500">Allowed OIDC issuers must also be approved in the service&apos;s SSO issuer allowlist.</p>
              <p className="text-xs text-slate-500">Register this exact redirect URI with your IdP: https://your-nomalog-domain/api/auth/sso/oidc/callback</p>
            </>
          ) : (
            <>
              <label className="block text-sm">IdP issuer/entity ID<input className={inputClass} name="idpIssuer" required /></label>
              <label className="block text-sm">IdP SSO URL<input className={inputClass} name="entryPoint" type="url" placeholder="https://idp.example.com/sso" required /></label>
              <label className="block text-sm">IdP signing certificate (PEM)<textarea className={inputClass} name="idpCertificate" rows={5} required /></label>
              <p className="text-xs text-slate-500">Configure the IdP ACS URL as {`https://your-nomalog-domain/api/auth/sso/saml/callback`}. Service-provider metadata is available after saving.</p>
            </>
          )}
          <button className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50" disabled={busy}>
            Save provider
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-medium text-slate-900">SSO enforcement</h3>
          <p className="mt-1 text-sm text-slate-600">
            {ssoEnforced ? "Required for organization access." : "Not enforced; existing sign-in methods remain available."}
          </p>
        </div>
        <button className={buttonClass} disabled={busy} onClick={() => void toggleEnforcement()}>
          {ssoEnforced ? "Disable enforcement" : "Enable enforcement"}
        </button>
      </div>
    </section>
  );
}
