# Freshroots | Demand Planning

A rules-based demand-planning app for Freshroots' Senior Demand Planner (Raghav). On demand, it reads the latest stored SAP-style records from **Supabase**, applies five documented planning rules, and explains each recommendation. Raghav then approves, edits or rejects each one. After explicit review, the app creates a **draft purchase order in Zoho Inventory**.

> **What this is not:** a live SAP integration (Supabase stands in for SAP), an AI or ML model, an autonomous ordering system, or proof of savings. It runs on a 15-SKU, 16-week demonstration dataset.

## Component flow

| # | Actor | What happens | Where in code |
|---|---|---|---|
| 1 | Frontend | Raghav clicks **Run Demand Planning** | `components/RunPlanningButton.tsx` |
| 2 | Backend | Requests the latest stored records from Supabase | `app/api/planning/run/route.ts` → `lib/server/repo.ts#loadSourceData` |
| 3 | Supabase (simulated SAP) | Returns the 5 datasets seeded from the CSVs | `supabase/migrations/0001_init.sql` |
| 4 | Backend rules engine | Validates the data, computes trends, coverage, risks and quantities, then saves the run | `lib/planning/rules.ts`, `validate.ts` |
| 5 | Frontend | Shows the dashboard, priority SKUs, quantities and reasons | `app/page.tsx`, `app/DashboardView.tsx` |
| 6 | Frontend | Raghav approves, edits (with a reason), rejects or marks for review | `app/recommendations/*`, `lib/planning/decisions.ts` |
| 7 | Backend | Validates the approval and Zoho vendor/item mapping, then calls the Zoho API | `lib/server/poService.ts`, `lib/server/zoho.ts` |
| 8 | Zoho Inventory | Creates a **draft** PO and returns its ID, number and status | `lib/zoho/api.ts#createPurchaseOrder` |
| 9 | Frontend | Shows the confirmation (or the exact error) and PO history | `app/purchase-orders/*` |

## The five rules

All five rules are in `lib/planning/rules.ts` as pure, deterministic functions. Boundary comparisons use integer sums, so the exact-threshold cases are decided precisely.

1. **Demand spike.** The latest-4-week average must be more than 20% above the latest-12-week average. Exactly +20% is **not** a spike. Proposed quantity is 1.5 × the standard reorder quantity, rounded up.
2. **Stockout risk.** Stock below 6 weeks of *adjusted* weekly demand triggers "reorder immediately". The proposal is the standard quantity (1.5× if there is also a spike), as a starting point.
3. **Overstock risk.** Stock above 14 weeks of adjusted demand triggers "pause next order".
4. **Festival uplift.** The planning month is taken from the **inventory snapshot date** (2026-10-19 → 2026-10), not today's date. If the festival calendar marks that month as a festival month, projected weekly demand (the 12-week average) is uplifted by 25% before the coverage checks. If the calendar has no row for the month, the documented Oct/Nov/Mar rule is used and a warning is shown. The uplift is applied once, and **not** to the 4w-vs-12w spike ratio.
5. **High perishability.** For `Perishability = High`, coverage limits are 3 and 4 weeks instead of 6 and 14.

`weeks_of_cover = units_on_hand / adjusted_weekly_demand`. With zero demand this is shown as "–" (never ∞ or NaN). In that case any positive stock counts as overstock, and a warning asks whether the SKU is discontinued.

**Combining flags.** All flags are stored. Priority order is: stockout → conflict → insufficient data → spike → overstock → healthy. A spike *plus* overstock gives **Manual review needed**, with no automatic quantity. Missing weeks, duplicate weeks, malformed weeks, negative values or missing inventory mark that SKU **insufficient data**, while the rest of the run still completes. If a proposal does not restore minimum cover, or would exceed the perishable maximum, a warning is shown. The app never invents lead time, inbound POs, expiry or cost.

**Baseline check (supplied data, 2026-10 snapshot).** 5 stockout (SKU001, 003, 004, 011, 013), 2 overstock (SKU006, 007) and 1 spike (SKU001). `tests/oracle.test.ts` confirms these counts against an independent float calculation; they are not hard-coded. Trace for SKU001: 12-week sum 2,579 → average 214.92; 4-week average 261.00 (+21.44%) → spike; ×1.25 = 268.65 per week; 900 ÷ 268.65 = 3.35 weeks of cover, below the 6-week minimum → reorder 1.5 × 500 = 750, which gives ≈6.14 weeks after receipt.

## Data model

Source tables (simulated SAP, upserted by the seed and never touched by decisions):
- `distributor_master` (PK `distributor_id`)
- `sku_master` (PK `sku_id`, FK → distributor)
- `weekly_sales` (PK `sku_id, week`; it also stores `iso_year` and `iso_week` so ISO weeks sort safely)
- `current_inventory` (PK `sku_id`)
- `festival_calendar` (PK `year_month`)
- `data_loads` (one row per import, used for freshness)

App records (never reseeded):
- `planning_runs`: snapshot, counts, data issues
- `recommendations`: one per SKU per run, with the full calculation JSON, the decision, the approver and timestamp, and `po_status`
- `zoho_connection`: unused since the switch to the server-side refresh token (kept so existing databases need no migration)
- `zoho_item_mappings`: SKU → real Zoho item + real Zoho **vendor** + confirmed rate
- `purchase_orders`: unique `idempotency_key` and `reference_number`, request payload, Zoho response
- `audit_events`

`claim_recommendations_for_po()` atomically locks approved recommendations to one PO submission.

**Access and security**
- **There is no sign-in, and Zoho is connected server-side.** Anyone who can open the app can run planning, approve orders and create Zoho **draft** POs in the configured organisation, with no Zoho login. Runs, decisions and POs are recorded under `PLANNER_NAME`.
- Before sharing a deployed URL, put the whole site behind **Vercel Deployment Protection** (Project → Settings → Deployment Protection: Vercel Authentication or Password Protection). That needs no app code.
- The browser never talks to Supabase or Zoho directly; only Next.js server routes do, using the service-role key and the Zoho refresh token from server environment variables.
- RLS is enabled on every table with **no policies**, so the public anon/publishable key cannot read or write anything.
- Approval confirmation, override reasons, the quantity checks and the duplicate-PO guards are still enforced on the server and in the database.

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase

1. Create a project. Copy the **Project URL** and the **Secret key** (or legacy `service_role` key) into `.env.local` (see `.env.example`).
2. Apply the schema, using either option:
   - paste all of `supabase/setup_all.sql` (both migrations plus a check query; nothing highlighted) into **SQL Editor → Run**. The last result should show `tables_created = 12`, `server_role_can_read = true`. Migration 0002 is required on projects where new tables are not automatically exposed to the Data API. Or:
   - set `DATABASE_URL` (Connect → Session pooler URI) and run `npm run db:migrate`.
3. Put the five CSVs in `./data/`. Files are identified **by header row**, so the festival calendar can keep an arbitrary filename. Then:

```bash
npm run db:seed
```

   - The seed validates first and aborts on any error. `npm run db:check` validates only, without writing.
   - It is idempotent (upserts) and never touches runs, approvals, mappings or POs.
4. Optionally set `PLANNER_NAME` (default "Demand Planner"). No user accounts are needed.

### 3. Zoho Inventory (live mode, server-to-server)

Zoho is connected **once, by the account owner**, using a Zoho **Self Client** refresh token stored on the server. Visitors never sign in to Zoho, and there is no redirect URI or "Connect" button.

1. Find your data centre: the domain you use to sign in to Zoho (`zoho.com`, `zoho.in`, `zoho.eu`, …). Set `ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.<dc>` and `ZOHO_API_DOMAIN=https://www.zohoapis.<dc>`.
2. In **https://api-console.zoho.&lt;dc&gt;**, choose **Add Client → Self Client**. Copy its **Client ID** and **Client Secret** into `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`.
3. In the Self Client, open **Generate Code**:
   - **Scope:** `ZohoInventory.settings.READ,ZohoInventory.items.READ,ZohoInventory.contacts.READ,ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ`
   - **Time duration:** 10 minutes
   - If asked, pick the Zoho Inventory organisation.
   - Click **Create** and copy the code.
4. Within those 10 minutes, run:

```bash
npm run zoho:token -- <code> --vercel
```

   This saves `ZOHO_REFRESH_TOKEN`, `ZOHO_API_DOMAIN` and, when there is only one organisation, `ZOHO_ORGANIZATION_ID` to `.env.local`. With `--vercel`, it also copies the Zoho settings to Vercel production. Then redeploy with `npx vercel deploy --prod`.
5. In Zoho Inventory, make sure the **items** and **vendors** you will order already exist. The app never creates master records. For a test organisation, import `zoho_import/vendors.csv` and `zoho_import/items.csv` (demo prices; see `zoho_import/HOW_TO_IMPORT.md`).
6. In the app, go to **Purchase Orders**, check the "Live Zoho Inventory" badge, then use **Load Zoho items & vendors** to map each SKU and confirm its rate. Items are pre-selected by matching the Zoho **SKU** field to `SKU_ID`, and vendors by matching the distributor name; you confirm each mapping.

How it works at runtime:
- The server exchanges the refresh token for one-hour access tokens and caches them per server instance. Concurrent requests share one refresh.
- `ZOHO_ORGANIZATION_ID` is required only when the Zoho account has several organisations; otherwise the only organisation is used.
- To disconnect, revoke the token in Zoho (Self Client) or remove `ZOHO_REFRESH_TOKEN`.

Without Zoho credentials, the PO page runs in **Demo / Disconnected** mode. It shows a clearly labelled example payload, and nothing is sent.

**Zoho implementation notes.** These follow the official docs, checked 2026-10-23.
- **Create.** `POST /inventory/v1/purchaseorders?organization_id=…`
  - Header: `Authorization: Zoho-oauthtoken …`
  - JSON body: `vendor_id`, `reference_number`, `date`, `notes`, `line_items[{item_id, quantity, purchase_rate}]`
  - The current docs name the line price `purchase_rate`, while older examples use `rate`, so both are sent with the same value. After creation the app compares Zoho's stored quantity and rate with what it sent, and shows any mismatch.
- **Numbering.** PO numbers use Zoho auto-numbering by default. If you type a number, the app adds `ignore_auto_number_generation=true`.
- **Draft only.** The app never calls the *mark as issued* endpoint. If Zoho returns a status other than draft, that is flagged.
- **Duplicates.** A unique idempotency key covers organisation + vendor + recommendations + quantities + rates, and the reference number is `FR-<key>`.
  - A Zoho error marks the PO failed, keeps the approval and allows a retry with the same reference.
  - A timeout or network error marks it **Needs reconciliation**. **Reconcile with Zoho** then searches recent POs for that reference before any retry is allowed.
- **Link.** The "Open in Zoho" link is *constructed* from region, organisation and PO ID; Zoho does not return a link.

### 4. Run, test, build

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm run build
```

- `npm run dev` serves http://localhost:3001 (pinned in package.json).
- `npm test` runs 66 tests: rules, ISO weeks, the dataset oracle, decisions, PO idempotency and failures, the mocked Zoho client and server connection, and the SQL migration on PGlite.
- `npm run e2e:supabase` runs the backend flow against your real Supabase project and deletes its test records afterwards.

### 5. Deploy to Vercel

1. Import the repo into Vercel. The framework (Next.js) is auto-detected.
2. Add every variable from `.env.example` under Settings → Environment Variables, or use `npm run zoho:token -- <code> --vercel` for the Zoho ones.
3. Seed from your machine with `npm run db:seed`. The runtime reads nothing from the local disk.

## Demo script (≈2–3 minutes)

1. **Open the app.** Point out the **Simulated SAP (Supabase)** badge, the data as-of date (2026-10-19), the latest week (2026-W42) and the 15-SKU / 16-week coverage.
2. Click **Run Demand Planning**. The backend reads Supabase fresh and saves a run. Show the KPI cards: 5 stockout, 2 overstock, 1 spike, with a note that SKU001 is counted in both. Point out the festival-month banner for 2026-10 (+25% uplift).
3. **Click the SKU001 row** to show the calculation trace: 4w 261.0 vs 12w 214.9 (+21.4%), adjusted demand 268.6, 3.35 weeks of cover vs a 6-week minimum, and a proposed 750 = 1.5 × 500. Show the trend chart.
4. Open **Recommendations**.
   - Approve SKU001 (750) with the confirmation step.
   - Edit SKU003 from 300 → 400: an override reason is required, and the coverage warning clears.
   - Show that SKU007 (High perishability, 3–4 week limits) recommends a pause.
5. Open **Purchase Orders**.
   - Show the Zoho connection status (connected organisation, or Demo / Disconnected), the mapping of SKUs to real Zoho items and vendors with confirmed rates, and the approved lines grouped by vendor.
   - **Review draft PO** → **Create Draft PO in Zoho**.
   - Show the returned Zoho PO number, ID and status in history. Clicking again cannot create a duplicate.
6. Close with **About / Pilot measurement**: these are proposals, not proven savings, and real impact needs a pilot.

## Pilot measurement (five pre-build decisions)

- **Outcome definition:** fewer stockouts and write-offs on pilot SKUs, plus a faster, traceable plan → approve → PO cycle.
- **Baseline:** the current monthly Excel process. Measure planning effort, data age (3–4 weeks), and quarterly stockouts and write-offs (case estimates of ₹18–22 lakh and ₹10–12 lakh are historical problem sizes, **not** promised savings).
- **Workflow change:** an on-demand run from stored data → explained flags → planner approval → draft PO. No autonomous ordering.
- **Measurement plan:**
  - per run: planning time, recommendation → approval time, approval → PO time, override rate and reasons
  - per quarter: stockout incidents, write-offs, decision quality in hindsight
- **Kill criterion:** stop or redesign if, after a defined pilot on real data, planners override most recommendations, planning time does not drop, or stockouts and write-offs do not improve vs. baseline.

## Known limitations

- Supabase is a static stand-in for SAP. Data changes only when it is re-seeded.
- The 15-SKU demo dataset is not the case's 400 SKUs and 1,200 distributors.
- Proposals use standard quantities. There is no lead-time, inbound-PO, expiry or cost optimisation, because the data does not contain them.
- Reconciliation scans up to 1,000 recent Zoho POs by reference number, because the docs do not list a reference filter.
- One server-side Zoho connection (one organisation) is shared by everyone using the app, in a single-tenant pilot.
- Access tokens are cached per serverless instance. Zoho limits how often a refresh token can mint access tokens, so very bursty cold starts could briefly hit that limit.
- No sign-in or per-user audit trail: every action is recorded under `PLANNER_NAME`. Use Vercel Deployment Protection for any shared deployment.
- The PO delivery address is Zoho's organisation default. `Location` is shown for reference only.
