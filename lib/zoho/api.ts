// Typed wrappers over the Zoho Inventory endpoints this app uses.
import { ZohoAmbiguousError, type ZohoClient } from "./client";

export interface ZohoOrganization {
  organization_id: string;
  name: string;
  currency_code?: string;
}
export interface ZohoItem {
  item_id: string;
  name: string;
  sku: string | null;
  status: string | null;
  purchase_rate: number | null;
  unit: string | null;
}
export interface ZohoVendor {
  contact_id: string;
  contact_name: string;
  company_name: string | null;
  status: string | null;
}
export interface CreatedPo {
  purchaseorder_id: string;
  purchaseorder_number: string | null;
  status: string | null;
  reference_number: string | null;
  line_items: { item_id: string; quantity: number | null; rate: number | null }[];
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

export function toItem(r: Record<string, unknown>): ZohoItem {
  return { item_id: String(r.item_id), name: String(r.name ?? ""), sku: str(r.sku), status: str(r.status), purchase_rate: num(r.purchase_rate), unit: str(r.unit) };
}

export function toVendor(r: Record<string, unknown>): ZohoVendor {
  return { contact_id: String(r.contact_id), contact_name: String(r.contact_name ?? ""), company_name: str(r.company_name), status: str(r.status) };
}

/** Parses the create-PO reply. Docs show `purchase_order`; older replies use `purchaseorder`. */
export function parseCreatedPo(body: Record<string, unknown>): CreatedPo {
  const po = (body.purchase_order ?? body.purchaseorder) as Record<string, unknown> | undefined;
  if (!po || po.purchaseorder_id === undefined || po.purchaseorder_id === null) {
    throw new ZohoAmbiguousError("Zoho reported success but the reply has no purchaseorder_id. Reconcile before retrying.");
  }
  return toCreatedPo(po);
}

export function toCreatedPo(po: Record<string, unknown>): CreatedPo {
  const lines = Array.isArray(po.line_items) ? (po.line_items as Record<string, unknown>[]) : [];
  return {
    purchaseorder_id: String(po.purchaseorder_id),
    purchaseorder_number: str(po.purchaseorder_number),
    status: str(po.status),
    reference_number: str(po.reference_number),
    line_items: lines.map((l) => ({ item_id: String(l.item_id), quantity: num(l.quantity), rate: num(l.rate ?? l.purchase_rate ?? l.bcy_rate) })),
  };
}

export async function listOrganizations(c: ZohoClient): Promise<ZohoOrganization[]> {
  const body = await c.request<{ organizations?: Record<string, unknown>[] }>("/organizations", { withOrg: false });
  return (body.organizations ?? []).map((o) => ({
    organization_id: String(o.organization_id),
    name: String(o.name ?? o.organization_id),
    currency_code: str(o.currency_code) ?? undefined,
  }));
}

export async function listItems(c: ZohoClient) {
  const { rows, truncated } = await c.listAll<Record<string, unknown>>("/items", "items");
  return { items: rows.map(toItem), truncated };
}

/** Vendors are contacts with contact_type = "vendor" (filtered here; never the CSV distributors). */
export async function listVendors(c: ZohoClient) {
  const { rows, truncated } = await c.listAll<Record<string, unknown>>("/contacts", "contacts", { filter_by: "Status.Active" });
  return { vendors: rows.filter((r) => r.contact_type === "vendor").map(toVendor), truncated };
}

export async function getItem(c: ZohoClient, itemId: string): Promise<ZohoItem> {
  const body = await c.request<{ item?: Record<string, unknown> }>(`/items/${encodeURIComponent(itemId)}`);
  if (!body.item) throw new Error("Zoho item not found.");
  return toItem(body.item);
}

export async function getVendor(c: ZohoClient, contactId: string): Promise<ZohoVendor & { contact_type: string | null }> {
  const body = await c.request<{ contact?: Record<string, unknown> }>(`/contacts/${encodeURIComponent(contactId)}`);
  if (!body.contact) throw new Error("Zoho contact not found.");
  return { ...toVendor(body.contact), contact_type: str(body.contact.contact_type) };
}

export async function createPurchaseOrder(c: ZohoClient, payload: unknown, manualNumber: boolean): Promise<CreatedPo> {
  const body = await c.request<Record<string, unknown>>("/purchaseorders", {
    method: "POST",
    json: payload,
    query: manualNumber ? { ignore_auto_number_generation: true } : undefined,
  });
  return parseCreatedPo(body);
}

/** Looks for POs with our internal reference number (used after an ambiguous result). */
export async function findPurchaseOrdersByReference(c: ZohoClient, reference: string, maxPages = 5): Promise<CreatedPo[]> {
  const { rows } = await c.listAll<Record<string, unknown>>("/purchaseorders", "purchaseorders", {}, maxPages);
  return rows.filter((r) => r.reference_number === reference).map(toCreatedPo);
}
