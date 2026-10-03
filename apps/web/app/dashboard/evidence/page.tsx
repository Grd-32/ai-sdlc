import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { evidenceBadgeVariant } from "@/lib/badges";
import { getOrganizations, getSelectedOrganization, getEvidence } from "@/lib/api";

export default async function EvidencePage() {
  const organizations = await getOrganizations();
  const selectedOrg = await getSelectedOrganization(organizations);

  if (!selectedOrg) {
    return null;
  }

  const evidence = await getEvidence(selectedOrg.id);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Evidence</h1>
        <p className="text-sm text-slate-500">{selectedOrg.name}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {evidence.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No security evidence recorded yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 font-medium">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-900">{e.type}</td>
                    <td className="px-4 py-3 text-slate-600">{e.source}</td>
                    <td className="px-4 py-3">
                      <Badge variant={evidenceBadgeVariant(e.status)}>{e.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}