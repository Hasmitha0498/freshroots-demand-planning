// PO orchestration against in-memory fakes: approval gating, idempotency,
// failure handling and reconciliation. No real Zoho calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDraftPo, preparePo, reconcilePo, type MappingRecord, type PoRecRecord, type PoRecord, type PoStore, type ZohoPort } from "@/lib/server/poService";
import { ZohoAmbiguousError, ZohoApiError } from "@/lib/zoho/client";
import { HttpError } from "@/lib/server/httpError";
import type { PoPayload } from "@/lib/zoho/po";
import type { CreatedPo } from "@/lib/zoho/api";

let recs: PoRecRecord[];
let mappings: MappingRecord[];
let pos: PoRecord[];
let audits: { action: string; details: unknown }[];

function fakeStore(): PoStore {
  return {
    getRecs: async (ids) => recs.filter((r) => ids.includes(r.id)).map((r) => ({ ...r })),
    getMappings: async (skus) => mappings.filter((m) => skus.includes(m.sku_id)),
    // Return copies, like the real store (rows are re-read from the database).
    findPoByKey: async (k) => {
      const p = pos.find((x) => x.idempotency_key === k);
      return p ? { ...p } : null;
    },
    getPo: async (id) => pos.find((p) => p.id === id) ?? null,
    insertPo: async (row) => {
      if (pos.some((p) => p.idempotency_key === row.idempotency_key)) return null;
      const po: PoRecord = { ...row, id: `po${pos.length + 1}`, attempts: 1, zoho_purchaseorder_id: null, zoho_purchaseorder_number: null, zoho_status: null, error_message: null, warnings: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      pos.push(po);
      return po;
    },
    retryFailedPo: async (id) => {
      const p = pos.find((x) => x.id === id && x.status === "failed");
      if (!p) return false;
      p.status = "submitting";
      p.attempts++;
      return true;
    },
    claimRecs: async (poId, ids) => {
      const ok = ids.every((id) => {
        const r = recs.find((x) => x.id === id)!;
        return r.decision === "approved" && (r.approved_qty ?? 0) > 0 && ["ready", "failed"].includes(r.po_status) && !r.purchase_order_id;
      });
      if (!ok) throw new Error("claim_failed");
      for (const id of ids) Object.assign(recs.find((x) => x.id === id)!, { po_status: "submitting", purchase_order_id: poId });
    },
    markCreated: async (po, created, _raw, warnings) => {
      Object.assign(pos.find((p) => p.id === po.id)!, { status: "created", zoho_purchaseorder_id: created.purchaseorder_id, zoho_purchaseorder_number: created.purchaseorder_number, zoho_status: created.status, warnings });
      for (const id of po.recommendation_ids) Object.assign(recs.find((x) => x.id === id)!, { po_status: "created" });
    },
    markFailed: async (po, message) => {
      Object.assign(pos.find((p) => p.id === po.id)!, { status: "failed", error_message: message });
      for (const id of po.recommendation_ids) {
        const r = recs.find((x) => x.id === id)!;
        if (r.purchase_order_id === po.id || !r.purchase_order_id) Object.assign(r, { po_status: "failed", purchase_order_id: null });
      }
    },
    markNeedsReconciliation: async (po, message) => {
      Object.assign(pos.find((p) => p.id === po.id)!, { status: "needs_reconciliation", error_message: message, updated_at: new Date(0).toISOString() });
      for (const id of po.recommendation_ids) Object.assign(recs.find((x) => x.id === id)!, { po_status: "needs_reconciliation" });
    },
    audit: async (_actor, action, _id, details) => {
      audits.push({ action, details });
    },
  };
}

const created = { purchaseorder_id: "Z1", purchaseorder_number: "PO-00001", status: "draft", reference_number: null, line_items: [] as { item_id: string; quantity: number | null; rate: number | null }[] };

function zoho(impl: Partial<ZohoPort> = {}): ZohoPort {
  return {
    organizationId: "org1",
    createPurchaseOrder: vi.fn(async (payload: PoPayload) => ({ po: { ...created, line_items: payload.line_items.map((l) => ({ item_id: l.item_id, quantity: l.quantity, rate: l.purchase_rate })) }, raw: {} })),
    findByReference: vi.fn(async () => []),
    ...impl,
  };
}

beforeEach(() => {
  const rec = (id: string, sku: string, over: Partial<PoRecRecord> = {}): PoRecRecord => ({ id, run_id: "run12345", sku_id: sku, decision: "approved", approved_qty: 100, po_status: "ready", purchase_order_id: null, calculation: { sku_name: sku }, ...over });
  recs = [rec("r1", "SKU001"), rec("r2", "SKU013"), rec("r3", "SKU003"), rec("p1", "SKU004", { decision: "pending", approved_qty: null, po_status: "not_applicable" })];
  const map = (sku: string, vendor: string, item: string): MappingRecord => ({ sku_id: sku, organization_id: "org1", zoho_item_id: item, zoho_item_name: item, zoho_vendor_id: vendor, zoho_vendor_name: vendor, purchase_rate: 10 });
  mappings = [map("SKU001", "vA", "i1"), map("SKU013", "vA", "i13"), map("SKU003", "vB", "i3"), map("SKU004", "vA", "i4")];
  pos = [];
  audits = [];
});

const store = () => fakeStore();
const errOf = (p: Promise<unknown>) => p.then(() => null, (e) => e as HttpError);

describe("draft PO creation", () => {
  it("requires explicit confirmation", async () => {
    expect((await errOf(createDraftPo(store(), zoho(), "p@x", { recommendation_ids: ["r1"], confirm: false })))!.status).toBe(400);
  });

  it("blocks unapproved recommendations and mixed vendors", async () => {
    const e1 = await errOf(createDraftPo(store(), zoho(), "p@x", { recommendation_ids: ["p1"], confirm: true }));
    expect(e1!.status).toBe(422);
    expect(JSON.stringify(e1!.details)).toMatch(/not approved/);
    const e2 = await errOf(createDraftPo(store(), zoho(), "p@x", { recommendation_ids: ["r1", "r3"], confirm: true }));
    expect(JSON.stringify(e2!.details)).toMatch(/different Zoho vendor/);
  });

  it("blocks missing mappings and wrong organisation", async () => {
    mappings = mappings.filter((m) => m.sku_id !== "SKU001");
    expect(JSON.stringify((await errOf(createDraftPo(store(), zoho(), "p@x", { recommendation_ids: ["r1"], confirm: true })))!.details)).toMatch(/no Zoho item/);
    expect((await errOf(createDraftPo(store(), zoho({ organizationId: null }), "p@x", { recommendation_ids: ["r2"], confirm: true })))!.message).toMatch(/organisation/);
  });

  it("creates one draft PO and saves Zoho's real ids", async () => {
    const z = zoho();
    const r = await createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1", "r2"], confirm: true });
    expect(r.outcome).toBe("created");
    expect(r.po).toMatchObject({ status: "created", zoho_purchaseorder_id: "Z1", zoho_purchaseorder_number: "PO-00001", zoho_status: "draft", warnings: [] });
    expect(r.po.reference_number).toMatch(/^FR-[0-9A-F]{10}$/);
    expect(recs.find((x) => x.id === "r1")!.po_status).toBe("created");
    expect(z.createPurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it("never sends a duplicate: a second request after success is rejected without calling Zoho", async () => {
    const z = zoho();
    await createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true });
    const again = await errOf(createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true }));
    expect(again!.status).toBe(422);
    expect(z.createPurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it("concurrent submit of the same set is locked", async () => {
    let release!: () => void;
    const z = zoho({ createPurchaseOrder: vi.fn(() => new Promise<{ po: CreatedPo; raw: unknown }>((res) => (release = () => res({ po: created, raw: {} })))) });
    const first = createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true });
    await new Promise((r) => setTimeout(r, 5));
    const second = await errOf(createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true }));
    expect(second!.status).toBe(409);
    release();
    await first;
    expect(z.createPurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it("on a Zoho error keeps the approval, marks PO failed, and allows a retry with the same reference", async () => {
    const z = zoho({ createPurchaseOrder: vi.fn().mockRejectedValueOnce(new ZohoApiError("Zoho error 4000: Vendor is inactive", 400, 4000, {})) });
    const e = await errOf(createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true }));
    expect(e!.status).toBe(502);
    expect(e!.message).toContain("Vendor is inactive");
    expect(recs.find((x) => x.id === "r1")).toMatchObject({ decision: "approved", po_status: "failed", purchase_order_id: null });
    const ref = pos[0].reference_number;
    (z.createPurchaseOrder as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ po: created, raw: {} });
    const r = await createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true });
    expect(r.po.reference_number).toBe(ref);
    expect(r.po.attempts).toBe(2);
    expect(audits.filter((x) => x.action === "po.submit").map((x) => (x.details as { attempt: number }).attempt)).toEqual([1, 2]);
    expect(pos).toHaveLength(1);
  });

  it("on a timeout marks needs_reconciliation and refuses a blind retry", async () => {
    const z = zoho({ createPurchaseOrder: vi.fn().mockRejectedValue(new ZohoAmbiguousError("No response from Zoho (timed out).")) });
    expect((await errOf(createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true })))!.status).toBe(504);
    expect(pos[0].status).toBe("needs_reconciliation");
    expect(recs.find((x) => x.id === "r1")!.po_status).toBe("needs_reconciliation");
    // retry is blocked (recommendation not ready) until reconciled
    expect((await errOf(createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true })))!.status).toBe(422);
    expect(z.createPurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it("reconciliation adopts the PO Zoho actually created", async () => {
    const z = zoho({ createPurchaseOrder: vi.fn().mockRejectedValue(new ZohoAmbiguousError("timed out")) });
    await errOf(createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true }));
    (z.findByReference as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ ...created, purchaseorder_id: "Z9", reference_number: pos[0].reference_number }]);
    const r = await reconcilePo(store(), z, "p@x", pos[0].id);
    expect(r.result).toBe("found");
    expect(r.po.zoho_purchaseorder_id).toBe("Z9");
    expect(recs.find((x) => x.id === "r1")!.po_status).toBe("created");
  });

  it("reconciliation that finds nothing releases the recommendation for retry", async () => {
    const z = zoho({ createPurchaseOrder: vi.fn().mockRejectedValue(new ZohoAmbiguousError("timed out")) });
    await errOf(createDraftPo(store(), z, "p@x", { recommendation_ids: ["r1"], confirm: true }));
    const r = await reconcilePo(store(), z, "p@x", pos[0].id);
    expect(r.result).toBe("not_found");
    expect(recs.find((x) => x.id === "r1")!.po_status).toBe("failed");
  });

  it("preview shows exactly what would be sent, with totals", async () => {
    const p = await preparePo(store(), "org1", { recommendation_ids: ["r1", "r2"], confirm: false }, "p@x");
    expect(p.vendor_id).toBe("vA");
    expect(p.payload.line_items).toHaveLength(2);
    expect(p.total).toBe(2000);
    expect(p.payload.notes).toMatch(/Not issued/);
  });
});
