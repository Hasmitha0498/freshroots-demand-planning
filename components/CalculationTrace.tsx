import { ACTION_LABELS, RULE_LABELS } from "@/lib/planning/rules";
import type { SkuPlan } from "@/lib/planning/types";
import { int, nf } from "@/lib/format";
import { Sparkline } from "./Sparkline";

export function CalculationTrace({ plan }: { plan: SkuPlan }) {
  const rows: [string, string][] = [
    ["Units on hand", `${int(plan.units_on_hand)} ${plan.location ? `(${plan.location})` : ""}`],
    ["4-week avg / 12-week avg", `${nf(plan.avg_4w)} / ${nf(plan.avg_12w)} (${plan.pct_change === null ? "–" : `${plan.pct_change >= 0 ? "+" : ""}${nf(plan.pct_change)}%`})`],
    ["Projected weekly demand", `${nf(plan.baseline_weekly_demand)} unadjusted → ${nf(plan.adjusted_weekly_demand)} adjusted (×${plan.uplift_factor})`],
    ["Weeks of cover", `${nf(plan.weeks_of_cover, 2)} (limits ${plan.min_cover_weeks}–${plan.max_cover_weeks})`],
    ["Standard reorder qty", `${int(plan.standard_reorder_qty)} ${plan.unit_of_measure}`],
    ["Action", `${ACTION_LABELS[plan.action]}${plan.proposed_qty ? ` — ${int(plan.proposed_qty)} units` : ""}`],
    ["Cover after proposed order", nf(plan.projected_cover_after_order, 2)],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="tabular text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-1">
          {(Object.keys(plan.flags) as (keyof typeof plan.flags)[]).map((r) => (
            <span key={r} className={`rounded px-1.5 py-0.5 text-xs ${plan.flags[r] ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-400 line-through"}`}>
              {RULE_LABELS[r]}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Sparkline history={plan.history} weeksUsed={plan.weeks_used} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          {plan.explanation.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ol>
        {plan.warnings.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800">
            {plan.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
