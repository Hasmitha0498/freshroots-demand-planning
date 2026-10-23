import { connection } from "next/server";
import Link from "next/link";
import { RecommendationsView, type RecItem } from "./RecommendationsView";
import { DataLine } from "@/components/DataLine";
import { SetupNotice } from "@/components/SetupNotice";
import { btn, Card, EmptyState, PageHeader } from "@/components/ui";
import { missingSupabaseEnv, supabaseConfigured } from "@/lib/env";
import { listMappings } from "@/lib/server/poStore";
import { getLatestRun, getRecommendations } from "@/lib/server/repo";

export default async function RecommendationsPage({ searchParams }: PageProps<"/recommendations">) {
  await connection(); // always read the latest Supabase state, never a build-time snapshot
  if (!supabaseConfigured()) return <SetupNotice missing={missingSupabaseEnv()} />;
  const sp = await searchParams;
  let data;
  try {
    const [run, mappings] = await Promise.all([getLatestRun(), listMappings()]);
    const recs = run ? await getRecommendations(run.id) : [];
    data = { run, recs, mapped: new Set(mappings.map((m) => m.sku_id)) };
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  const { run, recs, mapped } = data;
  const items: RecItem[] = recs
    .filter((r) => r.decision !== "not_actionable")
    .map((r) => ({
      id: r.id,
      plan: r.calculation,
      proposed_qty: r.proposed_qty,
      decision: r.decision,
      po_status: r.po_status,
      approved_qty: r.approved_qty,
      override_reason: r.override_reason,
      decision_note: r.decision_note,
      decided_by_email: r.decided_by_email,
      decided_at: r.decided_at,
      mapped: mapped.has(r.sku_id),
    }));

  return (
    <div>
      <PageHeader
        title="Recommendations"
        meta={run ? <DataLine asOf={run.snapshot.as_of_date} plannedAt={run.created_at} /> : undefined}
      />
      {!run ? (
        <Card>
          <EmptyState
            title="No recommendations yet"
            action={
              <Link href="/" className={btn.secondary}>
                Go to Overview to run planning
              </Link>
            }
          >
            Run planning to see which products need a reorder or a pause.
          </EmptyState>
        </Card>
      ) : (
        <RecommendationsView items={items} planningMonth={run.snapshot.planning_month} initialSku={typeof sp.sku === "string" ? sp.sku : null} />
      )}
    </div>
  );
}
