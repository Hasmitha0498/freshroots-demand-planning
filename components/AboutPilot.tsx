"use client";
import { useState } from "react";
import { Drawer } from "./Drawer";

// About this pilot: data source and the five pre-build decisions.
// Business impact is unproven until measured in a real pilot.
const DECISIONS: [string, string][] = [
  ["Outcome", "Fewer stockouts and write-offs on pilot products, and a faster, traceable plan → approve → purchase order cycle."],
  ["Baseline", "Today's monthly Excel process: planning effort, data that is 3–4 weeks old, and quarterly stockouts and write-offs. The case estimates of ₹18–22 lakh and ₹10–12 lakh are historical problem sizes, not promised savings."],
  ["Workflow change", "Planning runs on demand from stored data. The rules flag products and explain why, the planner approves or edits with a reason, and a draft purchase order goes to Zoho. Nothing is ordered automatically."],
  ["Measurement", "Per run: planning time, time to approve, time to purchase order, and how often and why quantities are changed. Per quarter: stockouts, write-offs and whether the decisions held up."],
  ["Stop if", "After a defined pilot on real data, planners override most recommendations, planning takes as long as before, or stockouts and write-offs don't improve."],
];

export function AboutPilot() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded text-xs text-slate-500 hover:text-slate-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
        About this pilot
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="About this pilot">
        <div className="space-y-5 text-sm text-slate-700">
          <div className="space-y-2">
            <p>
              <strong className="font-medium text-slate-900">Demo data.</strong> Sales and stock come from a 15-product, 16-week sample stored in Supabase, which stands in for SAP. It changes only when the sample is reloaded.
            </p>
            <p>
              <strong className="font-medium text-slate-900">Rules, not AI.</strong> Recommendations come from five fixed planning rules: sales spikes, low stock, excess stock, festival months and perishable limits. Every number can be traced in a product&apos;s calculation.
            </p>
            <p>
              <strong className="font-medium text-slate-900">Purchase orders</strong> are created as drafts in Zoho Inventory. Nothing is sent to vendors.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">How the pilot will be judged</h3>
            <dl className="mt-2 space-y-3">
              {DECISIONS.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
                  <dd className="mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Drawer>
    </>
  );
}
