"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SetupDrawer, type MappingView, type SkuOption } from "./ProductSetup";
import { Drawer } from "@/components/Drawer";
import { btn, Card, Chip, EmptyState, inputCls, Notice, Section, Spinner } from "@/components/ui";
import { inr, int } from "@/lib/format";
import { productName } from "@/lib/presentation";
import { zohoPoWebLink } from "@/lib/zoho/config";

export interface QueueLine {
  recommendation_id: string;
  sku_id: string;
  sku_name: string;
  approved_qty: number;
  po_status: string;
  location: string | null;
  zoho_item_name: string | null;
  zoho_vendor_id: string | null;
  zoho_vendor_name: string | null;
  purchase_rate: number | null;
}

interface Preview {
  vendor_name: string;
  organization_id: string;
  reference_number: string;
  payload: { date: string };
  lines: { recommendation_id: string; sku_id: string; sku_name: string; zoho_item_name: string; quantity: number; purchase_rate: number }[];
  total: number;
}
interface Created {
  outcome: "created" | "already_created";
  po: { zoho_purchaseorder_id: string; zoho_purchaseorder_number: string | null; zoho_status: string | null; organization_id: string; warnings: string[] };
}
type ApiError = { message: string; details?: string[] };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `Request failed (HTTP ${res.status}).` }));
  if (!res.ok) throw { message: json.error ?? `Request failed (HTTP ${res.status}).`, details: Array.isArray(json.details) ? json.details : undefined } satisfies ApiError;
  return json as T;
}

export function OrderQueue({
  lines,
  live,
  orgName,
  apiDomain,
  skus,
  mappings,
}: {
  lines: QueueLine[];
  live: boolean;
  orgName: string | null;
  apiDomain: string | null;
  skus: SkuOption[];
  mappings: MappingView[];
}) {
  const router = useRouter();
  const [reviewVendor, setReviewVendor] = useState<string | null>(null);
  const [setupSku, setSetupSku] = useState<SkuOption | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = lines.filter((l) => ["ready", "failed"].includes(l.po_status));
  const needsSetup = open.filter((l) => !l.zoho_vendor_id);
  const groups = new Map<string, QueueLine[]>();
  for (const l of open.filter((x) => x.zoho_vendor_id)) groups.set(l.zoho_vendor_id!, [...(groups.get(l.zoho_vendor_id!) ?? []), l]);
  const reviewLines = reviewVendor ? (groups.get(reviewVendor) ?? []) : [];

  async function withdraw(l: QueueLine) {
    if (!confirm(`Remove ${productName(l.sku_name)} (${int(l.approved_qty)} units) from the order list? It won't be ordered.`)) return;
    setWithdrawing(l.recommendation_id);
    setError(null);
    try {
      await postJson(`/api/recommendations/${l.recommendation_id}/decision`, { decision: "rejected", note: "Withdrawn from the order list" });
      router.refresh();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setWithdrawing(null);
    }
  }

  const removeBtn = (l: QueueLine) => (
    <button onClick={() => withdraw(l)} disabled={withdrawing !== null} className="rounded text-xs text-slate-500 hover:text-rose-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
      {withdrawing === l.recommendation_id ? "Removing…" : "Remove"}
      <span className="sr-only"> {productName(l.sku_name)}</span>
    </button>
  );

  return (
    <Section title="Ready to order" description="Approved reorders, grouped by vendor. Each vendor gets its own draft purchase order.">
      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {open.length === 0 && (
          <Card>
            <EmptyState
              title="Nothing to order right now"
              action={
                <Link href="/recommendations" className={btn.secondary}>
                  Review recommendations
                </Link>
              }
            >
              Approved reorders appear here, ready to become purchase orders.
            </EmptyState>
          </Card>
        )}

        {[...groups.entries()].map(([vendorId, group]) => {
          const total = group.reduce((a, l) => a + l.approved_qty * (l.purchase_rate ?? 0), 0);
          return (
            <Card key={vendorId}>
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-slate-900">{group[0].zoho_vendor_name}</h3>
                  <p className="text-sm text-slate-500">
                    {group.length} {group.length === 1 ? "product" : "products"} · {inr(total)}
                  </p>
                </div>
                <button onClick={() => setReviewVendor(vendorId)} disabled={!live} className={groups.size === 1 ? btn.primary : btn.secondary}>
                  Review purchase order
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {group.map((l) => (
                  <li key={l.recommendation_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_auto]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{productName(l.sku_name)}</p>
                      <p className="text-xs text-slate-500">{l.sku_id}</p>
                    </div>
                    <p className="tabular text-right text-sm text-slate-900">{int(l.approved_qty)} units</p>
                    <p className="tabular hidden text-right text-sm text-slate-600 sm:block">× {inr(l.purchase_rate)}</p>
                    <div className="sm:text-right">
                      {l.po_status === "failed" ? <Chip tone="red">PO failed</Chip> : <Chip tone="blue">Ready for PO</Chip>}
                    </div>
                    <div className="text-right">{removeBtn(l)}</div>
                  </li>
                ))}
              </ul>
              {group.some((l) => l.po_status === "failed") && (
                <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">The last attempt failed — see Purchase orders below for Zoho&apos;s message. You can try again.</p>
              )}
            </Card>
          );
        })}

        {needsSetup.length > 0 && (
          <Card>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Needs setup</h3>
              <p className="text-sm text-slate-500">Link these products to a Zoho item and vendor before ordering.</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {needsSetup.map((l) => (
                <li key={l.recommendation_id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {productName(l.sku_name)} <span className="font-normal text-slate-400">{l.sku_id}</span>
                    </p>
                    <p className="text-xs text-slate-500">{int(l.approved_qty)} units approved · not linked to Zoho yet</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {removeBtn(l)}
                    <button onClick={() => setSetupSku(skus.find((s) => s.sku_id === l.sku_id) ?? null)} disabled={!live} className={btn.secondary}>
                      Set up
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!live && open.length > 0 && (
          <details className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-3 text-sm">
            <summary className="cursor-pointer text-slate-600">What would be sent to Zoho (preview only)</summary>
            <ul className="mt-2 list-disc pl-5 text-slate-600">
              {open.map((l) => (
                <li key={l.recommendation_id}>
                  {productName(l.sku_name)}: {int(l.approved_qty)} units{l.purchase_rate ? ` at ${inr(l.purchase_rate)}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Nothing has been sent. Connect Zoho to create purchase orders.</p>
          </details>
        )}
      </div>

      <Drawer
        open={reviewVendor !== null}
        onClose={() => setReviewVendor(null)}
        title="New purchase order"
        subtitle={reviewLines[0] ? <span>{reviewLines[0].zoho_vendor_name}</span> : undefined}
      >
        {reviewVendor && (
          <ReviewBody
            key={reviewVendor}
            lines={reviewLines}
            orgName={orgName}
            apiDomain={apiDomain}
            onDone={() => {
              setReviewVendor(null);
              router.refresh();
            }}
          />
        )}
      </Drawer>
      <SetupDrawer sku={setupSku} mapping={mappings.find((m) => m.sku_id === setupSku?.sku_id)} onClose={() => setSetupSku(null)} />
    </Section>
  );
}

function ReviewBody({ lines, orgName, apiDomain, onDone }: { lines: QueueLine[]; orgName: string | null; apiDomain: string | null; onDone: () => void }) {
  const ids = lines.map((l) => l.recommendation_id);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [poNumber, setPoNumber] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "creating" | "created" | "error">("loading");
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    postJson<{ preview: Preview }>("/api/purchase-orders/preview", { recommendation_ids: ids })
      .then((r) => {
        setPreview(r.preview);
        setState("ready");
      })
      .catch((e: ApiError) => {
        setError(e);
        setState("error");
      });
    // Runs once per opened vendor (the component is keyed by vendor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    setState("creating");
    setError(null);
    try {
      const r = await postJson<Created>("/api/purchase-orders", { recommendation_ids: ids, purchaseorder_number: poNumber.trim() || null, confirm: true });
      setCreated(r);
      setState("created");
    } catch (e) {
      setError(e as ApiError);
      setState(preview ? "ready" : "error");
    }
  }

  if (state === "created" && created) {
    const link = apiDomain ? zohoPoWebLink(apiDomain, created.po.organization_id, created.po.zoho_purchaseorder_id) : null;
    return (
      <div className="space-y-5">
        <Notice tone="ok" title={created.outcome === "already_created" ? "This purchase order already exists in Zoho" : "Purchase order created in Zoho"}>
          <p>
            <strong className="font-semibold">{created.po.zoho_purchaseorder_number ?? "(no number returned)"}</strong> · status{" "}
            {created.po.zoho_status === "draft" ? "Draft" : (created.po.zoho_status ?? "unknown")} · nothing has been sent to the vendor.
          </p>
        </Notice>
        {created.po.warnings?.length > 0 && (
          <Notice tone="warn" title="Check this in Zoho">
            {created.po.warnings.join(" ")}
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className={btn.secondary}>
              Open in Zoho ↗
            </a>
          )}
          <button onClick={onDone} className={btn.primary}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Checking items and prices with Zoho…
        </p>
      )}

      {error && (
        <Notice tone="error" title={state === "error" ? "This purchase order can't be created yet" : "Zoho didn't create the purchase order"}>
          <p>{error.message}</p>
          {error.details && (
            <ul className="mt-1 list-disc pl-5">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          {state !== "error" && <p className="mt-1">Your approval is kept. Fix the problem and try again.</p>}
        </Notice>
      )}

      {preview && (
        <>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Vendor</dt>
              <dd className="font-medium text-slate-900">{preview.vendor_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Zoho organisation</dt>
              <dd className="font-medium text-slate-900">{orgName ?? preview.organization_id}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Deliver to</dt>
              <dd className="text-slate-900">{lines[0]?.location ?? "Default address"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Status in Zoho</dt>
              <dd className="text-slate-900">Draft — not sent to the vendor</dd>
            </div>
          </dl>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="py-2 font-medium">Product</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Price</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.lines.map((l) => (
                <tr key={l.recommendation_id}>
                  <td className="py-2 pr-2">
                    <span className="block text-slate-900">{productName(l.sku_name)}</span>
                    <span className="text-xs text-slate-500">{l.zoho_item_name}</span>
                  </td>
                  <td className="tabular py-2 text-right">{int(l.quantity)}</td>
                  <td className="tabular py-2 text-right">{inr(l.purchase_rate)}</td>
                  <td className="tabular py-2 text-right">{inr(l.quantity * l.purchase_rate)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="py-2" colSpan={3}>
                  Total <span className="font-normal text-slate-500">(before tax)</span>
                </td>
                <td className="tabular py-2 text-right">{inr(preview.total)}</td>
              </tr>
            </tfoot>
          </table>
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600">More options</summary>
            <label className="mt-2 block">
              <span className="text-slate-700">PO number</span>
              <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Leave blank for Zoho's next number" className={`${inputCls} mt-1 max-w-xs`} />
            </label>
            <p className="mt-2 text-xs text-slate-500">Reference {preview.reference_number} · dated {preview.payload.date}</p>
          </details>
          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            <button onClick={create} disabled={state === "creating"} className={btn.primary}>
              {state === "creating" && <Spinner />}
              {state === "creating" ? "Creating in Zoho…" : "Create purchase order"}
            </button>
            <button onClick={onDone} disabled={state === "creating"} className={btn.secondary}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
