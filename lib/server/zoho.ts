import "server-only";
import { createPurchaseOrder, findPurchaseOrdersByReference, listOrganizations } from "../zoho/api";
import { ZohoApiError, ZohoClient } from "../zoho/client";
import { missingZohoEnv, zohoConfig, type ZohoConfig } from "../zoho/config";
import { HttpError } from "./httpError";
import type { ZohoPort } from "./poService";

// Server-to-server Zoho access for every visitor: a refresh token from the
// environment is exchanged for short-lived access tokens, cached per instance.

/** Non-secret view of the Zoho connection for the UI. */
export interface ZohoStatus {
  configured: boolean;
  live: boolean;
  missing: string[];
  api_domain: string | null;
  organization_id: string | null;
  organization_name: string | null;
  error: string | null;
}

let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;
let orgCache: { id: string; name: string; at: number } | null = null;
const ORG_TTL_MS = 10 * 60_000;

export function requireZohoConfig(): ZohoConfig {
  const cfg = zohoConfig();
  if (!cfg) throw new HttpError(409, `Zoho Inventory is not configured on the server (missing ${missingZohoEnv().join(", ") || "valid ZOHO_*_DOMAIN"}).`);
  return cfg;
}

async function refreshAccessToken(cfg: ZohoConfig): Promise<string> {
  const res = await fetch(`${cfg.accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || body.error || !body.access_token) {
    throw new HttpError(
      502,
      `Zoho rejected the server credentials (${body.error ?? `HTTP ${res.status}`}). Check ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN and ZOHO_ACCOUNTS_DOMAIN (your Zoho data centre).`,
    );
  }
  tokenCache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

/** Valid access token; concurrent callers share one refresh. */
async function accessToken(cfg: ZohoConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  tokenRequest ??= refreshAccessToken(cfg).finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

function clientFor(cfg: ZohoConfig, organizationId: string | null) {
  return new ZohoClient({ apiDomain: cfg.apiDomain, organizationId, getAccessToken: () => accessToken(cfg) });
}

/** ZOHO_ORGANIZATION_ID if set (verified), otherwise the account's only organisation. */
async function resolveOrganization(cfg: ZohoConfig): Promise<{ id: string; name: string }> {
  if (orgCache && Date.now() - orgCache.at < ORG_TTL_MS && (!cfg.organizationId || orgCache.id === cfg.organizationId)) return orgCache;
  const orgs = await listOrganizations(clientFor(cfg, null)).catch(asHttpError);
  const org = cfg.organizationId ? orgs.find((o) => o.organization_id === cfg.organizationId) : orgs.length === 1 ? orgs[0] : undefined;
  if (!org) {
    const list = orgs.map((o) => `${o.name} (${o.organization_id})`).join(", ") || "none";
    throw new HttpError(
      409,
      cfg.organizationId
        ? `ZOHO_ORGANIZATION_ID ${cfg.organizationId} is not available to these credentials. Available: ${list}.`
        : `This Zoho account has ${orgs.length} organisations; set ZOHO_ORGANIZATION_ID to one of: ${list}.`,
    );
  }
  orgCache = { id: org.organization_id, name: org.name, at: Date.now() };
  return orgCache;
}

export async function getZohoStatus(): Promise<ZohoStatus> {
  const cfg = zohoConfig();
  const base = { missing: missingZohoEnv(), api_domain: cfg?.apiDomain ?? null };
  if (!cfg) return { ...base, configured: false, live: false, organization_id: null, organization_name: null, error: null };
  try {
    const org = await resolveOrganization(cfg);
    return { ...base, configured: true, live: true, organization_id: org.id, organization_name: org.name, error: null };
  } catch (e) {
    return { ...base, configured: true, live: false, organization_id: null, organization_name: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function zohoClient(): Promise<{ client: ZohoClient; organizationId: string; organizationName: string }> {
  const cfg = requireZohoConfig();
  const org = await resolveOrganization(cfg);
  return { client: clientFor(cfg, org.id), organizationId: org.id, organizationName: org.name };
}

export async function zohoPort(): Promise<ZohoPort> {
  const { client, organizationId } = await zohoClient();
  return {
    organizationId,
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
