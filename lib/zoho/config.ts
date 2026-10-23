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

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accountsDomain: string;
  apiDomain: string;
  encryptionKey: string;
}

export function zohoConfig(): ZohoConfig | null {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  const encryptionKey = process.env.ZOHO_TOKEN_ENCRYPTION_KEY;
  const accountsDomain = safeAccountsOrigin(process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.in");
  const apiDomain = safeApiOrigin(process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.in");
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey || !accountsDomain || !apiDomain) return null;
  return { clientId, clientSecret, redirectUri, accountsDomain, apiDomain, encryptionKey };
}

export function missingZohoEnv(): string[] {
  return ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REDIRECT_URI", "ZOHO_TOKEN_ENCRYPTION_KEY"].filter((k) => !process.env[k]);
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
