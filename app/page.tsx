import { connection } from "next/server";
import { OverviewView, type OverviewItem } from "./OverviewView";
import { DataLine } from "@/components/DataLine";
import { RunPlanningButton } from "@/components/RunPlanningButton";
import { SetupNotice } from "@/components/SetupNotice";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { missingSupabaseEnv, supabaseConfigured } from "@/lib/env";
import { shortDate } from "@/lib/presentation";
import { listMappings } from "@/lib/server/poStore";
import { getLatestRun, getRecommendations, getSourceStatus } from "@/lib/server/repo";

export default async function OverviewPage() {
  await connection(); // always read the latest Supabase state, never a build-time snapshot
  if (!supabaseConfigured()) return <SetupNotice missing={missingSupabaseEnv()} />;
  let data;
  try {
    const [status, run, mappings] = await Promise.all([getSourceStatus(), getLatestRun(), listMappings()]);
    const recs = run ? await getRecommendations(run.id) : [];
    data = { status, run, recs, mapped: new Set(mappings.map((m) => m.sku_id)) };
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  const { status, run, recs, mapped } = data;
  const snap = run?.snapshot;
  const issues = run?.data_issues ?? [];

  const items: OverviewItem[] = recs.map((r) => ({
    id: r.id,
    plan: r.calculation,
    decision: r.decision,
    po_status: r.po_status,
    approved_qty: r.approved_qty,
    mapped: mapped.has(r.sku_id),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        meta={<DataLine asOf={status.as_of_date} plannedAt={run?.created_at} festivalMonth={snap?.festival_applied ? snap.planning_month : null} />}
        actions={<RunPlanningButton disabled={status.sku_count === 0} reason={status.sku_count === 0 ? "No stock data yet. Load the sample data first (npm run db:seed)." : undefined} />}
      />

      {snap?.is_stale && (
        <Notice tone="warn">
          Stock data is {snap.data_age_days} days old. These recommendations reflect stock on {shortDate(snap.as_of_date)}.
        </Notice>
      )}
      {issues.length > 0 && (
        <Notice tone={issues.some((i) => i.severity === "error") ? "error" : "warn"} title="Some source data has problems">
          Affected products show &ldquo;Missing data&rdquo; until it is fixed.
          <details className="mt-1">
            <summary className="cursor-pointer text-xs underline">Show {issues.length} issue(s)</summary>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {issues.slice(0, 20).map((i, n) => (
                <li key={n}>
                  {i.table} {i.key}: {i.message}
                </li>
              ))}
            </ul>
          </details>
        </Notice>
      )}

      {run ? (
        <OverviewView items={items} planningMonth={snap?.planning_month ?? null} />
      ) : (
        <Card>
          <EmptyState title="No plan yet">Click Run planning to check every product&apos;s stock against expected demand.</EmptyState>
        </Card>
      )}
    </div>
  );
}
