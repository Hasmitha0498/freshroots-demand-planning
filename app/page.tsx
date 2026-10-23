import { connection } from "next/server";
import { DashboardView } from "./DashboardView";
import { PilotMeasurement } from "@/components/PilotMeasurement";
import { RunPlanningButton } from "@/components/RunPlanningButton";
import { SetupNotice } from "@/components/SetupNotice";
import { Card, Notice, PageTitle } from "@/components/ui";
import { missingSupabaseEnv, supabaseConfigured } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { getLatestRun, getRecommendations, getSourceStatus } from "@/lib/server/repo";

export default async function DashboardPage() {
  await connection(); // always read the latest Supabase state, never a build-time snapshot
  if (!supabaseConfigured()) return <SetupNotice missing={missingSupabaseEnv()} />;
  let data;
  try {
    const [status, run] = await Promise.all([getSourceStatus(), getLatestRun()]);
    const recs = run ? await getRecommendations(run.id) : [];
    data = { status, run, recs };
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  const { status, run, recs } = data;
  const snap = run?.snapshot;
  const issues = run?.data_issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");

  return (
    <div className="space-y-6">
      <PageTitle
        title="Dashboard"
        subtitle="Reads the latest stored SAP-style records from Supabase on demand and applies Raghav's five planning rules."
        actions={
          <RunPlanningButton
            disabled={status.sku_count === 0}
            reason={status.sku_count === 0 ? "No data in Supabase yet — run npm run db:seed." : undefined}
          />
        }
      />

      <Card className="grid gap-4 p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <Fact label="Inventory as of" value={status.as_of_date ?? "missing"} />
        <Fact label="Latest sales week" value={status.latest_week ?? "missing"} sub={snap?.latest_week_end ? `ends ${snap.latest_week_end}` : undefined} />
        <Fact label="Coverage" value={`${status.sku_count} SKUs · ${status.sales_rows} sales rows`} sub={snap ? `${snap.weeks_of_history} weeks (${snap.earliest_week} → ${snap.latest_week})` : undefined} />
        <Fact label="Last data load" value={status.last_load ? dateTime(status.last_load.loaded_at) : "never"} sub="static until re-seeded" />
        <Fact label="Last planning run" value={run ? dateTime(run.created_at) : "no runs yet"} sub={run ? `by ${run.created_by_email}` : undefined} />
      </Card>

      {snap?.is_stale && (
        <Notice tone="warn" title="Stale data">
          The inventory snapshot is {snap.data_age_days} days old (as of {snap.as_of_date}). Recommendations reflect that snapshot, not today&apos;s stock. Refresh the source data before acting.
        </Notice>
      )}
      {snap && (
        <Notice tone="info">
          Planning period <strong>{snap.planning_month}</strong> (from the snapshot date, not today&apos;s date):{" "}
          {snap.festival_applied ? "festival month — projected weekly demand is uplifted 25% before coverage checks" : "not a festival month — no uplift"}
          {snap.festival_source === "fallback_rule" && " (calendar row missing; documented Oct/Nov/Mar rule used)"}.
        </Notice>
      )}
      {issues.length > 0 && (
        <Notice tone={errors.length ? "error" : "warn"} title={`${issues.length} data issue(s) found in the last run`}>
          <ul className="list-disc pl-5">
            {issues.slice(0, 10).map((i, n) => (
              <li key={n}>
                <span className="font-mono text-xs">{i.table}</span> {i.key}: {i.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {run ? (
        <DashboardView run={run} recs={recs} />
      ) : (
        <Card className="p-10 text-center text-slate-600">
          <p className="font-medium text-slate-900">No planning run yet.</p>
          <p className="mt-1 text-sm">Click <strong>Run Demand Planning</strong> to read the stored data and compute recommendations.</p>
        </Card>
      )}

      <PilotMeasurement />
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 font-medium text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
