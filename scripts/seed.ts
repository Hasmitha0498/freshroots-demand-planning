// Idempotent import of the five SAP-style CSVs in ./data into Supabase.
// Validates first and aborts on any error. Upserts source tables only;
// planning runs, approvals, mappings and POs are never modified.
//
//   npm run db:seed            # validate + upsert
//   npm run db:seed -- --check # validate only, no writes
import { config } from "dotenv";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadCsvDir } from "../lib/data/loadCsvDir";
import { buildSeedRows, SEED_ORDER } from "../lib/data/seedRows";
import { validateSourceData } from "../lib/planning/validate";

config({ path: ".env.local" });
config();

async function main() {
  const dir = process.env.DATA_DIR ?? join(process.cwd(), "data");
  const checkOnly = process.argv.includes("--check");
  const loaded = loadCsvDir(dir);
  if (loaded.missing.length) {
    console.error(`Missing CSV(s) in ${dir}: ${loaded.missing.join(", ")}. Files are identified by their header row.`);
    process.exit(1);
  }
  if (loaded.unrecognised.length) console.warn(`Ignoring unrecognised CSVs: ${loaded.unrecognised.join(", ")}`);
  console.log("Files:", loaded.files);

  const { issues } = validateSourceData(loaded.data);
  for (const i of issues) console.log(`[${i.severity}] ${i.table} ${i.key}: ${i.message}`);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    console.error(`${errors.length} validation error(s); nothing was written.`);
    process.exit(1);
  }
  const rows = buildSeedRows(loaded.data);
  const counts = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  console.log("Validated rows:", counts);
  if (checkOnly) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  for (const [table, onConflict] of SEED_ORDER) {
    const { error } = await db.from(table).upsert(rows[table] as Record<string, unknown>[], { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`✓ upserted ${rows[table].length} rows into ${table}`);
  }
  const { error } = await db.from("data_loads").insert({
    source: `CSV import from ${dir}`,
    files: loaded.files,
    row_counts: counts,
    issues,
  });
  if (error) throw new Error(`data_loads: ${error.message}`);
  console.log("Seed complete.");
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
