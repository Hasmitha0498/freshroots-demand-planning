"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalculationTrace } from "@/components/CalculationTrace";
import { Badge, btn, Card } from "@/components/ui";
import { MIN_REASON_LENGTH } from "@/lib/planning/decisions";
import { ACTION_LABELS, evaluateQuantity, RULE_LABELS, STATUS_LABELS } from "@/lib/planning/rules";
import type { RiskStatus, RuleId } from "@/lib/planning/types";
import { dateTime, DECISION_STYLE, int, nf, PO_STATUS_LABEL, STATUS_STYLE } from "@/lib/format";
import type { RecommendationRecord } from "@/lib/server/repo";

export function RecommendationCard({ rec }: { rec: RecommendationRecord }) {
  const router = useRouter();
  const plan = rec.calculation;
  const isPause = plan.action === "pause_next_order";
  const initialQty = rec.approved_qty ?? (isPause ? 0 : rec.proposed_qty);
  const [qtyText, setQtyText] = useState(initialQty === null ? "" : String(initialQty));
  const [reason, setReason] = useState(rec.override_reason ?? "");
  const [note, setNote] = useState(rec.decision_note ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalc, setShowCalc] = useState(false);

  const qty = qtyText.trim() === "" ? null : Number(qtyText);
  const baseline = isPause ? 0 : rec.proposed_qty;
  const overridden = qty !== null && qty !== baseline;
  const check = useMemo(() => (qty === null || (isPause && qty === 0) ? null : evaluateQuantity(plan, qty)), [qty, plan, isPause]);
  const reasonMissing = overridden && reason.trim().length < MIN_REASON_LENGTH;
  const locked = ["submitting", "created", "needs_reconciliation"].includes(rec.po_status);
  const canApprove = !locked && qty !== null && !(check?.errors.length) && !reasonMissing;

  async function decide(decision: "approved" | "rejected" | "needs_review") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recommendations/${rec.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, quantity: qty, override_reason: reason, note, confirm: decision === "approved" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{plan.sku_id}</span>
            <h2 className="font-semibold text-slate-900">{plan.sku_name}</h2>
            <Badge className={STATUS_STYLE[plan.status as RiskStatus]}>{STATUS_LABELS[plan.status as RiskStatus]}</Badge>
            <Badge className={DECISION_STYLE[rec.decision]}>{rec.decision.replace("_", " ")}</Badge>
            {rec.po_status !== "not_applicable" && <Badge className="bg-white text-slate-700 ring-slate-300">{PO_STATUS_LABEL[rec.po_status]}</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {plan.triggered_rules.map((r) => (
              <span key={r} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-white">
                {RULE_LABELS[r as RuleId]}
              </span>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Metric label="Current stock" value={int(plan.units_on_hand)} />
          <Metric label="Weeks cover" value={`${nf(plan.weeks_of_cover, 2)} / ${plan.min_cover_weeks}–${plan.max_cover_weeks}`} />
          <Metric label="Standard qty" value={int(plan.standard_reorder_qty)} />
          <Metric label="Proposed" value={plan.proposed_qty === null ? "manual" : isPause ? "pause" : int(plan.proposed_qty)} strong />
        </dl>
      </div>

      <p className="mt-3 text-sm text-slate-700">
        <strong>{ACTION_LABELS[plan.action]}.</strong> {plan.explanation.filter((e) => /^(Proposed|Recommendation|Conflict|Weeks of cover|No demand)/.test(e)).join(" ")}
      </p>
      {plan.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-amber-800">
          {plan.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <button onClick={() => setShowCalc(!showCalc)} className="mt-2 text-xs font-medium text-emerald-700 hover:underline">
        {showCalc ? "Hide calculation" : "Show full calculation"}
      </button>
      {showCalc && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <CalculationTrace plan={plan} />
        </div>
      )}

      {rec.decided_at && (
        <p className="mt-3 text-xs text-slate-500">
          {rec.decision.replace("_", " ")} by {rec.decided_by_email} · {dateTime(rec.decided_at)}
          {rec.approved_qty !== null && ` · ${int(rec.approved_qty)} units`}
          {rec.override_reason && ` · override: “${rec.override_reason}”`}
          {rec.decision_note && ` · note: “${rec.decision_note}”`}
        </p>
      )}

      {!locked && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="grid gap-3 md:grid-cols-[10rem_1fr_1fr]">
            <label className="text-sm">
              <span className="text-slate-600">{isPause ? "Order qty (0 = pause)" : "Order quantity"}</span>
              <input
                inputMode="numeric"
                value={qtyText}
                onChange={(e) => {
                  setQtyText(e.target.value.replace(/[^\d-]/g, ""));
                  setConfirming(false);
                }}
                className="tabular mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                aria-label={`Order quantity for ${plan.sku_id}`}
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">Override reason {overridden ? <span className="text-red-700">(required)</span> : "(if quantity changed)"}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!overridden} placeholder={overridden ? "Why differ from the rule?" : ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 disabled:bg-slate-50" />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5" />
            </label>
          </div>
          {check && (check.errors.length > 0 || check.warnings.length > 0) && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {check.errors.map((e) => (
                <li key={e} className="text-red-700">✕ {e}</li>
              ))}
              {check.warnings.map((w) => (
                <li key={w} className="text-amber-800">⚠ {w}</li>
              ))}
            </ul>
          )}
          {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}

          {confirming ? (
            <div className="mt-3 flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-emerald-900">
                {qty && qty > 0 ? (
                  <>
                    Approve <strong>{int(qty)} units</strong> of {plan.sku_id}
                    {check?.projected_cover !== null && check?.projected_cover !== undefined && ` (≈${nf(check.projected_cover, 2)} weeks cover after receipt)`}? This makes it eligible for a draft PO; no PO is created yet.
                  </>
                ) : (
                  <>Confirm pausing the next order for {plan.sku_id}? No PO will be created.</>
                )}
              </p>
              <div className="flex gap-2">
                <button onClick={() => decide("approved")} disabled={busy} className={btn.primary}>
                  {busy ? "Saving…" : "Confirm approval"}
                </button>
                <button onClick={() => setConfirming(false)} className={btn.secondary}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setConfirming(true)} disabled={!canApprove || busy} className={btn.primary}>
                Approve…
              </button>
              <button onClick={() => decide("needs_review")} disabled={busy} className={btn.secondary}>
                Mark for review
              </button>
              <button onClick={() => decide("rejected")} disabled={busy} className={btn.danger}>
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`tabular ${strong ? "font-semibold text-slate-900" : "text-slate-800"}`}>{value}</dd>
    </div>
  );
}
