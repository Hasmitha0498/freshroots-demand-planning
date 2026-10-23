"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { btn, Card, Chip, inputCls, Notice, Spinner } from "@/components/ui";
import { inr } from "@/lib/format";
import { productName } from "@/lib/presentation";
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
export interface Catalog {
  items: Item[];
  vendors: Vendor[];
  truncated: boolean;
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
}
export interface SkuOption {
  sku_id: string;
  sku_name: string;
  distributor_id: string;
  distributor_name: string | null;
  needed: boolean;
}

/** Loads the organisation's existing Zoho items and vendors on demand. */
export function useZohoCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/zoho/catalog");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Couldn't load Zoho items (HTTP ${res.status}).`);
      setCatalog(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load Zoho items.");
    } finally {
      setLoading(false);
    }
  }, []);
  return { catalog, loading, error, load };
}

/**
 * Links one product to an existing Zoho item and vendor, with a confirmed
 * price. Pre-selects the item whose SKU matches and the vendor whose name
 * matches the distributor; the planner confirms.
 */
export function MappingForm({ sku, mapping, catalog, onSaved }: { sku: SkuOption; mapping?: MappingView; catalog: Catalog; onSaved: () => void }) {
  const suggestion = mapping ? null : suggestMapping(sku, catalog);
  const [itemId, setItemId] = useState(mapping?.zoho_item_id ?? suggestion?.item?.item_id ?? "");
  const [vendorId, setVendorId] = useState(mapping?.zoho_vendor_id ?? suggestion?.vendor?.contact_id ?? "");
  const [rate, setRate] = useState(
    mapping ? String(mapping.purchase_rate) : suggestion?.item?.purchase_rate && suggestion.item.purchase_rate > 0 ? String(suggestion.item.purchase_rate) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = useMemo(() => catalog.items.find((i) => i.item_id === itemId), [catalog, itemId]);

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
      if (!res.ok) throw new Error(body.error ?? `Couldn't save (HTTP ${res.status}).`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {suggestion && (suggestion.item || suggestion.vendor) && (
        <Notice tone="info">We picked the matching Zoho item and vendor. Check them, then save.</Notice>
      )}
      <label className="block text-sm">
        <span className="text-slate-700">Zoho item</span>
        <select
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            const it = catalog.items.find((i) => i.item_id === e.target.value);
            if (it?.purchase_rate && it.purchase_rate > 0) setRate(String(it.purchase_rate));
          }}
          className={`${inputCls} mt-1`}
        >
          <option value="">Choose an item…</option>
          {catalog.items.map((i) => (
            <option key={i.item_id} value={i.item_id}>
              {i.name}
              {i.sku ? ` (${i.sku})` : ""}
              {i.item_type === "sales" ? " — can't be purchased yet" : ""}
            </option>
          ))}
        </select>
      </label>
      {item?.item_type === "sales" && (
        <Notice tone="error">
          This item is set up for selling only. In Zoho Inventory, open the item, click Edit, tick &ldquo;Purchase Information&rdquo;, add a cost price and save. Then reload this page.
        </Notice>
      )}
      <label className="block text-sm">
        <span className="text-slate-700">Vendor</span>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={`${inputCls} mt-1`}>
          <option value="">Choose a vendor…</option>
          {catalog.vendors.map((v) => (
            <option key={v.contact_id} value={v.contact_id}>
              {v.contact_name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-slate-700">Purchase price per unit (₹)</span>
        <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={`${inputCls} tabular mt-1 max-w-[10rem]`} />
        <span className="mt-1 block text-xs text-slate-500">
          {item?.purchase_rate && item.purchase_rate > 0
            ? `Zoho cost price: ${inr(item.purchase_rate)}. Change it only if you have an agreed price.`
            : "Zoho has no cost price for this item. Enter the agreed price."}
        </span>
      </label>
      {catalog.vendors.length === 0 && <Notice tone="warn">There are no vendors in Zoho yet. Add the vendor in Zoho Inventory first.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <button className={btn.primary} disabled={busy || !itemId || !vendorId || !(Number(rate) > 0) || item?.item_type === "sales"} onClick={save}>
        {busy && <Spinner />}
        {busy ? "Checking with Zoho…" : "Save"}
      </button>
    </div>
  );
}

/** Drawer that loads the catalog and edits one product's Zoho link. */
export function SetupDrawer({ sku, mapping, onClose }: { sku: SkuOption | null; mapping?: MappingView; onClose: () => void }) {
  return (
    <Drawer
      open={sku !== null}
      onClose={onClose}
      title={sku ? `Set up ${productName(sku.sku_name)}` : ""}
      subtitle={sku ? <span>Link {sku.sku_id} to an existing Zoho item and vendor</span> : undefined}
    >
      {sku && <SetupBody key={sku.sku_id} sku={sku} mapping={mapping} onClose={onClose} />}
    </Drawer>
  );
}

function SetupBody({ sku, mapping, onClose }: { sku: SkuOption; mapping?: MappingView; onClose: () => void }) {
  const router = useRouter();
  const { catalog, loading, error, load } = useZohoCatalog();
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      {(loading || (!catalog && !error)) && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Loading items and vendors from Zoho…
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {catalog && (
        <MappingForm
          sku={sku}
          mapping={mapping}
          catalog={catalog}
          onSaved={() => {
            onClose();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** All products and their Zoho links (collapsed by default). */
export function ProductSetup({ skus, mappings, live }: { skus: SkuOption[]; mappings: MappingView[]; live: boolean }) {
  const [editing, setEditing] = useState<SkuOption | null>(null);
  const linked = skus.filter((s) => mappings.some((m) => m.sku_id === s.sku_id)).length;
  return (
    <Card>
      <details>
        <summary className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-5 py-3.5 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
          <span className="font-medium text-slate-900">Product setup</span>
          <span className="text-slate-500">
            {linked} of {skus.length} products linked to Zoho
          </span>
        </summary>
        <ul className="divide-y divide-slate-100 border-t border-slate-200">
          {skus.map((s) => {
            const m = mappings.find((x) => x.sku_id === s.sku_id);
            return (
              <li key={s.sku_id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {productName(s.sku_name)} <span className="font-normal text-slate-400">{s.sku_id}</span>
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {m ? `${m.zoho_vendor_name} · ${inr(m.purchase_rate)} per unit` : "Not linked to Zoho yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {m ? <Chip tone="green">Linked</Chip> : <Chip tone="gray">Not linked</Chip>}
                  {live && (
                    <button onClick={() => setEditing(s)} className={btn.ghost}>
                      {m ? "Edit" : "Set up"}
                      <span className="sr-only"> {productName(s.sku_name)}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </details>
      <SetupDrawer sku={editing} mapping={mappings.find((m) => m.sku_id === editing?.sku_id)} onClose={() => setEditing(null)} />
    </Card>
  );
}
