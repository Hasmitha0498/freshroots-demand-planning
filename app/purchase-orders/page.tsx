import { connection } from "next/server";
import { OrderQueue, type QueueLine } from "./OrderQueue";
import { PoHistory, type PoRow } from "./PoHistory";
import { ProductSetup, type MappingView, type SkuOption } from "./ProductSetup";
import { SetupNotice } from "@/components/SetupNotice";
import { Chip, Notice, PageHeader } from "@/components/ui";
import { missingSupabaseEnv, supabaseConfigured } from "@/lib/env";
import { listMappings, listPurchaseOrders } from "@/lib/server/poStore";
import { getApprovedForPo, getRecommendationsByIds } from "@/lib/server/repo";
import { getZohoStatus } from "@/lib/server/zoho";
import { zohoPoWebLink } from "@/lib/zoho/config";
import { adminDb } from "@/lib/supabase/admin";

export default async function PurchaseOrdersPage() {
  await connection(); // always read the latest Supabase state, never a build-time snapshot
  if (!supabaseConfigured()) return <SetupNotice missing={missingSupabaseEnv()} />;

  let data;
  try {
    const [status, approved, mappings, pos, skus, dists] = await Promise.all([
      getZohoStatus(),
      getApprovedForPo(),
      listMappings(),
      listPurchaseOrders(),
      adminDb().from("sku_master").select("sku_id,sku_name,distributor_id").order("sku_id"),
      adminDb().from("distributor_master").select("distributor_id,distributor_name"),
    ]);
    if (skus.error) throw new Error(skus.error.message);
    if (dists.error) throw new Error(dists.error.message);
    const poRecs = await getRecommendationsByIds([...new Set(pos.flatMap((p) => p.recommendation_ids))]);
    data = { status, approved, mappings, pos, skus: skus.data ?? [], dists: dists.data ?? [], poRecs };
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  const { status, approved, mappings, pos, skus, dists, poRecs } = data;
  const live = status.live;
  const orgMappings = mappings.filter((m) => !status.organization_id || m.organization_id === status.organization_id);

  const lines: QueueLine[] = approved.map((r) => {
    const m = orgMappings.find((x) => x.sku_id === r.sku_id);
    return {
      recommendation_id: r.id,
      sku_id: r.sku_id,
      sku_name: r.calculation.sku_name,
      approved_qty: r.approved_qty ?? 0,
      po_status: r.po_status,
      location: r.calculation.location,
      zoho_item_name: m?.zoho_item_name ?? null,
      zoho_vendor_id: m?.zoho_vendor_id ?? null,
      zoho_vendor_name: m?.zoho_vendor_name ?? null,
      purchase_rate: m ? Number(m.purchase_rate) : null,
    };
  });
  const needed = new Set(approved.map((r) => r.sku_id));
  const skuOptions: SkuOption[] = skus.map((s) => ({
    ...s,
    distributor_name: dists.find((d) => d.distributor_id === s.distributor_id)?.distributor_name ?? null,
    needed: needed.has(s.sku_id),
  }));
  const rows: PoRow[] = pos.map((p) => ({
    id: p.id,
    reference_number: p.reference_number,
    status: p.status,
    attempts: p.attempts,
    zoho_vendor_name: p.zoho_vendor_name,
    zoho_purchaseorder_id: p.zoho_purchaseorder_id,
    zoho_purchaseorder_number: p.zoho_purchaseorder_number,
    error_message: p.error_message,
    warnings: p.warnings,
    created_at: p.created_at,
    products: p.recommendation_ids.map((id) => {
      const r = poRecs.find((x) => x.id === id);
      return { name: r?.calculation.sku_name ?? id.slice(0, 8), qty: r?.approved_qty ?? null };
    }),
    total: (p.request_payload?.line_items ?? []).reduce((a, l) => a + l.quantity * l.purchase_rate, 0),
    link: p.zoho_purchaseorder_id && status.api_domain ? zohoPoWebLink(status.api_domain, p.organization_id, p.zoho_purchaseorder_id) : null,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Purchase orders"
        meta={
          <>
            {live ? (
              <Chip tone="green">Connected to Zoho · {status.organization_name}</Chip>
            ) : (
              <Chip tone={status.configured ? "red" : "gray"}>{status.configured ? "Zoho connection problem" : "Zoho not connected"}</Chip>
            )}
            <span>Created as drafts in Zoho. Nothing is sent to vendors.</span>
          </>
        }
      />
      {!live && (
        <Notice tone={status.configured ? "error" : "info"} title={status.configured ? "Can't reach Zoho Inventory" : "Zoho Inventory isn't connected"}>
          {status.error ?? `Purchase orders can't be created until the server's Zoho settings are added (${status.missing.join(", ")}). See README → Zoho Inventory.`}
        </Notice>
      )}
      <OrderQueue lines={lines} live={live} orgName={status.organization_name} apiDomain={status.api_domain} skus={skuOptions} mappings={orgMappings as MappingView[]} />
      <PoHistory rows={rows} />
      <ProductSetup skus={skuOptions} mappings={orgMappings as MappingView[]} live={live} />
    </div>
  );
}
