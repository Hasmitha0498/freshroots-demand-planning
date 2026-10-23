// Raghav's five documented planning rules as pure, deterministic functions.
// No I/O here: the same code runs in tests, on the server and in the browser
// (for quantity-edit warnings).

import {
  compareIsoWeeks,
  isoWeekEndDate,
  parseIsoWeek,
  precedingWeeks,
  type IsoWeek,
} from "./isoWeek";
import { validateSourceData } from "./validate";
import type {
  DataIssue,
  FestivalRow,
  InventoryRow,
  PlanAction,
  PlanCounts,
  PlanResult,
  RiskStatus,
  RuleId,
  SalesRow,
  SkuPlan,
  SkuRow,
  SourceData,
} from "./types";

export const RULES_VERSION = "freshroots-rules-v1";

export const SHORT_WINDOW_WEEKS = 4;
export const LONG_WINDOW_WEEKS = 12;
/** Rule 1: latest-4w average must exceed latest-12w average by MORE than this %. */
export const SPIKE_THRESHOLD_PCT = 20;
/** Rule 1 quantity: multiplier on the standard reorder quantity (as a fraction). */
export const SPIKE_QTY_NUM = 3;
export const SPIKE_QTY_DEN = 2;
/** Rule 4: festival uplift applied to projected weekly demand. */
export const FESTIVAL_UPLIFT_PCT = 25;
/** Rule 4 fallback when the calendar has no row for the planning month. */
export const FALLBACK_FESTIVAL_MONTHS = [3, 10, 11];
/** Rules 2, 3 and 5: weeks-of-cover limits. */
export const STANDARD_COVER = { min: 6, max: 14 } as const;
export const HIGH_PERISHABILITY_COVER = { min: 3, max: 4 } as const;
/** Snapshot older than this (vs. today) is flagged stale. */
export const STALE_AFTER_DAYS = 7;

// User-facing wording for statuses, actions and rules lives in lib/presentation.ts.

const STATUS_PRIORITY: Record<RiskStatus, number> = {
  stockout: 1,
  conflict: 2,
  insufficient_data: 3,
  demand_spike: 4,
  overstock: 5,
  ok: 9,
};

// ---------------------------------------------------------------------------
// Individual rules. All comparisons are done on integer sums so that boundary
// cases (exactly +20%, exactly 6 / 14 / 3 / 4 weeks) are decided exactly,
// without floating-point drift.
// ---------------------------------------------------------------------------

/**
 * Rule 1. avg_4w > avg_12w × (1 + T/100)
 *   ⇔ (sum4 / 4) × 100 > (sum12 / 12) × (100 + T)
 *   ⇔ sum4 × 12 × 100 > sum12 × 4 × (100 + T)
 * Exactly +T% is NOT a spike.
 */
export function isDemandSpike(sum4: number, sum12: number): boolean {
  return (
    sum4 * LONG_WINDOW_WEEKS * 100 >
    sum12 * SHORT_WINDOW_WEEKS * (100 + SPIKE_THRESHOLD_PCT)
  );
}

/** Uplift as an exact fraction num/den (125/100 in festival months, else 1/1). */
export interface Uplift {
  num: number;
  den: number;
}
export const NO_UPLIFT: Uplift = { num: 1, den: 1 };
export const FESTIVAL_UPLIFT: Uplift = { num: 100 + FESTIVAL_UPLIFT_PCT, den: 100 };

/**
 * Compares stock with `weeks` × adjusted weekly demand, exactly.
 * adjusted demand = (sum12 / 12) × num / den, so
 * stock ? weeks × demand ⇔ stock × 12 × den ? weeks × sum12 × num.
 * Returns <0, 0 or >0.
 */
export function compareStockToCover(stock: number, weeks: number, sum12: number, uplift: Uplift): number {
  return stock * LONG_WINDOW_WEEKS * uplift.den - weeks * sum12 * uplift.num;
}

/** Rule 2: stock strictly below `min` weeks of adjusted demand. */
export function isStockoutRisk(stock: number, sum12: number, uplift: Uplift, minWeeks: number): boolean {
  return compareStockToCover(stock, minWeeks, sum12, uplift) < 0;
}

/** Rule 3: stock strictly above `max` weeks of adjusted demand. */
export function isOverstockRisk(stock: number, sum12: number, uplift: Uplift, maxWeeks: number): boolean {
  return compareStockToCover(stock, maxWeeks, sum12, uplift) > 0;
}

/** Rule 5: High perishability swaps the 6/14 limits for 3/4. */
export function coverageLimits(perishability: string): { min: number; max: number } {
  return perishability === "High" ? HIGH_PERISHABILITY_COVER : STANDARD_COVER;
}

/** Rule 4: is the planning month a festival month? Calendar first, documented months as fallback. */
export function resolveFestival(
  planningMonth: string | null,
  festivals: FestivalRow[],
): { applied: boolean; source: "calendar" | "fallback_rule" | "none" } {
  if (!planningMonth) return { applied: false, source: "none" };
  const row = festivals.find((f) => f.year_month === planningMonth);
  if (row && typeof row.is_festival_month === "boolean") {
    return { applied: row.is_festival_month, source: "calendar" };
  }
  const month = Number(planningMonth.slice(5, 7));
  return { applied: FALLBACK_FESTIVAL_MONTHS.includes(month), source: "fallback_rule" };
}

/** Rule 1 quantity: 1.5 × standard, rounded up to a whole unit. */
export function spikeQuantity(standardQty: number): number {
  return Math.ceil((standardQty * SPIKE_QTY_NUM) / SPIKE_QTY_DEN);
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function fmt(n: number, dp = 1): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// ---------------------------------------------------------------------------
// Per-SKU evaluation
// ---------------------------------------------------------------------------

export interface SkuPlanInput {
  sku: SkuRow;
  sales: SalesRow[];
  inventory: InventoryRow | undefined;
  latestWeek: IsoWeek | null;
  festival: { applied: boolean; source: "calendar" | "fallback_rule" | "none" };
  planningMonth: string | null;
  invalid?: boolean;
}

export function computeSkuPlan(input: SkuPlanInput): SkuPlan {
  const { sku, inventory, latestWeek, festival } = input;
  const limits = coverageLimits(sku.perishability);
  const uplift = festival.applied ? FESTIVAL_UPLIFT : NO_UPLIFT;
  const upliftFactor = uplift.num / uplift.den;

  const history = input.sales
    .map((r) => ({ r, w: parseIsoWeek(r.week) }))
    .filter((x): x is { r: SalesRow; w: IsoWeek } => x.w !== null)
    .sort((a, b) => compareIsoWeeks(a.w, b.w))
    .map(({ r }) => ({ week: r.week, units_sold: r.units_sold }));

  const flags: Record<RuleId, boolean> = {
    demand_spike: false,
    stockout_risk: false,
    overstock_risk: false,
    festival_adjustment: festival.applied,
    high_perishability: sku.perishability === "High",
  };

  const base: SkuPlan = {
    sku_id: sku.sku_id,
    sku_name: sku.sku_name,
    category: sku.category,
    perishability: sku.perishability,
    standard_reorder_qty: sku.standard_reorder_qty,
    unit_of_measure: sku.unit_of_measure,
    distributor_id: sku.distributor_id,
    location: inventory?.location ?? null,
    units_on_hand: inventory?.units_on_hand ?? null,
    weeks_used: [],
    history,
    sum_4w: null,
    sum_12w: null,
    avg_4w: null,
    avg_12w: null,
    pct_change: null,
    festival_applied: festival.applied,
    uplift_factor: upliftFactor,
    baseline_weekly_demand: null,
    adjusted_weekly_demand: null,
    weeks_of_cover: null,
    min_cover_weeks: limits.min,
    max_cover_weeks: limits.max,
    flags,
    triggered_rules: [],
    status: "insufficient_data",
    action: "insufficient_data",
    priority: STATUS_PRIORITY.insufficient_data,
    proposed_qty: null,
    projected_cover_after_order: null,
    warnings: [],
    explanation: [],
  };

  const insufficient = (reason: string): SkuPlan => {
    base.warnings.push(reason);
    base.explanation.push(`Not evaluated: ${reason}. Fix the source data and re-run.`);
    base.triggered_rules = (Object.keys(flags) as RuleId[]).filter((k) => flags[k]);
    return base;
  };

  if (input.invalid) return insufficient("source data for this SKU failed validation (see data issues)");
  if (!inventory) return insufficient("no current inventory record");
  if (!latestWeek) return insufficient("no valid weekly sales in the dataset");

  // Exactly the 12 consecutive ISO weeks ending at the dataset's latest week.
  const required = precedingWeeks(latestWeek, LONG_WINDOW_WEEKS);
  const byWeek = new Map(history.map((h) => [h.week, h.units_sold]));
  const missing = required.filter((w) => !byWeek.has(w));
  if (missing.length > 0) {
    return insufficient(
      `missing sales for ${missing.length} of the latest ${LONG_WINDOW_WEEKS} weeks (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""})`,
    );
  }

  const units12 = required.map((w) => byWeek.get(w)!);
  const sum12 = units12.reduce((a, b) => a + b, 0);
  const sum4 = units12.slice(-SHORT_WINDOW_WEEKS).reduce((a, b) => a + b, 0);
  const avg4 = sum4 / SHORT_WINDOW_WEEKS;
  const avg12 = sum12 / LONG_WINDOW_WEEKS;
  const adjusted = avg12 * upliftFactor;
  const stock = inventory.units_on_hand;

  base.weeks_used = required;
  base.sum_4w = sum4;
  base.sum_12w = sum12;
  base.avg_4w = round(avg4);
  base.avg_12w = round(avg12);
  base.pct_change = sum12 === 0 ? null : round((avg4 / avg12 - 1) * 100);
  base.baseline_weekly_demand = round(avg12);
  base.adjusted_weekly_demand = round(adjusted);
  base.weeks_of_cover = adjusted > 0 ? round(stock / adjusted) : null;

  flags.demand_spike = isDemandSpike(sum4, sum12);
  flags.stockout_risk = isStockoutRisk(stock, sum12, uplift, limits.min);
  flags.overstock_risk = isOverstockRisk(stock, sum12, uplift, limits.max);

  const exp = base.explanation;
  // Rule 1
  exp.push(
    sum12 === 0
      ? "Rule 1: no sales in the latest 12 weeks, so a 4w-vs-12w change cannot be computed; no spike."
      : `Rule 1: 4-week avg ${fmt(avg4)} vs 12-week avg ${fmt(avg12)} (${base.pct_change! >= 0 ? "+" : ""}${fmt(base.pct_change!)}%) — ${
          flags.demand_spike ? `exceeds +${SPIKE_THRESHOLD_PCT}%: demand spike` : `does not exceed +${SPIKE_THRESHOLD_PCT}%`
        }. (Unadjusted history; festival uplift is not applied to this ratio.)`,
  );
  // Rule 4
  exp.push(
    festival.applied
      ? `Rule 4: ${input.planningMonth} is a festival month (${festival.source === "calendar" ? "festival calendar" : "documented Oct/Nov/Mar fallback"}): projected weekly demand ${fmt(avg12)} × ${upliftFactor} = ${fmt(adjusted)}.`
      : `Rule 4: ${input.planningMonth ?? "planning month unknown"} is not a festival month; projected weekly demand = 12-week avg ${fmt(avg12)}.`,
  );
  // Rule 5
  exp.push(
    flags.high_perishability
      ? `Rule 5: High perishability — coverage limits ${limits.min}–${limits.max} weeks replace 6–14.`
      : `Coverage limits ${limits.min}–${limits.max} weeks (${sku.perishability} perishability).`,
  );
  // Rules 2 & 3
  if (adjusted > 0) {
    const cover = stock / adjusted;
    exp.push(
      `Weeks of cover = ${stock.toLocaleString("en-IN")} ÷ ${fmt(adjusted)} = ${fmt(cover, 2)} weeks — ${
        flags.stockout_risk
          ? `below the ${limits.min}-week minimum: stockout risk (Rule 2)`
          : flags.overstock_risk
            ? `above the ${limits.max}-week maximum: overstock risk (Rule 3)`
            : `within ${limits.min}–${limits.max} weeks`
      }.`,
    );
  } else {
    exp.push(
      stock > 0
        ? `No demand in the latest 12 weeks with ${stock} units on hand — any stock exceeds the ${limits.max}-week maximum: overstock risk (Rule 3).`
        : "No demand and no stock: no coverage risk.",
    );
    base.warnings.push("Zero sales in the last 12 weeks — check whether this product is discontinued or data is missing.");
  }

  // Combine flags into one status/action. All flags stay stored.
  let status: RiskStatus;
  let action: PlanAction;
  let qty: number | null;
  if (flags.demand_spike && flags.overstock_risk) {
    status = "conflict";
    action = "manual_review";
    qty = null;
    exp.push("Conflict: demand spike suggests ordering more, but stock is already above the maximum cover. Manual review needed — no quantity is proposed automatically.");
  } else if (flags.stockout_risk) {
    status = "stockout";
    action = "reorder_immediately";
    qty = flags.demand_spike ? spikeQuantity(sku.standard_reorder_qty) : sku.standard_reorder_qty;
    exp.push(
      flags.demand_spike
        ? `Proposed order: 1.5 × standard ${sku.standard_reorder_qty} = ${qty} units (Rule 1 quantity, immediate per Rule 2).`
        : `Proposed order: standard reorder quantity ${qty} units as a starting proposal (not an optimised requirement).`,
    );
  } else if (flags.demand_spike) {
    status = "demand_spike";
    action = "reorder_high_demand";
    qty = spikeQuantity(sku.standard_reorder_qty);
    exp.push(`Proposed order: 1.5 × standard ${sku.standard_reorder_qty} = ${qty} units (Rule 1).`);
  } else if (flags.overstock_risk) {
    status = "overstock";
    action = "pause_next_order";
    qty = 0;
    exp.push("Recommendation: pause the next order (Rule 3).");
  } else {
    status = "ok";
    action = "no_action";
    qty = 0;
  }

  base.status = status;
  base.action = action;
  base.priority = STATUS_PRIORITY[status];
  base.proposed_qty = qty;
  base.triggered_rules = (Object.keys(flags) as RuleId[]).filter((k) => flags[k]);

  if (qty && qty > 0) {
    const q = evaluateQuantity(base, qty);
    base.projected_cover_after_order = q.projected_cover;
    base.warnings.push(...q.warnings.filter((w) => !w.startsWith("Differs")));
  }
  return base;
}

// ---------------------------------------------------------------------------
// Quantity checks (used for proposals and for planner edits)
// ---------------------------------------------------------------------------

export interface QuantityCheck {
  errors: string[];
  warnings: string[];
  projected_cover: number | null;
}

export function evaluateQuantity(
  plan: Pick<
    SkuPlan,
    | "units_on_hand"
    | "sum_12w"
    | "festival_applied"
    | "uplift_factor"
    | "adjusted_weekly_demand"
    | "min_cover_weeks"
    | "max_cover_weeks"
    | "proposed_qty"
    | "action"
    | "flags"
  >,
  qty: number,
): QuantityCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Number.isFinite(qty) || !Number.isInteger(qty)) errors.push("Quantity must be a whole number.");
  else if (qty <= 0) errors.push("Order quantity must be greater than zero.");
  if (errors.length || plan.units_on_hand === null || plan.sum_12w === null) {
    return { errors, warnings, projected_cover: null };
  }
  const uplift = plan.festival_applied ? FESTIVAL_UPLIFT : NO_UPLIFT;
  const after = plan.units_on_hand + qty;
  const demand = plan.adjusted_weekly_demand ?? 0;
  const projected = demand > 0 ? round(after / demand) : null;

  if (plan.proposed_qty !== null && qty !== plan.proposed_qty)
    warnings.push(`Differs from the rule-based proposal of ${plan.proposed_qty} units — an override reason is required.`);
  if (compareStockToCover(after, plan.min_cover_weeks, plan.sum_12w, uplift) < 0)
    warnings.push(
      `${qty.toLocaleString("en-IN")} units only brings stock to about ${projected ?? "–"} weeks — below the ${plan.min_cover_weeks}-week minimum. Consider ordering more (lead times and open orders aren't in the data).`,
    );
  if (compareStockToCover(after, plan.max_cover_weeks, plan.sum_12w, uplift) > 0)
    warnings.push(
      `${qty.toLocaleString("en-IN")} units would bring stock to about ${projected ?? "∞"} weeks — above the ${plan.max_cover_weeks}-week maximum${plan.flags.high_perishability ? " for a High-perishability product, so some may expire" : ", which risks excess stock"}.`,
    );
  if (plan.action === "pause_next_order")
    warnings.push("The rules suggest pausing orders for this product because stock is already high.");
  return { errors, warnings, projected_cover: projected };
}

// ---------------------------------------------------------------------------
// Whole-run evaluation
// ---------------------------------------------------------------------------

function daysBetween(fromIsoDate: string, to: Date): number {
  const from = Date.UTC(+fromIsoDate.slice(0, 4), +fromIsoDate.slice(5, 7) - 1, +fromIsoDate.slice(8, 10));
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((toUtc - from) / 86_400_000);
}

export function computePlan(src: SourceData, opts: { today: Date }): PlanResult {
  const { issues, invalidSkus } = validateSourceData(src);
  const allIssues: DataIssue[] = [...issues];

  const validWeeks = src.sales
    .map((r) => parseIsoWeek(r.week))
    .filter((w): w is IsoWeek => w !== null)
    .sort(compareIsoWeeks);
  const latestWeek = validWeeks.at(-1) ?? null;
  const earliestWeek = validWeeks[0] ?? null;
  const distinctWeeks = new Set(validWeeks.map((w) => `${w.year}-${w.week}`)).size;

  const asOfDates = src.inventory.map((i) => i.as_of_date).filter(Boolean).sort();
  const asOf = asOfDates.at(-1) ?? null;
  // Planning period = month of the data snapshot, not today's system date.
  const planningMonth = asOf ? asOf.slice(0, 7) : null;
  const festival = resolveFestival(planningMonth, src.festivals);
  if (planningMonth && festival.source === "fallback_rule") {
    allIssues.push({
      severity: "warning",
      table: "festival_calendar",
      key: planningMonth,
      message: `No festival calendar row for ${planningMonth}; used the documented Oct/Nov/Mar rule (${festival.applied ? "festival" : "not festival"}).`,
    });
  }
  if (!asOf) allIssues.push({ severity: "error", table: "current_inventory", key: "*", message: "No inventory snapshot date available." });

  const latestWeekEnd = latestWeek ? isoWeekEndDate(latestWeek) : null;
  if (asOf && latestWeekEnd && daysBetween(latestWeekEnd, new Date(`${asOf}T00:00:00Z`)) > 7) {
    allIssues.push({
      severity: "warning",
      table: "weekly_sales",
      key: "*",
      message: `Latest sales week ends ${latestWeekEnd}, more than 7 days before the inventory snapshot ${asOf}.`,
    });
  }
  const dataAge = asOf ? daysBetween(asOf, opts.today) : null;
  const isStale = dataAge === null || dataAge > STALE_AFTER_DAYS;

  const salesBySku = new Map<string, SalesRow[]>();
  for (const r of src.sales) {
    const list = salesBySku.get(r.sku_id) ?? [];
    list.push(r);
    salesBySku.set(r.sku_id, list);
  }
  const invBySku = new Map(src.inventory.map((i) => [i.sku_id, i]));

  const skus = [...src.skus]
    .sort((a, b) => a.sku_id.localeCompare(b.sku_id))
    .map((sku) =>
      computeSkuPlan({
        sku,
        sales: salesBySku.get(sku.sku_id) ?? [],
        inventory: invBySku.get(sku.sku_id),
        latestWeek,
        festival,
        planningMonth,
        invalid: invalidSkus.has(sku.sku_id),
      }),
    );

  const counts: PlanCounts = {
    total_skus: skus.length,
    stockout_risk: skus.filter((s) => s.flags.stockout_risk).length,
    overstock_risk: skus.filter((s) => s.flags.overstock_risk).length,
    demand_spike: skus.filter((s) => s.flags.demand_spike).length,
    festival_adjusted: skus.filter((s) => s.festival_applied && s.status !== "insufficient_data").length,
    manual_review: skus.filter((s) => s.action === "manual_review").length,
    insufficient_data: skus.filter((s) => s.status === "insufficient_data").length,
    actionable: skus.filter((s) => s.status !== "ok").length,
  };

  return {
    rules_version: RULES_VERSION,
    snapshot: {
      as_of_date: asOf,
      latest_week: latestWeek ? `${latestWeek.year}-W${String(latestWeek.week).padStart(2, "0")}` : null,
      latest_week_end: latestWeekEnd,
      earliest_week: earliestWeek ? `${earliestWeek.year}-W${String(earliestWeek.week).padStart(2, "0")}` : null,
      weeks_of_history: distinctWeeks,
      planning_month: planningMonth,
      festival_applied: festival.applied,
      festival_source: festival.source,
      sku_count: src.skus.length,
      sales_rows: src.sales.length,
      data_age_days: dataAge,
      is_stale: isStale,
    },
    counts,
    issues: allIssues,
    skus: skus.sort((a, b) => a.priority - b.priority || a.sku_id.localeCompare(b.sku_id)),
  };
}
