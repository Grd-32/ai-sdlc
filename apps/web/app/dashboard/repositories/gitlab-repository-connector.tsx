"use client";

import { useCallback, useEffect, useState } from "react";

interface GitLabConnection {
  id: string;
  provider: string;
  accountName: string;
  scopes: string[];
  capabilities: unknown;
  _count: { repositories: number };
}

interface GitLabProject {
  externalId: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  webUrl: string;
}

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

interface ProjectCollection {
  items: GitLabProject[];
  complete: boolean;
  capability: { status: string; detail: string };
}

interface GitLabWebhookSetup {
  webhookUrl: string;
  secret: string;
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

export function GitLabRepositoryConnector({
  organizationId,
  canManage,
  connected,
  errorCode,
}: {
  organizationId: string;
  canManage: boolean;
  connected: boolean;
  errorCode?: string;
}) {
  const [connections, setConnections] = useState<GitLabConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [capability, setCapability] = useState<ProjectCollection["capability"] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [webhookSetup, setWebhookSetup] = useState<GitLabWebhookSetup | null>(null);

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/connections`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as ApiResponse<GitLabConnection[]>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not load source-control connections.");
      }
      const gitLabConnections = body.data.filter((entry) => entry.provider === "GITLAB");
      setConnections(gitLabConnections);
      setConnectionId((previous) =>
        gitLabConnections.some((entry) => entry.id === previous)
          ? previous
          : (gitLabConnections[0]?.id ?? ""),
      );
    } catch (loadError) {
      setError(errorMessage(loadError, "Could not load source-control connections."));
    } finally {
      setLoadingConnections(false);
    }
  }, [organizationId]);

  const loadProjects = useCallback(
    async (selectedConnectionId: string) => {
      setLoadingProjects(true);
      setError("");
      try {
        const response = await fetch(
          `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/gitlab/projects?connectionId=${encodeURIComponent(selectedConnectionId)}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as ApiResponse<ProjectCollection>;
        if (!response.ok || !body.data) {
          throw new Error(body.error?.message ?? "Could not list GitLab projects.");
        }
        setProjects(body.data.items);
        setCapability(body.data.capability);
      } catch (loadError) {
        setProjects([]);
        setCapability(null);
        setError(errorMessage(loadError, "Could not list GitLab projects."));
      } finally {
        setLoadingProjects(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (canManage && connectionId) void loadProjects(connectionId);
    else {
      setProjects([]);
      setCapability(null);
    }
  }, [canManage, connectionId, loadProjects]);

  async function saveSelection() {
    if (!connectionId || selected.length === 0) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/gitlab/repositories`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId, projectIds: selected }),
        },
      );
      const body = (await response.json()) as ApiResponse<unknown>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not save the selected projects.");
      }
      setMessage(
        `${selected.length} GitLab project${selected.length === 1 ? "" : "s"} added to the organisation.`,
      );
      setSelected([]);
      await loadConnections();
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save the selected projects."));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect(selectedConnectionId: string) {
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/connections/${encodeURIComponent(selectedConnectionId)}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as ApiResponse<{ disconnected: boolean }>;
      if (!response.ok && !body.data?.disconnected) {
        throw new Error(body.error?.message ?? "Could not disconnect GitLab.");
      }
      setMessage(
        body.error?.message ??
          "GitLab connection disconnected. Its repositories have been removed from active monitoring.",
      );
      await loadConnections();
    } catch (disconnectError) {
      setError(errorMessage(disconnectError, "Could not disconnect GitLab."));
    }
  }

  async function rotateWebhookSecret() {
    if (!connectionId) return;
    setError("");
    setMessage("");
    setWebhookSetup(null);
    try {
      const response = await fetch(
        `/api/backend/api/organizations/${encodeURIComponent(organizationId)}/source-control/gitlab/webhook-secret`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId }),
        },
      );
      const body = (await response.json()) as ApiResponse<GitLabWebhookSetup>;
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not configure GitLab webhook delivery.");
      }
      setWebhookSetup(body.data);
      setMessage("Webhook secret created. Copy it now; it cannot be viewed again.");
    } catch (setupError) {
      setError(errorMessage(setupError, "Could not configure GitLab webhook delivery."));
    }
  }

  const connectHref = `/api/source-control/gitlab/connect?organizationId=${encodeURIComponent(organizationId)}`;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">GitLab.com</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Authorizes read-only project and repository access. Selected GitLab merge requests can
            use the shared on-demand assessment and webhook-triggered analysis pipeline. Configure
            GitLab merge-request webhooks below. Current-head pipeline vulnerability findings,
            configured Secret Detection reports, and exact protected-branch settings are collected
            where GitLab permissions and pipeline configuration allow; missing or denied data is
            reported as unavailable. Assessments and analysis fail rather than score incomplete or
            truncated merge-request diffs.
          </p>
        </div>
        {canManage && (
          <a
            href={connectHref}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Connect GitLab.com
          </a>
        )}
      </div>

      {connected && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          GitLab account connected. Select the repositories you want associated with this
          organisation.
        </p>
      )}
      {errorCode && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          GitLab connection could not be completed ({errorCode.replaceAll("_", " ")}). Check the
          OAuth and encryption configuration, then retry.
        </p>
      )}
      {message && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {!canManage ? (
        <p className="text-sm text-slate-500">
          Organisation admin access is required to manage connections.
        </p>
      ) : loadingConnections ? (
        <p className="text-sm text-slate-500">Loading GitLab connections...</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-slate-500">
          No GitLab account is connected to this organisation.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="gitlab-connection" className="text-sm font-medium text-slate-700">
              Connected account
            </label>
            <select
              id="gitlab-connection"
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
              className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  @{connection.accountName} ({connection._count.repositories} linked)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void disconnect(connectionId)}
              className="text-sm font-medium text-red-700 underline underline-offset-2"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={() => void rotateWebhookSecret()}
              className="text-sm font-medium text-orange-700 underline underline-offset-2"
            >
              Create webhook secret
            </button>
          </div>

          {webhookSetup && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">
                Configure a GitLab project webhook for each selected project.
              </p>
              <p>
                URL: <code className="break-all">{webhookSetup.webhookUrl}</code>
              </p>
              <p>
                Secret token: <code className="break-all">{webhookSetup.secret}</code>
              </p>
              <p className="text-xs">
                Enable only Merge request events. Rotating this secret invalidates the previous
                token. GitLab does not receive write permissions from this application.
              </p>
            </div>
          )}

          {capability && (
            <p className="text-xs text-slate-500">
              Project discovery: {capability.status}. {capability.detail}
            </p>
          )}
          {loadingProjects ? (
            <p className="text-sm text-slate-500">Loading accessible GitLab projects...</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-slate-500">No accessible GitLab projects were returned.</p>
          ) : (
            <>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                {projects.map((project) => (
                  <label
                    key={project.externalId}
                    className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(project.externalId)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, project.externalId]
                            : current.filter((id) => id !== project.externalId),
                        )
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-orange-600"
                    />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium text-slate-900">
                        {project.owner}/{project.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {project.webUrl}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void saveSelection()}
                disabled={saving || selected.length === 0}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "Saving…"
                  : `Add ${selected.length || ""} selected project${selected.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
