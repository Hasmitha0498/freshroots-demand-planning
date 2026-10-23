import { NextResponse } from "next/server";
import { HttpError, plannerActor, route } from "@/lib/server/actor";
import { getItem, isSalesOnly, salesOnlyMessage } from "@/lib/zoho/api";
import { preparePo, type CreatePoInput } from "@/lib/server/poService";
import { supabasePoStore } from "@/lib/server/poStore";
import { asHttpError, zohoClient } from "@/lib/server/zoho";

// Review step: returns exactly what would be sent to Zoho. Creates nothing in Zoho.
export const POST = route(async (req: Request) => {
  const actor = plannerActor();
  const input = (await req.json().catch(() => ({}))) as CreatePoInput;
  const { client, organizationId, organizationName } = await zohoClient();
  const preview = await preparePo(supabasePoStore(), organizationId, input, actor.name);
  // Re-check the live Zoho items, so problems surface here rather than on Create.
  const items = await Promise.all([...new Set(preview.lines.map((l) => l.zoho_item_id))].map((id) => getItem(client, id))).catch(asHttpError);
  const salesOnly = items.filter(isSalesOnly);
  if (salesOnly.length) throw new HttpError(422, "Fix these items in Zoho before creating the PO.", salesOnly.map((i) => salesOnlyMessage(i.name)));
  return NextResponse.json({ preview, organization_name: organizationName });
});
