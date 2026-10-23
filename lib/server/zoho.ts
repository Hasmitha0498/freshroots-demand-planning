import "server-only";
import { adminDb } from "../supabase/admin";
import { createPurchaseOrder, findPurchaseOrdersByReference } from "../zoho/api";
import { ZohoApiError, ZohoClient } from "../zoho/client";
import { safeAccountsOrigin, safeApiOrigin, ZOHO_SCOPES, zohoConfig, type ZohoConfig } from "../zoho/config";
import { decryptSecret, encryptSecret } from "../zoho/crypto";
import { HttpError } from "./httpError";
import type { ZohoPort } from "./poService";

export interface ZohoConnectionRow {
  accounts_domain: string;
  api_domain: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  scope: string | null;
  organization_id: string | null;
  organization_name: string | null;
  connected_by_email: string;
  connected_at: string;
}

/** Public, non-secret view of the connection for the UI. */
export interface ZohoStatus {
  configured: boolean;
  connected: boolean;
  api_domain: string | null;
  organization_id: string | null;
  organization_name: string | null;
  connected_by_email: string | null;
  connected_at: string | null;
}

export function requireZohoConfig(): ZohoConfig {
  const cfg = zohoConfig();
  if (!cfg) throw new HttpError(409, "Zoho is not configured on the server (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI, ZOHO_TOKEN_ENCRYPTION_KEY).");
  return cfg;
}

export async function getConnection(): Promise<ZohoConnectionRow | null> {
  const { data, error } = await adminDb().from("zoho_connection").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Loading Zoho connection: ${error.message}`);
  return data as ZohoConnectionRow | null;
}

export async function getZohoStatus(): Promise<ZohoStatus> {
  const configured = zohoConfig() !== null;
  const c = configured ? await getConnection() : null;
  return {
    configured,
    connected: Boolean(c),
    api_domain: c?.api_domain ?? null,
    organization_id: c?.organization_id ?? null,
    organization_name: c?.organization_name ?? null,
    connected_by_email: c?.connected_by_email ?? null,
    connected_at: c?.connected_at ?? null,
  };
}

export function buildAuthorizeUrl(cfg: ZohoConfig, state: string): string {
  const u = new URL(`${cfg.accountsDomain}/oauth/v2/auth`);
  u.searchParams.set("scope", ZOHO_SCOPES.join(","));
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_domain?: string;
  scope?: string;
  error?: string;
}

async function tokenRequest(accountsDomain: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error) throw new HttpError(502, `Zoho OAuth error: ${body.error ?? `HTTP ${res.status}`}`);
  return body;
}

/** OAuth callback: exchange the code server-side and store encrypted tokens. */
export async function completeOAuth(code: string, accountsServer: string | null, actorEmail: string) {
  const cfg = requireZohoConfig();
  // Zoho may name the account's own data centre; accept it only if it is a Zoho accounts host.
  const accounts = safeAccountsOrigin(accountsServer) ?? cfg.accountsDomain;
  const t = await tokenRequest(accounts, {
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    code,
  });
  if (!t.refresh_token || !t.access_token) {
    throw new HttpError(502, "Zoho did not return a refresh token. Revoke the app's access in Zoho and connect again (offline access with consent is required).");
  }
  const apiDomain = safeApiOrigin(t.api_domain) ?? cfg.apiDomain;
  const { error } = await adminDb()
    .from("zoho_connection")
    .upsert({
      id: 1,
      accounts_domain: accounts,
      api_domain: apiDomain,
      refresh_token_enc: encryptSecret(t.refresh_token, cfg.encryptionKey),
      access_token_enc: encryptSecret(t.access_token, cfg.encryptionKey),
      access_token_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      scope: t.scope ?? ZOHO_SCOPES.join(","),
      organization_id: null,
      organization_name: null,
      connected_by_email: actorEmail,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`Saving Zoho connection: ${error.message}`);
}

/** Returns a valid access token, refreshing it server-side when near expiry. */
async function accessToken(cfg: ZohoConfig): Promise<string> {
  const c = await getConnection();
  if (!c) throw new HttpError(409, "Zoho Inventory is not connected.");
  if (c.access_token_enc && c.access_token_expires_at && new Date(c.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return decryptSecret(c.access_token_enc, cfg.encryptionKey);
  }
  const t = await tokenRequest(c.accounts_domain, {
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: decryptSecret(c.refresh_token_enc, cfg.encryptionKey),
  }).catch((e) => {
    throw new HttpError(401, `${e instanceof Error ? e.message : e}. Reconnect Zoho Inventory.`);
  });
  if (!t.access_token) throw new HttpError(401, "Zoho token refresh returned no access token. Reconnect Zoho Inventory.");
  const { error } = await adminDb()
    .from("zoho_connection")
    .update({
      access_token_enc: encryptSecret(t.access_token, cfg.encryptionKey),
      access_token_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(`Saving refreshed token: ${error.message}`);
  return t.access_token;
}

export async function zohoClient(opts: { requireOrg?: boolean } = {}): Promise<{ client: ZohoClient; connection: ZohoConnectionRow }> {
  const cfg = requireZohoConfig();
  const connection = await getConnection();
  if (!connection) throw new HttpError(409, "Zoho Inventory is not connected. Use Connect Zoho Inventory first.");
  if (opts.requireOrg !== false && !connection.organization_id) throw new HttpError(409, "Select a Zoho organisation first.");
  return {
    connection,
    client: new ZohoClient({ apiDomain: connection.api_domain, organizationId: connection.organization_id, getAccessToken: () => accessToken(cfg) }),
  };
}

export async function zohoPort(): Promise<ZohoPort> {
  const { client, connection } = await zohoClient();
  return {
    organizationId: connection.organization_id,
    async createPurchaseOrder(payload, manualNumber) {
      const po = await createPurchaseOrder(client, payload, manualNumber);
      return { po, raw: { purchase_order: po } };
    },
    findByReference: (ref) => findPurchaseOrdersByReference(client, ref),
  };
}

/** Converts Zoho errors to HTTP errors that show Zoho's own message. */
export function asHttpError(e: unknown): never {
  if (e instanceof ZohoApiError) throw new HttpError(e.httpStatus >= 400 && e.httpStatus < 500 ? 422 : 502, e.message);
  throw e;
}

export async function disconnectZoho() {
  const cfg = zohoConfig();
  const c = await getConnection();
  if (cfg && c) {
    // Best effort: revoke the refresh token at Zoho.
    try {
      await fetch(`${c.accounts_domain}/oauth/v2/token/revoke?token=${encodeURIComponent(decryptSecret(c.refresh_token_enc, cfg.encryptionKey))}`, { method: "POST" });
    } catch {
      /* ignore */
    }
  }
  const { error } = await adminDb().from("zoho_connection").delete().eq("id", 1);
  if (error) throw new Error(error.message);
}
