import { NextResponse } from "next/server";
import { plannerActor, route } from "@/lib/server/actor";
import { createDraftPo, type CreatePoInput } from "@/lib/server/poService";
import { supabasePoStore } from "@/lib/server/poStore";
import { zohoPort } from "@/lib/server/zoho";

// Creates ONE draft PO in Zoho Inventory for one vendor, after explicit confirmation.
export const POST = route(async (req: Request) => {
  const actor = plannerActor();
  const input = (await req.json().catch(() => ({}))) as CreatePoInput;
  const result = await createDraftPo(supabasePoStore(), await zohoPort(), actor.name, input);
  return NextResponse.json(result);
});
