import { connection } from "next/server";
import { MappingEditor, type MappingView, type SkuOption } from "./MappingEditor";
import { PoHistory, type PoRow } from "./PoHistory";
import { ReadyOrders, type ReadyLine } from "./ReadyOrders";
import { ZohoStatusPanel } from "./ZohoStatusPanel";
import { SetupNotice } from "@/components/SetupNotice";
import { PageTitle } from "@/components/ui";
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

  const lines: ReadyLine[] = approved.map((r) => {
    const m = mappings.find((x) => x.sku_id === r.sku_id && x.organization_id === status.organization_id);
    return {
      recommendation_id: r.id,
      sku_id: r.sku_id,
      sku_name: r.calculation.sku_name,
      approved_qty: r.approved_qty ?? 0,
      approved_by: r.decided_by_email,
      approved_at: r.decided_at,
      run_id: r.run_id,
      location: r.calculation.location,
      po_status: r.po_status,
      zoho_item_name: m?.zoho_item_name ?? null,
      zoho_vendor_id: m?.zoho_vendor_id ?? null,
      zoho_vendor_name: m?.zoho_vendor_name ?? null,
      purchase_rate: m ? Number(m.purchase_rate) : null,
    };
  });
  const neededSkus = new Set(approved.map((r) => r.sku_id));
  const skuOptions: SkuOption[] = skus.map((s) => ({
    ...s,
    distributor_name: dists.find((d) => d.distributor_id === s.distributor_id)?.distributor_name ?? null,
    needed: neededSkus.has(s.sku_id),
  }));
  const rows: PoRow[] = pos.map((p) => ({
    ...p,
    skus: p.recommendation_ids.map((id) => {
      const r = poRecs.find((x) => x.id === id);
      return { sku_id: r?.sku_id ?? id.slice(0, 8), qty: r?.approved_qty ?? null };
    }),
    link: p.zoho_purchaseorder_id && status.api_domain ? zohoPoWebLink(status.api_domain, p.organization_id, p.zoho_purchaseorder_id) : null,
  }));

  return (
    <div className="space-y-6">
      <PageTitle title="Purchase Orders" subtitle="Approved reorders become DRAFT purchase orders in Zoho Inventory only after review and an explicit click." />
      <ZohoStatusPanel status={status} />
      <ReadyOrders lines={lines} live={live} orgName={status.organization_name} />
      <MappingEditor skus={skuOptions} mappings={mappings as MappingView[]} organizationId={status.organization_id} />
      <PoHistory rows={rows} />
    </div>
  );
}
