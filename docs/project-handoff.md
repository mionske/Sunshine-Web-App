# Sunshine Window Works — Internal App: Handoff / Project Knowledge

Paste this file into a Claude.ai (or ChatGPT) Project's "Project knowledge"
to discuss this app's workflow and code without re-explaining the whole
thing from scratch. It's a snapshot as of **2026-07-27** — check the live
repo for anything time-sensitive.

## What this is

An internal web app for Sunshine Window Works (a one-person/small-crew
window cleaning business) that replaced a native macOS app. Used from the
field on a phone, and from a desktop for quoting/admin work. Google Sheets
is the entire backend — one spreadsheet, many tabs, no database.

**Stack**: Astro 7 + `@astrojs/cloudflare` adapter (SSR, deployed as a
Cloudflare Worker), React islands (`client:load`) for interactive pieces
(pipeline Kanban board, quoter form, dashboard chart). Google Sheets API v4
via a Google Cloud service account, JWT-signed (Workers-runtime compatible).
Zod schemas validate every tab's shape. Vitest for tests (300+), with a
hand-built fake-Sheets-API test harness so tests never touch the live
spreadsheet. Deployed with `wrangler deploy`; local dev (`astro dev`) reads
and writes the *same* live spreadsheet as production — there is no separate
dev database.

## Core business rule (governs everything)

```
Active PricingConfig     → controls the price charged today
$150/on-site labor hour  → the initial operating target, set in that config
Completed-job calibration → measures actual performance, informational only
```

Historical job data **never** automatically changes pricing. Pricing
changes are an explicit action — the owner activates a new `PricingConfig`
row. Calibration (comparing target vs. actual $/hour across completed
jobs) is a recommendation signal only, gated by confidence thresholds
based on comparable-job counts (0–9 insufficient, 10–24 early, 25–49
moderate, 50+ strong). **In practice the business still has very few
completed jobs**, so calibration is mostly informational/directional right
now, not a strong signal yet.

The $150 target specifically means $150 per **on-site** labor hour (setup +
cleaning + inspection + pack-up) — travel time and off-site admin are
tracked separately and never counted toward it.

## The real-world lifecycle

```
Lead → Quote → Accepted Quote → Scheduled Job → Completed Job →
Invoiced Job → Paid Job
```

- A **Quote** is created either from the in-field **Quoter** (manual entry,
  desktop or phone) or generated from a completed **Walkthrough** (a
  per-window-item field survey done via `WalkthroughWizard`).
- Accepting a Quote (`quotes/[id].astro`'s dedicated "Accept quote" action)
  creates a linked **Job** and is the *only* path that can set a Quote's
  status to `Accepted` — this is an enforced invariant (see below).
- A Job only counts toward calibration once its status is
  Completed/Invoiced/Paid **and** actual labor time, final revenue, direct
  costs, and callback info are all filled in.
- Separately, **Historical Entry** (`historical-entry.astro` +
  `HistoricalEntryWizard.tsx`) is a *backfill* path: it creates a Client/
  Property/Walkthrough/Quote/Job all at once for work that already
  happened, with its own owner-entered dollar figure (it does not run the
  pricing engine). This is a genuinely separate flow from the live
  Quote→Job path above — worth knowing since there are effectively **two
  ways a Job gets created**.

## Data model (high level — full column reference in `docs/data-dictionary.md`)

Single Google Sheet, all primary IDs are UUIDs (never row numbers), every
app-owned tab has `Created At`/`Updated At`/`Archived At` (soft-delete
only — **this app never hard-deletes a business record**, anywhere).

**Core tabs**: Clients, Properties, Pipeline (sales opportunities only —
stages New Lead → Contacted → Walkthrough Scheduled → Quote Draft → Quote
Sent → Follow-up → Accepted/Lost — "Accepted" closes the opportunity and
hands off to Quotes, it is not itself a Job state), Quotes + QuoteItems,
Services (a small fixed catalog), PricingConfig (versioned, exactly one
Active row per Property Type), Jobs + JobItems, Walkthroughs +
WalkthroughItems, CalibrationSnapshot, ActivityLog, Tasks (lightweight
follow-up reminders).

**QuickBooks mirror tabs** (one-way sync, QB → app only, the app never
writes to QuickBooks): QBCustomers, QBEstimates, QBInvoices, QBPayments.
Quotes/Jobs each carry a `QB Estimate ID`/`QB Invoice ID` link column —
linking is a manual search-and-confirm action in the UI (with a lazy
"potential match found" suggestion banner), not automatic. QuickBooks is
treated as the source of truth for estimate/invoice financial state once
linked (status, total, balance, payment info all display read-only from
the mirror).

**Jobs tab caveat**: this is the *original* hand-maintained spreadsheet
tab, not something the app created. It has legacy columns the app
tolerates via `.catchall()` in its Zod schema (so unknown columns
round-trip untouched). New columns are only ever appended, never
inserted/reordered.

**Property/Walkthrough/Client data ownership** (an intentional, explicit
rule established mid-project): a field's home is decided by its lifetime —
"generally true about the property forever" → Property; "observed on one
visit, could differ next time" → Walkthrough; "a customer preference" →
Client; "part of a specific quoted job" → Quote; "happened during
completed work" → Job. Several redesign passes moved fields to the correct
owner as this rule was discovered/refined (e.g. glass-condition/access
flags moved from Property → Walkthrough; maintenance-frequency
preferences moved from Property → Client). Legacy columns are always kept
declared (never deleted) for backward-compat display, with a documented
compat-default mapping.

## Auth

Single shared password, rate-limited login, HttpOnly/Secure/SameSite=Strict
signed session cookie. Only `/estimate` (the public ballpark estimator)
and its API route are unauthenticated. The public estimator returns a
deliberately restricted response — never the internal target rate,
labor-hour estimates, margins, or PricingConfig internals.

## Feature inventory by page (nav order)

| Page | What it does |
|---|---|
| **Dashboard** (`/`) | Today's/this-week's calendar (read-only Google Calendar integration — Calendar is the scheduling source of truth), Recent Performance line chart (toggleable time windows), Pipeline summary, Calibration summary, Data Quality warnings, follow-up reminders. |
| **Clients** | List + detail. Contact info, referral source, service preferences (maintenance frequency/season — moved here from Property), "Add property" drawer. |
| **Properties** | List + detail. Detail page **is** the edit form (no separate edit mode). Recently added: delete (soft, blocked if the property has an in-flight Job), restore, duplicate (copies every field to a new row, e.g. for a multi-unit building's next unit), and a "view deleted/archived" toggle. |
| **Pipeline** | Kanban board of sales opportunities, drag-and-drop stage changes. |
| **Quoter** | The in-field pricing form. Three modes: plain new quote, **edit** (`?quoteId=`, locks Client/Property, recalculates in place), **duplicate** (`?duplicateFrom=`, pre-fills everything but leaves Client/Property editable and saves as a new quote — works even off an Accepted quote). Auto-defaults inventory/condition from a property's latest Walkthrough when available. |
| **Quotes** | List + detail. Status changes via a colored dropdown (both list and detail) — "Accepted" is only settable via the dedicated Accept action. Recently added: edit, delete/restore (with a bulk-select checkbox toolbar on the list — bulk status change, bulk delete), duplicate, and a "view deleted/archived" toggle. |
| **Jobs** | List + detail ("Job Day" mode — mobile timer/checklist for the actual on-site visit, completion form capturing actual time/costs/callback/review). |
| **Calibration** | Filterable comparison of quoted vs. actual performance across completed jobs, segmented by many dimensions (scope, access difficulty, oversized/french-pane windows, restoration flags, etc.), confidence-gated. |
| **Pricing Config** | Versioned pricing policy rows; exactly one Active per Property Type. |
| **QuickBooks** | OAuth connection, sync health, Customer↔Client match review. |
| **Historical Entry / Historical Records** | Backfill wizard for past jobs (see lifecycle note above) + a list/edit view for records already entered this way. |
| **Estimate** (public, unauthenticated) | Customer-facing ballpark price range. |

## Recent work (roughly the last week, most relevant to today)

- **QuickBooks one-way sync**: token storage/OAuth, REST client, incremental sync engine, Customer↔Client matching + linking, webhook handler, and — most recently — making QuickBooks the linked source of truth for Quote/Job financials (replacing a dead free-text "paste a QB link" field with real linked-record cards, match suggestions, and a refresh action).
- **Historical Job Entry overhaul**: access/equipment-complexity checkboxes, callback root-cause/corrective-action fields, a Pricing Review section ("would I price this differently today"), a Job Performance Review section (ratings, would-hire-again) — all reporting-only, explicitly never feeding pricing. Added a Quotes nav item/list page and a Historical Records list+edit view (true in-place edit, not just create) in the same pass.
- **Real-world data entry**: a 4-unit condo building (601 Canyon Blvd) was entered by hand via the Quoter's Manual Adjustment/Override Reason mechanism to force exact pre-negotiated per-unit prices — this is the scenario that motivated most of the "duplicate" and "bulk actions" work described next, since doing 4 near-identical quotes by hand was tedious.
- **Production bug fix**: `updateQuote()`'s QuoteItem-replacement step was doing one Sheets API round-trip per line item, which could exceed Cloudflare Workers' per-request subrequest cap on a quote with several items and 500 in production. Fixed to a single batched write.
- **Quote lifecycle CRUD parity**: edit, delete/restore (soft-delete, archived-view toggle), duplicate, and bulk multi-select actions (status change, delete) — all added to both the Quotes list and Quote Detail page.
- **Property CRUD parity**: same pattern applied to Properties — delete/restore/duplicate, archived-view toggle (Property Detail already served as its own edit form, so no separate edit UI was needed there).

## Known workflow friction / things worth a fresh look

This is the section most relevant if you're being asked to suggest workflow
improvements — these are genuine rough edges observed while building and
using the app, not hypotheticals:

1. **Two separate paths create a "Job."** The live Quote→Accept flow and
   the Historical Entry backfill flow both end up creating Job rows, with
   different data-entry shapes and different levels of pricing-engine
   involvement. It's occasionally been unclear (even to the person
   building this) which path a given real-world scenario should use.
2. **Multi-unit properties are still a manual, repetitive process.** Real
   example: a 4-unit condo required creating 4 Clients-worth of
   Property/Quote data by hand, forcing prices via Manual Adjustment
   because the pricing engine's line-item math doesn't match a
   pre-negotiated flat rate. The new Duplicate feature helps but hasn't
   been used yet in real day-to-day work.
3. **The "Accepted" status invariant creates some friction of its own.**
   Because an Accepted quote always needs a matching Job, the UI blocks
   setting status *to* Accepted from the generic dropdown — but does allow
   moving *away* from Accepted, which has already led to a bit of
   real-data churn (quotes bounced between Sent/Accepted while testing,
   leaving a few Jobs that no longer perfectly match their Quote's
   current status). Nothing breaks, but it's a slightly fragile manual
   invariant rather than something the UI actively guards end-to-end.
4. **QuickBooks estimates can silently go stale.** In the condo example,
   the two QuickBooks estimates covering pairs of units stopped matching
   reality the moment each unit's actual chosen scope diverged from what
   was originally quoted — and the app has no write access to QuickBooks,
   so there's no way to push a correction back; it can only flag a
   mismatch for the owner to fix on the QuickBooks side.
5. **No push notifications/reminders outside the Dashboard.** Follow-ups,
   maintenance-due reminders, and review requests all rely on someone
   opening the Dashboard and reading it — there's no email/SMS/push
   nudge.
6. **Very little completed-job data feeds Calibration.** The confidence-
   gating is doing its job (correctly saying "not enough data yet" for
   most segments), but it means a decent chunk of the app's built
   analytical surface isn't yet actionable in practice.
7. **Newest CRUD features (bulk-select, duplicate, restore) are freshly
   built and verified with synthetic test data, not yet exercised in real
   day-to-day use** — worth watching for rough edges once actually used
   for something like a real second multi-unit building.
8. **No cascading soft-delete.** Deleting a Quote/Property never touches
   its dependent Walkthroughs/Jobs/Pipeline rows (a deliberate choice —
   nothing auto-cascades in this app), which is safe but means an
   archived parent can leave dependent records pointing at something
   that's now hidden from normal list views.

## Where to look in the repo

- `~/.claude/plans/imperative-sauteeing-clock.md` — the original full
  build plan plus every subsequent addendum (architecture, data model,
  QuickBooks integration plan, data-ownership-separation plan, etc.).
- `docs/data-dictionary.md` — full column-by-tab reference, kept in sync
  with the live sheet.
- `src/lib/models/*.ts` — Zod schema + `TabConfig` per tab.
- `src/lib/sheets/` — the Sheets API client, row/column helpers, CRUD,
  activity logging, schema bootstrap.
- `src/lib/pricing/` — pricing engine, quote-to-job lifecycle, calibration.
- `src/lib/properties.ts` — Property delete/restore/duplicate.
- `src/lib/qb/` — QuickBooks OAuth, sync, matching, webhook.
- `src/pages/` — one Astro page per surface; `src/pages/api/` for API
  routes (including `admin/` — internal one-off maintenance endpoints).
