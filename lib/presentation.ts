// Plain-language wording for the UI. One vocabulary for product health and
// one for order progress, used on every screen. Presentation only: no
// business rules live here.
import type { PlanAction, RiskStatus, RuleId, SkuPlan } from "./planning/types";

export type Tone = "red" | "amber" | "blue" | "violet" | "green" | "gray";

/** Product health (from the planning rules). */
export const HEALTH: Record<RiskStatus, { label: string; tone: Tone }> = {
  stockout: { label: "Running low", tone: "red" },
  conflict: { label: "Needs judgement", tone: "amber" },
  insufficient_data: { label: "Missing data", tone: "gray" },
  demand_spike: { label: "Sales rising", tone: "violet" },
  overstock: { label: "Excess stock", tone: "blue" },
  ok: { label: "Healthy", tone: "green" },
};

export const ACTION: Record<PlanAction, string> = {
  reorder_immediately: "Reorder now",
  reorder_high_demand: "Reorder",
  pause_next_order: "Pause next order",
  manual_review: "Decide quantity",
  no_action: "No action",
  insufficient_data: "Fix data first",
};

/** Rule names for the detailed calculation view. */
export const RULE: Record<RuleId, string> = {
  demand_spike: "Rule 1 · Sales spike",
  stockout_risk: "Rule 2 · Low stock",
  overstock_risk: "Rule 3 · Excess stock",
  festival_adjustment: "Rule 4 · Festival demand",
  high_perishability: "Rule 5 · Perishable",
};

/** "Freshroots Mango Drink 200ml" → "Mango Drink 200ml". */
export function productName(name: string): string {
  return name.replace(/^Freshroots\s+/i, "");
}

export function weeks(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${n === 1 ? "week" : "weeks"}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthName(yearMonth: string | null | undefined): string {
  const m = Number(yearMonth?.slice(5, 7));
  return m >= 1 && m <= 12 ? MONTHS[m - 1] : "this month";
}

type PlanFacts = Pick<
  SkuPlan,
  | "status"
  | "action"
  | "flags"
  | "weeks_of_cover"
  | "min_cover_weeks"
  | "max_cover_weeks"
  | "pct_change"
  | "units_on_hand"
  | "adjusted_weekly_demand"
  | "proposed_qty"
  | "warnings"
>;

/** What to do, in a few words: "Reorder 750 units". */
export function actionText(p: Pick<SkuPlan, "action" | "proposed_qty">): string {
  if ((p.action === "reorder_immediately" || p.action === "reorder_high_demand") && p.proposed_qty)
    return `Reorder ${p.proposed_qty.toLocaleString("en-IN")} units`;
  return ACTION[p.action];
}

/** One-line reason for lists. */
export function headline(p: PlanFacts): string {
  switch (p.status) {
    case "stockout":
      return `About ${weeks(p.weeks_of_cover)} of stock left (target ${p.min_cover_weeks}+)`;
    case "overstock":
      return p.adjusted_weekly_demand
        ? `About ${weeks(p.weeks_of_cover)} of stock (max ${p.max_cover_weeks})`
        : "No recent sales, but stock on hand";
    case "demand_spike":
      return `Sales up ${Math.round(p.pct_change ?? 0)}% in the last 4 weeks`;
    case "conflict":
      return "Sales rising, but stock is already high";
    case "insufficient_data":
      return "Not enough sales data to plan";
    default:
      return `About ${weeks(p.weeks_of_cover)} of stock — on target`;
  }
}

/** Plain explanation, most important first. */
export function reasons(p: PlanFacts, planningMonth?: string | null): string[] {
  const out: string[] = [];
  if (p.status === "insufficient_data") {
    out.push(`This product can't be planned: ${p.warnings[0] ?? "its source data is incomplete"}.`);
    return out;
  }
  if (p.flags.stockout_risk)
    out.push(`Stock will last about ${weeks(p.weeks_of_cover)}. The target is at least ${p.min_cover_weeks} weeks.`);
  if (p.flags.overstock_risk)
    out.push(
      p.adjusted_weekly_demand
        ? `There is about ${weeks(p.weeks_of_cover)} of stock — more than the ${p.max_cover_weeks}-week maximum.`
        : `There were no sales in the last 12 weeks, but ${p.units_on_hand?.toLocaleString("en-IN")} units are in stock.`,
    );
  if (p.flags.demand_spike) out.push(`Sales are up ${Math.round(p.pct_change ?? 0)}% over the last 4 weeks.`);
  if (p.status === "conflict") out.push("Sales are rising but stock is already high, so the rules don't suggest a quantity. Use your judgement.");
  if (p.status === "ok") out.push(`Stock will last about ${weeks(p.weeks_of_cover)} — within the ${p.min_cover_weeks}–${p.max_cover_weeks} week target.`);
  if (p.flags.high_perishability) out.push(`Perishable product: keep ${p.min_cover_weeks}–${p.max_cover_weeks} weeks of stock.`);
  if (p.flags.festival_adjustment) out.push(`Demand includes +25% for ${monthName(planningMonth)} festivals.`);
  return out;
}

// ---------------------------------------------------------------------------
// Order progress: Recommended → Approved → Ready for PO → Creating PO → PO created / PO failed
// ---------------------------------------------------------------------------

export interface ProgressInput {
  decision: string;
  po_status: string;
  approved_qty: number | null;
}

export function progress(r: ProgressInput, opts: { mapped?: boolean } = {}): { label: string; tone: Tone } {
  switch (r.decision) {
    case "pending":
      return { label: "Recommended", tone: "gray" };
    case "needs_review":
      return { label: "Decide later", tone: "amber" };
    case "rejected":
      return { label: "Rejected", tone: "gray" };
    case "superseded":
      return { label: "Replaced by newer plan", tone: "gray" };
    case "not_actionable":
      return { label: "No action needed", tone: "gray" };
  }
  if (!r.approved_qty) return { label: "Pause approved", tone: "green" };
  switch (r.po_status) {
    case "submitting":
      return { label: "Creating PO", tone: "blue" };
    case "created":
      return { label: "PO created", tone: "green" };
    case "failed":
      return { label: "PO failed", tone: "red" };
    case "needs_reconciliation":
      return { label: "Check in Zoho", tone: "amber" };
    default:
      return opts.mapped === false ? { label: "Approved", tone: "green" } : { label: "Ready for PO", tone: "blue" };
  }
}

export function shortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "–";
  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: isoDate.length === 10 ? "UTC" : "Asia/Kolkata" });
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
