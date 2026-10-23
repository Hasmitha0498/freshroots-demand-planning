"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "./ui";

export function RunPlanningButton({ disabled, reason }: { disabled?: boolean; reason?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/planning/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMsg({ tone: "ok", text: `Planning run saved — ${body.counts.actionable} SKUs need attention.` });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Run failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button onClick={run} disabled={busy || disabled} title={reason} className={btn.primary}>
        {busy ? "Reading Supabase…" : "Run Demand Planning"}
      </button>
      {disabled && reason && <span className="text-xs text-slate-500">{reason}</span>}
      {msg && <span className={`text-xs ${msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}`} role="status">{msg.text}</span>}
    </div>
  );
}
