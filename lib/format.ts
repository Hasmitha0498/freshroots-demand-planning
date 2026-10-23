// Client-safe display helpers.
import type { RiskStatus } from "./planning/types";

export const nf = (n: number | null | undefined, dp = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? "–" : n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const int = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-IN"));

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " IST";
}

export const STATUS_STYLE: Record<RiskStatus, string> = {
  stockout: "bg-red-50 text-red-700 ring-red-200",
  conflict: "bg-amber-50 text-amber-800 ring-amber-300",
  demand_spike: "bg-violet-50 text-violet-700 ring-violet-200",
  overstock: "bg-sky-50 text-sky-700 ring-sky-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  insufficient_data: "bg-slate-100 text-slate-600 ring-slate-300",
};

export const DECISION_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 ring-slate-300",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  needs_review: "bg-amber-50 text-amber-800 ring-amber-300",
  superseded: "bg-slate-100 text-slate-500 ring-slate-200",
  not_actionable: "bg-slate-50 text-slate-500 ring-slate-200",
};

export const PO_STATUS_LABEL: Record<string, string> = {
  not_applicable: "No PO",
  ready: "Ready for PO",
  submitting: "Submitting…",
  created: "Draft PO created",
  failed: "PO not created",
  needs_reconciliation: "Needs reconciliation",
};
