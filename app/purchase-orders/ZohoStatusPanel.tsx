import { Badge, Card, Notice } from "@/components/ui";
import type { ZohoStatus } from "@/lib/server/zoho";

// Read-only: the server holds the Zoho credentials, so visitors never sign in to Zoho.
export function ZohoStatusPanel({ status }: { status: ZohoStatus }) {
  const [label, tone] = status.live
    ? ["Live Zoho Inventory", "bg-emerald-50 text-emerald-700 ring-emerald-200"]
    : status.configured
      ? ["Zoho error — preview only", "bg-red-50 text-red-700 ring-red-200"]
      : ["Demo / Disconnected — server credentials missing", "bg-slate-100 text-slate-700 ring-slate-300"];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Zoho Inventory</h2>
        <Badge className={tone}>{label}</Badge>
      </div>
      {status.live && (
        <p className="mt-1 text-sm text-slate-600">
          Organisation <strong>{status.organization_name}</strong> ({status.organization_id}) via {status.api_domain}. Connected server-side — anyone using this
          app can create <strong>draft</strong> POs here; nothing is issued or emailed to vendors.
        </p>
      )}
      {!status.configured && (
        <p className="mt-1 text-sm text-slate-600">
          Set <code className="font-mono">{status.missing.join(", ")}</code> on the server (see README → Zoho Inventory). Until then this page shows a labelled preview only.
        </p>
      )}
      {status.error && (
        <div className="mt-3">
          <Notice tone="error">{status.error}</Notice>
        </div>
      )}
    </Card>
  );
}
