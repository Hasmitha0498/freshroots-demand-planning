"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn, Spinner } from "./ui";

export function RunPlanningButton({ disabled, reason }: { disabled?: boolean; reason?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/planning/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Planning failed (HTTP ${res.status}).`);
      const n = body.counts.actionable as number;
      setMsg({ ok: true, text: n ? `Planning updated — ${n} ${n === 1 ? "product needs" : "products need"} attention.` : "Planning updated — no products need attention." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Planning failed. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button onClick={run} disabled={busy || disabled} className={btn.primary}>
        {busy && <Spinner />}
        {busy ? "Planning…" : "Run planning"}
      </button>
      <p aria-live="polite" className={`max-w-xs text-xs sm:text-right ${msg ? (msg.ok ? "text-emerald-700" : "text-red-700") : "text-slate-500"}`}>
        {msg?.text ?? (disabled ? reason : null)}
      </p>
    </div>
  );
}
