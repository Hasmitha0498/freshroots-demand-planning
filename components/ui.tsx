// Shared UI primitives. Neutral slate surfaces, one emerald accent for the
// primary action, status colour only on chips and notices.
import type { ReactNode } from "react";
import type { Tone } from "@/lib/presentation";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2";
const base = `inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;

/** Button / link class names. Use at most one `primary` per view. */
export const btn = {
  primary: `${base} h-9 bg-emerald-700 px-4 text-white hover:bg-emerald-800`,
  secondary: `${base} h-9 border border-slate-300 bg-white px-3.5 text-slate-800 hover:bg-slate-50`,
  ghost: `${base} h-8 px-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900`,
  danger: `${base} h-9 border border-rose-200 bg-white px-3.5 text-rose-700 hover:bg-rose-50`,
  link: `rounded text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline ${focus}`,
};

export const inputCls = `block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500 ${focus} focus-visible:ring-offset-0`;

const TONE: Record<Tone, string> = {
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  gray: "bg-slate-100 text-slate-600 ring-slate-200",
};
const DOT: Record<Tone, string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  blue: "bg-sky-500",
  violet: "bg-violet-500",
  green: "bg-emerald-500",
  gray: "bg-slate-400",
};

/** Status chip: always text + colour, never colour alone. */
export function Chip({ tone = "gray", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`min-w-0 rounded-lg border border-slate-200 bg-white ${className}`}>{children}</section>;
}

export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {meta && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Titled block inside a page. */
export function Section({ title, description, actions, children, className = "" }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "ok"; title?: string; children: ReactNode }) {
  const styles = {
    info: "border-slate-200 bg-slate-50 text-slate-700",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div className={`rounded-md border px-3.5 py-2.5 text-sm ${styles}`} role={tone === "error" ? "alert" : "status"}>
      {title && <p className="font-medium">{title}</p>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

/** Label / value pair for detail views. */
export function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
}
