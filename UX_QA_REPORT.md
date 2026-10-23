# UX redesign — QA report

**Date:** 23 Oct 2026
**Build tested:** local production build (`npm run build && npm start`, port 3001) against the real Supabase project and the live Zoho organisation (MESA Freshroots, read-only calls).
**Rollback point:** git tag `pre-ux-redesign`.
**Screenshots:** `docs/screenshots/before/` (the pre-redesign build, live on Vercel at the time) and `docs/screenshots/after/`. Each folder covers 3 screens at 1440, 768 and 390 px.
- They were produced by `node scripts/ux-screenshots.mjs <url> <dir>`, using Chrome with real device emulation and no extra dependencies.
- Playwright is not installed, and was not added, to avoid a new dependency.

## Before → after

| Area | Before | After |
|---|---|---|
| **Navigation** | Dashboard · Recommendations · Purchase Orders, plus a "Simulated SAP (Supabase)" badge, "Planner: …" and a disclaimer footer on every page. | **Overview · Recommendations · Purchase orders**. A single "Demo data" marker sits next to the stock date and explains the source on hover; the footer has an **About this pilot** link. |
| **Readability** | Formulas in the UI ("Weeks of cover = 900 ÷ 268.6 = 3.35 weeks — below the 6-week minimum: stockout risk (Rule 2)"). | Plain sentences: "Stock will last about 3.4 weeks. The target is at least 6 weeks." "Sales are up 21% over the last 4 weeks." The full calculation stays one click away under **Show calculation**. |
| **Information hierarchy** | Five equal-weight provenance facts, a festival banner, four KPI cards, filter chips and a 10-column table. | One quiet data line → four compact counts → a **Next step** line → **Needs your attention** (most urgent first, each with reason and action) → a slim **All products** table (5 columns). |
| **Copy** | Run Demand Planning · Stockout risk · Overstock risk · Demand spike · Adj. weekly demand · Weeks cover · Mark for review · approved / pending · Created in Zoho. | Run planning · Running low · Excess stock · Sales rising · Expected weekly demand · Stock lasts · Decide later · **one progress vocabulary**: Recommended → Approved → Ready for PO → Creating PO → PO created / PO failed (plus Check in Zoho). |
| **User journey** | Planner had to find what mattered, then scroll to an always-open form. | Overview names the next step. Clicking a product opens its recommendation directly (`/recommendations?sku=…`). After approval, the panel links to Purchase orders, and Purchase orders shows the next action. |
| **Recommendations** | 7 always-open forms, about 4,000 px tall on a phone. | A compact list with **To review / Decided / All** tabs. **Review** opens one detail panel: reasons, four key numbers, the calculation on request, and the decision (approve, with a reason if the quantity changed, then a confirmation step; **Decide later**; **Reject**, which now needs a reason). |
| **Purchase orders** | Zoho status card, mapping for every SKU, a raw JSON preview and history, all at the same level. | Connection status is a chip in the header. Then **Ready to order** (a card per vendor with total and **Review purchase order**), **Needs setup** (inline **Set up** for an unlinked product), **Purchase orders** (Zoho number linked, products, total, status) and a collapsed **Product setup**. The review panel shows vendor, delivery, "Draft — not sent to the vendor", lines and total, with one **Create purchase order** button. Success shows Zoho's real PO number and an **Open in Zoho** link. |

## Functional tests

| Test | How | Result |
|---|---|---|
| Unit and integration suite | `npm test` (rules, ISO weeks, dataset oracle, decisions, PO service with idempotency and failures, mocked Zoho client and server token, migration on PGlite, new wording tests) | ✅ **72 / 72 pass** |
| Rules unchanged | Oracle test: 5 running low, 2 excess, 1 sales spike, plus the SKU001 trace. `rules.ts` changed only in its wording and in removing unused label constants. | ✅ Pass; same results shown in the UI (Running low 5, Excess stock 2, Sales rising 1) |
| Wording matches the calculation | `tests/presentation.test.ts` checks the SKU001 reasons against computed values: 3.4 weeks, +21%, 750 units, October festival. | ✅ Pass |
| Run planning | Browser: clicked **Run planning**. The button showed a disabled "Planning…"; the planned time moved from 9:35 pm to 10:54 pm; the message read "Planning updated — 7 products need attention." | ✅ Pass |
| Data loads from Supabase | Overview showed stock as of 19 Oct 2026, 15 products, the live counts and the next-step line. | ✅ Pass |
| Overview → product | Clicked Brown Rice in *Needs your attention*; Recommendations opened with its panel already open. | ✅ Pass |
| Change quantity needs a reason | Changed SKU003 from 300 to 400. Approve stayed disabled with "Reason for change (required)", and the live hint updated: "stock should last about 6.5 weeks". | ✅ Pass |
| Approve with confirmation | "Approve 400 units of Brown Rice 1kg? This doesn't create a purchase order yet…" → **Confirm approval** | ✅ Pass |
| Persists after refresh | Reloaded: "Ready for PO · Approved 400 units · Changed because: 'Restore 6-week cover'" with the time. | ✅ Pass |
| Reject needs a reason | **Reject recommendation** stayed disabled until a reason was typed; then saved "Rejected". The server also refuses a reject without a reason (unit test). | ✅ Pass |
| PO review (live Zoho check, no write) | Purchase orders → GrainPath card (1 product, ₹38,000) → **Review purchase order**: vendor, organisation, delivery, "Draft — not sent to the vendor", 400 × ₹95 = ₹38,000. **Create was not clicked.** | ✅ Pass |
| PO creation, duplicates, failures | Unit tests with mocks: create, repeat-click protection, concurrent submit lock, Zoho error keeps the approval and allows a retry, timeout → "Check in Zoho" → reconcile. Real creation was verified earlier (PO-00001 and PO-00002 read back from Zoho); not repeated here. | ✅ Pass (mocked); live creation not re-run by design |
| Remove from order list | **Remove** on the queued line → "Nothing to order right now" | ✅ Pass |
| Errors | No browser console errors and no server errors during the whole journey. | ✅ Pass |

Test data cleanup: my test approval was removed, and planning was re-run, so the latest plan starts with 7 products to review. The SKU013 rejection and the earlier decisions belong to an older planning run and are no longer shown.

## UI and accessibility tests

| Check | Result |
|---|---|
| Horizontal overflow at 1440, 768 and 390 px (measured `scrollWidth` vs viewport on every screen) | ✅ None |
| Clipped or overlapping text | ✅ Fixed during QA. The phone layout of *All products* had the status chip overlapping the next column, and product names cut to a few letters on tablet. Names now wrap and the chip sits on its own line. |
| Navigation fits on phones | ✅ Fixed during QA (it previously clipped "Purchase orders"). |
| Detail panel | ✅ `role="dialog"`, `aria-modal`, labelled title; focus moves into the panel, stays inside on Tab, returns to the opener on close; **Esc** and the backdrop close it; full screen on phones. |
| Keyboard | ✅ Every action is a real button or link, so table rows aren't the only way in. Focus rings are visible (`focus-visible` ring). The tabs use `role="tab"` / `aria-selected`. |
| Colour and text | ✅ Every status chip has a text label (colour is never the only signal). Body text is slate-600 to slate-900 on white or slate-50; chip text uses -700/-800 shades on -50 backgrounds. |
| Loading, empty and error states | ✅ Run planning and Create show a spinner and disabled button. Each list has an empty state ("All caught up", "Nothing to order right now", "No purchase orders yet"). Errors show the server's message plus what to do next ("Your approval is kept. Fix the problem and try again."). |

## Corrections and findings during QA

- **Audit correction.** The first audit draft rated mobile "page overflows horizontally" as Critical. That was an artefact: headless Chrome has a minimum window width, so the 390 px images were crops of a wider layout. Measured with real device emulation, the old pages fit the screen. The real problem was hidden table columns. `UX_AUDIT.md` was corrected (now issue 3, High), and the screenshot tool was rewritten to use real emulation.
- **Behaviour change (intended, tested):** rejecting a recommendation now requires a short reason, enforced by the server and the UI.
- **No calculation defects** were found. Only engine wording changed, and the tests still pass on the same numbers.

## Limitations

- **No Playwright suite.** Browser checks were run interactively in the app's browser pane and recorded above. They are not an automated, repeatable end-to-end suite.
- **No live PO creation in this QA.** Creating a PO was **not** re-tested live, to avoid creating another real PO in your Zoho organisation; the success state of the new review panel is covered by code review and the mocked service tests only. The integration itself was verified live earlier (PO-00001 and PO-00002).
- **Screen readers.** Contrast was reviewed from the palette, not measured with an automated contrast checker. Screen-reader behaviour was checked through the accessibility tree only, not with VoiceOver.

## Deployment readiness

- ✅ `npm run build` passes; `npm run lint` and `npm run typecheck` are clean; 72 tests pass.
- ✅ No API, schema or environment-variable changes. The Supabase and Zoho integration is untouched.
- ✅ No secrets in tracked files (`.env.local` is git-ignored).
- ✅ Compatible with the existing Vercel project.
