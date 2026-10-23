// One-off fix for a demo Zoho organisation: turn on Purchase Information for
// every item imported from zoho_import/items.csv (Zoho rejects sales-only
// items on purchase orders, error 29032).
//
// 1. Self Client → Generate Code, scope: ZohoInventory.items.READ,ZohoInventory.items.UPDATE
// 2. npm run zoho:enable-purchasing -- <code>              # makes the changes
//    npm run zoho:enable-purchasing -- <code> --dry-run    # only shows them (uses up the code)
//
// The code's token is used for this run only and is never saved, so the app
// itself keeps its read-and-create-PO-only permissions.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { toTable } from "../lib/data/csv";
import { listItems, listVendors, toItem } from "../lib/zoho/api";
import { ZohoClient } from "../lib/zoho/client";
import { safeAccountsOrigin, safeApiOrigin } from "../lib/zoho/config";

config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const code = args.find((a) => !a.startsWith("--"));
  const apply = !args.includes("--dry-run");
  if (!code) {
    console.log("Usage: npm run zoho:enable-purchasing -- <code> [--dry-run]\nScope: ZohoInventory.items.READ,ZohoInventory.items.UPDATE");
    process.exit(1);
  }
  const accounts = safeAccountsOrigin(process.env.ZOHO_ACCOUNTS_DOMAIN ?? "");
  const api = safeApiOrigin(process.env.ZOHO_API_DOMAIN ?? "");
  const org = process.env.ZOHO_ORGANIZATION_ID;
  if (!accounts || !api || !org || !process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    console.error("Needs ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ACCOUNTS_DOMAIN, ZOHO_API_DOMAIN and ZOHO_ORGANIZATION_ID in .env.local.");
    process.exit(1);
  }

  const res = await fetch(`${accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, code }),
  });
  const t = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; error?: string };
  if (!t.access_token) {
    console.error(`Zoho did not issue a token (${t.error ?? `HTTP ${res.status}`}). Codes last up to 10 minutes and work once — generate a new one.`);
    process.exit(1);
  }
  if (!t.scope?.includes("ZohoInventory.items.UPDATE")) {
    console.error(`The code is missing ZohoInventory.items.UPDATE (granted: ${t.scope ?? "unknown"}). Generate a new code with: ZohoInventory.items.READ,ZohoInventory.items.UPDATE`);
    process.exit(1);
  }
  const token = t.access_token;
  const client = new ZohoClient({ apiDomain: api, organizationId: org, getAccessToken: async () => token });

  // Desired purchase details per SKU, from the import file.
  const wanted = new Map(
    toTable(readFileSync("zoho_import/items.csv", "utf8")).records.map((r) => [r.SKU, { purchase_rate: Number(r["Purchase Rate"]), vendor: r["Preferred Vendor"] }]),
  );
  const { items } = await listItems(client);
  const { vendors } = await listVendors(client).catch(() => ({ vendors: [] as { contact_id: string; contact_name: string }[] }));

  let changed = 0;
  let failed = 0;
  for (const item of items.sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? ""))) {
    const w = item.sku ? wanted.get(item.sku) : undefined;
    if (!w) continue;
    if (item.item_type !== "sales" && (item.purchase_rate ?? 0) > 0) {
      console.log(`= ${item.sku} ${item.name}: already purchasable (${item.item_type}, cost ${item.purchase_rate})`);
      continue;
    }
    const vendor = vendors.find((v) => v.contact_name === w.vendor);
    const body: Record<string, unknown> = {
      name: item.name,
      item_type: item.item_type === "inventory" ? "inventory" : "sales_and_purchases",
      can_be_purchased: true,
      purchase_rate: w.purchase_rate,
      ...(vendor ? { vendor_id: vendor.contact_id } : {}),
    };
    const label = `${item.sku} ${item.name}: ${item.item_type} → ${body.item_type}, cost ${w.purchase_rate.toFixed(2)}${vendor ? `, vendor ${vendor.contact_name}` : ""}`;
    if (!apply) {
      console.log(`~ would update ${label}`);
      continue;
    }
    try {
      const out = await client.request<{ item?: Record<string, unknown> }>(`/items/${encodeURIComponent(item.item_id)}`, { method: "PUT", json: body });
      const after = out.item ? toItem(out.item) : null;
      console.log(`✓ updated ${label}${after ? ` (Zoho now: ${after.item_type}, cost ${after.purchase_rate})` : ""}`);
      changed++;
    } catch (e) {
      console.error(`✕ ${label}: ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }
  console.log(apply ? `\nDone: ${changed} updated, ${failed} failed.` : "\nDry run only — re-run with a NEW code (without --dry-run) to make these changes.");
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
