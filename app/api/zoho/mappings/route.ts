import { NextResponse } from "next/server";
import { HttpError, plannerActor, route } from "@/lib/server/actor";
import { getItem, getVendor } from "@/lib/zoho/api";
import { audit } from "@/lib/server/repo";
import { asHttpError, zohoClient } from "@/lib/server/zoho";
import { adminDb } from "@/lib/supabase/admin";

interface Body {
  sku_id?: string;
  zoho_item_id?: string;
  zoho_vendor_id?: string;
  purchase_rate?: number;
}

// Saves SKU → existing Zoho item + vendor. Both are re-fetched from Zoho to prove they exist.
export const POST = route(async (req: Request) => {
  const actor = plannerActor();
  const b = (await req.json().catch(() => ({}))) as Body;
  if (!b.sku_id || !b.zoho_item_id || !b.zoho_vendor_id) throw new HttpError(400, "SKU, Zoho item and Zoho vendor are required.");
  const rate = Number(b.purchase_rate);
  if (!Number.isFinite(rate) || rate <= 0 || Math.round(rate * 100) !== rate * 100)
    throw new HttpError(422, "Purchase rate must be above zero with at most two decimals.");

  const { data: sku } = await adminDb().from("sku_master").select("sku_id").eq("sku_id", b.sku_id).maybeSingle();
  if (!sku) throw new HttpError(404, "Unknown SKU.");

  const { client, connection } = await zohoClient();
  const [item, vendor] = await Promise.all([getItem(client, b.zoho_item_id), getVendor(client, b.zoho_vendor_id)]).catch(asHttpError);
  if (vendor.contact_type && vendor.contact_type !== "vendor") throw new HttpError(422, `${vendor.contact_name} is a ${vendor.contact_type}, not a vendor.`);

  const rateSource = item.purchase_rate !== null && Math.abs(item.purchase_rate - rate) < 0.005 ? "zoho_item" : "planner_entered";
  const row = {
    sku_id: b.sku_id,
    organization_id: connection.organization_id!,
    zoho_item_id: item.item_id,
    zoho_item_name: item.name,
    zoho_item_sku: item.sku,
    zoho_vendor_id: vendor.contact_id,
    zoho_vendor_name: vendor.contact_name,
    purchase_rate: rate,
    rate_source: rateSource,
    confirmed_by_email: actor.name,
    updated_at: new Date().toISOString(),
  };
  const { error } = await adminDb().from("zoho_item_mappings").upsert(row);
  if (error) throw new Error(error.message);
  await audit(actor.name, "mapping.saved", "zoho_item_mapping", b.sku_id, row);
  return NextResponse.json({ mapping: row });
});
