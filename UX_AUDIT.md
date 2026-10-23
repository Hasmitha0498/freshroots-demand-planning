# UX audit — Freshroots Demand Planning

**Date:** 23 Oct 2026
**Build audited:** `pre-ux-redesign` (git tag, commit `7246e70`), the version live at https://freshroots-demand-planning-one-gamma.vercel.app
**Method:**
- Full-page screenshots of every route at 1440, 768 and 390 px, using Chrome with real device emulation (`scripts/ux-screenshots.mjs`). They are saved in `docs/screenshots/before/`.
- Interactive states checked in a real browser.
- Code review of every page and component.

**User:** Raghav, Senior Demand Planner. He needs five answers, fast:
1. What needs attention?
2. Why?
3. What should I do?
4. How do I approve it?
5. Did the PO get created?

Issues are ranked by their impact on completing those tasks, not by visual taste.

## Summary

The engine and integrations are sound. The interface talks like the engineering spec.

- **Overview:** it opens with five data-provenance facts and a technical banner, then four KPI cards and a ten-column table of averages.
- **Recommendations:** this page renders an always-open approval form for every product, about 7 screens of near-identical controls.
- **Purchase orders:** this page mixes configuration (Zoho connection, item mapping) with the actual task of ordering.
- **Mobile:** the key table columns sit off-screen behind a sideways scroll.

The next action is never singled out, and the reasons are written as formulas ("Weeks of cover = 900 ÷ 268.6 = 3.35 weeks — below the 6-week minimum: stockout risk (Rule 2)").

## Issues

| # | Where | What is wrong | Why it creates friction | Proposed improvement | Priority |
|---|---|---|---|---|---|
| 1 | Recommendations | Every product shows a full decision form at once (quantity, override reason, note and three buttons), so 7 forms are on screen together. | It is very hard to see what still needs a decision. It also invites accidental edits, and the page is about 2,000 px tall. | One compact list row per product, with status and suggested action. Clicking **Review** opens a detail panel containing the reason, the numbers and the decision controls. | **Critical** |
| 2 | Overview | Nothing says "do this next". KPI cards, filter chips, a link and the table all compete for attention. | Raghav has to work out the priority himself, which defeats the purpose of the tool. | A short **"Needs your attention"** list in urgency order. Each row carries a plain reason and one action, followed by a single primary button. | **Critical** |
| 3 | Overview table and navigation, mobile (390 px) | The 10-column table scrolls sideways inside its card. On a phone only SKU, name and category are visible; stock, weeks of cover, status and action are off-screen. The nav clips "Purchase Orde…" and scrolls within itself. | The information Raghav needs most is hidden on small screens unless he discovers the sideways scroll. | Show fewer, essential columns, with the status chip under the name on phones. Use stacked rows instead of wide tables, and fit the nav without scrolling. | **High** |
| 4 | Recommendations, Overview | Reasons are formulas with rule numbers and jargon: "stockout risk (Rule 2)", "Proposed order: 1.5 × standard…", "Adj. weekly demand", "Weeks cover". | A planner has to decode the engine before acting. | Use plain sentences: "Running low — about 3.4 weeks of stock left (target 6+)." Keep the full calculation behind **Show calculation**. | **High** |
| 5 | Status vocabulary, everywhere | Several vocabularies are mixed: Stockout risk / pending / approved / Draft PO created / Ready for PO / Created in Zoho / needs_review / superseded. | The user cannot tell where an order is in the process. | One status vocabulary, used everywhere:<br>• Product health: Running low · Excess stock · Sales rising · Needs judgement · Missing data · Healthy<br>• Order progress: To review · Approved · Ready for PO · Creating PO · PO created · PO failed · Check in Zoho | **High** |
| 6 | Purchase orders | Setup (Zoho connection, a mapping list of every SKU) sits at the same level as ordering. Missing mappings show as a warning far from the item. | The main job, "turn approvals into POs", is buried. Fixing a missing item means scrolling to another card. | Order the page as *Ready to order* (per vendor) → *Purchase orders*. A line that needs setup gets an inline **Set up** action that opens just that product's mapping. Full product setup moves into a collapsed section. | **High** |
| 7 | Purchase orders | **Review draft PO** expands a large inline block, and the optional PO-number field sits beside the main button. | The flow is busy, and it is unclear what happens on click. | Open a focused review panel (vendor, lines, total, "draft, not sent to vendor") with one primary **Create purchase order** button. The PO number goes under **More options**. Success shows the Zoho PO number and a link. | **High** |
| 8 | Overview | The data-provenance card lists five facts: inventory as of, latest sales week, coverage, last data load and last run. | Five facts at equal weight push the actual answers below the fold. | One quiet line under the title: "Stock as of 19 Oct · Planned 23 Oct, 9:35 pm · Demo data". Details move into a tooltip or popover. | **High** |
| 9 | Header and footer | "Simulated SAP (Supabase)" badge, "Planner: Demand Planner" and a footer disclaimer repeated on every page. | Technical disclaimers on every screen add noise. | A single small "Demo data" marker next to the data date, with an explanation on hover. The footer becomes an **About this pilot** link. | **Medium** |
| 10 | Overview table | 10 columns, including 4-week and 12-week averages, adjusted demand, category and a perishability note. | The user scans numbers they don't need to decide. | Show product, stock, weeks left (with target), status and suggested action. Averages and adjusted demand move into the detail panel. | **Medium** |
| 11 | Recommendations | **Reject** needs no reason; "Mark for review" is unclear. | Rejections are not explainable later, which hurts the audit trail and the pilot's override analysis. | Require a short reason to reject. Rename the other action **Decide later**. | **Medium** |
| 12 | Recommendations | The page-top notice is a 3-line paragraph about lead times and optimisation. | Long caveats get ignored and push content down. | One short line under the title, with the detail in **Show calculation** and the About page. | **Medium** |
| 13 | Overview | The festival-uplift explanation is a full-width banner. | It looks like an alert, but it is context. | A small "October: +25% festival demand" chip in the header line. | **Medium** |
| 14 | Purchase orders | The demo payload prints as raw JSON. | Meaningless to a planner. | Keep it only when Zoho is not connected, collapsed under "What would be sent". | **Low** |
| 15 | Purchase orders | Each history row shows the Zoho internal ID, "Zoho status: draft" and an attempt count. | Too much detail at the same weight as the PO number. | Show the PO number (linked), vendor, products, total and status. ID and attempts go in a tooltip. | **Low** |
| 16 | Accessibility | Clickable table rows aren't keyboard reachable, and status relies partly on colour. Focus styles are browser defaults. | Keyboard users cannot open details, and colour-only meaning fails some users. | Use buttons for row actions, give every chip a text label and add visible focus rings. Dialogs get `role="dialog"`, Esc to close and focus handling. | **Medium** |
| 17 | Feedback | The run result shows in tiny text under the button. | Easy to miss whether the run succeeded. | Show a loading state on the button, then a short confirmation toast-style line at the top: "Planning updated — 7 products need attention." | **Low** |

> **Correction (during QA):** the first draft of the mobile issue (now issue 3) said the whole page overflowed horizontally on mobile and rated it Critical. That came from a screenshot artefact: headless Chrome enforces a minimum window width, so the 390 px images were crops of a wider layout. Re-measured with real device emulation, the old pages fit the screen width. The real mobile problem, hidden table columns, is the one now listed, rated High.

## What works and is kept

- **Kept unchanged:** the rules engine, validation, decisions, idempotent PO service, Zoho client and Supabase schema. This is a UI-only refactor.
- **Kept, moved behind a disclosure:** the calculation trace and sales sparkline. They are valuable evidence, now shown in the detail panel.
- **Kept:** the quantity checks while typing, the confirmation before approving, the duplicate-order guards and the sales-only item check.

## Calculation review

No calculation defects were found. The 5 / 2 / 1 oracle, the boundary tests and the SKU001 trace still pass. No business rules change in this redesign. The only behaviour change is that **rejecting requires a reason** (issue 11), and that is covered by a new test.
