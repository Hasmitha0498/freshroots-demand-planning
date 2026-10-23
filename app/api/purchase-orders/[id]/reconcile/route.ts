import { NextResponse } from "next/server";
import { plannerActor, route } from "@/lib/server/actor";
import { reconcilePo } from "@/lib/server/poService";
import { supabasePoStore } from "@/lib/server/poStore";
import { asHttpError, zohoPort } from "@/lib/server/zoho";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = plannerActor();
  const { id } = await ctx.params;
  const result = await reconcilePo(supabasePoStore(), await zohoPort(), actor.name, id).catch(asHttpError);
  return NextResponse.json(result);
});
