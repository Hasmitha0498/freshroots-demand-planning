import { Card } from "./ui";

// The five pre-build decisions. Impact is unproven until measured in a real pilot.
const ITEMS: [string, string][] = [
  ["Outcome definition", "Fewer stockouts and overstock write-offs on pilot SKUs, with a faster, traceable plan → approve → PO cycle. Not claimed from this static dataset."],
  ["Baseline", "Current monthly Excel process: planning effort per cycle, data age (3–4 weeks), stockout incidents and write-offs per quarter (case estimate ₹18–22 lakh and ₹10–12 lakh — historical problem estimates, not savings)."],
  ["Workflow change", "Run on demand from stored data → rules flag risks with explanations → Raghav approves / edits with reasons → draft PO in Zoho. No autonomous ordering."],
  ["Measurement plan", "Log per run: planning time, recommendation → approval time, approval → draft-PO time, override rate and reasons; per quarter: stockout incidents, write-offs, decision quality (would the rule have been right in hindsight?)."],
  ["Kill criterion", "Stop or redesign if, after a defined pilot period on real data, planners override most recommendations, planning time does not fall, or stockout / write-off rates do not improve vs. baseline."],
];

export function PilotMeasurement() {
  return (
    <Card>
      <details className="group p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">About / Pilot measurement</summary>
        <p className="mt-2 text-sm text-slate-600">
          This MVP runs on a 15-SKU, 16-week demonstration dataset (the case describes ~400 SKUs and 1,200 distributors). Business impact still needs real-world measurement.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {ITEMS.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
              <dd className="mt-1 text-sm text-slate-700">{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}
