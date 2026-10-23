"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Drawer } from "@/components/Drawer";
import { ProductSummary } from "@/components/ProductSummary";
import { btn, Card, Chip, Section } from "@/components/ui";
import type { SkuPlan } from "@/lib/planning/types";
import { int } from "@/lib/format";
import { actionText, HEALTH, headline, productName, progress, weeks } from "@/lib/presentation";

export interface OverviewItem {
  id: string;
  plan: SkuPlan;
  decision: string;
  po_status: string;
  approved_qty: number | null;
  mapped: boolean;
}

type Filter = "attention" | "all" | "healthy";

export function OverviewView({ items, planningMonth }: { items: OverviewItem[]; planningMonth: string | null }) {
  const [filter, setFilter] = useState<Filter>("attention");
  const [detail, setDetail] = useState<OverviewItem | null>(null);

  const attention = useMemo(() => items.filter((i) => i.plan.status !== "ok").sort((a, b) => a.plan.priority - b.plan.priority), [items]);
  const count = (f: (p: SkuPlan) => boolean) => items.filter((i) => f(i.plan)).length;
  const toReview = attention.filter((i) => i.decision === "pending" || i.decision === "needs_review").length;
  const readyForPo = items.filter((i) => i.decision === "approved" && (i.approved_qty ?? 0) > 0 && ["ready", "failed"].includes(i.po_status)).length;
  const shown = items
    .filter((i) => (filter === "all" ? true : filter === "attention" ? i.plan.status !== "ok" : i.plan.status === "ok"))
    .sort((a, b) => a.plan.priority - b.plan.priority || a.plan.sku_id.localeCompare(b.plan.sku_id));

  const stats = [
    { label: "Need attention", value: attention.length, sub: `of ${items.length} products` },
    { label: "Running low", value: count((p) => p.flags.stockout_risk), sub: "reorder now" },
    { label: "Excess stock", value: count((p) => p.flags.overstock_risk), sub: "pause orders" },
    { label: "Sales rising", value: count((p) => p.flags.demand_spike), sub: "last 4 weeks" },
  ];

  return (
    <div className="space-y-8">
      <Card>
        <dl className="grid grid-cols-2 divide-slate-200 sm:grid-cols-4 sm:divide-x">
          {stats.map((s, i) => (
            <div key={s.label} className={`px-5 py-4 ${i < 2 ? "border-b border-slate-200 sm:border-b-0" : ""} ${i % 2 === 1 ? "border-l border-slate-200 sm:border-l-0" : ""}`}>
              <dt className="text-xs font-medium text-slate-500">{s.label}</dt>
              <dd className="tabular mt-1 text-2xl font-semibold text-slate-900">{s.value}</dd>
              <dd className="text-xs text-slate-500">{s.sub}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {(toReview > 0 || readyForPo > 0) && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-800">
            <span className="font-medium">Next step:</span>{" "}
            {toReview > 0
              ? `${toReview} ${toReview === 1 ? "recommendation is" : "recommendations are"} waiting for your decision.`
              : `${readyForPo} approved ${readyForPo === 1 ? "reorder is" : "reorders are"} ready for a purchase order.`}
          </p>
          <Link href={toReview > 0 ? "/recommendations" : "/purchase-orders"} className={btn.secondary}>
            {toReview > 0 ? "Review recommendations" : "Create purchase orders"} →
          </Link>
        </div>
      )}

      <Section title="Needs your attention" description={attention.length ? "Most urgent first." : undefined}>
        <Card>
          {attention.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No products need attention. Stock is on target everywhere.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((i) => {
                const h = HEALTH[i.plan.status];
                const pr = progress(i, { mapped: i.mapped });
                return (
                  <li key={i.id}>
                    <Link
                      href={`/recommendations?sku=${i.plan.sku_id}`}
                      className="flex flex-col gap-2 px-5 py-3.5 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {productName(i.plan.sku_name)} <span className="font-normal text-slate-400">{i.plan.sku_id}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          <Chip tone={h.tone}>{h.label}</Chip>
                          {i.plan.flags.demand_spike && i.plan.status !== "demand_spike" && <Chip tone="violet">Sales rising</Chip>}
                          <span>{headline(i.plan)}</span>
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <span className="text-sm font-medium text-slate-900">{actionText(i.plan)}</span>
                        <Chip tone={pr.tone} dot={false}>
                          {pr.label}
                        </Chip>
                        <span aria-hidden className="hidden text-slate-400 sm:inline">
                          ›
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </Section>

      <Section
        title="All products"
        actions={
          <div role="tablist" aria-label="Filter products" className="flex gap-1 rounded-md bg-slate-100 p-0.5 text-sm">
            {(
              [
                ["attention", `Need attention (${attention.length})`],
                ["healthy", `Healthy (${items.length - attention.length})`],
                ["all", `All (${items.length})`],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={filter === k}
                onClick={() => setFilter(k)}
                className={`rounded px-2.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${filter === k ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                {l}
              </button>
            ))}
          </div>
        }
      >
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="w-full px-5 py-2.5 font-medium sm:w-auto">Product</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">In stock</th>
                <th className="px-3 py-2.5 text-right font-medium">Stock lasts</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Status</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Suggested action</th>
                <th className="px-5 py-2.5">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((i) => {
                const h = HEALTH[i.plan.status];
                return (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{productName(i.plan.sku_name)}</p>
                      <p className="text-xs text-slate-500">{i.plan.sku_id}</p>
                      <div className="mt-1 md:hidden">
                        <Chip tone={h.tone}>{h.label}</Chip>
                      </div>
                    </td>
                    <td className="tabular hidden px-3 py-3 text-right text-slate-700 sm:table-cell">{int(i.plan.units_on_hand)}</td>
                    <td className="tabular whitespace-nowrap px-3 py-3 text-right text-slate-900">
                      {weeks(i.plan.weeks_of_cover)}
                      <span className="block text-xs text-slate-400">
                        target {i.plan.min_cover_weeks}–{i.plan.max_cover_weeks}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <Chip tone={h.tone}>{h.label}</Chip>
                    </td>
                    <td className="hidden px-3 py-3 text-slate-700 lg:table-cell">{actionText(i.plan)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => setDetail(i)} className={btn.ghost} aria-label={`Details for ${productName(i.plan.sku_name)}`}>
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </Section>

      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? productName(detail.plan.sku_name) : ""}
        subtitle={
          detail && (
            <>
              <span>{detail.plan.sku_id}</span>
              <Chip tone={HEALTH[detail.plan.status].tone}>{HEALTH[detail.plan.status].label}</Chip>
            </>
          )
        }
        footer={
          detail && detail.plan.status !== "ok" ? (
            <Link href={`/recommendations?sku=${detail.plan.sku_id}`} className={btn.primary}>
              Review recommendation
            </Link>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-5">
            <p className="text-sm text-slate-900">
              <span className="text-slate-500">Suggested action:</span> <span className="font-medium">{actionText(detail.plan)}</span>
            </p>
            <ProductSummary plan={detail.plan} planningMonth={planningMonth} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
