import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { validateDecision, type RecommendationState } from "@/lib/planning/decisions";
import { loadCsvDir } from "@/lib/data/loadCsvDir";
import { computePlan } from "@/lib/planning/rules";
import { runPlanning, type PlanningStore } from "@/lib/server/planningService";

const plan = computePlan(loadCsvDir(join(__dirname, "..", "data")).data, { today: new Date("2026-10-23T00:00:00Z") });
const get = (id: string) => plan.skus.find((s) => s.sku_id === id)!;
const rec = (id: string, over: Partial<RecommendationState> = {}): RecommendationState => ({
  decision: "pending",
  po_status: "not_applicable",
  proposed_qty: get(id).proposed_qty,
  calculation: get(id),
  ...over,
});

describe("planner decisions", () => {
  it("approves the proposal as-is only with confirmation", () => {
    expect(validateDecision(rec("SKU001"), { decision: "approved" }).errors).toContain("Approval must be explicitly confirmed.");
    const r = validateDecision(rec("SKU001"), { decision: "approved", confirm: true });
    expect(r.ok).toBe(true);
    expect(r.update).toMatchObject({ approved_qty: 750, po_status: "ready", override_reason: null });
  });

  it("requires an override reason for edits and blocks zero/negative orders", () => {
    expect(validateDecision(rec("SKU003"), { decision: "approved", confirm: true, quantity: 400 }).ok).toBe(false);
    const ok = validateDecision(rec("SKU003"), { decision: "approved", confirm: true, quantity: 400, override_reason: "Restore 6 weeks cover" });
    expect(ok.ok).toBe(true);
    expect(ok.update?.override_reason).toBe("Restore 6 weeks cover");
    expect(validateDecision(rec("SKU003"), { decision: "approved", confirm: true, quantity: 0, override_reason: "zero please" }).ok).toBe(false);
    expect(validateDecision(rec("SKU003"), { decision: "approved", confirm: true, quantity: -5, override_reason: "negative" }).ok).toBe(false);
  });

  it("warns when an edit breaks coverage rules", () => {
    const r = validateDecision(rec("SKU011"), { decision: "approved", confirm: true, quantity: 2000, override_reason: "Bulk buy test" });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/High-perishability/);
  });

  it("approving a pause records qty 0 with no PO", () => {
    const r = validateDecision(rec("SKU006"), { decision: "approved", confirm: true });
    expect(r.update).toMatchObject({ approved_qty: 0, po_status: "not_applicable" });
  });

  it("locks decisions once a PO is in flight or created, and on superseded runs", () => {
    expect(validateDecision(rec("SKU001", { decision: "approved", po_status: "created" }), { decision: "rejected" }).ok).toBe(false);
    expect(validateDecision(rec("SKU001", { decision: "approved", po_status: "submitting" }), { decision: "rejected" }).ok).toBe(false);
    expect(validateDecision(rec("SKU001", { decision: "superseded" }), { decision: "approved", confirm: true }).ok).toBe(false);
    expect(validateDecision(rec("SKU001", { decision: "approved", po_status: "ready" }), { decision: "needs_review" }).update?.po_status).toBe("not_applicable");
  });

  it("reject and mark-for-review never make a recommendation PO-eligible", () => {
    expect(validateDecision(rec("SKU001"), { decision: "rejected" }).update?.po_status).toBe("not_applicable");
    expect(validateDecision(rec("SKU001"), { decision: "needs_review", note: "check promo" }).update).toMatchObject({ decision: "needs_review", decision_note: "check promo" });
  });
});

describe("runPlanning reads from the store (Supabase in production)", () => {
  it("computes from whatever the store returns and saves the run", async () => {
    const data = loadCsvDir(join(__dirname, "..", "data")).data;
    let loads = 0;
    let saved: unknown = null;
    const store: PlanningStore = {
      async loadSourceData() {
        loads++;
        // simulate an updated SAP snapshot: SKU002 stock drops
        return { ...data, inventory: data.inventory.map((i) => (i.sku_id === "SKU002" ? { ...i, units_on_hand: 100 } : i)) };
      },
      async saveRun(p) {
        saved = p;
        return { runId: "run-1" };
      },
    };
    const { runId, plan: p } = await runPlanning(store, { id: null, name: "Test Planner" }, new Date("2026-10-23T00:00:00Z"));
    expect(loads).toBe(1);
    expect(runId).toBe("run-1");
    expect(saved).toBe(p);
    expect(p.counts.stockout_risk).toBe(6); // the store's data, not a hardcoded array
  });

  it("refuses to plan on an empty database", async () => {
    const store: PlanningStore = {
      loadSourceData: async () => ({ skus: [], sales: [], inventory: [], distributors: [], festivals: [] }),
      saveRun: async () => ({ runId: "x" }),
    };
    await expect(runPlanning(store, { id: null, name: "Test Planner" })).rejects.toThrow(/db:seed/);
  });
});
