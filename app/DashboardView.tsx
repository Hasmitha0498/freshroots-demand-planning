"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { CalculationTrace } from "@/components/CalculationTrace";
import { Badge, Card } from "@/components/ui";
import { ACTION_LABELS, STATUS_LABELS } from "@/lib/planning/rules";
import type { RiskStatus } from "@/lib/planning/types";
import { int, nf, STATUS_STYLE } from "@/lib/format";
import type { RecommendationRecord, RunSummary } from "@/lib/server/repo";

type Filter = "all" | "stockout_risk" | "overstock_risk" | "demand_spike" | "attention";

export function DashboardView({ run, recs }: { run: RunSummary; recs: RecommendationRecord[] }) {
  const [filter, setFilter] = useState<Filter>("attention");
  const [open, setOpen] = useState<string | null>(null);
  const plans = recs.map((r) => r.calculation);

  const shown = useMemo(
    () =>
      plans.filter((p) =>
        filter === "all" ? true : filter === "attention" ? p.status !== "ok" : p.flags[filter],
      ),
    [plans, filter],
  );

  const c = run.counts;
  const kpis: { key: Filter; label: string; value: number; tone: string; note?: string }[] = [
    { key: "all", label: "Total SKUs", value: c.total_skus, tone: "text-slate-900" },
    { key: "stockout_risk", label: "Stockout risk", value: c.stockout_risk, tone: "text-red-700" },
    { key: "overstock_risk", label: "Overstock risk", value: c.overstock_risk, tone: "text-sky-700" },
    { key: "demand_spike", label: "Demand spikes", value: c.demand_spike, tone: "text-violet-700" },
  ];
  const overlap = plans.filter((p) => p.flags.demand_spike && (p.flags.stockout_risk || p.flags.overstock_risk)).map((p) => p.sku_id);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <button
            key={k.key}
            onClick={() => setFilter(k.key)}
            className={`rounded-xl border bg-white p-4 text-left shadow-sm transition ${filter === k.key ? "border-emerald-600 ring-1 ring-emerald-600" : "border-slate-200 hover:border-slate-300"}`}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
            <p className={`tabular mt-1 text-3xl font-semibold ${k.tone}`}>{k.value}</p>
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        Flags can overlap, so these counts are not mutually exclusive.
        {overlap.length > 0 && ` ${overlap.join(", ")} also triggers the demand-spike rule.`}
        {c.manual_review > 0 && ` ${c.manual_review} SKU(s) have conflicting rules and need manual review.`}
        {c.insufficient_data > 0 && ` ${c.insufficient_data} SKU(s) have insufficient data.`}
      </p>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap gap-1 text-sm">
            {(
              [
                ["attention", "Needs attention"],
                ["all", "All"],
                ["stockout_risk", "Stockout"],
                ["overstock_risk", "Overstock"],
                ["demand_spike", "Demand spike"],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {l}
              </button>
            ))}
          </div>
          <Link href="/recommendations" className="text-sm font-medium text-emerald-700 hover:underline">
            Review recommendations →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">SKU</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2 text-right">Stock</th>
                <th className="px-2 py-2 text-right">Avg 4w</th>
                <th className="px-2 py-2 text-right">Avg 12w</th>
                <th className="px-2 py-2 text-right">Adj. weekly demand</th>
                <th className="px-2 py-2 text-right">Weeks cover</th>
                <th className="px-2 py-2">Risk status</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <Fragment key={p.sku_id}>
                  <tr
                    onClick={() => setOpen(open === p.sku_id ? null : p.sku_id)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    aria-expanded={open === p.sku_id}
                  >
                    <td className="px-4 py-2 font-mono text-xs">{p.sku_id}</td>
                    <td className="px-2 py-2">
                      {p.sku_name}
                      {p.perishability === "High" && <span className="ml-1 text-xs text-amber-700">· High perishability</span>}
                    </td>
                    <td className="px-2 py-2 text-slate-600">{p.category}</td>
                    <td className="tabular px-2 py-2 text-right">{int(p.units_on_hand)}</td>
                    <td className="tabular px-2 py-2 text-right">{nf(p.avg_4w)}</td>
                    <td className="tabular px-2 py-2 text-right">{nf(p.avg_12w)}</td>
                    <td className="tabular px-2 py-2 text-right">
                      {nf(p.adjusted_weekly_demand)}
                      {p.festival_applied && <span className="ml-1 text-xs text-slate-400">+25%</span>}
                    </td>
                    <td className="tabular px-2 py-2 text-right">
                      {nf(p.weeks_of_cover, 2)}
                      <span className="ml-1 text-xs text-slate-400">
                        ({p.min_cover_weeks}–{p.max_cover_weeks})
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge className={STATUS_STYLE[p.status as RiskStatus]}>{STATUS_LABELS[p.status as RiskStatus]}</Badge>
                        {p.flags.demand_spike && p.status !== "demand_spike" && <Badge className={STATUS_STYLE.demand_spike}>+ spike</Badge>}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {ACTION_LABELS[p.action]}
                      {p.proposed_qty ? <span className="tabular text-slate-500"> · {int(p.proposed_qty)}</span> : null}
                    </td>
                  </tr>
                  {open === p.sku_id && (
                    <tr className="border-t border-slate-100 bg-slate-50/60">
                      <td colSpan={10} className="px-4 py-4">
                        <CalculationTrace plan={p} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    No SKUs match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Click a row to see how its recommendation was calculated.</p>
      </Card>
    </div>
  );
}
