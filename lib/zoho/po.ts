// Pure helpers for building and checking a draft purchase-order request.

export interface PoLineInput {
  recommendation_id: string;
  sku_id: string;
  sku_name: string;
  zoho_item_id: string;
  zoho_item_name: string;
  zoho_vendor_id: string;
  quantity: number;
  purchase_rate: number;
}

export interface PoRequestInput {
  vendor_id: string;
  reference_number: string;
  date: string; // YYYY-MM-DD
  notes: string;
  lines: PoLineInput[];
  purchaseorder_number?: string | null;
}

export interface PoPayload {
  vendor_id: string;
  reference_number: string;
  date: string;
  notes: string;
  purchaseorder_number?: string;
  line_items: { item_id: string; quantity: number; purchase_rate: number; rate: number }[];
}

export function validatePoLines(vendorId: string, lines: PoLineInput[]): string[] {
  const errors: string[] = [];
  if (!vendorId) errors.push("No Zoho vendor selected.");
  if (lines.length === 0) errors.push("No approved lines to order.");
  const items = new Set<string>();
  for (const l of lines) {
    if (l.zoho_vendor_id !== vendorId) errors.push(`${l.sku_id} is mapped to a different Zoho vendor; vendors cannot be mixed on one PO.`);
    if (!l.zoho_item_id) errors.push(`${l.sku_id} has no Zoho item mapping.`);
    if (items.has(l.zoho_item_id)) errors.push(`${l.sku_id}: Zoho item ${l.zoho_item_name} appears twice on this PO.`);
    items.add(l.zoho_item_id);
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) errors.push(`${l.sku_id}: quantity must be a whole number above zero.`);
    if (!Number.isFinite(l.purchase_rate) || l.purchase_rate <= 0) errors.push(`${l.sku_id}: purchase rate must be above zero.`);
  }
  return errors;
}

/**
 * Builds the POST /purchaseorders body. The current docs name the line price
 * `purchase_rate`; earlier Zoho examples used `rate`, so both carry the same
 * planner-confirmed value. The PO is never marked issued — it stays a draft.
 */
export function buildPoPayload(input: PoRequestInput): PoPayload {
  const payload: PoPayload = {
    vendor_id: input.vendor_id,
    reference_number: input.reference_number,
    date: input.date,
    notes: input.notes,
    line_items: [...input.lines]
      .sort((a, b) => a.sku_id.localeCompare(b.sku_id))
      .map((l) => ({ item_id: l.zoho_item_id, quantity: l.quantity, purchase_rate: l.purchase_rate, rate: l.purchase_rate })),
  };
  const manual = input.purchaseorder_number?.trim();
  if (manual) payload.purchaseorder_number = manual;
  return payload;
}

/** Stable key: same org + vendor + recommendation/item/qty/rate set ⇒ same key. */
export function idempotencyMaterial(orgId: string, vendorId: string, lines: PoLineInput[]): string {
  const parts = [...lines]
    .sort((a, b) => a.recommendation_id.localeCompare(b.recommendation_id))
    .map((l) => [l.recommendation_id, l.zoho_item_id, l.quantity, l.purchase_rate.toFixed(2)]);
  return JSON.stringify([orgId, vendorId, parts]);
}

/** Compares what Zoho stored against what we sent; returns human-readable warnings. */
export function compareCreatedLines(
  sent: PoPayload["line_items"],
  received: { item_id: string; quantity: number | null; rate: number | null }[],
): string[] {
  const warnings: string[] = [];
  if (received.length === 0) return ["Zoho's reply did not include line items — verify the draft PO in Zoho."];
  for (const s of sent) {
    const r = received.find((x) => x.item_id === s.item_id);
    if (!r) warnings.push(`Item ${s.item_id} is missing from Zoho's reply — verify in Zoho.`);
    else {
      if (r.quantity !== null && r.quantity !== s.quantity) warnings.push(`Item ${s.item_id}: Zoho stored quantity ${r.quantity}, sent ${s.quantity}.`);
      if (r.rate !== null && Math.abs(r.rate - s.purchase_rate) > 0.005) warnings.push(`Item ${s.item_id}: Zoho stored rate ${r.rate}, sent ${s.purchase_rate}.`);
    }
  }
  return warnings;
}

export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Groups approved lines by Zoho vendor — one draft PO per vendor. */
export function groupByVendor<T extends { zoho_vendor_id: string }>(lines: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of lines) m.set(l.zoho_vendor_id, [...(m.get(l.zoho_vendor_id) ?? []), l]);
  return m;
}
