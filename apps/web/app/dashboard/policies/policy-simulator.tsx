"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { PolicyMode } from "@/lib/api";

interface SimulationDecision {
  repository?: string;
  pullRequestId?: string;
  pullRequestNumber?: number;
  pullRequestTitle?: string;
  action: "ALLOW" | "REVIEW" | "BLOCK";
  previousAction?: "ALLOW" | "REVIEW" | "BLOCK";
  changed: boolean;
  riskScore: number;
  reason: string;
}

interface SimulationResult {
  mode: PolicyMode;
  totalEvaluated: number;
  allow: number;
  review: number;
  block: number;
  affectedRepositories: string[];
  affectedPullRequests: string[];
  decisions: SimulationDecision[];
  historyWindow: number;
  skippedStaleAnalysis: number;
  skippedMissingRisk: number;
}

interface SimulationResponse {
  data: SimulationResult | null;
  error: { code: string; message: string } | null;
}

export function PolicySimulator({ organizationId }: { organizationId: string }) {
  const [mode, setMode] = useState<"DRY_RUN" | "ENFORCING">("DRY_RUN");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runSimulation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/policies/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, mode, limit: 100 }),
      });
      const payload = (await response.json()) as SimulationResponse;
      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? "Policy simulation failed.");
        return;
      }
      setResult(payload.data);
    } catch {
      setError("Unable to reach the policy simulation service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">Policy history simulation</h2>
        <p className="mt-1 text-sm text-slate-600">
          Re-evaluate up to 100 recently analyzed changes using the current enabled policy rules.
          This does not write decisions or affect pull requests.
        </p>
      </div>

      <form onSubmit={runSimulation} className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">
          Simulated mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "DRY_RUN" | "ENFORCING")}
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="DRY_RUN">Dry run</option>
            <option value="ENFORCING">Enforcing</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Simulating…" : "Run simulation"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{result.totalEvaluated} evaluated</Badge>
            <Badge variant="success">{result.allow} allow</Badge>
            <Badge variant="warning">{result.review} review</Badge>
            <Badge variant="destructive">{result.block} block</Badge>
            <Badge variant="outline">
              {result.decisions.filter((decision) => decision.changed).length} changed vs. recorded
            </Badge>
          </div>

          {(result.skippedStaleAnalysis > 0 || result.skippedMissingRisk > 0) && (
            <p className="text-xs text-slate-500">
              Excluded from the {result.historyWindow}-change window: {result.skippedStaleAnalysis}{" "}
              with stale analysis and {result.skippedMissingRisk} without a saved risk assessment.
            </p>
          )}

          {result.decisions.length > 0 ? (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
              {result.decisions.map((decision) => (
                <li
                  key={decision.pullRequestId}
                  className="flex items-start justify-between gap-4 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {decision.repository} #{decision.pullRequestNumber}:{" "}
                      {decision.pullRequestTitle}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Risk {decision.riskScore} · {decision.reason}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge
                      variant={
                        decision.action === "BLOCK"
                          ? "destructive"
                          : decision.action === "REVIEW"
                            ? "warning"
                            : "success"
                      }
                    >
                      {decision.action}
                    </Badge>
                    {decision.changed && decision.previousAction && (
                      <span className="text-xs text-slate-500">
                        previously {decision.previousAction}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              No eligible analyzed changes were found in this organization.
            </p>
          )}
          <p className="text-xs text-slate-500">
            This is a deterministic replay, not a false-positive estimate. Review simulation results
            before changing enforcement mode.
          </p>
        </div>
      )}
    </section>
  );
}
