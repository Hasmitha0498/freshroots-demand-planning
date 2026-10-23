import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { route } from "@/lib/server/actor";
import { buildAuthorizeUrl, requireZohoConfig } from "@/lib/server/zoho";

export const STATE_COOKIE = "zoho_oauth_state";

// Starts OAuth: random state in an httpOnly cookie, then redirect to Zoho consent.
export const GET = route(async () => {
  const cfg = requireZohoConfig();
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/zoho/callback",
    maxAge: 600,
  });
  return res;
});
