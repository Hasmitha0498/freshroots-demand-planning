import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminDb } from "../supabase/admin";
import type { PlanCounts, PlanResult, PlanSnapshot, SkuPlan, SourceData, DataIssue } from "../planning/types";
import type { PlanningStore } from "./planningService";
import { recommendationRow } from "./planningService";

const PAGE = 1000;

/** Reads a whole table in pages (PostgREST caps responses at 1000 rows by default). */
async function fetchAll<T>(db: SupabaseClient, table: string, columns: string, order: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns);
    for (const col of order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export async function audit(actorEmail: string, action: string, entity: string, entityId: string | null, details: unknown = {}) {
  const { error } = await adminDb().from("audit_events").insert({ actor_email: actorEmail, action, entity, entity_id: entityId, details });
  if (error) console.error("[audit] failed:", error.message);
}

export function supabasePlanningStore(db: SupabaseClient = adminDb()): PlanningStore {
  return {
    async loadSourceData(): Promise<SourceData> {
      const [skus, sales, inventory, distributors, festivals] = await Promise.all([
        fetchAll<SourceData["skus"][number]>(db, "sku_master", "sku_id,sku_name,category,perishability,standard_reorder_qty,unit_of_measure,distributor_id", ["sku_id"]),
        fetchAll<SourceData["sales"][number]>(db, "weekly_sales", "sku_id,week,units_sold", ["sku_id", "iso_year", "iso_week"]),
        fetchAll<SourceData["inventory"][number]>(db, "current_inventory", "sku_id,location,units_on_hand,as_of_date", ["sku_id"]),
        fetchAll<SourceData["distributors"][number]>(db, "distributor_master", "distributor_id,distributor_name,region,status", ["distributor_id"]),
        fetchAll<SourceData["festivals"][number]>(db, "festival_calendar", "year,month,year_month,is_festival_month", ["year_month"]),
      ]);
      return { skus, sales, inventory, distributors, festivals };
    },

    async saveRun(plan: PlanResult, actor) {
      const { data: run, error } = await db
        .from("planning_runs")
        .insert({
          created_by: actor.id,
          created_by_email: actor.name,
          rules_version: plan.rules_version,
          as_of_date: plan.snapshot.as_of_date,
          latest_week: plan.snapshot.latest_week,
          planning_month: plan.snapshot.planning_month,
          festival_applied: plan.snapshot.festival_applied,
          festival_source: plan.snapshot.festival_source,
          snapshot: plan.snapshot,
          counts: plan.counts,
          data_issues: plan.issues,
        })
        .select("id")
        .single();
      if (error || !run) throw new Error(`Saving planning run: ${error?.message}`);
      const runId = run.id as string;

      const { error: recErr } = await db.from("recommendations").insert(plan.skus.map((s) => recommendationRow(runId, s)));
      if (recErr) throw new Error(`Saving recommendations: ${recErr.message}`);

      // Undecided items from older runs are superseded by this run. Approved
      // items (and their PO state) are kept untouched.
      const { error: supErr } = await db
        .from("recommendations")
        .update({ decision: "superseded" })
        .neq("run_id", runId)
        .in("decision", ["pending", "needs_review"]);
      if (supErr) throw new Error(`Superseding older recommendations: ${supErr.message}`);
      return { runId };
    },
  };
}

// ---------------------------------------------------------------------------
// Read models for pages
// ---------------------------------------------------------------------------

export interface RunSummary {
  id: string;
  created_at: string;
  created_by_email: string;
  rules_version: string;
  snapshot: PlanSnapshot;
  counts: PlanCounts;
  data_issues: DataIssue[];
}

export interface RecommendationRecord {
  id: string;
  run_id: string;
  sku_id: string;
  status_flag: string;
  action: string;
  priority: number;
  triggered_rules: string[];
  proposed_qty: number | null;
  standard_reorder_qty: number;
  calculation: SkuPlan;
  decision: "pending" | "approved" | "rejected" | "needs_review" | "superseded" | "not_actionable";
  approved_qty: number | null;
  override_reason: string | null;
  decision_note: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  po_status: "not_applicable" | "ready" | "submitting" | "created" | "failed" | "needs_reconciliation";
  purchase_order_id: string | null;
}

export interface SourceStatus {
  sku_count: number;
  sales_rows: number;
  as_of_date: string | null;
  latest_week: string | null;
  last_load: { loaded_at: string; source: string; row_counts: Record<string, number> } | null;
}

export async function getSourceStatus(): Promise<SourceStatus> {
  const db = adminDb();
  const [skus, sales, inv, wk, load] = await Promise.all([
    db.from("sku_master").select("sku_id", { count: "exact", head: true }),
    db.from("weekly_sales").select("sku_id", { count: "exact", head: true }),
    db.from("current_inventory").select("as_of_date").order("as_of_date", { ascending: false }).limit(1),
    db.from("weekly_sales").select("week").order("iso_year", { ascending: false }).order("iso_week", { ascending: false }).limit(1),
    db.from("data_loads").select("loaded_at,source,row_counts").order("loaded_at", { ascending: false }).limit(1),
  ]);
  for (const r of [skus, sales, inv, wk, load]) if (r.error) throw new Error(r.error.message);
  return {
    sku_count: skus.count ?? 0,
    sales_rows: sales.count ?? 0,
    as_of_date: inv.data?.[0]?.as_of_date ?? null,
    latest_week: wk.data?.[0]?.week ?? null,
    last_load: load.data?.[0] ?? null,
  };
}

export async function getLatestRun(): Promise<RunSummary | null> {
  const { data, error } = await adminDb()
    .from("planning_runs")
    .select("id,created_at,created_by_email,rules_version,snapshot,counts,data_issues")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as RunSummary) ?? null;
}

export async function getRecommendations(runId: string): Promise<RecommendationRecord[]> {
  const { data, error } = await adminDb()
    .from("recommendations")
    .select("*")
    .eq("run_id", runId)
    .order("priority", { ascending: true })
    .order("sku_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RecommendationRecord[];
}

export async function getRecommendation(id: string): Promise<RecommendationRecord | null> {
  const { data, error } = await adminDb().from("recommendations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as RecommendationRecord | null;
}

/** Approved recommendations with an order quantity, from any run, that still need or have a PO. */
export async function getApprovedForPo(): Promise<RecommendationRecord[]> {
  const { data, error } = await adminDb()
    .from("recommendations")
    .select("*")
    .eq("decision", "approved")
    .in("po_status", ["ready", "failed", "submitting", "needs_reconciliation"])
    .order("decided_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RecommendationRecord[];
}

export async function getRecommendationsByIds(ids: string[]): Promise<RecommendationRecord[]> {
  if (ids.length === 0) return [];
  const { data, error } = await adminDb().from("recommendations").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as RecommendationRecord[];
}
