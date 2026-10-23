"use client";
import Link from "next/link";
import { useState } from "react";
import { DecisionPanel } from "./DecisionPanel";
import { Drawer } from "@/components/Drawer";
import { ProductSummary } from "@/components/ProductSummary";
import { btn, Card, Chip, EmptyState } from "@/components/ui";
import type { SkuPlan } from "@/lib/planning/types";
import { actionText, HEALTH, headline, productName, progress, weeks } from "@/lib/presentation";

export interface RecItem {
  id: string;
  plan: SkuPlan;
  proposed_qty: number | null;
  decision: "pending" | "approved" | "rejected" | "needs_review" | "superseded" | "not_actionable";
  po_status: "not_applicable" | "ready" | "submitting" | "created" | "failed" | "needs_reconciliation";
  approved_qty: number | null;
  override_reason: string | null;
  decision_note: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  mapped: boolean;
}

type Tab = "review" | "decided" | "all";
const isOpen = (i: RecItem) => i.decision === "pending" || i.decision === "needs_review";

export function RecommendationsView({ items, planningMonth, initialSku }: { items: RecItem[]; planningMonth: string | null; initialSku: string | null }) {
  const toReview = items.filter(isOpen);
  const [tab, setTab] = useState<Tab>(toReview.length ? "review" : "all");
  const [selectedId, setSelectedId] = useState<string | null>(() => items.find((i) => i.plan.sku_id === initialSku)?.id ?? null);
  // Read the selected item from props so it updates after a decision refreshes the page.
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const readyForPo = items.filter((i) => i.decision === "approved" && (i.approved_qty ?? 0) > 0 && ["ready", "failed"].includes(i.po_status)).length;

  const shown = (tab === "review" ? toReview : tab === "decided" ? items.filter((i) => !isOpen(i)) : items).slice().sort((a, b) => a.plan.priority - b.plan.priority);
  const tabs: [Tab, string][] = [
    ["review", `To review (${toReview.length})`],
    ["decided", `Decided (${items.length - toReview.length})`],
    ["all", `All (${items.length})`],
  ];

  return (
    <div className="space-y-5">
      {readyForPo > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-800">
            {readyForPo} approved {readyForPo === 1 ? "reorder is" : "reorders are"} ready for a purchase order.
          </p>
          <Link href="/purchase-orders" className={btn.secondary}>
            Create purchase orders →
          </Link>
        </div>
      )}

      <div role="tablist" aria-label="Filter recommendations" className="inline-flex gap-1 rounded-md bg-slate-100 p-0.5 text-sm">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${tab === k ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {l}
          </button>
        ))}
      </div>

      <Card>
        {shown.length === 0 ? (
          <EmptyState title={tab === "review" ? "All caught up" : "Nothing here yet"}>
            {tab === "review" ? "Every recommendation from this plan has a decision." : "Decisions you make will appear here."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            <li aria-hidden className="hidden grid-cols-[minmax(0,1.6fr)_8rem_7rem_minmax(0,1fr)_8rem_5.5rem] gap-4 bg-slate-50 px-5 py-2.5 text-xs font-medium text-slate-500 lg:grid">
              <span>Product</span>
              <span>Status</span>
              <span className="text-right">Stock lasts</span>
              <span>Suggested action</span>
              <span>Decision</span>
              <span />
            </li>
            {shown.map((i) => {
              const h = HEALTH[i.plan.status];
              const pr = progress(i, { mapped: i.mapped });
              return (
                <li key={i.id} className="grid grid-cols-1 gap-2 px-5 py-3.5 hover:bg-slate-50 lg:grid-cols-[minmax(0,1.6fr)_8rem_7rem_minmax(0,1fr)_8rem_5.5rem] lg:items-center lg:gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {productName(i.plan.sku_name)} <span className="font-normal text-slate-400">{i.plan.sku_id}</span>
                    </p>
                    <p className="truncate text-sm text-slate-500">{headline(i.plan)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={h.tone}>{h.label}</Chip>
                    <span className="lg:hidden">
                      <Chip tone={pr.tone} dot={false}>
                        {pr.label}
                      </Chip>
                    </span>
                  </div>
                  <p className="tabular hidden text-right text-sm text-slate-900 lg:block">{weeks(i.plan.weeks_of_cover)}</p>
                  <p className="text-sm font-medium text-slate-900">
                    {i.decision === "approved" && i.approved_qty ? `Approved ${i.approved_qty.toLocaleString("en-IN")} units` : actionText(i.plan)}
                  </p>
                  <div className="hidden lg:block">
                    <Chip tone={pr.tone} dot={false}>
                      {pr.label}
                    </Chip>
                  </div>
                  <div className="lg:text-right">
                    <button onClick={() => setSelectedId(i.id)} className={isOpen(i) ? btn.secondary : btn.ghost}>
                      {isOpen(i) ? "Review" : "View"}
                      <span className="sr-only"> {productName(i.plan.sku_name)}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Drawer
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected ? productName(selected.plan.sku_name) : ""}
        subtitle={
          selected && (
            <>
              <span>{selected.plan.sku_id}</span>
              <Chip tone={HEALTH[selected.plan.status].tone}>{HEALTH[selected.plan.status].label}</Chip>
              <Chip tone={progress(selected, { mapped: selected.mapped }).tone} dot={false}>
                {progress(selected, { mapped: selected.mapped }).label}
              </Chip>
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-6">
            <ProductSummary plan={selected.plan} planningMonth={planningMonth} />
            <DecisionPanel key={`${selected.id}-${selected.decision}-${selected.po_status}`} item={selected} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
