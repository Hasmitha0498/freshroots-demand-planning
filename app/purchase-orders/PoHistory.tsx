"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, btn, Card } from "@/components/ui";
import { dateTime, int } from "@/lib/format";

export interface PoRow {
  id: string;
  reference_number: string;
  status: string;
  attempts: number;
  zoho_vendor_name: string;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  zoho_status: string | null;
  error_message: string | null;
  warnings: string[];
  created_by_email: string;
  created_at: string;
  updated_at: string;
  skus: { sku_id: string; qty: number | null }[];
  link: string | null;
}

const STYLE: Record<string, string> = {
  created: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  needs_reconciliation: "bg-amber-50 text-amber-800 ring-amber-300",
  submitting: "bg-sky-50 text-sky-700 ring-sky-200",
};
const LABEL: Record<string, string> = {
  created: "Created in Zoho",
  failed: "PO not created",
  needs_reconciliation: "Needs reconciliation",
  submitting: "Submitting",
};

export function PoHistory({ rows }: { rows: PoRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function reconcile(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/purchase-orders/${id}/reconcile`, { method: "POST" });
      const body = await res.json();
      setMsg({ ...msg, [id]: res.ok ? (body.result === "found" ? "Found in Zoho — record updated." : body.result === "not_found" ? "Not found in Zoho — safe to retry from the ready list." : `Status: ${body.result}`) : body.error });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Purchase order history</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">No PO submissions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Status</th>
                <th className="px-2 py-2">Zoho PO</th>
                <th className="px-2 py-2">Vendor</th>
                <th className="px-2 py-2">Lines</th>
                <th className="px-2 py-2">Reference</th>
                <th className="px-2 py-2">Created</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2">
                    <Badge className={STYLE[r.status]}>{LABEL[r.status] ?? r.status}</Badge>
                    {r.attempts > 1 && <span className="ml-1 text-xs text-slate-500">attempt {r.attempts}</span>}
                    {r.error_message && <p className="mt-1 max-w-xs text-xs text-red-700">{r.error_message}</p>}
                    {r.warnings?.map((w) => (
                      <p key={w} className="mt-1 max-w-xs text-xs text-amber-800">⚠ {w}</p>
                    ))}
                  </td>
                  <td className="px-2 py-2">
                    {r.zoho_purchaseorder_id ? (
                      <>
                        <p className="font-medium">{r.zoho_purchaseorder_number ?? "–"}</p>
                        <p className="font-mono text-xs text-slate-500">ID {r.zoho_purchaseorder_id}</p>
                        <p className="text-xs">Zoho status: {r.zoho_status ?? "–"}</p>
                        {r.link && (
                          <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 underline" title="Constructed from the Zoho region, organisation and PO ID">
                            Open in Zoho Inventory ↗
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                  <td className="px-2 py-2">{r.zoho_vendor_name}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.skus.map((s) => (
                      <div key={s.sku_id}>
                        {s.sku_id} · {int(s.qty)}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.reference_number}</td>
                  <td className="px-2 py-2 text-xs">
                    {dateTime(r.created_at)}
                    <br />
                    {r.created_by_email}
                  </td>
                  <td className="px-2 py-2">
                    {(r.status === "needs_reconciliation" || r.status === "submitting") && (
                      <button className={btn.secondary} disabled={busy === r.id} onClick={() => reconcile(r.id)}>
                        {busy === r.id ? "Checking Zoho…" : "Reconcile with Zoho"}
                      </button>
                    )}
                    {msg[r.id] && <p className="mt-1 max-w-[12rem] text-xs text-slate-600">{msg[r.id]}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
