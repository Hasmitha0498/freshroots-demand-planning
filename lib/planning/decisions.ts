// Pure validation of planner decisions on a recommendation.
import { evaluateQuantity } from "./rules";
import type { SkuPlan } from "./types";

export type Decision = "approved" | "rejected" | "needs_review";
export type PoStatus = "not_applicable" | "ready" | "submitting" | "created" | "failed" | "needs_reconciliation";

export interface RecommendationState {
  decision: "pending" | Decision | "superseded" | "not_actionable";
  po_status: PoStatus;
  proposed_qty: number | null;
  calculation: SkuPlan;
}

export interface DecisionInput {
  decision: Decision;
  quantity?: number | null;
  override_reason?: string | null;
  note?: string | null;
  confirm?: boolean;
}

export interface DecisionResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  update?: {
    decision: Decision;
    approved_qty: number | null;
    override_reason: string | null;
    decision_note: string | null;
    po_status: PoStatus;
  };
}

export const MIN_REASON_LENGTH = 5;
const LOCKED_PO: PoStatus[] = ["submitting", "created", "needs_reconciliation"];

export function validateDecision(rec: RecommendationState, input: DecisionInput): DecisionResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rec.decision === "superseded") errors.push("This recommendation belongs to an older planning run. Use the latest run.");
  if (rec.decision === "not_actionable") errors.push("No action is recommended for this SKU.");
  if (LOCKED_PO.includes(rec.po_status))
    errors.push(`A purchase order is ${rec.po_status.replace("_", " ")} for this recommendation; the decision is locked.`);
  if (!["approved", "rejected", "needs_review"].includes(input.decision)) errors.push("Unknown decision.");
  const reason = input.override_reason?.trim() || null;
  const note = input.note?.trim() || null;
  if (errors.length) return { ok: false, errors, warnings };

  if (input.decision !== "approved") {
    return {
      ok: true,
      errors,
      warnings,
      update: { decision: input.decision, approved_qty: null, override_reason: null, decision_note: note, po_status: "not_applicable" },
    };
  }

  if (!input.confirm) errors.push("Approval must be explicitly confirmed.");
  const plan = rec.calculation;
  const isPause = plan.action === "pause_next_order";
  // A pause recommendation is approved with quantity 0 (no PO). Any other approval orders > 0 units.
  const qty = input.quantity ?? (isPause ? 0 : rec.proposed_qty);

  if (qty === null || qty === undefined) {
    errors.push("Enter an order quantity — no quantity is proposed automatically for this SKU.");
  } else if (isPause && qty === 0) {
    // acknowledged pause
  } else {
    const check = evaluateQuantity(plan, qty);
    errors.push(...check.errors);
    warnings.push(...check.warnings.filter((w) => !w.startsWith("Differs")));
  }
  const overridden = qty !== null && qty !== undefined && qty !== (isPause ? 0 : rec.proposed_qty);
  if (overridden && (!reason || reason.length < MIN_REASON_LENGTH))
    errors.push(`An override reason (at least ${MIN_REASON_LENGTH} characters) is required when the quantity differs from the proposal.`);

  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    update: {
      decision: "approved",
      approved_qty: qty!,
      override_reason: overridden ? reason : null,
      decision_note: note,
      po_status: qty! > 0 ? "ready" : "not_applicable",
    },
  };
}
