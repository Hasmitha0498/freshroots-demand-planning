import { NextResponse } from "next/server";
import { plannerActor, route } from "@/lib/server/actor";
import { preparePo, type CreatePoInput } from "@/lib/server/poService";
import { supabasePoStore } from "@/lib/server/poStore";
import { getConnection } from "@/lib/server/zoho";

// Review step: returns exactly what would be sent to Zoho. Makes no Zoho call.
export const POST = route(async (req: Request) => {
  const actor = plannerActor();
  const input = (await req.json().catch(() => ({}))) as CreatePoInput;
  const conn = await getConnection();
  const preview = await preparePo(supabasePoStore(), conn?.organization_id ?? null, input, actor.name);
  return NextResponse.json({ preview, organization_name: conn?.organization_name ?? null });
});
