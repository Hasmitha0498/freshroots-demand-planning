import type { SkuPlan } from "@/lib/planning/types";
import { int } from "@/lib/format";
import { reasons, weeks } from "@/lib/presentation";
import { CalculationTrace } from "./CalculationTrace";
import { Fact } from "./ui";

/** Why a product needs attention: plain reasons, key numbers, calculation on request. */
export function ProductSummary({ plan, planningMonth }: { plan: SkuPlan; planningMonth?: string | null }) {
  const why = reasons(plan, planningMonth);
  return (
    <div className="space-y-5">
      <ul className="space-y-1.5 text-sm text-slate-800">
        {why.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            {r}
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-4 sm:grid-cols-4">
        <Fact label="In stock" value={`${int(plan.units_on_hand)}`} hint="units" />
        <Fact label="Weekly demand" value={plan.adjusted_weekly_demand === null ? "–" : Math.round(plan.adjusted_weekly_demand).toLocaleString("en-IN")} hint="units / week" />
        <Fact label="Stock lasts" value={weeks(plan.weeks_of_cover)} />
        <Fact label="Target" value={`${plan.min_cover_weeks}–${plan.max_cover_weeks} weeks`} hint={plan.flags.high_perishability ? "perishable" : undefined} />
      </dl>
      {plan.warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-800">
          {plan.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <details className="group rounded-md border border-slate-200">
        <summary className="cursor-pointer select-none rounded-md px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
          Show calculation
        </summary>
        <div className="border-t border-slate-200 p-4">
          <CalculationTrace plan={plan} />
        </div>
      </details>
    </div>
  );
}
