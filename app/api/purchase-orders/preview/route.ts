import { NextResponse } from "next/server";
import { plannerActor, route } from "@/lib/server/actor";
import { preparePo, type CreatePoInput } from "@/lib/server/poService";
import { supabasePoStore } from "@/lib/server/poStore";
import { zohoClient } from "@/lib/server/zoho";

// Review step: returns exactly what would be sent to Zoho. Creates nothing in Zoho.
export const POST = route(async (req: Request) => {
  const actor = plannerActor();
  const input = (await req.json().catch(() => ({}))) as CreatePoInput;
  const { organizationId, organizationName } = await zohoClient();
  const preview = await preparePo(supabasePoStore(), organizationId, input, actor.name);
  return NextResponse.json({ preview, organization_name: organizationName });
});
