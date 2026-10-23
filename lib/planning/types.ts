// Shared domain types. Field names mirror the Supabase columns (snake_case),
// which in turn mirror the supplied SAP-style CSV headers.

export type Perishability = "High" | "Medium" | "Low";

export interface SkuRow {
  sku_id: string;
  sku_name: string;
  category: string;
  perishability: string;
  standard_reorder_qty: number;
  unit_of_measure: string;
  distributor_id: string;
}

export interface SalesRow {
  sku_id: string;
  week: string; // ISO week, e.g. 2026-W42
  units_sold: number;
}

export interface InventoryRow {
  sku_id: string;
  location: string;
  units_on_hand: number;
  as_of_date: string; // YYYY-MM-DD
}

export interface DistributorRow {
  distributor_id: string;
  distributor_name: string;
  region: string;
  status: string;
}

export interface FestivalRow {
  year: number;
  month: number;
  year_month: string; // YYYY-MM
  is_festival_month: boolean;
}

export interface SourceData {
  skus: SkuRow[];
  sales: SalesRow[];
  inventory: InventoryRow[];
  distributors: DistributorRow[];
  festivals: FestivalRow[];
}

export type IssueSeverity = "error" | "warning";

export interface DataIssue {
  severity: IssueSeverity;
  table: string;
  key: string;
  message: string;
}

export type RuleId =
  | "demand_spike"
  | "stockout_risk"
  | "overstock_risk"
  | "festival_adjustment"
  | "high_perishability";

export type RiskStatus =
  | "stockout"
  | "conflict"
  | "demand_spike"
  | "overstock"
  | "ok"
  | "insufficient_data";

export type PlanAction =
  | "reorder_immediately"
  | "reorder_high_demand"
  | "pause_next_order"
  | "manual_review"
  | "no_action"
  | "insufficient_data";

export interface SkuPlan {
  sku_id: string;
  sku_name: string;
  category: string;
  perishability: string;
  standard_reorder_qty: number;
  unit_of_measure: string;
  distributor_id: string;
  location: string | null;
  units_on_hand: number | null;
  /** Weeks (oldest → newest) used for the 12-week baseline. */
  weeks_used: string[];
  /** Full available sales history (oldest → newest), for trend display. */
  history: { week: string; units_sold: number }[];
  sum_4w: number | null;
  sum_12w: number | null;
  avg_4w: number | null;
  avg_12w: number | null;
  /** (avg_4w / avg_12w − 1) × 100; null when avg_12w is 0 or data is insufficient. */
  pct_change: number | null;
  festival_applied: boolean;
  uplift_factor: number;
  /** Unadjusted projected weekly demand (= 12-week average). */
  baseline_weekly_demand: number | null;
  /** Projected weekly demand after any festival uplift. Used for coverage checks. */
  adjusted_weekly_demand: number | null;
  /** units_on_hand / adjusted_weekly_demand; null when demand is 0 or unknown. */
  weeks_of_cover: number | null;
  min_cover_weeks: number;
  max_cover_weeks: number;
  flags: Record<RuleId, boolean>;
  triggered_rules: RuleId[];
  status: RiskStatus;
  action: PlanAction;
  /** Lower number = more urgent. */
  priority: number;
  /** Suggested order quantity. 0 for pause/no action, null when manual review decides. */
  proposed_qty: number | null;
  projected_cover_after_order: number | null;
  warnings: string[];
  explanation: string[];
}

export interface PlanSnapshot {
  as_of_date: string | null;
  latest_week: string | null;
  latest_week_end: string | null;
  earliest_week: string | null;
  weeks_of_history: number;
  planning_month: string | null;
  festival_applied: boolean;
  festival_source: "calendar" | "fallback_rule" | "none";
  sku_count: number;
  sales_rows: number;
  data_age_days: number | null;
  is_stale: boolean;
}

export interface PlanCounts {
  total_skus: number;
  stockout_risk: number;
  overstock_risk: number;
  demand_spike: number;
  festival_adjusted: number;
  manual_review: number;
  insufficient_data: number;
  actionable: number;
}

export interface PlanResult {
  rules_version: string;
  snapshot: PlanSnapshot;
  counts: PlanCounts;
  issues: DataIssue[];
  skus: SkuPlan[];
}
