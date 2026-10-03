import { Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiUrl } from "@/lib/utils";

interface HealthResponse {
  data: {
    status: string;
    service?: string;
    name?: string;
  } | null;
  error: { code: string; message: string } | null;
}

async function getApiHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${getApiUrl()}/health`, {
      next: { revalidate: 0 },
    });
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await getApiHealth();
  const apiConnected = health?.data?.status === "ok";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              AI-SDLC Control Plane
            </h1>
            <p className="text-slate-600">
              Security and governance for AI-assisted software development
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Platform Status</CardTitle>
              <CardDescription>Phase 0 — Foundation</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <StatusRow label="Web Application" status="ok" />
                <StatusRow
                  label="API Server"
                  status={apiConnected ? "ok" : "pending"}
                  detail={apiConnected ? "Connected" : "Not reachable"}
                />
                <StatusRow label="Worker" status="pending" detail="Start via docker compose" />
                <StatusRow
                  label="Database"
                  status="pending"
                  detail="PostgreSQL via docker compose"
                />
                <StatusRow
                  label="Queue"
                  status="pending"
                  detail="Redis + BullMQ via docker compose"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Core Workflow</CardTitle>
              <CardDescription>The golden path this platform enables</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="list-inside list-decimal space-y-2 text-sm text-slate-600">
                <li>AI-assisted development</li>
                <li>Provenance &amp; confidence</li>
                <li>Sensitive-area classification</li>
                <li>Explainable risk assessment</li>
                <li>Policy evaluation</li>
                <li>Security evidence aggregation</li>
                <li>Human approval where required</li>
                <li>AI Change Passport</li>
              </ol>
            </CardContent>
          </Card>
        </div>

        <p className="mt-8 text-center text-sm text-slate-500">
          Dashboard navigation (Overview, Changes, Agents, Repositories, Policies, Evidence) — Phase
          13
        </p>
      </div>
    </main>
  );
}

function StatusRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: "ok" | "pending" | "fail";
  detail?: string;
}) {
  const colors = {
    ok: "bg-emerald-500",
    pending: "bg-amber-400",
    fail: "bg-red-500",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        {detail && <span className="text-slate-500">{detail}</span>}
        <span className={`h-2.5 w-2.5 rounded-full ${colors[status]}`} />
      </div>
    </div>
  );
}
