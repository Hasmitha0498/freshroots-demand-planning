// Applies supabase/migrations/*.sql in order using DATABASE_URL (Supabase →
// Project Settings → Database → Connection string). Each file is idempotent
// and tracked in public.schema_migrations.
import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env.local, or paste supabase/migrations/*.sql into the Supabase SQL editor.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
  await client.connect();
  await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  await client.query("alter table schema_migrations enable row level security");
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await client.query("select 1 from schema_migrations where name = $1", [file]);
    if (done.rowCount) {
      console.log(`✓ ${file} (already applied)`);
      continue;
    }
    await client.query("begin");
    try {
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`✓ ${file} applied`);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  await client.end();
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
