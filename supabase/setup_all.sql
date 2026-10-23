-- ONE-SHOT SETUP for the Supabase SQL Editor: 0001_init.sql + 0002_service_role_grants.sql
-- Generated from supabase/migrations. Paste ALL of it (nothing highlighted) and click Run.

-- Freshroots Demand Planning — initial schema.
-- Source tables (simulated SAP, seeded from CSV) are kept separate from
-- planning decisions and purchase-order records. Reseeding only upserts
-- source tables and never touches decision / PO history.

-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase), no extension needed.

-- ---------------------------------------------------------------------------
-- Simulated SAP source tables
-- ---------------------------------------------------------------------------

create table if not exists distributor_master (
  distributor_id   text primary key,
  distributor_name text not null,
  region           text not null,
  status           text not null
);

create table if not exists sku_master (
  sku_id               text primary key,
  sku_name             text not null,
  category             text not null,
  perishability        text not null check (perishability in ('High', 'Medium', 'Low')),
  standard_reorder_qty integer not null check (standard_reorder_qty > 0),
  unit_of_measure      text not null,
  distributor_id       text not null references distributor_master (distributor_id)
);

create table if not exists weekly_sales (
  sku_id     text not null references sku_master (sku_id),
  week       text not null check (week ~ '^\d{4}-W\d{2}$'),
  iso_year   integer not null,
  iso_week   integer not null check (iso_week between 1 and 53),
  units_sold integer not null check (units_sold >= 0),
  primary key (sku_id, week),
  check (week = iso_year::text || '-W' || lpad(iso_week::text, 2, '0'))
);
create index if not exists weekly_sales_week_idx on weekly_sales (iso_year, iso_week);

create table if not exists current_inventory (
  sku_id        text primary key references sku_master (sku_id),
  location      text not null,
  units_on_hand integer not null check (units_on_hand >= 0),
  as_of_date    date not null
);

create table if not exists festival_calendar (
  year_month        text primary key check (year_month ~ '^\d{4}-\d{2}$'),
  year              integer not null,
  month             integer not null check (month between 1 and 12),
  is_festival_month boolean not null,
  check (year_month = year::text || '-' || lpad(month::text, 2, '0'))
);

-- One row per seed/import, for data-freshness display.
create table if not exists data_loads (
  id          bigint generated always as identity primary key,
  loaded_at   timestamptz not null default now(),
  source      text not null,
  files       jsonb not null,
  row_counts  jsonb not null,
  issues      jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Planning runs and recommendations
-- ---------------------------------------------------------------------------

create table if not exists planning_runs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_email text not null,
  rules_version    text not null,
  as_of_date       date,
  latest_week      text,
  planning_month   text,
  festival_applied boolean not null,
  festival_source  text not null,
  snapshot         jsonb not null,
  counts           jsonb not null,
  data_issues      jsonb not null default '[]'::jsonb
);
create index if not exists planning_runs_created_idx on planning_runs (created_at desc);

create table if not exists recommendations (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references planning_runs (id),
  sku_id               text not null references sku_master (sku_id),
  status_flag          text not null,  -- risk status (stockout, overstock, …)
  action               text not null,
  priority             integer not null,
  triggered_rules      text[] not null,
  units_on_hand        integer,
  avg_4w               numeric,
  avg_12w              numeric,
  pct_change           numeric,
  adjusted_weekly_demand numeric,
  weeks_of_cover       numeric,
  standard_reorder_qty integer not null,
  proposed_qty         integer,
  calculation          jsonb not null,  -- full SkuPlan, for explainability
  -- planner decision
  decision             text not null default 'pending'
                         check (decision in ('pending', 'approved', 'rejected', 'needs_review', 'superseded', 'not_actionable')),
  approved_qty         integer check (approved_qty is null or approved_qty >= 0),
  override_reason      text,
  decision_note        text,
  decided_by           uuid,
  decided_by_email     text,
  decided_at           timestamptz,
  -- purchase-order handoff
  po_status            text not null default 'not_applicable'
                         check (po_status in ('not_applicable', 'ready', 'submitting', 'created', 'failed', 'needs_reconciliation')),
  purchase_order_id    uuid,
  unique (run_id, sku_id),
  check (decision <> 'approved' or decided_at is not null),
  check (po_status not in ('ready', 'submitting', 'created', 'needs_reconciliation') or (decision = 'approved' and approved_qty > 0))
);
create index if not exists recommendations_run_idx on recommendations (run_id);
create index if not exists recommendations_po_status_idx on recommendations (po_status);

-- ---------------------------------------------------------------------------
-- Zoho Inventory connection, mappings and purchase orders
-- ---------------------------------------------------------------------------

-- Single-row table. Tokens are AES-256-GCM encrypted by the app before storage.
create table if not exists zoho_connection (
  id                      integer primary key default 1 check (id = 1),
  accounts_domain         text not null,
  api_domain              text not null,
  refresh_token_enc       text not null,
  access_token_enc        text,
  access_token_expires_at timestamptz,
  scope                   text,
  organization_id         text,
  organization_name       text,
  connected_by_email      text not null,
  connected_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- SKU → real, existing Zoho item + Zoho vendor (NOT the CSV Distributor_ID).
create table if not exists zoho_item_mappings (
  sku_id             text primary key references sku_master (sku_id),
  organization_id    text not null,
  zoho_item_id       text not null,
  zoho_item_name     text not null,
  zoho_item_sku      text,
  zoho_vendor_id     text not null,
  zoho_vendor_name   text not null,
  purchase_rate      numeric(14, 2) not null check (purchase_rate > 0),
  rate_source        text not null check (rate_source in ('zoho_item', 'planner_entered')),
  confirmed_by_email text not null,
  updated_at         timestamptz not null default now()
);

create table if not exists purchase_orders (
  id                     uuid primary key default gen_random_uuid(),
  idempotency_key        text not null unique,
  reference_number       text not null unique,
  organization_id        text not null,
  zoho_vendor_id         text not null,
  zoho_vendor_name       text not null,
  recommendation_ids     uuid[] not null,
  request_payload        jsonb not null,
  status                 text not null check (status in ('submitting', 'created', 'failed', 'needs_reconciliation')),
  attempts               integer not null default 1,
  zoho_purchaseorder_id  text,
  zoho_purchaseorder_number text,
  zoho_status            text,
  zoho_response          jsonb,
  error_message          text,
  warnings               jsonb not null default '[]'::jsonb,
  created_by_email       text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (status <> 'created' or zoho_purchaseorder_id is not null)
);

alter table recommendations
  drop constraint if exists recommendations_purchase_order_fk;
alter table recommendations
  add constraint recommendations_purchase_order_fk
  foreign key (purchase_order_id) references purchase_orders (id);

create table if not exists audit_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_email text not null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Atomic claim of approved recommendations for one PO submission.
-- Succeeds only if every recommendation is approved, has qty > 0, and is
-- 'ready' or 'failed' (or already claimed by this same PO). Prevents a
-- recommendation being placed on two POs.
-- ---------------------------------------------------------------------------
create or replace function claim_recommendations_for_po(p_po_id uuid, p_rec_ids uuid[])
returns integer
language plpgsql
as $$
declare
  claimed integer;
begin
  update recommendations
     set po_status = 'submitting', purchase_order_id = p_po_id
   where id = any (p_rec_ids)
     and decision = 'approved'
     and approved_qty > 0
     and (po_status in ('ready', 'failed') or (po_status in ('submitting', 'needs_reconciliation') and purchase_order_id = p_po_id))
     and (purchase_order_id is null or purchase_order_id = p_po_id);
  get diagnostics claimed = row_count;
  if claimed <> coalesce(array_length(p_rec_ids, 1), 0) then
    raise exception 'claim_failed: % of % recommendations are not ready for a PO', coalesce(array_length(p_rec_ids, 1), 0) - claimed, coalesce(array_length(p_rec_ids, 1), 0);
  end if;
  return claimed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled everywhere with NO policies, so the anon and
-- authenticated roles cannot read or write anything directly. All access goes
-- through Next.js server routes, which verify the planner and then use the
-- service-role key (server-only).
-- ---------------------------------------------------------------------------
alter table distributor_master  enable row level security;
alter table sku_master          enable row level security;
alter table weekly_sales        enable row level security;
alter table current_inventory   enable row level security;
alter table festival_calendar   enable row level security;
alter table data_loads          enable row level security;
alter table planning_runs       enable row level security;
alter table recommendations     enable row level security;
alter table zoho_connection     enable row level security;
alter table zoho_item_mappings  enable row level security;
alter table purchase_orders     enable row level security;
alter table audit_events        enable row level security;

revoke all on function claim_recommendations_for_po(uuid, uuid[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function claim_recommendations_for_po(uuid, uuid[]) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function claim_recommendations_for_po(uuid, uuid[]) to service_role';
  end if;
end $$;

-- Explicit Data API grants for the server-only service_role.
-- Newer Supabase projects may not auto-grant table privileges to API roles,
-- in which case the Data API cannot see the tables at all. anon and
-- authenticated deliberately get NO grants (RLS also denies them).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
    execute 'grant usage, select on all sequences in schema public to service_role';
    execute 'grant execute on function public.claim_recommendations_for_po(uuid, uuid[]) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Verification: should return 12 tables, all readable by service_role.
select count(*) as tables_created,
       bool_and(has_table_privilege('service_role', 'public.' || table_name, 'SELECT')) as server_role_can_read
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('distributor_master','sku_master','weekly_sales','current_inventory','festival_calendar','data_loads',
                      'planning_runs','recommendations','zoho_connection','zoho_item_mappings','purchase_orders','audit_events');
