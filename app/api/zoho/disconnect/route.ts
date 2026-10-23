import { NextResponse } from "next/server";
import { plannerActor, route } from "@/lib/server/actor";
import { audit } from "@/lib/server/repo";
import { disconnectZoho } from "@/lib/server/zoho";

export const POST = route(async () => {
  const actor = plannerActor();
  await disconnectZoho();
  await audit(actor.name, "zoho.disconnected", "zoho_connection", "1", {});
  return NextResponse.json({ ok: true });
});
