import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { plannerActor } from "@/lib/server/actor";
import { audit } from "@/lib/server/repo";
import { completeOAuth } from "@/lib/server/zoho";

const STATE_COOKIE = "zoho_oauth_state";

function back(req: NextRequest, params: Record<string, string>) {
  // Logged server-side so a failed connection is visible in Vercel / dev logs (no codes or tokens).
  if (params.zoho_error) console.error("[zoho callback] failed:", params.zoho_error);
  else console.log("[zoho callback] connected");
  const url = new URL("/purchase-orders", req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, "", { path: "/api/zoho/callback", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const actor = plannerActor();
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(req, { zoho_error: `Zoho declined: ${q.get("error")}` });
  const state = q.get("state") ?? "";
  const expected = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const valid = state.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!valid) return back(req, { zoho_error: "OAuth state mismatch or expired. Start Connect Zoho Inventory again." });
  const code = q.get("code");
  if (!code) return back(req, { zoho_error: "No authorisation code returned by Zoho." });

  try {
    await completeOAuth(code, q.get("accounts-server"), actor.name);
    await audit(actor.name, "zoho.connected", "zoho_connection", "1", {});
    return back(req, { zoho_connected: "1" });
  } catch (e) {
    return back(req, { zoho_error: e instanceof Error ? e.message : "Zoho connection failed." });
  }
}
