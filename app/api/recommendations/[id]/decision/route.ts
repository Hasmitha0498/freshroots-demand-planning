import { NextResponse } from "next/server";
import { HttpError, plannerActor, route } from "@/lib/server/actor";
import { findOpenApproval, validateDecision, type DecisionInput, type SameSkuRecommendation } from "@/lib/planning/decisions";
import { audit, getRecommendation } from "@/lib/server/repo";
import { adminDb } from "@/lib/supabase/admin";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = plannerActor();
  const { id } = await ctx.params;
  const input = (await req.json().catch(() => ({}))) as DecisionInput;
  const rec = await getRecommendation(id);
  if (!rec) throw new HttpError(404, "Recommendation not found.");

  const result = validateDecision(rec, input);
  if (!result.ok || !result.update) throw new HttpError(422, result.errors.join(" "), { errors: result.errors, warnings: result.warnings });

  if (result.update.decision === "approved" && (result.update.approved_qty ?? 0) > 0) {
    const { data: sameSku, error: sameErr } = await adminDb()
      .from("recommendations")
      .select("id,run_id,decision,approved_qty,po_status")
      .eq("sku_id", rec.sku_id)
      .eq("decision", "approved");
    if (sameErr) throw new Error(sameErr.message);
    const open = findOpenApproval(id, (sameSku ?? []) as SameSkuRecommendation[]);
    if (open)
      throw new HttpError(
        409,
        `${rec.sku_id} already has an approved order of ${open.approved_qty} units (planning run ${open.run_id.slice(0, 8)}) waiting for a PO. Withdraw it on the Purchase Orders page first, so the SKU is not ordered twice.`,
      );
  }

  // Conditional on the state we validated against, so a concurrent PO submit cannot be overwritten.
  const { data, error } = await adminDb()
    .from("recommendations")
    .update({ ...result.update, decided_by: actor.id, decided_by_email: actor.name, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("po_status", rec.po_status)
    .eq("decision", rec.decision)
    .select("*");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new HttpError(409, "This recommendation changed in the meantime. Refresh and try again.");

  await audit(actor.name, `recommendation.${result.update.decision}`, "recommendation", id, {
    sku_id: rec.sku_id,
    proposed_qty: rec.proposed_qty,
    approved_qty: result.update.approved_qty,
    override_reason: result.update.override_reason,
    warnings: result.warnings,
  });
  return NextResponse.json({ recommendation: data[0], warnings: result.warnings });
});
