// Live backend check against the configured Supabase project, using the same
// server modules as the API routes. The actor is a labelled test identity. Everything it creates is deleted at the end.
//
//   npm run e2e:supabase
import { config } from "dotenv";
config({ path: ".env.local" });

import assert from "node:assert/strict";
import { validateDecision } from "../lib/planning/decisions";
import { runPlanning } from "../lib/server/planningService";
import { getRecommendations, getSourceStatus, supabasePlanningStore } from "../lib/server/repo";
import { preparePo } from "../lib/server/poService";
import { supabasePoStore } from "../lib/server/poStore";
import { adminDb } from "../lib/supabase/admin";
import { HttpError } from "../lib/server/httpError";

const ACTOR = { id: null, name: "e2e-test (automated check)" };

async function main() {
  const db = adminDb();
  const before = await db.from("recommendations").select("id", { count: "exact", head: true });
  assert.equal(before.count, 0, "This check expects no existing recommendations, so it cannot disturb real decisions.");
  let runId: string | null = null;
  try {
    const status = await getSourceStatus();
    console.log("source:", status.sku_count, "SKUs,", status.sales_rows, "sales rows, as of", status.as_of_date, "latest week", status.latest_week);

    const t0 = Date.now();
    const result = await runPlanning(supabasePlanningStore(), ACTOR);
    runId = result.runId;
    console.log(`run ${runId.slice(0, 8)} saved in ${Date.now() - t0} ms; counts`, result.plan.counts);
    assert.equal(result.plan.counts.stockout_risk, 5);
    assert.equal(result.plan.counts.overstock_risk, 2);
    assert.equal(result.plan.counts.demand_spike, 1);

    const recs = await getRecommendations(runId);
    assert.equal(recs.length, 15);
    const by = (sku: string) => recs.find((r) => r.sku_id === sku)!;
    console.log("stored flags:", recs.filter((r) => r.decision === "pending").map((r) => `${r.sku_id}:${r.status_flag}`).join(" "));
    assert.equal(by("SKU001").proposed_qty, 750);

    // Decision path, exactly as the decision route does it.
    const decide = async (sku: string, input: Parameters<typeof validateDecision>[1]) => {
      const rec = by(sku);
      const v = validateDecision(rec, input);
      if (!v.ok) return v;
      const { error } = await db
        .from("recommendations")
        .update({ ...v.update, decided_by: ACTOR.id, decided_by_email: ACTOR.name, decided_at: new Date().toISOString() })
        .eq("id", rec.id)
        .eq("po_status", rec.po_status);
      if (error) throw new Error(error.message);
      return v;
    };
    assert.equal((await decide("SKU001", { decision: "approved", confirm: true })).ok, true);
    assert.equal((await decide("SKU003", { decision: "approved", confirm: true, quantity: 400 })).ok, false, "edit without reason must fail");
    assert.equal((await decide("SKU003", { decision: "approved", confirm: true, quantity: 400, override_reason: "Restore 6-week cover" })).ok, true);
    assert.equal((await decide("SKU013", { decision: "approved", confirm: true, quantity: 0, override_reason: "zero test" })).ok, false, "zero order must fail");
    assert.equal((await decide("SKU006", { decision: "approved", confirm: true })).ok, true);
    assert.equal((await decide("SKU004", { decision: "rejected", note: "e2e" })).ok, true);

    const after = await getRecommendations(runId);
    const a = (sku: string) => after.find((r) => r.sku_id === sku)!;
    assert.deepEqual([a("SKU001").approved_qty, a("SKU001").po_status], [750, "ready"]);
    assert.deepEqual([a("SKU003").approved_qty, a("SKU003").override_reason], [400, "Restore 6-week cover"]);
    assert.deepEqual([a("SKU006").approved_qty, a("SKU006").po_status], [0, "not_applicable"]);
    assert.equal(a("SKU004").decision, "rejected");
    console.log("decisions persisted: SKU001 approved 750 · SKU003 edited 400 with reason · SKU006 pause acknowledged · SKU004 rejected");

    // DB constraint: an unapproved recommendation can never be PO-ready.
    const bad = await db.from("recommendations").update({ po_status: "ready" }).eq("id", a("SKU011").id);
    assert.ok(bad.error, "DB must reject po_status=ready on a pending recommendation");
    // The atomic claim function refuses unapproved recommendations.
    const claim = await db.rpc("claim_recommendations_for_po", { p_po_id: "00000000-0000-0000-0000-000000000001", p_rec_ids: [a("SKU011").id] });
    assert.match(claim.error?.message ?? "", /claim_failed/);
    console.log("guards: DB check constraint and claim function both reject unapproved items");

    // PO preparation with no Zoho mapping must be blocked with a precise reason.
    const err = await preparePo(supabasePoStore(), "test-org", { recommendation_ids: [a("SKU001").id], confirm: true }, ACTOR.name).catch((e) => e);
    assert.ok(err instanceof HttpError && err.status === 422);
    console.log("PO guard:", (err.details as string[]).join(" "));
    console.log("\nALL LIVE SUPABASE CHECKS PASSED");
  } finally {
    if (runId) {
      await db.from("recommendations").delete().eq("run_id", runId);
      await db.from("planning_runs").delete().eq("id", runId);
      console.log("cleaned up test run", runId.slice(0, 8));
    }
  }
}

main().catch((e) => {
  console.error("E2E FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
