// UI wording must describe what the engine actually calculated.
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadCsvDir } from "@/lib/data/loadCsvDir";
import { computePlan } from "@/lib/planning/rules";
import { actionText, headline, HEALTH, productName, progress, reasons, weeks } from "@/lib/presentation";

const plan = computePlan(loadCsvDir(join(__dirname, "..", "data")).data, { today: new Date("2026-10-23T00:00:00Z") });
const sku = (id: string) => plan.skus.find((s) => s.sku_id === id)!;

describe("plain-language wording", () => {
  it("SKU001: running low and sales rising, with the real numbers", () => {
    const s = sku("SKU001");
    expect(HEALTH[s.status].label).toBe("Running low");
    expect(productName(s.sku_name)).toBe("Mango Drink 200ml");
    expect(headline(s)).toBe("About 3.4 weeks of stock left (target 6+)");
    expect(actionText(s)).toBe("Reorder 750 units");
    expect(reasons(s, "2026-10")).toEqual([
      "Stock will last about 3.4 weeks. The target is at least 6 weeks.",
      "Sales are up 21% over the last 4 weeks.",
      "Demand includes +25% for October festivals.",
    ]);
  });

  it("perishable overstock (SKU007) explains its 3–4 week limits", () => {
    const s = sku("SKU007");
    expect(HEALTH[s.status].label).toBe("Excess stock");
    expect(actionText(s)).toBe("Pause next order");
    expect(reasons(s, "2026-10")).toContain("Perishable product: keep 3–4 weeks of stock.");
    expect(reasons(s)[0]).toBe("There is about 4.1 weeks of stock — more than the 4-week maximum.");
  });

  it("healthy products say they are on target", () => {
    expect(headline(sku("SKU002"))).toMatch(/on target$/);
    expect(weeks(1)).toBe("1 week");
    expect(weeks(null)).toBe("–");
  });

  it("order progress uses one vocabulary", () => {
    expect(progress({ decision: "pending", po_status: "not_applicable", approved_qty: null }).label).toBe("Recommended");
    expect(progress({ decision: "approved", po_status: "ready", approved_qty: 750 }, { mapped: false }).label).toBe("Approved");
    expect(progress({ decision: "approved", po_status: "ready", approved_qty: 750 }, { mapped: true }).label).toBe("Ready for PO");
    expect(progress({ decision: "approved", po_status: "submitting", approved_qty: 750 }).label).toBe("Creating PO");
    expect(progress({ decision: "approved", po_status: "created", approved_qty: 750 }).label).toBe("PO created");
    expect(progress({ decision: "approved", po_status: "failed", approved_qty: 750 }).label).toBe("PO failed");
    expect(progress({ decision: "approved", po_status: "not_applicable", approved_qty: 0 }).label).toBe("Pause approved");
  });
});
