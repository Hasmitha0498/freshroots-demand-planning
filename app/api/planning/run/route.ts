import { NextResponse } from "next/server";
import { plannerActor, route } from "@/lib/server/actor";
import { runPlanning } from "@/lib/server/planningService";
import { audit, supabasePlanningStore } from "@/lib/server/repo";

// Run Demand Planning: fresh read of the Supabase (simulated SAP) tables → rules → saved run.
export const POST = route(async () => {
  const actor = plannerActor();
  const { runId, plan } = await runPlanning(supabasePlanningStore(), actor);
  await audit(actor.name, "planning.run", "planning_run", runId, { counts: plan.counts, as_of: plan.snapshot.as_of_date });
  return NextResponse.json({ runId, counts: plan.counts, snapshot: plan.snapshot, issues: plan.issues });
});
