// Draft-PO orchestration: validation, idempotency, claim, Zoho call, reconciliation.
// Depends only on the PoStore / ZohoPort interfaces so every path is unit-testable.
import { createHash } from "node:crypto";
import type { CreatedPo } from "../zoho/api";
import { ZohoAmbiguousError, ZohoApiError } from "../zoho/client";
import {
  buildPoPayload,
  compareCreatedLines,
  idempotencyMaterial,
  todayInIndia,
  validatePoLines,
  type PoLineInput,
  type PoPayload,
} from "../zoho/po";
import { HttpError } from "./httpError";

export interface MappingRecord {
  sku_id: string;
  organization_id: string;
  zoho_item_id: string;
  zoho_item_name: string;
  zoho_vendor_id: string;
  zoho_vendor_name: string;
  purchase_rate: number;
}

export interface PoRecRecord {
  id: string;
  run_id: string;
  sku_id: string;
  decision: string;
  approved_qty: number | null;
  po_status: string;
  purchase_order_id: string | null;
  calculation: { sku_name: string };
}

export interface PoRecord {
  id: string;
  idempotency_key: string;
  reference_number: string;
  organization_id: string;
  zoho_vendor_id: string;
  zoho_vendor_name: string;
  recommendation_ids: string[];
  request_payload: PoPayload;
  status: "submitting" | "created" | "failed" | "needs_reconciliation";
  attempts: number;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  zoho_status: string | null;
  error_message: string | null;
  warnings: string[];
  created_by_email: string;
  created_at: string;
  updated_at: string;
}

export interface PoStore {
  getRecs(ids: string[]): Promise<PoRecRecord[]>;
  getMappings(skuIds: string[]): Promise<MappingRecord[]>;
  findPoByKey(key: string): Promise<PoRecord | null>;
  getPo(id: string): Promise<PoRecord | null>;
  /** Returns null when the unique idempotency key already exists (concurrent submit). */
  insertPo(row: Omit<PoRecord, "id" | "attempts" | "zoho_purchaseorder_id" | "zoho_purchaseorder_number" | "zoho_status" | "error_message" | "warnings" | "created_at" | "updated_at">): Promise<PoRecord | null>;
  /** Conditional failed → submitting. Returns false if another request got there first. */
  retryFailedPo(id: string, payload: PoPayload): Promise<boolean>;
  /** Atomically marks recs submitting for this PO; throws if any is not eligible. */
  claimRecs(poId: string, recIds: string[]): Promise<void>;
  markCreated(po: PoRecord, created: CreatedPo, response: unknown, warnings: string[]): Promise<void>;
  markFailed(po: PoRecord, message: string, response: unknown): Promise<void>;
  markNeedsReconciliation(po: PoRecord, message: string): Promise<void>;
  audit(actor: string, action: string, entityId: string, details: unknown): Promise<void>;
}

export interface ZohoPort {
  organizationId: string | null;
  createPurchaseOrder(payload: PoPayload, manualNumber: boolean): Promise<{ po: CreatedPo; raw: unknown }>;
  findByReference(reference: string): Promise<CreatedPo[]>;
}

export interface CreatePoInput {
  recommendation_ids: string[];
  confirm: boolean;
  purchaseorder_number?: string | null;
}

export interface PoPreview {
  vendor_id: string;
  vendor_name: string;
  organization_id: string;
  reference_number: string;
  idempotency_key: string;
  payload: PoPayload;
  lines: PoLineInput[];
  total: number;
}

export function referenceFromKey(key: string): string {
  return `FR-${key.slice(0, 10).toUpperCase()}`;
}

/** Validates approvals + mappings and builds the exact request that would be sent. */
export async function preparePo(store: PoStore, organizationId: string | null, input: CreatePoInput, actorEmail: string): Promise<PoPreview> {
  const ids = [...new Set(input.recommendation_ids ?? [])];
  if (ids.length === 0) throw new HttpError(400, "Select at least one approved recommendation.");
  if (!organizationId) throw new HttpError(409, "Select a Zoho organisation first.");

  const recs = await store.getRecs(ids);
  const inFlight = recs.filter((r) => r.po_status === "submitting").map((r) => r.sku_id);
  if (inFlight.length) throw new HttpError(409, `A PO is already being submitted for ${inFlight.join(", ")}. Wait for it to finish.`);
  const problems: string[] = [];
  for (const id of ids) if (!recs.find((r) => r.id === id)) problems.push(`Recommendation ${id} not found.`);
  for (const r of recs) {
    if (r.decision !== "approved") problems.push(`${r.sku_id} is not approved (${r.decision}).`);
    else if (!r.approved_qty || r.approved_qty <= 0) problems.push(`${r.sku_id} has no positive approved quantity.`);
    if (!["ready", "failed"].includes(r.po_status)) problems.push(`${r.sku_id} PO status is ${r.po_status}.`);
  }
  const mappings = await store.getMappings(recs.map((r) => r.sku_id));
  const lines: PoLineInput[] = [];
  for (const r of recs) {
    const m = mappings.find((x) => x.sku_id === r.sku_id);
    if (!m) {
      problems.push(`${r.sku_id} has no Zoho item/vendor mapping.`);
      continue;
    }
    if (m.organization_id !== organizationId) problems.push(`${r.sku_id} is mapped in a different Zoho organisation; re-map it.`);
    lines.push({
      recommendation_id: r.id,
      sku_id: r.sku_id,
      sku_name: r.calculation.sku_name,
      zoho_item_id: m.zoho_item_id,
      zoho_item_name: m.zoho_item_name,
      zoho_vendor_id: m.zoho_vendor_id,
      quantity: r.approved_qty ?? 0,
      purchase_rate: Number(m.purchase_rate),
    });
  }
  const vendorId = lines[0]?.zoho_vendor_id ?? "";
  problems.push(...validatePoLines(vendorId, lines));
  if (problems.length) throw new HttpError(422, "This purchase order cannot be created yet.", [...new Set(problems)]);

  const key = createHash("sha256").update(idempotencyMaterial(organizationId, vendorId, lines)).digest("hex");
  const reference = referenceFromKey(key);
  const runIds = [...new Set(recs.map((r) => r.run_id.slice(0, 8)))].join(", ");
  const payload = buildPoPayload({
    vendor_id: vendorId,
    reference_number: reference,
    date: todayInIndia(),
    notes: `Draft created by Freshroots Demand Planning (planning run ${runIds}), approved by ${actorEmail}. Not issued.`,
    lines,
    purchaseorder_number: input.purchaseorder_number,
  });
  const vendorName = mappings.find((m) => m.zoho_vendor_id === vendorId)?.zoho_vendor_name ?? vendorId;
  const total = lines.reduce((a, l) => a + l.quantity * l.purchase_rate, 0);
  return { vendor_id: vendorId, vendor_name: vendorName, organization_id: organizationId, reference_number: reference, idempotency_key: key, payload, lines, total };
}

export type CreatePoOutcome =
  | { outcome: "created"; po: PoRecord }
  | { outcome: "already_created"; po: PoRecord };

export async function createDraftPo(store: PoStore, zoho: ZohoPort, actorEmail: string, input: CreatePoInput): Promise<CreatePoOutcome> {
  if (input.confirm !== true) throw new HttpError(400, "Creating a Zoho PO requires explicit confirmation.");

  // Duplicate check comes first, so a repeat click after success returns the existing PO.
  const preview = await preparePo(store, zoho.organizationId, input, actorEmail);
  const existing = await store.findPoByKey(preview.idempotency_key);
  let po: PoRecord;
  if (existing) {
    if (existing.status === "created") return { outcome: "already_created", po: existing };
    if (existing.status === "submitting") throw new HttpError(409, "This PO is already being submitted. Wait for it to finish.");
    if (existing.status === "needs_reconciliation")
      throw new HttpError(409, "A previous attempt had an unclear result. Use Reconcile with Zoho before retrying.");
    if (!(await store.retryFailedPo(existing.id, preview.payload))) throw new HttpError(409, "Another submission is in progress.");
    po = { ...existing, status: "submitting", request_payload: preview.payload };
  } else {
    const inserted = await store.insertPo({
      idempotency_key: preview.idempotency_key,
      reference_number: preview.reference_number,
      organization_id: preview.organization_id,
      zoho_vendor_id: preview.vendor_id,
      zoho_vendor_name: preview.vendor_name,
      recommendation_ids: preview.lines.map((l) => l.recommendation_id),
      request_payload: preview.payload,
      status: "submitting",
      created_by_email: actorEmail,
    });
    if (!inserted) throw new HttpError(409, "This PO is already being submitted. Refresh to see its status.");
    po = inserted;
  }

  try {
    await store.claimRecs(po.id, po.recommendation_ids);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await store.markFailed(po, `Could not lock recommendations: ${msg}`, null);
    throw new HttpError(409, "Some recommendations are already on another PO or no longer approved. Refresh and try again.");
  }

  await store.audit(actorEmail, "po.submit", po.id, { reference: po.reference_number, attempt: po.attempts });
  try {
    const { po: created, raw } = await zoho.createPurchaseOrder(preview.payload, Boolean(preview.payload.purchaseorder_number));
    const warnings = compareCreatedLines(preview.payload.line_items, created.line_items);
    if (created.status && created.status.toLowerCase() !== "draft")
      warnings.push(`Zoho reports status "${created.status}", not "draft". Review it in Zoho.`);
    await store.markCreated(po, created, raw, warnings);
    await store.audit(actorEmail, "po.created", po.id, { zoho_purchaseorder_id: created.purchaseorder_id, number: created.purchaseorder_number });
    return { outcome: "created", po: (await store.getPo(po.id))! };
  } catch (e) {
    if (e instanceof ZohoAmbiguousError) {
      await store.markNeedsReconciliation(po, e.message);
      await store.audit(actorEmail, "po.ambiguous", po.id, { message: e.message });
      throw new HttpError(504, `${e.message} Marked "Needs reconciliation" — use Reconcile with Zoho before retrying.`);
    }
    const msg = e instanceof Error ? e.message : String(e);
    await store.markFailed(po, msg, e instanceof ZohoApiError ? e.body : null);
    await store.audit(actorEmail, "po.failed", po.id, { message: msg });
    throw new HttpError(502, `Zoho did not create the PO: ${msg}`, { recommendation_status: "approved — PO not created" });
  }
}

/** After an ambiguous result: look the PO up in Zoho by our reference before allowing a retry. */
export async function reconcilePo(store: PoStore, zoho: ZohoPort, actorEmail: string, poId: string) {
  const po = await store.getPo(poId);
  if (!po) throw new HttpError(404, "PO record not found.");
  if (po.status === "created") return { result: "already_created" as const, po };
  if (po.status === "failed") return { result: "failed" as const, po };
  const ageMs = Date.now() - new Date(po.updated_at).getTime();
  if (po.status === "submitting" && ageMs < 60_000)
    throw new HttpError(409, "Submission is still in progress; try reconciling in a minute.");

  const matches = await zoho.findByReference(po.reference_number);
  if (matches.length > 0) {
    const warnings = matches.length > 1 ? [`Zoho has ${matches.length} POs with reference ${po.reference_number}; using the first. Review duplicates in Zoho.`] : [];
    await store.markCreated(po, matches[0], { reconciled: true, matches }, warnings);
    await store.audit(actorEmail, "po.reconciled_found", po.id, { zoho_purchaseorder_id: matches[0].purchaseorder_id });
    return { result: "found" as const, po: (await store.getPo(po.id))! };
  }
  await store.markFailed(po, "Not found in Zoho during reconciliation; safe to retry.", null);
  await store.audit(actorEmail, "po.reconciled_not_found", po.id, {});
  return { result: "not_found" as const, po: (await store.getPo(po.id))! };
}
