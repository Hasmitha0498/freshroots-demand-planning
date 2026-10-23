// Baseline regression check against the supplied 2026-10 snapshot.
// The expected values below are computed independently (plain float maths on
// the raw CSV rows, no engine code) and then compared with the engine output.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadCsvDir } from "@/lib/data/loadCsvDir";
import { computePlan } from "@/lib/planning/rules";

const loaded = loadCsvDir(join(__dirname, "..", "data"));
const result = computePlan(loaded.data, { today: new Date("2026-10-23T00:00:00Z") });

function independent() {
  const { skus, sales, inventory, festivals } = loaded.data;
  const asOf = inventory[0].as_of_date;
  const festival = festivals.find((f) => f.year_month === asOf.slice(0, 7))!.is_festival_month;
  const out = { stockout: [] as string[], overstock: [] as string[], spike: [] as string[] };
  for (const s of skus) {
    // All weeks in this dataset are within 2026, so W-numbers sort numerically.
    const rows = sales.filter((r) => r.sku_id === s.sku_id).sort((a, b) => Number(a.week.slice(6)) - Number(b.week.slice(6)));
    const last12 = rows.slice(-12).map((r) => r.units_sold);
    const avg12 = last12.reduce((a, b) => a + b, 0) / 12;
    const avg4 = last12.slice(-4).reduce((a, b) => a + b, 0) / 4;
    const demand = avg12 * (festival ? 1.25 : 1);
    const stock = inventory.find((i) => i.sku_id === s.sku_id)!.units_on_hand;
    const [min, max] = s.perishability === "High" ? [3, 4] : [6, 14];
    if (avg4 > avg12 * 1.2) out.spike.push(s.sku_id);
    if (stock < min * demand) out.stockout.push(s.sku_id);
    if (stock > max * demand) out.overstock.push(s.sku_id);
  }
  return out;
}

describe("supplied dataset oracle", () => {
  it("loads all five files (festival file identified by headers)", () => {
    expect(loaded.missing).toEqual([]);
    expect(loaded.data.skus).toHaveLength(15);
    expect(loaded.data.sales).toHaveLength(240);
    expect(loaded.data.inventory).toHaveLength(15);
    expect(loaded.data.distributors).toHaveLength(4);
    expect(loaded.data.festivals).toHaveLength(24);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("snapshot: 2026-10 festival month, latest week 2026-W42, 16 weeks", () => {
    expect(result.snapshot).toMatchObject({
      as_of_date: "2026-10-19",
      latest_week: "2026-W42",
      earliest_week: "2026-W27",
      weeks_of_history: 16,
      planning_month: "2026-10",
      festival_applied: true,
      festival_source: "calendar",
    });
  });

  it("matches the independent calculation and the brief's oracle (5 / 2 / 1)", () => {
    const ind = independent();
    const engine = {
      stockout: result.skus.filter((s) => s.flags.stockout_risk).map((s) => s.sku_id).sort(),
      overstock: result.skus.filter((s) => s.flags.overstock_risk).map((s) => s.sku_id).sort(),
      spike: result.skus.filter((s) => s.flags.demand_spike).map((s) => s.sku_id).sort(),
    };
    expect(engine).toEqual(ind);
    expect(engine.stockout).toEqual(["SKU001", "SKU003", "SKU004", "SKU011", "SKU013"]);
    expect(engine.overstock).toEqual(["SKU006", "SKU007"]);
    expect(engine.spike).toEqual(["SKU001"]);
    expect(result.counts).toMatchObject({ total_skus: 15, stockout_risk: 5, overstock_risk: 2, demand_spike: 1, manual_review: 0 });
  });

  it("traces SKU001 end-to-end", () => {
    const s = result.skus.find((x) => x.sku_id === "SKU001")!;
    // W31..W42: 201+195+185+200+185+197+186+186+261+267+257+259 = 2579; last 4 = 1044
    expect(s.weeks_used[0]).toBe("2026-W31");
    expect(s.sum_12w).toBe(2579);
    expect(s.sum_4w).toBe(1044);
    expect(s.avg_4w).toBe(261);
    expect(s.avg_12w).toBe(214.92);
    expect(s.pct_change).toBe(21.44);
    expect(s.adjusted_weekly_demand).toBe(268.65);
    expect(s.weeks_of_cover).toBe(3.35);
    expect(s.status).toBe("stockout");
    expect(s.action).toBe("reorder_immediately");
    expect(s.proposed_qty).toBe(750);
    expect(s.projected_cover_after_order).toBe(6.14);
  });

  it("surfaces coverage warnings for SKUs where the standard qty falls short", () => {
    const s3 = result.skus.find((x) => x.sku_id === "SKU003")!;
    expect(s3.proposed_qty).toBe(300);
    expect(s3.warnings.join(" ")).toMatch(/below the 6-week minimum/);
    const s7 = result.skus.find((x) => x.sku_id === "SKU007")!;
    expect(s7.action).toBe("pause_next_order");
    expect(s7.min_cover_weeks).toBe(3);
  });
});
