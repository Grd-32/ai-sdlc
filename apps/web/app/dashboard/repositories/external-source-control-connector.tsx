"use client";

import { useCallback, useEffect, useState } from "react";

type Provider = "BITBUCKET" | "AZURE_DEVOPS";
type Connection = {
  id: string;
  provider: string;
  accountName: string;
  _count: { repositories: number };
};
type Workspace = { uuid: string; slug: string; name: string };
type Project = { id: string; name: string };
type Repository = {
  externalId: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  webUrl: string;
};
type Collection<T> = {
  items: T[];
  complete: boolean;
  capability?: { status: string; detail: string };
};
type ApiResponse<T> = { data: T | null; error: { code: string; message: string } | null };
type BitbucketWebhookSetup = {
  webhookUrl: string;
  secret: string;
  events: string[];
  signatureHeader: string;
};
type AzureDevOpsWebhookSetup = {
  webhookUrl: string;
  username: string;
  password: string;
  events: string[];
  authentication: string;
  resourceDetails: string;
};

function displayError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ExternalSourceControlConnector({
  provider,
  organizationId,
  canManage,
  connected,
  errorCode,
}: {
  provider: Provider;
  organizationId: string;
  canManage: boolean;
  connected: boolean;
  errorCode?: string;
}) {
  const isBitbucket = provider === "BITBUCKET";
  const title = isBitbucket ? "Bitbucket Cloud" : "Azure DevOps";
  const slug = isBitbucket ? "bitbucket" : "azure-devops";
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [groups, setGroups] = useState<Array<Workspace | Project>>([]);
  const [groupId, setGroupId] = useState("");
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [azureOrganization, setAzureOrganization] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [coverage, setCoverage] = useState<string | null>(null);
  const [webhookSetup, setWebhookSetup] = useState<BitbucketWebhookSetup | null>(null);
  const [azureWebhookSetup, setAzureWebhookSetup] = useState<AzureDevOpsWebhookSetup | null>(null);

  const base = `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/${slug}`;
  const readConnections = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/connections`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as ApiResponse<Connection[]>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not load source-control connections.");
      }
      const matches = body.data.filter((entry) => entry.provider === provider);
      setConnections(matches);
      setConnectionId((previous) =>
        matches.some((entry) => entry.id === previous) ? previous : (matches[0]?.id ?? ""),
      );
    } catch (loadError) {
      setError(displayError(loadError, "Could not load source-control connections."));
    } finally {
      setLoading(false);
    }
  }, [organizationId, provider]);

  const readGroups = useCallback(async () => {
    if (!connectionId) {
      setGroups([]);
      setGroupId("");
      return;
    }
    setError("");
    try {
      const path = isBitbucket ? `${base}/workspaces` : `${base}/projects`;
      const response = await fetch(`${path}?connectionId=${encodeURIComponent(connectionId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as ApiResponse<Collection<Workspace | Project>>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? `Could not list ${title} workspaces.`);
      }
      setGroups(body.data.items);
      setGroupId((previous) =>
        body.data?.items.some((item) => ("slug" in item ? item.slug : item.id) === previous)
          ? previous
          : body.data?.items[0]
            ? "slug" in body.data.items[0]
              ? body.data.items[0].slug
              : body.data.items[0].id
            : "",
      );
      setCoverage(
        body.data.complete
          ? null
          : "The provider returned a truncated list. Only listed resources are available for selection.",
      );
    } catch (loadError) {
      setGroups([]);
      setGroupId("");
      setError(displayError(loadError, `Could not list ${title} workspaces.`));
    }
  }, [base, connectionId, isBitbucket, title]);

  useEffect(() => {
    void readConnections();
  }, [readConnections]);

  useEffect(() => {
    void readGroups();
  }, [readGroups]);

  useEffect(() => {
    if (!connectionId || !groupId) {
      setRepositories([]);
      setSelected([]);
      return;
    }
    let cancelled = false;
    async function readRepositories() {
      setLoadingRepos(true);
      setError("");
      setSelected([]);
      try {
        const response = await fetch(
          `${base}/repositories?connectionId=${encodeURIComponent(connectionId)}&${isBitbucket ? "workspace" : "project"}=${encodeURIComponent(groupId)}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as ApiResponse<Collection<Repository>>;
        if (!response.ok || !body.data) {
          throw new Error(body.error?.message ?? `Could not list ${title} repositories.`);
        }
        if (!cancelled) {
          setRepositories(body.data.items);
          setCoverage(
            body.data.complete
              ? null
              : "The provider returned a truncated repository list; unlisted repositories are not selectable.",
          );
        }
      } catch (readError) {
        if (!cancelled) {
          setRepositories([]);
          setError(displayError(readError, `Could not list ${title} repositories.`));
        }
      } finally {
        if (!cancelled) setLoadingRepos(false);
      }
    }
    void readRepositories();
    return () => {
      cancelled = true;
    };
  }, [base, connectionId, groupId, isBitbucket, title]);

  async function saveSelection() {
    if (!connectionId || !groupId || selected.length === 0) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${base}/repositories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId,
          ...(isBitbucket ? { workspace: groupId } : { project: groupId }),
          repositoryIds: selected,
        }),
      });
      const body = (await response.json()) as ApiResponse<unknown>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not save repository selection.");
      }
      setMessage(
        `${selected.length} ${title} ${selected.length === 1 ? "repository" : "repositories"} added to the organization.`,
      );
      setSelected([]);
      await readConnections();
    } catch (saveError) {
      setError(displayError(saveError, "Could not save repository selection."));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect(id: string) {
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/connections/${encodeURIComponent(id)}/external`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as ApiResponse<{ disconnected: boolean }>;
      if (!response.ok && !body.data?.disconnected) {
        throw new Error(body.error?.message ?? `Could not disconnect ${title}.`);
      }
      setMessage(
        body.error?.message ??
          `${title} disconnected. Its repositories have been removed from active monitoring.`,
      );
      await readConnections();
    } catch (disconnectError) {
      setError(displayError(disconnectError, `Could not disconnect ${title}.`));
    }
  }

  async function configureBitbucketWebhook() {
    if (!isBitbucket || !connectionId) return;
    setError("");
    setMessage("");
    setWebhookSetup(null);
    try {
      const response = await fetch(`${base}/webhook-secret`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const body = (await response.json()) as ApiResponse<BitbucketWebhookSetup>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not configure Bitbucket webhook delivery.");
      }
      setWebhookSetup(body.data);
      setMessage("Webhook signing secret created. Copy it now; it cannot be viewed again.");
    } catch (setupError) {
      setError(displayError(setupError, "Could not configure Bitbucket webhook delivery."));
    }
  }

  async function configureAzureDevOpsWebhook() {
    if (isBitbucket || !connectionId) return;
    setError("");
    setMessage("");
    setAzureWebhookSetup(null);
    try {
      const response = await fetch(`${base}/webhook-secret`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const body = (await response.json()) as ApiResponse<AzureDevOpsWebhookSetup>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not configure Azure DevOps Service Hooks.");
      }
      setAzureWebhookSetup(body.data);
      setMessage(
        "Basic-auth credentials created. Copy the password now; it cannot be viewed again.",
      );
    } catch (setupError) {
      setError(displayError(setupError, "Could not configure Azure DevOps Service Hooks."));
    }
  }

  const connectHref = isBitbucket
    ? `/api/source-control/bitbucket/connect?organizationId=${encodeURIComponent(organizationId)}`
    : `/api/source-control/azure-devops/connect?organizationId=${encodeURIComponent(organizationId)}&azureOrganization=${encodeURIComponent(azureOrganization.trim())}`;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Connect with provider authorization, then explicitly select repositories. Access is
            read-only and analysis is limited to selected repositories. Both providers support
            on-demand assessment and changed-file analysis. Pull-request webhooks can trigger
            analysis, but neither provider is continuously monitored.
          </p>
          {!isBitbucket && (
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Azure DevOps Advanced Security alerts require the optional read-only{" "}
              <code>vso.advsec</code> permission. Only current active alerts are available; an empty
              result does not establish that scanners are enabled or have complete historical
              coverage.
            </p>
          )}
        </div>
        {canManage &&
          (isBitbucket ? (
            <a
              href={connectHref}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Connect Bitbucket Cloud
            </a>
          ) : (
            <form
              action="/api/source-control/azure-devops/connect"
              method="get"
              className="flex flex-wrap gap-2"
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <label className="sr-only" htmlFor="azure-devops-organization">
                Azure DevOps organization
              </label>
              <input
                id="azure-devops-organization"
                name="azureOrganization"
                value={azureOrganization}
                onChange={(event) => setAzureOrganization(event.target.value)}
                required
                pattern="[A-Za-z0-9_-]{1,64}"
                maxLength={64}
                placeholder="Azure DevOps organization"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={!azureOrganization.trim()}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                Connect Azure DevOps
              </button>
            </form>
          ))}
      </div>

      {connected && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {title} authorization completed. Choose the repositories to add below.
        </p>
      )}
      {errorCode && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not connect {title} ({errorCode.replaceAll("_", " ")}). Check the provider
          configuration, then retry.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {coverage && <p className="text-sm text-amber-800">{coverage}</p>}

      {canManage && connections.length > 0 && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="space-y-1 text-sm font-medium text-slate-700">
            Connected account
            <select
              value={connectionId}
              onChange={(event) => {
                setConnectionId(event.target.value);
                setWebhookSetup(null);
                setAzureWebhookSetup(null);
              }}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2"
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.accountName} ({connection._count.repositories} selected)
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-sm font-medium text-slate-700">
              {isBitbucket ? "Workspace" : "Project"}
              <select
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2"
              >
                {groups.map((group) => {
                  const id = "slug" in group ? group.slug : group.id;
                  return (
                    <option key={id} value={id}>
                      {group.name}
                    </option>
                  );
                })}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void disconnect(connectionId)}
              className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              Disconnect
            </button>
            {isBitbucket && (
              <button
                type="button"
                onClick={() => void configureBitbucketWebhook()}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Create webhook secret
              </button>
            )}
            {!isBitbucket && (
              <button
                type="button"
                onClick={() => void configureAzureDevOpsWebhook()}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Configure Service Hooks
              </button>
            )}
          </div>
        </div>
      )}

      {webhookSetup && canManage && isBitbucket && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">
            Configure a Bitbucket Cloud webhook for each selected repository.
          </p>
          <p>
            URL: <code className="break-all">{webhookSetup.webhookUrl}</code>
          </p>
          <p>
            Secret: <code className="break-all">{webhookSetup.secret}</code>
          </p>
          <p>Events: {webhookSetup.events.join(", ")}</p>
          <p>Signature: {webhookSetup.signatureHeader}</p>
          <p className="text-xs">
            The secret is encrypted at rest and displayed only once. Rotating it invalidates the
            previous signature. Bitbucket webhooks enter the shared on-demand analysis pipeline;
            this does not enable repository polling or continuous monitoring.
          </p>
        </div>
      )}
      {azureWebhookSetup && canManage && !isBitbucket && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">
            Configure Azure DevOps Web Hooks for each selected project.
          </p>
          <p>
            URL: <code className="break-all">{azureWebhookSetup.webhookUrl}</code>
          </p>
          <p>
            Username: <code>{azureWebhookSetup.username}</code>
          </p>
          <p>
            Password: <code className="break-all">{azureWebhookSetup.password}</code>
          </p>
          <p>Events: {azureWebhookSetup.events.join(", ")}</p>
          <p>Authentication: {azureWebhookSetup.authentication}</p>
          <p>Resource details: {azureWebhookSetup.resourceDetails}</p>
          <p className="text-xs">
            The password is encrypted at rest and displayed only once. Use an HTTPS endpoint and
            configure the service-hook resource details as All. Rotating the password invalidates
            the previous credentials. Only selected repositories enter analysis; this does not
            enable continuous monitoring.
          </p>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Loading connections…</p>}
      {canManage && connections.length > 0 && (
        <div className="space-y-3">
          {loadingRepos ? (
            <p className="text-sm text-slate-500">Loading repositories…</p>
          ) : repositories.length ? (
            <>
              <ul className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
                {repositories.map((repository) => (
                  <li key={repository.externalId}>
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(repository.externalId)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, repository.externalId]
                              : current.filter((id) => id !== repository.externalId),
                          )
                        }
                        className="mt-1"
                      />
                      <span>
                        <span className="block font-medium text-slate-800">
                          {repository.owner}/{repository.name}
                        </span>
                        {repository.defaultBranch && (
                          <span className="text-xs text-slate-500">
                            Default branch: {repository.defaultBranch}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={saving || selected.length === 0}
                onClick={() => void saveSelection()}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : `Add ${selected.length || ""} selected repositories`}
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              {groupId
                ? `No repositories are available in this ${isBitbucket ? "workspace" : "project"}.`
                : "Select a workspace or project to list repositories."}
            </p>
          )}
        </div>
      )}

      {!loading && connections.length === 0 && (
        <p className="text-sm text-slate-500">
          {canManage
            ? `No ${title} account is connected yet.`
            : `An organization administrator must connect ${title}.`}
        </p>
      )}
    </section>
  );
}
