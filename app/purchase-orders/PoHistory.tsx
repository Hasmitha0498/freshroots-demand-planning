"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn, Card, Chip, EmptyState, Section } from "@/components/ui";
import { inr, int } from "@/lib/format";
import { productName, shortDateTime, type Tone } from "@/lib/presentation";

export interface PoRow {
  id: string;
  reference_number: string;
  status: string;
  attempts: number;
  zoho_vendor_name: string;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  error_message: string | null;
  warnings: string[];
  created_at: string;
  products: { name: string; qty: number | null }[];
  total: number;
  link: string | null;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  created: { label: "PO created", tone: "green" },
  failed: { label: "PO failed", tone: "red" },
  needs_reconciliation: { label: "Check in Zoho", tone: "amber" },
  submitting: { label: "Creating PO", tone: "blue" },
};

export function PoHistory({ rows }: { rows: PoRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function check(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/purchase-orders/${id}/reconcile`, { method: "POST" });
      const body = await res.json();
      setMsg({
        ...msg,
        [id]: res.ok
          ? body.result === "found"
            ? "Found in Zoho — updated."
            : body.result === "not_found"
              ? "Not in Zoho. You can create it again from Ready to order."
              : "Updated."
          : body.error,
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Purchase orders">
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No purchase orders yet">Purchase orders you create appear here with their Zoho number.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, tone: "gray" as Tone };
              return (
                <li key={r.id} className="grid grid-cols-1 gap-2 px-5 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)_7rem_9rem] sm:items-start sm:gap-4">
                  <div>
                    {r.zoho_purchaseorder_number ? (
                      r.link ? (
                        <a href={r.link} target="_blank" rel="noopener noreferrer" className={`${btn.link} text-sm`} title={`Zoho ID ${r.zoho_purchaseorder_id} · reference ${r.reference_number}`}>
                          {r.zoho_purchaseorder_number} ↗
                        </a>
                      ) : (
                        <span className="text-sm font-medium text-slate-900">{r.zoho_purchaseorder_number}</span>
                      )
                    ) : (
                      <span className="text-sm text-slate-400" title={`Reference ${r.reference_number}`}>
                        Not created
                      </span>
                    )}
                    <p className="text-xs text-slate-500">{shortDateTime(r.created_at)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-900">{r.zoho_vendor_name}</p>
                    <p className="truncate text-xs text-slate-500">{r.products.map((p) => `${productName(p.name)} × ${int(p.qty)}`).join(", ")}</p>
                    {r.status === "failed" && r.error_message && <p className="mt-1 text-xs text-red-700">{r.error_message}</p>}
                    {r.warnings?.map((w) => (
                      <p key={w} className="mt-1 text-xs text-amber-800">
                        ⚠ {w}
                      </p>
                    ))}
                    {msg[r.id] && <p className="mt-1 text-xs text-slate-600">{msg[r.id]}</p>}
                  </div>
                  <p className="tabular text-sm text-slate-900 sm:text-right">{inr(r.total)}</p>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Chip tone={s.tone}>{s.label}</Chip>
                    {(r.status === "needs_reconciliation" || r.status === "submitting") && (
                      <button className={btn.ghost} disabled={busy === r.id} onClick={() => check(r.id)}>
                        {busy === r.id ? "Checking…" : "Check Zoho"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Section>
  );
}
