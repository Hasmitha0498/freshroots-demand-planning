import { NextResponse } from "next/server";
import { HttpError, plannerActor, route } from "@/lib/server/actor";
import { listOrganizations } from "@/lib/zoho/api";
import { audit } from "@/lib/server/repo";
import { asHttpError, zohoClient } from "@/lib/server/zoho";
import { adminDb } from "@/lib/supabase/admin";

export const GET = route(async () => {
  const { client } = await zohoClient({ requireOrg: false });
  const organizations = await listOrganizations(client).catch(asHttpError);
  return NextResponse.json({ organizations });
});

export const POST = route(async (req: Request) => {
  const actor = plannerActor();
  const { organization_id } = (await req.json().catch(() => ({}))) as { organization_id?: string };
  const { client } = await zohoClient({ requireOrg: false });
  const orgs = await listOrganizations(client).catch(asHttpError);
  const org = orgs.find((o) => o.organization_id === organization_id);
  if (!org) throw new HttpError(422, "That organisation is not available to this Zoho account.");
  const { error } = await adminDb()
    .from("zoho_connection")
    .update({ organization_id: org.organization_id, organization_name: org.name, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  await audit(actor.name, "zoho.organization_selected", "zoho_connection", "1", org);
  return NextResponse.json({ organization: org });
});
