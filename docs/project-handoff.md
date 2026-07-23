# Sunshine Window Works — Internal App: Handoff / Project Knowledge

Paste this file into a Claude.ai Project's "Project knowledge" to discuss
this app's workflow and code without re-explaining the whole thing from
scratch. It's a snapshot as of 2026-07-23 — check the live repo for
anything time-sensitive.

## What this is

An internal web app for Sunshine Window Works (window cleaning business)
that replaces a native macOS app. Reachable from the field on a phone.
Google Sheets is the entire backend — one spreadsheet, many tabs, no
database.

**Stack**: Astro 7 + `@astrojs/cloudflare` adapter (SSR, deployed to
Cloudflare Pages), React islands (`client:load`) for interactive pieces
(pipeline Kanban board, quoter form, dashboard). Google Sheets API v4 via a
Google Cloud service account, JWT-signed with `jose` (Workers-runtime
compatible — no Node-only crypto). Zod schemas validate every tab's shape.
Vitest for tests, with a hand-built fake-Sheets-API test harness so tests
never touch the live spreadsheet.

## Core business rule (governs everything)

```
Active PricingConfig  →  controls the price charged today
$150/on-site labor hour → the initial operating target, set in that config
Completed-job calibration → measures actual performance, informational only
```

Historical job data **never** automatically changes pricing. Pricing
changes are an explicit action — the owner activates a new `PricingConfig`
row. Calibration (comparing target vs. actual $/hour across completed
jobs) is a recommendation signal only, gated by confidence thresholds
based on comparable-job counts (0–9 insufficient, 10–24 early, 25–49
moderate, 50+ strong).

The $150 target specifically means $150 per **on-site** labor hour (setup +
cleaning + inspection + pack-up) — travel time and off-site admin are
tracked separately and never counted toward it.

## Data model

Single Google Sheet, multiple tabs, all primary IDs are UUIDs (never row
numbers), every app-owned tab has `Created At`/`Updated At`/`Archived At`
(soft-delete only). Full column-by-column reference: `docs/data-dictionary.md`.

Tabs: **Clients**, **Properties**, **Pipeline** (sales opportunities only —
stages New Lead → Contacted → Walkthrough Scheduled → Quote Draft → Quote
Sent → Follow-up → Accepted/Lost), **Quotes** (+ **QuoteItems**), **Services**
(catalog), **PricingConfig** (versioned, exactly one Active row),
**Jobs** (the pre-existing legacy tab, extended in place — see below),
**JobItems**, **CalibrationSnapshot**, **ActivityLog**.

Key relationships: a Client always lives at one property (no landlord/
multi-property case in this business) — client-level address was removed
for that reason; `Properties.Street Address/City/State/Zip` is the only
address. A `Quote` references `Client ID` + `Property ID` + `Opportunity ID`.
Accepting a Quote creates a `Job` linked by `Quote ID`, `Opportunity ID`,
and (as of 2026-07-23) a real `Property ID` column — replacing fragile
address-substring matching used to find a property's job history.

**Jobs tab caveat**: this is the *original* hand-maintained spreadsheet
tab, not something the app created. It has many legacy columns the app
never touches (window-type counts, a calibration-summary formula block,
etc.). The app's Zod schema for Jobs uses `.catchall()` so unknown columns
round-trip untouched on every read/update — this is deliberate, not an
oversight. New columns are only ever *appended* after existing content,
never inserted/reordered, per an explicit Jobs-preservation protocol.

## Quote → Job lifecycle

```
Lead → Quote → Accepted Quote → Scheduled Job → Completed Job →
Invoiced Job → Paid Job
```

A Job only counts toward calibration once its status is
Completed/Invoiced/Paid **and** actual labor time, final revenue, direct
costs, and callback info are all filled in.

## Auth

Single shared password, rate-limited login, HttpOnly/Secure/SameSite=Strict
signed session cookie (12hr expiry). Only `/estimate` (public ballpark
estimator) and its API route are unauthenticated; everything else requires
login, enforced by middleware allowlist. The public estimator returns a
deliberately restricted response (a price range + a message) — it never
exposes the internal target rate, labor-hour estimates, margins, or
PricingConfig internals.

## Sheets data-integrity patterns worth knowing

- Column mapping is always by **header name**, never position — this is
  why column reordering/insertion is safe throughout the app.
- Writes use explicit `nextEmptyRow()` + range-targeted `updateValues()`,
  not the Sheets `:append` endpoint — `:append`'s "smart" placement
  heuristic mis-detected the right row on the sparse Jobs tab early on and
  silently shifted data into the wrong columns.
- `ensureGridSize()` must run before any write that might exceed a tab's
  current grid dimensions — Sheets hard-caps grid size at creation and
  rejects out-of-bounds writes rather than growing automatically.
- Multi-tab creates (e.g. Quote + QuoteItems) use a shared Write Operation
  ID rather than relying on any cross-range transaction (Sheets has none).
- `readRows()` filters out rows missing their own primary ID — guards
  against legacy calibration-formula artifact rows being mistaken for real
  records.

## Current status (as of 2026-07-23)

All 13 planned build phases are complete and were verified live in the
browser: pipeline board, client/property directory, in-field quoter,
quote acceptance → job lifecycle, calibration with confidence levels,
public estimator, dashboard, and a brand-consistent visual redesign
(reusing the marketing site's navy/red/cream/tan palette and
Barlow Condensed / Source Sans 3 fonts).

Recently finished: a redundancy audit of the live spreadsheet. Two
confirmed fixes shipped: (1) removed client-level address entirely — a
client always lives at the property being serviced, so address lives
only on Properties; (2) added a real `Property ID` column to Jobs,
replacing fragile address-substring text matching for finding a property's
job history (with fallback matching preserved for jobs predating the
column). Also removed some now-dead code/columns found along the way
(an unused `renameSheetTab()` helper, 4 leftover empty address columns on
Clients from an earlier, since-reverted approach).

**Not yet committed to git** — this batch of work (address-field
restructuring, phone-number auto-formatting, and the redundancy-audit
fixes) is sitting as uncommitted changes.

## Open questions, not yet decided

- Possible duplication between Jobs' `Lead Source` column and
  Clients/Pipeline's `Referral Source` — flagged, not yet investigated or
  resolved.
- Jobs' `Window Count` column is currently always written as `0` — it's
  dead weight until something populates it for real (JobItems integration
  or manual entry).

## Where to look in the repo

- `~/.claude/plans/imperative-sauteeing-clock.md` — the original full
  build plan (architecture, complete data model, revision history,
  12-phase build order, Phase 13 visual redesign spec).
- `docs/data-dictionary.md` — quick column-by-tab reference, kept in sync
  with the live sheet.
- `src/lib/models/*.ts` — Zod schema + `TabConfig` per tab.
- `src/lib/sheets/` — the Sheets API client, row/column helpers, CRUD,
  activity logging, schema bootstrap.
- `src/lib/pricing/` — pricing engine, quote-to-job lifecycle, calibration.
- `src/pages/` — one Astro page per surface; `src/pages/api/` for API
  routes (including `admin/` — internal one-off maintenance endpoints).
