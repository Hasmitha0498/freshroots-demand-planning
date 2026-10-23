"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, btn, Card, Notice } from "@/components/ui";
import { inr } from "@/lib/format";
import { suggestMapping } from "@/lib/zoho/suggest";

interface Item {
  item_id: string;
  name: string;
  sku: string | null;
  status: string | null;
  purchase_rate: number | null;
  item_type: string | null;
}
interface Vendor {
  contact_id: string;
  contact_name: string;
  company_name: string | null;
}
export interface MappingView {
  sku_id: string;
  organization_id: string;
  zoho_item_id: string;
  zoho_item_name: string;
  zoho_vendor_id: string;
  zoho_vendor_name: string;
  purchase_rate: number;
  rate_source: string;
  confirmed_by_email: string;
}
export interface SkuOption {
  sku_id: string;
  sku_name: string;
  distributor_id: string;
  distributor_name: string | null;
  needed: boolean;
}

export function MappingEditor({ skus, mappings, organizationId }: { skus: SkuOption[]; mappings: MappingView[]; organizationId: string | null }) {
  const [catalog, setCatalog] = useState<{ items: Item[]; vendors: Vendor[]; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = skus.filter((s) => showAll || s.needed || mappings.some((m) => m.sku_id === s.sku_id));

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/zoho/catalog");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCatalog(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Zoho catalog");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold">SKU → Zoho item &amp; vendor mapping</h2>
          <p className="mt-1 text-sm text-slate-600">
            Map each SKU to an <strong>existing</strong> Zoho item and an existing Zoho <strong>vendor</strong>. The CSV Distributor_ID is shown for reference only and is not a Zoho vendor. No Zoho records are created here.
          </p>
        </div>
        <div className="flex gap-2">
          <button className={btn.secondary} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Only needed" : "All SKUs"}
          </button>
          {organizationId && (
            <button className={btn.primary} onClick={load} disabled={busy}>
              {busy ? "Loading…" : catalog ? "Reload Zoho items & vendors" : "Load Zoho items & vendors"}
            </button>
          )}
        </div>
      </div>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      {catalog?.truncated && <div className="mt-3"><Notice tone="warn">Large Zoho catalog: only the first 2,000 records were loaded.</Notice></div>}
      {catalog && catalog.vendors.length === 0 && <div className="mt-3"><Notice tone="warn">No active vendor contacts found in this Zoho organisation. Create the vendor in Zoho first.</Notice></div>}
      {!organizationId && <p className="mt-3 text-sm text-slate-500">Mappings can be edited once the server Zoho connection is live.</p>}
      <div className="mt-3 space-y-2">
        {rows.map((s) => (
          <MappingRow key={`${s.sku_id}-${catalog ? "loaded" : "empty"}`} sku={s} mapping={mappings.find((m) => m.sku_id === s.sku_id)} catalog={catalog} canEdit={Boolean(organizationId)} organizationId={organizationId} />
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-500">No approved orders need mapping yet.</p>}
      </div>
    </Card>
  );
}

function MappingRow({ sku, mapping, catalog, canEdit, organizationId }: { sku: SkuOption; mapping?: MappingView; catalog: { items: Item[]; vendors: Vendor[] } | null; canEdit: boolean; organizationId: string | null }) {
  const router = useRouter();
  // Rows remount when the catalog loads, so unmapped SKUs start from the suggestion.
  const suggestion = !mapping && catalog ? suggestMapping(sku, catalog) : null;
  const [itemId, setItemId] = useState(mapping?.zoho_item_id ?? suggestion?.item?.item_id ?? "");
  const [vendorId, setVendorId] = useState(mapping?.zoho_vendor_id ?? suggestion?.vendor?.contact_id ?? "");
  const [rate, setRate] = useState(
    mapping ? String(mapping.purchase_rate) : suggestion?.item?.purchase_rate && suggestion.item.purchase_rate > 0 ? String(suggestion.item.purchase_rate) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = useMemo(() => catalog?.items.find((i) => i.item_id === itemId), [catalog, itemId]);
  const wrongOrg = mapping && organizationId && mapping.organization_id !== organizationId;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/zoho/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku_id: sku.sku_id, zoho_item_id: itemId, zoho_vendor_id: vendorId, purchase_rate: Number(rate) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs text-slate-500">{sku.sku_id}</span>
        <span className="font-medium">{sku.sku_name}</span>
        <span className="text-xs text-slate-400">CSV distributor {sku.distributor_id}</span>
        {sku.needed && <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">approved order</Badge>}
        {mapping ? (
          <Badge className={wrongOrg ? "bg-red-50 text-red-700 ring-red-200" : "bg-slate-100 text-slate-700 ring-slate-300"}>
            {wrongOrg ? "mapped in another organisation" : `→ ${mapping.zoho_item_name} · ${mapping.zoho_vendor_name} · ${inr(mapping.purchase_rate)} (${mapping.rate_source === "zoho_item" ? "Zoho item rate" : "planner-entered rate"})`}
          </Badge>
        ) : (
          <Badge className="bg-amber-50 text-amber-800 ring-amber-300">not mapped</Badge>
        )}
      </div>
      {canEdit && catalog && (
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_9rem_auto] md:items-end">
          <label className="text-xs text-slate-600">
            Zoho item
            <select
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                const it = catalog.items.find((i) => i.item_id === e.target.value);
                if (it?.purchase_rate && it.purchase_rate > 0) setRate(String(it.purchase_rate));
              }}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select existing item…</option>
              {catalog.items.map((i) => (
                <option key={i.item_id} value={i.item_id}>
                  {i.name}
                  {i.sku ? ` [${i.sku}]` : ""}
                  {i.status && i.status !== "active" ? ` (${i.status})` : ""}
                  {i.item_type === "sales" ? " — sales only (enable Purchase Information in Zoho)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Zoho vendor
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Select existing vendor…</option>
              {catalog.vendors.map((v) => (
                <option key={v.contact_id} value={v.contact_id}>
                  {v.contact_name}
                  {v.company_name && v.company_name !== v.contact_name ? ` (${v.company_name})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Purchase rate (₹/unit)
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="tabular mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <button className={btn.primary} disabled={busy || !itemId || !vendorId || !(Number(rate) > 0)} onClick={save}>
            {busy ? "Verifying…" : "Confirm mapping"}
          </button>
          {suggestion && (suggestion.item || suggestion.vendor) && (
            <p className="text-xs font-medium text-emerald-700 md:col-span-4">
              Suggested{suggestion.item ? ` item by SKU ${sku.sku_id}` : ""}{suggestion.item && suggestion.vendor ? " and" : ""}
              {suggestion.vendor ? ` vendor by name “${sku.distributor_name}”` : ""} — check, then Confirm mapping.
            </p>
          )}
          <p className="text-xs text-slate-500 md:col-span-4">
            {item ? (item.purchase_rate && item.purchase_rate > 0 ? `Zoho item purchase rate: ${inr(item.purchase_rate)}. Change it only if you have a confirmed price.` : "This Zoho item has no purchase rate — enter and confirm the agreed price.") : "Rate comes from the Zoho item where set, or must be entered by you."}
          </p>
          {item?.item_type === "sales" && (
            <p className="text-sm text-red-700 md:col-span-4">
              This Zoho item has only Sales information, so it cannot go on a purchase order. In Zoho: open the item → Edit → tick Purchase Information → Save, then reload items here.
            </p>
          )}
          {error && <p className="text-sm text-red-700 md:col-span-4">{error}</p>}
        </div>
      )}
    </div>
  );
}
