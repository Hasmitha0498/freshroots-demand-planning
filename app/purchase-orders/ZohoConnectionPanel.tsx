"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, btn, Card, Notice } from "@/components/ui";
import { dateTime } from "@/lib/format";
import type { ZohoStatus } from "@/lib/server/zoho";

interface Org {
  organization_id: string;
  name: string;
  currency_code?: string;
}

export function ZohoConnectionPanel({ status, missingEnv, flash }: { status: ZohoStatus; missingEnv: string[]; flash: { error?: string; connected?: boolean } }) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [selected, setSelected] = useState(status.organization_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, init?: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const state = !status.configured ? "not_configured" : !status.connected ? "disconnected" : !status.organization_id ? "no_org" : "ready";
  const badge = {
    not_configured: ["Demo / Disconnected — server credentials missing", "bg-slate-100 text-slate-700 ring-slate-300"],
    disconnected: ["Demo / Disconnected — not connected", "bg-slate-100 text-slate-700 ring-slate-300"],
    no_org: ["Connected — select organisation", "bg-amber-50 text-amber-800 ring-amber-300"],
    ready: ["Live Zoho Inventory connected", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  }[state];

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Zoho Inventory connection</h2>
            <Badge className={badge[1]}>{badge[0]}</Badge>
          </div>
          {status.connected && (
            <p className="mt-1 text-sm text-slate-600">
              API {status.api_domain} · organisation {status.organization_name ? `${status.organization_name} (${status.organization_id})` : "not selected"} · connected by {status.connected_by_email} {dateTime(status.connected_at)}
            </p>
          )}
          {state === "not_configured" && (
            <p className="mt-1 text-sm text-slate-600">
              Set <code className="font-mono">{missingEnv.join(", ")}</code> on the server to enable OAuth. Until then this page shows a labelled preview only.
            </p>
          )}
        </div>
        {status.configured && (
          <div className="flex flex-wrap gap-2">
            {(state === "disconnected" || state === "no_org" || state === "ready") && (
              <a href="/api/zoho/connect" className={state === "disconnected" ? btn.primary : btn.secondary}>
                {state === "disconnected" ? "Connect Zoho Inventory" : "Reconnect"}
              </a>
            )}
            {status.connected && (
              <button
                className={btn.danger}
                disabled={busy}
                onClick={async () => {
                  if (confirm("Disconnect Zoho Inventory? Stored tokens will be deleted and revoked.") && (await call("/api/zoho/disconnect", { method: "POST" }))) router.refresh();
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {flash.error && <Notice tone="error">Zoho: {flash.error}</Notice>}
        {flash.connected && state !== "not_configured" && <Notice tone="ok">Zoho account connected. Tokens are stored encrypted on the server.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      {status.connected && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {orgs === null ? (
            <button className={btn.secondary} disabled={busy} onClick={async () => setOrgs((await call("/api/zoho/organizations"))?.organizations ?? null)}>
              {busy ? "Loading…" : status.organization_id ? "Change organisation" : "Load Zoho organisations"}
            </button>
          ) : (
            <>
              <label className="text-sm">
                <span className="text-slate-600">Organisation</span>
                <select value={selected} onChange={(e) => setSelected(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="">Select…</option>
                  {orgs.map((o) => (
                    <option key={o.organization_id} value={o.organization_id}>
                      {o.name} ({o.organization_id}){o.currency_code ? ` · ${o.currency_code}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={btn.primary}
                disabled={!selected || busy}
                onClick={async () => {
                  if (await call("/api/zoho/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organization_id: selected }) })) {
                    setOrgs(null);
                    router.refresh();
                  }
                }}
              >
                Use this organisation
              </button>
              {orgs.length === 0 && <span className="text-sm text-slate-600">No organisations returned for this Zoho account.</span>}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
