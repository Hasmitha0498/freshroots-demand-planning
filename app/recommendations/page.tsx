import { connection } from "next/server";
import Link from "next/link";
import { RecommendationCard } from "./RecommendationCard";
import { SetupNotice } from "@/components/SetupNotice";
import { Card, Notice, PageTitle } from "@/components/ui";
import { missingSupabaseEnv, supabaseConfigured } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { getLatestRun, getRecommendations } from "@/lib/server/repo";

export default async function RecommendationsPage() {
  await connection(); // always read the latest Supabase state, never a build-time snapshot
  if (!supabaseConfigured()) return <SetupNotice missing={missingSupabaseEnv()} />;
  let run, recs;
  try {
    run = await getLatestRun();
    recs = run ? await getRecommendations(run.id) : [];
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  const flagged = recs.filter((r) => r.decision !== "not_actionable");
  const approved = flagged.filter((r) => r.decision === "approved" && (r.approved_qty ?? 0) > 0).length;

  return (
    <div className="space-y-4">
      <PageTitle
        title="Recommendations"
        subtitle={run ? `Planning run ${run.id.slice(0, 8)} · ${dateTime(run.created_at)} · data as of ${run.snapshot.as_of_date}` : undefined}
        actions={
          approved > 0 ? (
            <Link href="/purchase-orders" className="text-sm font-medium text-emerald-700 hover:underline">
              {approved} approved order(s) → Purchase Orders
            </Link>
          ) : undefined
        }
      />
      <Notice tone="info">
        Proposals are rule-based starting points. Standard quantities are not an optimised purchase requirement — lead time, inbound POs, expiry and cost are not in the data. Editing a quantity requires an override reason. Approval does not change stored inventory.
      </Notice>
      {!run && (
        <Card className="p-10 text-center text-slate-600">
          No planning run yet. Go to the <Link href="/" className="text-emerald-700 underline">Dashboard</Link> and click Run Demand Planning.
        </Card>
      )}
      {run && flagged.length === 0 && <Card className="p-10 text-center text-slate-600">No SKUs were flagged in the latest run.</Card>}
      {flagged.map((r) => (
        <RecommendationCard key={r.id} rec={r} />
      ))}
    </div>
  );
}
