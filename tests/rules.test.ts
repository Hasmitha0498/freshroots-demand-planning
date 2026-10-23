import { describe, expect, it } from "vitest";
import {
  computePlan,
  computeSkuPlan,
  coverageLimits,
  evaluateQuantity,
  FESTIVAL_UPLIFT,
  isDemandSpike,
  isOverstockRisk,
  isStockoutRisk,
  NO_UPLIFT,
  resolveFestival,
  spikeQuantity,
} from "@/lib/planning/rules";
import { parseIsoWeek, precedingWeeks } from "@/lib/planning/isoWeek";
import type { SalesRow, SkuRow, SourceData } from "@/lib/planning/types";

const LATEST = parseIsoWeek("2026-W42")!;
const WEEKS = precedingWeeks(LATEST, 12);

function sku(over: Partial<SkuRow> = {}): SkuRow {
  return {
    sku_id: "T1",
    sku_name: "Test",
    category: "Snack",
    perishability: "Low",
    standard_reorder_qty: 100,
    unit_of_measure: "Units",
    distributor_id: "D1",
    ...over,
  };
}

/** 12 weeks: first 8 at `older`, last 4 at `recent`. */
function sales(older: number, recent = older, id = "T1"): SalesRow[] {
  return WEEKS.map((week, i) => ({ sku_id: id, week, units_sold: i < 8 ? older : recent }));
}

function plan(opts: {
  older: number;
  recent?: number;
  stock: number;
  festival?: boolean;
  perishability?: string;
  salesRows?: SalesRow[];
}) {
  return computeSkuPlan({
    sku: sku({ perishability: opts.perishability ?? "Low" }),
    sales: opts.salesRows ?? sales(opts.older, opts.recent),
    inventory: { sku_id: "T1", location: "WH", units_on_hand: opts.stock, as_of_date: "2026-10-19" },
    latestWeek: LATEST,
    festival: { applied: opts.festival ?? false, source: "calendar" },
    planningMonth: "2026-10",
  });
}

describe("Rule 1 · demand spike", () => {
  it("is strict: exactly +20% is not a spike", () => {
    // avg12 = 100, avg4 = 120 → exactly +20%
    // older 8 weeks at x, recent 4 at y: avg12 = (8x+4y)/12. x=90,y=120 → avg12=100, avg4=120.
    expect(isDemandSpike(4 * 120, 8 * 90 + 4 * 120)).toBe(false);
    expect(isDemandSpike(4 * 120 + 1, 8 * 90 + 4 * 120 + 1)).toBe(true);
    expect(plan({ older: 90, recent: 120, stock: 1000 }).flags.demand_spike).toBe(false);
  });

  it("flags > 20% and proposes 1.5 × standard rounded up", () => {
    const p = plan({ older: 90, recent: 130, stock: 1000 });
    expect(p.flags.demand_spike).toBe(true);
    expect(p.action).toBe("reorder_high_demand");
    expect(p.proposed_qty).toBe(150);
    expect(spikeQuantity(75)).toBe(113);
  });

  it("does not inflate the 4w/12w ratio with the festival uplift", () => {
    const a = plan({ older: 90, recent: 120, stock: 1000, festival: false });
    const b = plan({ older: 90, recent: 120, stock: 1000, festival: true });
    expect(a.pct_change).toBe(b.pct_change);
    expect(b.flags.demand_spike).toBe(false);
  });
});

describe("Rules 2 & 3 · coverage thresholds", () => {
  it("exactly 6 weeks is not a stockout; just under is", () => {
    // avg12 = 100 → 6 weeks = 600
    expect(plan({ older: 100, stock: 600 }).flags.stockout_risk).toBe(false);
    expect(plan({ older: 100, stock: 599 }).flags.stockout_risk).toBe(true);
    expect(plan({ older: 100, stock: 599 }).action).toBe("reorder_immediately");
    expect(plan({ older: 100, stock: 599 }).proposed_qty).toBe(100);
  });

  it("exactly 14 weeks is not overstock; just over is", () => {
    expect(plan({ older: 100, stock: 1400 }).flags.overstock_risk).toBe(false);
    const p = plan({ older: 100, stock: 1401 });
    expect(p.flags.overstock_risk).toBe(true);
    expect(p.action).toBe("pause_next_order");
    expect(p.proposed_qty).toBe(0);
  });

  it("weeks of cover uses adjusted demand", () => {
    const p = plan({ older: 100, stock: 1000, festival: true });
    expect(p.baseline_weekly_demand).toBe(100);
    expect(p.adjusted_weekly_demand).toBe(125);
    expect(p.weeks_of_cover).toBe(8);
  });
});

describe("Rule 4 · festival uplift", () => {
  it("applies 25% before the coverage check, exactly once", () => {
    // 650 units: 6.5 weeks unadjusted (OK), 5.2 weeks adjusted (stockout)
    expect(plan({ older: 100, stock: 650 }).flags.stockout_risk).toBe(false);
    const f = plan({ older: 100, stock: 650, festival: true });
    expect(f.flags.stockout_risk).toBe(true);
    expect(f.flags.festival_adjustment).toBe(true);
    expect(f.uplift_factor).toBe(1.25);
    // boundary: 750 = exactly 6 weeks of 125 → not stockout
    expect(plan({ older: 100, stock: 750, festival: true }).flags.stockout_risk).toBe(false);
    expect(isStockoutRisk(749, 1200, FESTIVAL_UPLIFT, 6)).toBe(true);
    expect(isOverstockRisk(1750, 1200, FESTIVAL_UPLIFT, 14)).toBe(false);
    expect(isOverstockRisk(1751, 1200, FESTIVAL_UPLIFT, 14)).toBe(true);
  });

  it("resolves the month from the calendar, with documented fallback", () => {
    const cal = [{ year: 2026, month: 10, year_month: "2026-10", is_festival_month: true }, { year: 2026, month: 9, year_month: "2026-09", is_festival_month: false }];
    expect(resolveFestival("2026-10", cal)).toEqual({ applied: true, source: "calendar" });
    expect(resolveFestival("2026-09", cal)).toEqual({ applied: false, source: "calendar" });
    expect(resolveFestival("2027-03", cal)).toEqual({ applied: true, source: "fallback_rule" });
    expect(resolveFestival("2027-04", cal)).toEqual({ applied: false, source: "fallback_rule" });
    expect(resolveFestival(null, cal).applied).toBe(false);
  });
});

describe("Rule 5 · high perishability", () => {
  it("uses 3/4-week limits with exact boundaries", () => {
    expect(coverageLimits("High")).toEqual({ min: 3, max: 4 });
    expect(coverageLimits("Low")).toEqual({ min: 6, max: 14 });
    expect(plan({ older: 100, stock: 300, perishability: "High" }).flags.stockout_risk).toBe(false);
    expect(plan({ older: 100, stock: 299, perishability: "High" }).flags.stockout_risk).toBe(true);
    expect(plan({ older: 100, stock: 400, perishability: "High" }).flags.overstock_risk).toBe(false);
    const o = plan({ older: 100, stock: 401, perishability: "High" });
    expect(o.flags.overstock_risk).toBe(true);
    expect(o.triggered_rules).toContain("high_perishability");
    // the same 401 units would be a stockout for a Low SKU
    expect(plan({ older: 100, stock: 401 }).flags.stockout_risk).toBe(true);
  });
});

describe("overlaps, conflicts and edge cases", () => {
  it("keeps both flags when spike + stockout fire together", () => {
    const p = plan({ older: 90, recent: 130, stock: 100 });
    expect(p.flags.demand_spike && p.flags.stockout_risk).toBe(true);
    expect(p.triggered_rules).toEqual(expect.arrayContaining(["demand_spike", "stockout_risk"]));
    expect(p.status).toBe("stockout");
    expect(p.proposed_qty).toBe(150);
  });

  it("spike + overstock → manual review, no automatic quantity", () => {
    const p = plan({ older: 90, recent: 130, stock: 5000 });
    expect(p.flags.demand_spike && p.flags.overstock_risk).toBe(true);
    expect(p.status).toBe("conflict");
    expect(p.action).toBe("manual_review");
    expect(p.proposed_qty).toBeNull();
  });

  it("handles zero sales without NaN/Infinity", () => {
    const withStock = plan({ older: 0, stock: 50 });
    expect(withStock.weeks_of_cover).toBeNull();
    expect(withStock.pct_change).toBeNull();
    expect(withStock.flags.demand_spike).toBe(false);
    expect(withStock.flags.overstock_risk).toBe(true);
    expect(withStock.warnings.join(" ")).toMatch(/Zero sales/);
    const empty = plan({ older: 0, stock: 0 });
    expect(empty.flags.stockout_risk || empty.flags.overstock_risk).toBe(false);
    expect(JSON.stringify(empty)).not.toMatch(/NaN|Infinity/);
  });

  it("marks missing weeks as insufficient data", () => {
    const rows = sales(100).filter((r) => r.week !== "2026-W40");
    const p = plan({ older: 100, stock: 100, salesRows: rows });
    expect(p.status).toBe("insufficient_data");
    expect(p.proposed_qty).toBeNull();
    expect(p.warnings[0]).toMatch(/2026-W40/);
  });

  it("warns when the proposal does not restore minimum cover", () => {
    const p = plan({ older: 100, stock: 100 }); // std 100 → 200 units = 2 weeks
    expect(p.projected_cover_after_order).toBe(2);
    expect(p.warnings.join(" ")).toMatch(/below the 6-week minimum/);
  });

  it("evaluates planner edits", () => {
    const p = plan({ older: 100, stock: 100 });
    expect(evaluateQuantity(p, 0).errors).toContain("Order quantity must be greater than zero.");
    expect(evaluateQuantity(p, -5).errors.length).toBe(1);
    expect(evaluateQuantity(p, 1.5).errors).toContain("Quantity must be a whole number.");
    const ok = evaluateQuantity(p, 500);
    expect(ok.errors).toEqual([]);
    expect(ok.projected_cover).toBe(6);
    expect(ok.warnings.some((w) => w.startsWith("Differs"))).toBe(true);
    expect(evaluateQuantity(p, 2000).warnings.join(" ")).toMatch(/above the 14-week maximum/);
    expect(isStockoutRisk(600, 1200, NO_UPLIFT, 6)).toBe(false);
  });
});

describe("computePlan with dirty data", () => {
  const base: SourceData = {
    skus: [sku(), sku({ sku_id: "T2" })],
    sales: [...sales(100), ...sales(100, 100, "T2")],
    inventory: [
      { sku_id: "T1", location: "WH", units_on_hand: 1000, as_of_date: "2026-10-19" },
      { sku_id: "T2", location: "WH", units_on_hand: 1000, as_of_date: "2026-10-19" },
    ],
    distributors: [{ distributor_id: "D1", distributor_name: "D", region: "R", status: "Active" }],
    festivals: [{ year: 2026, month: 10, year_month: "2026-10", is_festival_month: true }],
  };

  it("flags duplicate weeks and negative stock per SKU without breaking others", () => {
    const dirty: SourceData = {
      ...base,
      sales: [...base.sales, { sku_id: "T1", week: "2026-W42", units_sold: 5 }],
      inventory: [base.inventory[0], { ...base.inventory[1], units_on_hand: -3 }],
    };
    const r = computePlan(dirty, { today: new Date("2026-10-23T00:00:00Z") });
    expect(r.issues.some((i) => i.message.includes("Duplicate SKU/week"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("Units_On_Hand"))).toBe(true);
    expect(r.counts.insufficient_data).toBe(2);
  });

  it("uses the snapshot month, not today, and reports staleness", () => {
    const r = computePlan(base, { today: new Date("2027-01-15T00:00:00Z") });
    expect(r.snapshot.planning_month).toBe("2026-10");
    expect(r.snapshot.festival_applied).toBe(true);
    expect(r.snapshot.is_stale).toBe(true);
    const fresh = computePlan(base, { today: new Date("2026-10-23T00:00:00Z") });
    expect(fresh.snapshot.data_age_days).toBe(4);
    expect(fresh.snapshot.is_stale).toBe(false);
  });

  it("flags malformed weeks and unknown references", () => {
    const r = computePlan(
      { ...base, sales: [...base.sales, { sku_id: "T2", week: "2026-42", units_sold: 1 }, { sku_id: "ZZ", week: "2026-W42", units_sold: 1 }], skus: [...base.skus, sku({ sku_id: "T3", distributor_id: "NOPE" })] },
      { today: new Date("2026-10-23T00:00:00Z") },
    );
    const msgs = r.issues.map((i) => i.message).join("|");
    expect(msgs).toMatch(/Malformed ISO week/);
    expect(msgs).toMatch(/not found in sku_master/);
    expect(msgs).toMatch(/not found in distributor_master/);
    expect(msgs).toMatch(/No inventory record/);
  });
});
