// Applies the real migration to an in-process Postgres (PGlite) and checks
// constraints, seed idempotency and the atomic PO-claim function.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCsvDir } from "@/lib/data/loadCsvDir";
import { buildSeedRows, SEED_ORDER } from "@/lib/data/seedRows";

const db = new PGlite();
const rows = buildSeedRows(loadCsvDir(join(__dirname, "..", "data")).data);

async function upsert(table: string, conflict: string, list: Record<string, unknown>[]) {
  for (const r of list) {
    const cols = Object.keys(r);
    const updates = cols.filter((c) => !conflict.split(",").includes(c)).map((c) => `${c} = excluded.${c}`);
    await db.query(
      `insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})
       on conflict (${conflict}) do ${updates.length ? `update set ${updates.join(",")}` : "nothing"}`,
      cols.map((c) => r[c]),
    );
  }
}

async function seed() {
  for (const [table, conflict] of SEED_ORDER) await upsert(table, conflict, rows[table] as Record<string, unknown>[]);
}

beforeAll(async () => {
  await db.exec(readFileSync(join(__dirname, "..", "supabase", "migrations", "0001_init.sql"), "utf8"));
  // Re-applying must be safe.
  await db.exec(readFileSync(join(__dirname, "..", "supabase", "migrations", "0001_init.sql"), "utf8"));
  await db.exec(readFileSync(join(__dirname, "..", "supabase", "migrations", "0002_service_role_grants.sql"), "utf8"));
});

const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n;

describe("migration + seed", () => {
  it("seeds idempotently", async () => {
    await seed();
    await seed();
    expect(await count("sku_master")).toBe(15);
    expect(await count("weekly_sales")).toBe(240);
    expect(await count("festival_calendar")).toBe(24);
  });

  it("rejects bad source rows", async () => {
    await expect(db.query("insert into weekly_sales values ('SKU001','2026-W43',2026,43,-1)")).rejects.toThrow();
    await expect(db.query("insert into weekly_sales values ('SKU001','2026-43',2026,43,1)")).rejects.toThrow();
    await expect(db.query("insert into weekly_sales values ('SKU001','2026-W42',2026,42,1)")).rejects.toThrow(); // duplicate PK
    await expect(db.query("insert into weekly_sales values ('NOPE','2026-W43',2026,43,1)")).rejects.toThrow();
    await expect(db.query("update current_inventory set units_on_hand = -1 where sku_id='SKU001'")).rejects.toThrow();
  });

  it("claims approved recommendations for exactly one PO", async () => {
    const run = await db.query<{ id: string }>(
      `insert into planning_runs (created_by_email, rules_version, festival_applied, festival_source, snapshot, counts)
       values ('p@x', 'v1', true, 'calendar', '{}', '{}') returning id`,
    );
    const runId = run.rows[0].id;
    const ins = async (sku: string, decision: string, qty: number | null, po: string) =>
      (
        await db.query<{ id: string }>(
          `insert into recommendations (run_id, sku_id, status_flag, action, priority, triggered_rules, standard_reorder_qty, proposed_qty, calculation, decision, approved_qty, decided_at, po_status)
           values ($1,$2,'stockout','reorder_immediately',1,'{}',100,100,'{}',$3,$4, now(), $5) returning id`,
          [runId, sku, decision, qty, po],
        )
      ).rows[0].id;
    const a = await ins("SKU001", "approved", 750, "ready");
    const b = await ins("SKU003", "approved", 300, "ready");
    const pending = await ins("SKU004", "pending", null, "not_applicable");
    // cannot mark an unapproved rec ready
    await expect(ins("SKU011", "pending", null, "ready")).rejects.toThrow();

    const po = async (key: string, ids: string[]) =>
      (
        await db.query<{ id: string }>(
          `insert into purchase_orders (idempotency_key, reference_number, organization_id, zoho_vendor_id, zoho_vendor_name, recommendation_ids, request_payload, status, created_by_email)
           values ($1, $1, 'org', 'v', 'Vendor', $2, '{}', 'submitting', 'p@x') returning id`,
          [key, ids],
        )
      ).rows[0].id;
    const po1 = await po("k1", [a, b]);
    expect((await db.query("select claim_recommendations_for_po($1, $2) as n", [po1, [a, b]])).rows[0]).toEqual({ n: 2 });
    // a second PO cannot claim the same recommendation
    const po2 = await po("k2", [a]);
    await expect(db.query("select claim_recommendations_for_po($1, $2)", [po2, [a]])).rejects.toThrow(/claim_failed/);
    // unapproved recommendation can never be claimed
    await expect(db.query("select claim_recommendations_for_po($1, $2)", [po2, [pending]])).rejects.toThrow(/claim_failed/);
    // duplicate idempotency key rejected
    await expect(po("k1", [a])).rejects.toThrow();
  });
});
