"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, btn, Card, Notice } from "@/components/ui";
import { int, inr, PO_STATUS_LABEL } from "@/lib/format";

export interface ReadyLine {
  recommendation_id: string;
  sku_id: string;
  sku_name: string;
  approved_qty: number;
  approved_by: string | null;
  location: string | null;
  po_status: string;
  zoho_item_name: string | null;
  zoho_vendor_id: string | null;
  zoho_vendor_name: string | null;
  purchase_rate: number | null;
}

interface Preview {
  vendor_id: string;
  vendor_name: string;
  organization_id: string;
  reference_number: string;
  payload: { date: string; notes: string; purchaseorder_number?: string; line_items: { item_id: string; quantity: number; purchase_rate: number }[] };
  lines: { recommendation_id: string; sku_id: string; sku_name: string; zoho_item_name: string; quantity: number; purchase_rate: number }[];
  total: number;
}

interface CreateResult {
  outcome: "created" | "already_created";
  po: { zoho_purchaseorder_id: string; zoho_purchaseorder_number: string | null; zoho_status: string | null; reference_number: string; warnings: string[] };
}

export function ReadyOrders({ lines, live, orgName }: { lines: ReadyLine[]; live: boolean; orgName: string | null }) {
  const eligible = lines.filter((l) => ["ready", "failed"].includes(l.po_status));
  const pending = lines.filter((l) => !["ready", "failed"].includes(l.po_status));
  const mapped = eligible.filter((l) => l.zoho_vendor_id);
  const unmapped = eligible.filter((l) => !l.zoho_vendor_id);
  const groups = new Map<string, ReadyLine[]>();
  for (const l of mapped) groups.set(l.zoho_vendor_id!, [...(groups.get(l.zoho_vendor_id!) ?? []), l]);

  return (
    <Card className="p-4">
      <h2 className="font-semibold">Approved reorders ready for Zoho</h2>
      <p className="mt-1 text-sm text-slate-600">One draft PO per Zoho vendor. Vendors are never mixed on one PO. Only approved quantities above zero appear here.</p>
      {eligible.length === 0 && pending.length === 0 && <p className="mt-3 text-sm text-slate-500">No approved reorders waiting. Approve proposals on the Recommendations page.</p>}
      {unmapped.length > 0 && (
        <div className="mt-3">
          <Notice tone="warn" title="Mapping incomplete">
            {unmapped.map((l) => `${l.sku_id} (${int(l.approved_qty)} units)`).join(", ")} — map to a Zoho item and vendor below before creating a PO.
          </Notice>
        </div>
      )}
      {pending.length > 0 && (
        <div className="mt-3">
          <Notice tone="info">In progress: {pending.map((l) => `${l.sku_id} — ${PO_STATUS_LABEL[l.po_status]}`).join(", ")}. See PO history.</Notice>
        </div>
      )}
      <div className="mt-3 space-y-3">
        {[...groups.entries()].map(([vendorId, group]) => (
          <VendorGroup key={vendorId} lines={group} live={live} orgName={orgName} />
        ))}
      </div>
      {!live && eligible.length > 0 && <DemoPreview lines={eligible} />}
    </Card>
  );
}

function VendorGroup({ lines, live, orgName }: { lines: ReadyLine[]; live: boolean; orgName: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(lines.map((l) => l.recommendation_id));
  const [poNumber, setPoNumber] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const body = () => JSON.stringify({ recommendation_ids: selected, purchaseorder_number: poNumber || null, confirm: true });

  async function post(url: string) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body() });
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw { message: json.error ?? `HTTP ${res.status}`, details: Array.isArray(json.details) ? json.details : undefined };
    return json;
  }

  async function review() {
    setBusy("preview");
    setError(null);
    try {
      setPreview((await post("/api/purchase-orders/preview")).preview);
    } catch (e) {
      setError(e as { message: string });
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("create");
    setError(null);
    try {
      setResult(await post("/api/purchase-orders"));
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError(e as { message: string });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const vendor = lines[0].zoho_vendor_name;
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-sm font-medium">
          Zoho vendor: {vendor} <span className="text-xs text-slate-500">({lines[0].zoho_vendor_id})</span>
        </p>
        <Badge className="bg-white text-slate-600 ring-slate-300">{lines.length} line(s)</Badge>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="w-8 px-3 py-1.5"></th>
            <th className="px-2 py-1.5">SKU</th>
            <th className="px-2 py-1.5">Zoho item</th>
            <th className="px-2 py-1.5 text-right">Qty</th>
            <th className="px-2 py-1.5 text-right">Rate</th>
            <th className="px-2 py-1.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.recommendation_id} className="border-t border-slate-100">
              <td className="px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={selected.includes(l.recommendation_id)}
                  onChange={(e) => {
                    setPreview(null);
                    setSelected(e.target.checked ? [...selected, l.recommendation_id] : selected.filter((x) => x !== l.recommendation_id));
                  }}
                  aria-label={`Include ${l.sku_id}`}
                />
              </td>
              <td className="px-2 py-1.5">
                <span className="font-mono text-xs">{l.sku_id}</span> {l.sku_name}
              </td>
              <td className="px-2 py-1.5">{l.zoho_item_name}</td>
              <td className="tabular px-2 py-1.5 text-right">{int(l.approved_qty)}</td>
              <td className="tabular px-2 py-1.5 text-right">{inr(l.purchase_rate)}</td>
              <td className="px-2 py-1.5 text-xs">{l.po_status === "failed" ? <span className="text-red-700">PO not created — retry allowed</span> : "Approved"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-3 border-t border-slate-100 p-3">
        {live && !preview && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">
              PO number (optional — leave blank to use Zoho auto-numbering)
              <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="mt-1 block w-64 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button className={btn.primary} disabled={selected.length === 0 || busy !== null} onClick={review}>
              {busy === "preview" ? "Checking…" : "Review draft PO"}
            </button>
          </div>
        )}
        {preview && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
            <p className="font-semibold text-emerald-900">Review before sending to Zoho</p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <div>Vendor: <strong>{preview.vendor_name}</strong></div>
              <div>Organisation: <strong>{orgName ?? preview.organization_id}</strong></div>
              <div>Destination: {lines[0].location ?? "–"} <span className="text-xs text-slate-600">(Zoho applies the organisation&apos;s default delivery address)</span></div>
              <div>Date: {preview.payload.date} · Reference: <span className="font-mono">{preview.reference_number}</span></div>
              <div>PO number: {preview.payload.purchaseorder_number ?? "Zoho auto-number"}</div>
              <div>Status in Zoho: <strong>Draft</strong> (never issued or sent by this app)</div>
            </dl>
            <table className="mt-2 w-full">
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.recommendation_id} className="border-t border-emerald-200">
                    <td className="py-1">{l.sku_id} → {l.zoho_item_name}</td>
                    <td className="tabular py-1 text-right">{int(l.quantity)} × {inr(l.purchase_rate)}</td>
                    <td className="tabular py-1 text-right">{inr(l.quantity * l.purchase_rate)}</td>
                  </tr>
                ))}
                <tr className="border-t border-emerald-300 font-semibold">
                  <td className="py-1">Total (before any Zoho taxes)</td>
                  <td></td>
                  <td className="tabular py-1 text-right">{inr(preview.total)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={btn.primary} disabled={busy !== null} onClick={create}>
                {busy === "create" ? "Creating in Zoho…" : "Create Draft PO in Zoho"}
              </button>
              <button className={btn.secondary} disabled={busy !== null} onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <Notice tone="error" title="PO not created">
            <p>{error.message}</p>
            {error.details && (
              <ul className="mt-1 list-disc pl-5">
                {error.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {result && (
          <Notice tone="ok" title={result.outcome === "already_created" ? "This PO already exists in Zoho" : "Draft PO created in Zoho Inventory"}>
            Zoho PO <strong>{result.po.zoho_purchaseorder_number ?? "(no number returned)"}</strong> · ID <span className="font-mono">{result.po.zoho_purchaseorder_id}</span> · status{" "}
            <strong>{result.po.zoho_status ?? "unknown"}</strong> · ref {result.po.reference_number}
            {result.po.warnings?.length > 0 && <span className="block text-amber-800">⚠ {result.po.warnings.join(" ")}</span>}
          </Notice>
        )}
      </div>
    </div>
  );
}

function DemoPreview({ lines }: { lines: ReadyLine[] }) {
  const example = {
    vendor_id: "<existing Zoho vendor_id — select after connecting>",
    reference_number: "FR-<generated>",
    date: "<today, IST>",
    line_items: lines.map((l) => ({ item_id: `<Zoho item_id for ${l.sku_id}>`, quantity: l.approved_qty, purchase_rate: "<rate from Zoho item or planner>" })),
  };
  return (
    <div className="mt-4 rounded-lg border border-dashed border-slate-400 bg-slate-50 p-3">
      <p className="text-sm font-semibold text-slate-800">DEMO / DISCONNECTED — example payload only. Nothing has been sent to Zoho and no PO exists.</p>
      <pre className="mt-2 overflow-x-auto text-xs text-slate-700">{JSON.stringify(example, null, 2)}</pre>
    </div>
  );
}
