import { monthName, shortDate, shortDateTime } from "@/lib/presentation";

/** Data freshness, one quiet line: when the stock data is from and when planning last ran. */
export function DataLine({ asOf, plannedAt, festivalMonth }: { asOf: string | null; plannedAt?: string | null; festivalMonth?: string | null }) {
  return (
    <>
      <span>Stock as of {shortDate(asOf)}</span>
      {plannedAt && (
        <>
          <span aria-hidden>·</span>
          <span>Planned {shortDateTime(plannedAt)}</span>
        </>
      )}
      {festivalMonth && (
        <>
          <span aria-hidden>·</span>
          <span>{monthName(festivalMonth)}: +25% festival demand</span>
        </>
      )}
      <span
        className="cursor-help rounded border border-slate-200 bg-white px-1.5 py-px text-xs text-slate-500"
        title="Demo data: a 15-product sample stored in Supabase, standing in for SAP. It changes only when the sample is reloaded."
      >
        Demo data
      </span>
    </>
  );
}
