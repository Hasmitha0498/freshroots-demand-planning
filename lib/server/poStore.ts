import "server-only";
import { adminDb } from "../supabase/admin";
import type { CreatedPo } from "../zoho/api";
import type { PoPayload } from "../zoho/po";
import { audit } from "./repo";
import type { MappingRecord, PoRecRecord, PoRecord, PoStore } from "./poService";

function check<T>(r: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export function supabasePoStore(): PoStore {
  const db = adminDb();
  const setRecs = async (ids: string[], values: Record<string, unknown>) =>
    check(await db.from("recommendations").update(values).in("id", ids), "Updating recommendations");

  return {
    async getRecs(ids) {
      return check(
        await db.from("recommendations").select("id,run_id,sku_id,decision,approved_qty,po_status,purchase_order_id,calculation").in("id", ids),
        "Loading recommendations",
      ) as PoRecRecord[];
    },
    async getMappings(skuIds) {
      return check(await db.from("zoho_item_mappings").select("*").in("sku_id", skuIds), "Loading mappings") as MappingRecord[];
    },
    async findPoByKey(key) {
      return check(await db.from("purchase_orders").select("*").eq("idempotency_key", key).maybeSingle(), "Loading PO") as PoRecord | null;
    },
    async getPo(id) {
      return check(await db.from("purchase_orders").select("*").eq("id", id).maybeSingle(), "Loading PO") as PoRecord | null;
    },
    async insertPo(row) {
      const r = await db.from("purchase_orders").insert(row).select("*").single();
      if (r.error?.code === "23505") return null; // unique violation: concurrent submit
      return check(r, "Creating PO record") as PoRecord;
    },
    async retryFailedPo(id, payload: PoPayload) {
      const { data: cur } = await db.from("purchase_orders").select("attempts").eq("id", id).single();
      const r = await db
        .from("purchase_orders")
        .update({ status: "submitting", request_payload: payload, error_message: null, attempts: (cur?.attempts ?? 1) + 1, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "failed")
        .select("id");
      return (check(r, "Retrying PO") ?? []).length === 1;
    },
    async claimRecs(poId, recIds) {
      check(await db.rpc("claim_recommendations_for_po", { p_po_id: poId, p_rec_ids: recIds }), "Claiming recommendations");
    },
    async markCreated(po: PoRecord, created: CreatedPo, response: unknown, warnings: string[]) {
      check(
        await db
          .from("purchase_orders")
          .update({
            status: "created",
            zoho_purchaseorder_id: created.purchaseorder_id,
            zoho_purchaseorder_number: created.purchaseorder_number,
            zoho_status: created.status,
            zoho_response: response,
            error_message: null,
            warnings,
            updated_at: new Date().toISOString(),
          })
          .eq("id", po.id),
        "Saving created PO",
      );
      await setRecs(po.recommendation_ids, { po_status: "created", purchase_order_id: po.id });
    },
    async markFailed(po, message, response) {
      check(
        await db.from("purchase_orders").update({ status: "failed", error_message: message, zoho_response: response, updated_at: new Date().toISOString() }).eq("id", po.id),
        "Saving failed PO",
      );
      // Recommendations stay approved; release them so a corrected retry is possible.
      const { error } = await db
        .from("recommendations")
        .update({ po_status: "failed", purchase_order_id: null })
        .in("id", po.recommendation_ids)
        .or(`purchase_order_id.eq.${po.id},purchase_order_id.is.null`)
        .in("po_status", ["submitting", "ready", "needs_reconciliation"]);
      if (error) throw new Error(`Releasing recommendations: ${error.message}`);
    },
    async markNeedsReconciliation(po, message) {
      check(
        await db.from("purchase_orders").update({ status: "needs_reconciliation", error_message: message, updated_at: new Date().toISOString() }).eq("id", po.id),
        "Saving PO state",
      );
      await setRecs(po.recommendation_ids, { po_status: "needs_reconciliation", purchase_order_id: po.id });
    },
    async audit(actor, action, entityId, details) {
      await audit(actor, action, "purchase_order", entityId, details);
    },
  };
}

export async function listPurchaseOrders(): Promise<PoRecord[]> {
  return check(await adminDb().from("purchase_orders").select("*").order("created_at", { ascending: false }).limit(100), "Loading POs") as PoRecord[];
}

export async function listMappings(): Promise<(MappingRecord & { rate_source: string; confirmed_by_email: string; updated_at: string; zoho_item_sku: string | null })[]> {
  return check(await adminDb().from("zoho_item_mappings").select("*").order("sku_id"), "Loading mappings") as never;
}
