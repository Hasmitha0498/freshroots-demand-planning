// Run Demand Planning: read the simulated-SAP tables, apply the rules, persist the run.
import { computePlan } from "../planning/rules";
import type { PlanResult, SkuPlan, SourceData } from "../planning/types";

export interface RunActor {
  id: string | null;
  name: string;
}

export interface PlanningStore {
  loadSourceData(): Promise<SourceData>;
  saveRun(plan: PlanResult, actor: RunActor): Promise<{ runId: string }>;
}

export async function runPlanning(store: PlanningStore, actor: RunActor, today = new Date()) {
  const source = await store.loadSourceData();
  if (source.skus.length === 0) {
    throw new Error("No SKUs found in Supabase. Run `npm run db:seed` to load the CSVs from ./data.");
  }
  const plan = computePlan(source, { today });
  const { runId } = await store.saveRun(plan, actor);
  return { runId, plan };
}

/** Maps one SkuPlan to a recommendations row. */
export function recommendationRow(runId: string, s: SkuPlan) {
  return {
    run_id: runId,
    sku_id: s.sku_id,
    status_flag: s.status,
    action: s.action,
    priority: s.priority,
    triggered_rules: s.triggered_rules,
    units_on_hand: s.units_on_hand,
    avg_4w: s.avg_4w,
    avg_12w: s.avg_12w,
    pct_change: s.pct_change,
    adjusted_weekly_demand: s.adjusted_weekly_demand,
    weeks_of_cover: s.weeks_of_cover,
    standard_reorder_qty: s.standard_reorder_qty,
    proposed_qty: s.proposed_qty,
    calculation: s,
    decision: s.status === "ok" ? "not_actionable" : "pending",
  };
}
