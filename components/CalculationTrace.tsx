import type { RuleId, SkuPlan } from "@/lib/planning/types";
import { int, nf } from "@/lib/format";
import { RULE } from "@/lib/presentation";
import { Sparkline } from "./Sparkline";

/** Full, inspectable calculation for one product (shown on request). */
export function CalculationTrace({ plan }: { plan: SkuPlan }) {
  const rows: [string, string][] = [
    ["Stock on hand", `${int(plan.units_on_hand)} units${plan.location ? ` · ${plan.location}` : ""}`],
    ["Average weekly sales", `${nf(plan.avg_4w)} (last 4 weeks) · ${nf(plan.avg_12w)} (last 12 weeks)`],
    ["Change", plan.pct_change === null ? "–" : `${plan.pct_change >= 0 ? "+" : ""}${nf(plan.pct_change)}% (spike if more than +20%)`],
    ["Expected weekly demand", `${nf(plan.adjusted_weekly_demand)}${plan.festival_applied ? ` (${nf(plan.baseline_weekly_demand)} + 25% festival)` : ""}`],
    ["Weeks of stock left", `${nf(plan.weeks_of_cover, 2)} · target ${plan.min_cover_weeks}–${plan.max_cover_weeks} weeks`],
    ["Standard order quantity", `${int(plan.standard_reorder_qty)} units`],
    ["Stock after suggested order", plan.projected_cover_after_order === null ? "–" : `${nf(plan.projected_cover_after_order, 2)} weeks`],
  ];
  return (
    <div className="space-y-5">
      <Sparkline history={plan.history} weeksUsed={plan.weeks_used} />
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="tabular -mt-1.5 text-slate-900 sm:mt-0">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-xs font-medium text-slate-500">Rules applied</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {(Object.keys(plan.flags) as RuleId[]).map((r) => (
            <li key={r} className={`rounded px-1.5 py-0.5 text-xs ${plan.flags[r] ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-400"}`}>
              {RULE[r]}
              <span className="sr-only">{plan.flags[r] ? " (applied)" : " (not applied)"}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">Step by step</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          {plan.explanation.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
