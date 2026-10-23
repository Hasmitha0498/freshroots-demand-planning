// Zoho Inventory configuration. Region is configurable; India is the default.
export const ZOHO_SCOPES = [
  "ZohoInventory.settings.READ", // list organisations
  "ZohoInventory.items.READ",
  "ZohoInventory.contacts.READ", // vendors
  "ZohoInventory.purchaseorders.CREATE",
  "ZohoInventory.purchaseorders.READ", // reconciliation
];

const ACCOUNTS_HOST_RE = /^accounts\.zoho(cloud)?\.(com|eu|in|com\.au|jp|ca|sa|uk|com\.cn)$/;
const API_HOST_RE = /^www\.zohoapis\.(com|eu|in|com\.au|jp|ca|sa|uk|com\.cn)$/;

/** Returns the origin only if it is an https Zoho accounts host. */
export function safeAccountsOrigin(value: string | null | undefined): string | null {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" && ACCOUNTS_HOST_RE.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

/** Returns the origin only if it is an https Zoho API host. */
export function safeApiOrigin(value: string | null | undefined): string | null {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" && API_HOST_RE.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Server-to-server connection: a Zoho "Self Client" refresh token generated
 * once by the account owner and stored as a server environment variable.
 * There is no per-visitor OAuth sign-in or redirect URI.
 */
export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Optional: required only when the Zoho account has more than one organisation. */
  organizationId: string | null;
  accountsDomain: string;
  apiDomain: string;
}

export function zohoConfig(): ZohoConfig | null {
  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();
  const accountsDomain = safeAccountsOrigin(process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.in");
  const apiDomain = safeApiOrigin(process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.in");
  if (!clientId || !clientSecret || !refreshToken || !accountsDomain || !apiDomain) return null;
  return { clientId, clientSecret, refreshToken, organizationId: process.env.ZOHO_ORGANIZATION_ID?.trim() || null, accountsDomain, apiDomain };
}

export function missingZohoEnv(): string[] {
  return ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"].filter((k) => !process.env[k]?.trim());
}

/**
 * Best-effort web link to a PO in the Zoho Inventory UI, derived from the API
 * region. Labelled as constructed in the UI — Zoho does not return a link.
 */
export function zohoPoWebLink(apiDomain: string, organizationId: string, purchaseOrderId: string): string | null {
  const origin = safeApiOrigin(apiDomain);
  if (!origin) return null;
  const tld = new URL(origin).hostname.replace(/^www\.zohoapis\./, "");
  return `https://inventory.zoho.${tld}/app/${encodeURIComponent(organizationId)}#/purchaseorders/${encodeURIComponent(purchaseOrderId)}`;
}
