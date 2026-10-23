"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { RecItem } from "./RecommendationsView";
import { btn, inputCls, Notice, Spinner } from "@/components/ui";
import { MIN_REASON_LENGTH } from "@/lib/planning/decisions";
import { evaluateQuantity } from "@/lib/planning/rules";
import { productName, shortDateTime, weeks } from "@/lib/presentation";

type Mode = "edit" | "confirm" | "reject";
const LOCKED = ["submitting", "created", "needs_reconciliation"];

/** Approve (with optional change + reason), reject (with reason) or decide later. */
export function DecisionPanel({ item }: { item: RecItem }) {
  const router = useRouter();
  const plan = item.plan;
  const name = productName(plan.sku_name);
  const isPause = plan.action === "pause_next_order";
  const suggested = isPause ? 0 : item.proposed_qty;
  const decided = item.decision === "approved" || item.decision === "rejected";
  const locked = LOCKED.includes(item.po_status);

  const [editing, setEditing] = useState(!decided);
  const [mode, setMode] = useState<Mode>("edit");
  const [qtyText, setQtyText] = useState(String(item.approved_qty ?? suggested ?? ""));
  const [reason, setReason] = useState(item.override_reason ?? "");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const qty = qtyText.trim() === "" ? null : Number(qtyText);
  const changed = qty !== null && qty !== suggested;
  const check = useMemo(() => (qty === null || (isPause && qty === 0) ? null : evaluateQuantity(plan, qty)), [qty, plan, isPause]);
  const warnings = check?.warnings.filter((w) => !w.startsWith("Differs")) ?? [];
  const reasonMissing = changed && reason.trim().length < MIN_REASON_LENGTH;
  const canApprove = qty !== null && !check?.errors.length && !reasonMissing;

  async function send(decision: "approved" | "rejected" | "needs_review", extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recommendations/${item.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Couldn't save (HTTP ${res.status}).`);
      setDone(
        decision === "approved"
          ? qty
            ? `Approved ${qty.toLocaleString("en-IN")} units. Next, create the purchase order.`
            : "Pause approved. No purchase order will be created."
          : decision === "rejected"
            ? "Rejected."
            : "Saved for later.",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (plan.status === "insufficient_data")
    return <Notice tone="warn">This product can&apos;t be planned until its source data is fixed. No decision is needed now.</Notice>;

  if (done)
    return (
      <Notice tone="ok" title={done}>
        {done.startsWith("Approved") ? (
          <Link href="/purchase-orders" className={btn.link}>
            Go to Purchase orders →
          </Link>
        ) : null}
      </Notice>
    );

  // Current decision summary
  if (!editing || locked) {
    const what =
      item.decision === "approved"
        ? item.approved_qty
          ? `Approved ${item.approved_qty.toLocaleString("en-IN")} units`
          : "Pause approved"
        : item.decision === "rejected"
          ? "Rejected"
          : item.decision === "superseded"
            ? "Replaced by a newer plan"
            : "Decision saved";
    return (
      <div className="space-y-3 rounded-md border border-slate-200 p-4">
        <p className="text-sm font-medium text-slate-900">{what}</p>
        <p className="text-xs text-slate-500">
          {item.decided_by_email ?? "—"} · {shortDateTime(item.decided_at)}
          {item.override_reason && <> · Changed because: &ldquo;{item.override_reason}&rdquo;</>}
          {item.decision_note && <> · Note: &ldquo;{item.decision_note}&rdquo;</>}
        </p>
        {locked ? (
          <p className="text-sm text-slate-600">
            A purchase order is linked to this decision, so it can&apos;t be changed.{" "}
            <Link href="/purchase-orders" className={btn.link}>
              View purchase orders
            </Link>
          </p>
        ) : (
          item.decision !== "superseded" && (
            <button onClick={() => setEditing(true)} className={btn.secondary}>
              Change decision
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Your decision</h3>

      {mode === "edit" && (
        <>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <label className="block text-sm">
              <span className="text-slate-700">{isPause ? "Order quantity" : "Order quantity"}</span>
              <input
                inputMode="numeric"
                value={qtyText}
                placeholder={suggested === null ? "Enter units" : undefined}
                onChange={(e) => setQtyText(e.target.value.replace(/[^\d-]/g, ""))}
                className={`${inputCls} tabular mt-1`}
                aria-describedby="qty-hint"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">
                Reason for change {changed ? <span className="text-red-700">(required)</span> : <span className="text-slate-400">(only if you change it)</span>}
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={!changed}
                placeholder={changed ? "e.g. Supplier minimum order" : ""}
                className={`${inputCls} mt-1`}
              />
            </label>
          </div>
          <p id="qty-hint" className="-mt-1 text-xs text-slate-500">
            {suggested === null
              ? "The rules don't suggest a quantity for this product. Enter one and say why."
              : isPause
                ? "Suggested: pause the next order (0 units)."
                : `Suggested: ${suggested.toLocaleString("en-IN")} units — a starting point. Lead times and open orders aren't in the data.`}
            {check?.projected_cover !== null && check?.projected_cover !== undefined && ` After delivery, stock should last about ${weeks(check.projected_cover)}.`}
          </p>
          {(check?.errors.length || warnings.length) ? (
            <ul className="space-y-1 text-sm">
              {check?.errors.map((e) => (
                <li key={e} className="text-red-700">
                  {e}
                </li>
              ))}
              {warnings.map((w) => (
                <li key={w} className="text-amber-800">
                  ⚠ {w}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={() => setMode("confirm")} disabled={!canApprove || busy} className={btn.primary}>
              {qty ? `Approve ${qty.toLocaleString("en-IN")} units` : "Approve pause"}
            </button>
            <button onClick={() => send("needs_review")} disabled={busy} className={btn.secondary}>
              Decide later
            </button>
            <button onClick={() => setMode("reject")} disabled={busy} className={btn.ghost}>
              Reject
            </button>
            {decided && (
              <button onClick={() => setEditing(false)} className={btn.ghost}>
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {mode === "confirm" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-800">
            {qty
              ? <>Approve <strong className="font-semibold">{qty.toLocaleString("en-IN")} units</strong> of {name}? This doesn&apos;t create a purchase order yet — you&apos;ll do that on the Purchase orders page.</>
              : <>Approve pausing the next order for {name}? No purchase order will be created.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => send("approved", { quantity: qty, override_reason: reason, confirm: true })}
              disabled={busy}
              className={btn.primary}
            >
              {busy && <Spinner />}
              Confirm approval
            </button>
            <button onClick={() => setMode("edit")} disabled={busy} className={btn.secondary}>
              Back
            </button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-700">Why are you rejecting this?</span>
            <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Promotion cancelled" className={`${inputCls} mt-1`} autoFocus />
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => send("rejected", { note: rejectReason })} disabled={busy || rejectReason.trim().length < MIN_REASON_LENGTH} className={btn.danger}>
              {busy && <Spinner />}
              Reject recommendation
            </button>
            <button onClick={() => setMode("edit")} disabled={busy} className={btn.secondary}>
              Back
            </button>
          </div>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
