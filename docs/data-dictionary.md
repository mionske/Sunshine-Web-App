# Spreadsheet data dictionary

Single Google Sheet (the existing Jobs spreadsheet), multiple tabs. Every tab
has `Created At`, `Updated At`, `Archived At` (soft delete only — never hard
delete a business record). All primary IDs are UUIDs, never row numbers.
Full rationale for each decision lives in the plan this was generated from;
this file is the quick column reference kept in sync with the live sheet.

## Clients
Client ID, First Name, Last Name, Phone, Email, Address (deprecated, kept
only for safe round-tripping of one pre-existing value — clients don't
carry their own address at all; every client lives at the property being
serviced, so the address lives once on Properties instead), Referral
Source, First Contact Date, Customer Since, Preferred Contact Method,
Notes, Created At, Updated At, Archived At.

## Properties
Property ID, Client ID, Property Type (Residential/Commercial/New
Build-Construction — required; drives which PricingConfig segment
applies and is a calibration segmentation dimension), Street Address,
City, State, Zip, Year Built, Square Footage, Stories, **Interior Access
Difficulty**, **Exterior Access Difficulty** (each Easy/Standard/
Difficult — radio, single-select), **Roof Access Required (Y/N)**,
**Water Source** (Exterior Spigot/Well Water/No On-Site Water — radio),
**Exterior Cleaning Method** (Water-Fed Pole Suitable/Traditional
Cleaning Required — radio), Total Window Units (approximate number of
window assemblies — subjective, what counts as "one window" varies),
Total Glass Panes (total individual glass panes — objective; validated
live against the pane breakdown below), Count — Double Hung, Count —
Casement, Count — Picture, Count — Sliding (sliding *windows* — a window
type, like Double Hung/Casement), Count — French (divided-light/
grid-pane windows — same concept the quoter calls "French/grid pane"),
Count — Awning, Count — Skylights, Count — Solar Panels, Screen Count,
Track Count (Solar Panels/Screens/Tracks are accessories, not counted
toward the pane totals), Desired Maintenance Frequency (One Time/
Quarterly/Twice Yearly/Yearly/Custom/Unknown — Phase 9 gave this
pre-existing free-text field a defined option set rather than adding a
duplicate "Preferred Service Frequency" column), Preferred Service Season
(Spring/Summer/Fall/Winter/No preference/Unknown), Next Recommended
Service Date (a planning/reminder estimate — distinct from Next Scheduled
Visit below, which is a confirmed date once something is actually on the
calendar; this never auto-creates a Job, it's read-only input for
reminders), Maintenance Notes, Next Scheduled Visit, Last Review
Requested Date, Last Review Received Date, Sliding Glass Door Pane Count
(sliding *doors* — a distinct pricing-catalog service from sliding
windows, so tracked separately from Count — Sliding), **Ladder
Requirement** (None/Standard (6-10 ft)/Extension (16-24 ft)/Tall
Extension (28+ ft) — radio, "Highest Ladder Required" in the UI),
**Window Condition** (Maintenance/Moderate Buildup/Heavy Buildup/
Restoration Required — radio), **Hard Water History (Y/N)** ("Hard Water
Staining Present" in the UI) and **Construction Debris (Y/N)**
("Construction Debris Present" in the UI) — supplemental checkboxes
alongside Window Condition, Access Notes (exterior/interior/parking/gate/
water-source access, consolidated into one field), Pet Notes, General
Notes, Building/Complex Name (optional — display/logistics grouping only,
e.g. "all units in this condo building"; not a data relationship the app
enforces), Unit Identifier (optional — unit number/letter within that
building), Created At, Updated At, Archived At.

The Property is the operational center for a physical location's service
history — Client, Pipeline, Quotes, and Jobs all reference it by Property
ID rather than duplicating address/characteristic data.

A multi-unit building (e.g. a 4-unit condo building) is still one full
Property record per unit, each with its own Client — the "a Client always
lives at one Property" rule is unchanged. Building/Complex Name just lets
units in the same building be found/filtered together.

`/properties` lists every active Property directly (address, client, type,
a map link) — properties are still only ever *created* from a Client's
own page (no separate "add" form here), but this gives direct access
without going through Clients first.

**Access & Conditions redesign.** The Property Details page's Access &
Equipment/Conditions fieldsets were replaced with four bordered cards
(Access Difficulty, Water & Exterior Method, Ladder Requirement, Window
Condition) in a responsive grid — two columns once there's room, single
column on phones — using radio groups instead of checkbox groups
wherever only one value is ever actually true. Legacy columns **Roof
Access Difficulty**, **Overall Access Difficulty**, **Water Access**,
**Equipment Suitability**, and **Water-Fed Pole Suitable (Y/N)** are kept
declared in the schema (any pre-existing value still round-trips) but are
no longer written by the current form — they're fully superseded by the
fields above. A property with a legacy `Water-Fed Pole Suitable (Y/N)`
value but no `Exterior Cleaning Method` yet gets that value pre-selected
as the new radio's default the first time the page loads, but nothing is
written back until the form is actually saved. There is and never was a
per-Property "Interior Only" concept — that's a per-service-line property
of a Quote's line items, computed live for calibration reporting, never
stored as a Property flag.

**Windows & Doors redesign.** Reorganized into three cards: Summary
(Window Units + Total Glass Panes, with a compact inline validation line
directly beneath Total Glass Panes — "✓ Pane breakdown matches total
panes" or "⚠ Pane breakdown totals X of Y panes" — replacing the old
boxed warning banner), Pane Breakdown (the eight per-type counts, in a
fixed two-column grid), and Accessories (Screens/Tracks/Solar Panels,
explicitly not counted toward pane totals). No field names changed here —
only the layout and copy.

## Pipeline (sales opportunities only — not job operations)
Opportunity ID, Client ID, Property ID, Primary Quote ID, Stage, Status,
Estimated Value, Referral Source, Next Follow-up Date, Last Contact Date,
Created At, Updated At, Closed At, Archived At, Lost Reason, Notes.

Stages: New Lead → Contacted → Walkthrough Scheduled → Quote Draft →
Quote Sent → Follow-up → Accepted → Lost. Paid is never a pipeline stage —
Accepted closes the opportunity and starts the Job workflow.

Property ID is normally blank when a lead is first created — a contact
comes in before a property exists, and one gets attached later via a
dedicated "Attach property" action (not a plain field edit), logged to
ActivityLog as `Property attached`. The Pipeline board shows a
"No property yet — add one" prompt on any card without one, rather than a
blank/broken address.

## Quotes
Quote ID, Client ID, Property ID, Opportunity ID, Walkthrough ID (link —
set when the quote was generated from a completed Walkthrough), Pricing Config ID,
Calculator Version, Input Snapshot (JSON), Calculation Result Snapshot
(JSON), Rounding Policy, Currency, Calculated Base Amount,
Calculated Add-ons, Calculated Surcharges, Estimated Labor Hours,
Target Hourly Rate, Target Price Before Adjustments, Manual Adjustment,
Discount, Final Quoted Price, Expected Revenue Per Labor Hour,
Override Reason, Quote Status, Created At, Updated At, Sent At,
Accepted At, Declined At, Expired At, Archived At, Created By, Notes,
QB Estimate Link (URL — set once created/sent in QuickBooks; the app only
stores the link, never talks to the QuickBooks API), Difficult Access Item
Count, Specialty Access Item Count.

The saved Quote + QuoteItems rows are always the authoritative record of
what was charged. Reproducibility means the stored snapshots + config
reference let anyone audit how the price was reached later — not that the
app recomputes a past quote from current logic and treats that as truth.

**Difficult/Specialty Access Item Count** (window-characteristic calibration
reporting): populated only for quotes created from a completed Walkthrough
(`createQuoteFromWalkthrough` in `lib/pricing/walkthroughToQuote.ts`) —
summed from each WalkthroughItem's own per-item Access Difficulty
(Quantity-weighted, not row-counted; see `countAccessDifficultyItems`).
Blank — never a fabricated `0` — for quotes created directly via the
plain in-field quoter, which has no per-item data at all. Reporting-only:
feeds `deriveJobSegmentation`'s calibration dimensions, never the pricing
engine.

## Services (catalog)
Service Code, Service Name, Service Category, Default Unit,
Default Labor Minutes, Pricing Method, Publicly Available,
Internally Available, Active, Sort Order, Created At, Updated At,
Archived At, Notes.

Initial codes: WINDOW_EXT_STANDARD, WINDOW_INT_STANDARD,
WINDOW_EXT_OVERSIZED, WINDOW_INT_OVERSIZED, WINDOW_EXT_FRENCH_PANE,
WINDOW_INT_FRENCH_PANE, SLIDING_DOOR_EXT, SLIDING_DOOR_INT, SCREEN_CLEAN,
TRACK_BASIC, TRACK_DEEP, SKYLIGHT_EXT, SKYLIGHT_INT, HARD_WATER_REMOVAL,
CONSTRUCTION_DEBRIS, FIRST_TIME_CLEAN, ACCESS_SURCHARGE,
MINIMUM_JOB_ADJUSTMENT, MANUAL_ADJUSTMENT, DISCOUNT.

## QuoteItems
Quote Item ID, Quote ID, Service Code, Service Category, Description,
Quantity, Unit, Unit Price, Estimated Labor Minutes, Line Total, Taxable,
Sort Order, Created At, Updated At, Archived At, Internal Notes.

## PricingConfig (versioned, exactly one Active row **per Property Type**)
Pricing Config ID, Config Name, Effective Date, End Date, Status,
Property Type (Residential/Commercial/New Build-Construction — free
string, not an enforced enum, since the one pre-existing live row
predates this column), Calculator Version, Target Hourly Rate, Minimum Job Price,
Exterior Labor Weight, Interior Labor Weight, Screen Unit Price,
Track Unit Price, Deep Track Unit Price, Skylight Unit Price,
Sliding Door Unit Price, French Pane Unit Price, Oversized Glass Unit Price,
Second Story Factor, Third Story Factor, Moderate Condition Factor,
Heavy Condition Factor, First-Time Cleaning Factor, Hard Water Minimum,
Construction Debris Minimum, Access Surcharge Minimum,
Estimate Low Variance, Estimate High Variance, Created At, Updated At,
Archived At, Notes.

**Changed rule**: "exactly one Active row" is now scoped per Property
Type, not global — Residential/Commercial/New Build-Construction are
independently priced and versioned. activatePricingConfig() only
supersedes the previously-Active row of the *same* Property Type.

Initial row: Target Hourly Rate = 150 (per estimated **on-site** labor
hour — setup, active cleaning, inspection, pack-up; travel and off-site
admin are tracked separately), Status = Active, Property Type =
Residential. Commercial/New Build-Construction have no Active config yet
— real rates for those segments are an explicit owner decision, not
fabricated placeholder numbers.

The quoter pre-selects the Active config matching the property's type as
a default, but the field stays a normal manual selector — the owner can
always choose a different active config for any quote.

## Jobs (existing tab, extended in place — see preservation protocol)
Existing columns untouched: Job ID, date, property, job type, lead source,
window counts, total panes, screens, hard water treatment,
quoted/final/add-on/total revenue, estimated/actual/WFP time,
time accuracy, effective $/hr, notes, calibration summary block
(columns X–Y).

**Resolved redundancy: Lead Source vs. Referral Source.** Jobs' legacy
`Lead Source` column is never read or written by any app code — Pipeline/
Client's `Referral Source` is the one source of truth for lead
acquisition going forward. Existing `Lead Source` values on old rows are
preserved untouched (the `.catchall()` round-trip already guarantees
this) but the app will never write to that column again, so no new
duplication can occur. No migration of historical values — they stay
exactly as hand-entered.

**Resolved: Window Count no longer means "unknown."** `createJobFromQuote`
used to hardcode `Window Count = 0` for every new Job, which reads
indistinguishably from "this property truly has zero windows." It now
copies the property's own `Total Window Units` when known, leaving the
column blank otherwise — never a fake 0. (Calibration's window-count
fallback logic already treated 0/blank as "try the legacy Windows-*
columns instead," so no change was needed on the read side.)

Appended columns: Window Count, Quote ID (link), Opportunity ID (link),
Property ID (link — reliable join to Properties, added after the original
free-text "Property Address" column proved too fragile to match on),
Job Status (Unscheduled/Scheduled/In Progress/Completed/Invoiced/Paid/
Cancelled), Arrival/Start/Finish/Departure Timestamps,
Travel/Setup/Cleaning/Inspection/Pack-up Time (the four Inspection/Setup/
Cleaning/Pack-up categories are what count as on-site labor toward the
$150/hr target — Travel and Off-Site Admin Time never do), Off-Site Admin
Time, Supplies Cost, Gas, Other Expenses, Total Job Cost, Net Profit,
Customer Rating, Callback Required (Y/N), Callback Labor Minutes,
Callback Cost, Photos (link), Version, Archived At, Record Classification (Customer Job/
Discounted Customer Job/Test Job/Practice Job/Owner Property/Historical
Import — a walkthrough-only visit never becomes a Job at all), Revenue
Treatment (Full Price/Discounted/No Charge/Test Price/Unknown),
Standard Price Equivalent (only meaningful together with a non-"Full
Price" Revenue Treatment — what a standard customer price would have
been; never blended with actual Final Revenue in the same calibration
metric), Data Quality (Complete/Mostly Complete/Partial/Estimate Only),
Data Quality Notes. These five are free-text columns, not enforced
enums — unlike Job Status, most existing rows simply won't have them set,
and forcing a default value would fabricate false completeness on legacy
data; the allowed-value lists only constrain what forms offer.

Review Requested At (timestamp), Review Left (Yes/No/Unknown),
Next Maintenance Follow-up Date (pre-filled as Job completion date +
Property's Desired Maintenance Frequency interval when the Job is marked
Completed/Invoiced/Paid — only for Quarterly/Twice Yearly/Yearly, since
there's no global default cadence — but always manually editable and
never re-computed afterward), Maintenance Follow-up Status (Not yet due/
Due/Contacted/Scheduled/Declined — manual, no auto-transitions),
QB Invoice Link (URL, link only — no QuickBooks API integration).

Scheduled Date (set by `acceptQuote`/`createJobFromQuote` when the quote is
accepted with a date, and editable afterward from the Quote page's Job
form — previously accepted-but-scheduled jobs only recorded this in the
Job Status transition and dropped the actual date on the floor).

**Job Day mode fields (Phase 6):** Job Day State (Not Started/Setup/
Cleaning/Inspection/Pack-up/Paused/Completed — a free string, not an
enforced enum, for the same reason as the classification fields above;
tracks the current on-site timer state and is distinct from Job Status),
Job Checklist (JSON) (a `{checklistKey: boolean}` blob — see below),
Job Notes, Scope Changes (free text, captured at job completion), Payment
Status (Not Paid/Partially Paid/Paid in Full/Unknown — records what the
owner actually knows about payment independent of Job Status; completing
a Job Day with Payment Status "Paid in Full" moves Job Status straight to
Paid, otherwise to Completed).

## JobTimeEntries
Job Time Entry ID, Job ID, Time Category, Started At, Ended At,
Duration Minutes, Notes, Created At, Updated At, Archived At.

Time Category is one of Setup/Cleaning/Inspection/Pack-up/Travel/
Off-Site Admin/Callback. Only the first four count as on-site labor
toward the $150/on-site-hour target — this is exactly what feeds Jobs'
existing Setup/Cleaning/Inspection/Pack-up Time and Actual Time (hrs)
columns at completion (`lib/pricing/jobDay.ts`'s `completeJobDay`), so no
new "actual hours" column was needed.

A job can have any number of entries over its lifetime — starting a new
segment (`startTimeSegment`) always closes out whatever segment is
currently open for that Job ID first, so there is never more than one
active (no `Ended At`) entry per job at a time. This is deliberately
forgiving rather than strict: a forgotten timer just gets silently closed
by the next tap instead of blocking the owner from moving on. A manual
correction form (`correctTimeEntry`) lets the owner fix a segment's
timestamps after the fact, and `addManualTimeEntry` lets one be added
without ever running the live timer (used for Travel/Off-Site Admin/
Callback logged after the fact, and for historical/import data).

## Job Day mode (`/jobs/[id]`, `lib/pricing/jobDay.ts`)
A simplified mobile Job Day screen for a solo owner working one job at a
time — not a workforce-management system. Shows the client/property/
access notes/water source/ladder requirement/pet notes pulled from
Property, the linked Quote's scope and total, a timer with one button per
on-site category plus Travel/Callback logging and Pause, the running
time-entry log with inline correction, a checklist, and a completion
form.

The checklist (`computeJobChecklist`) is generated from the job's
QuoteItems rather than being a fixed list: exterior/interior/screens/
tracks/specialty-glass items only appear when the quoted scope actually
includes them (by Service Code), alongside always-present fixed items
(confirm scope/access, final inspection, client walkthrough, equipment
packed, payment or invoice handled). A job with no linked quote scope
gets the full checklist rather than guessing what doesn't apply.
Checked/unchecked state is a plain toggle persisted to Jobs' Job
Checklist (JSON) column.

Completing the job (`completeJobDay`) closes any still-running segment,
sums JobTimeEntries into Jobs' existing per-category Time columns and
Actual Time (hrs) (on-site categories only), computes Total Job Cost and
Net Profit from the entered direct costs, and calls the existing
`updateJobStatus` — reusing its maintenance-follow-up prefill and
calibration-recalculation-on-completion logic rather than duplicating
it. Never touches PricingConfig.

A Job counts toward calibration only once Status is Completed/Invoiced/Paid
AND actual labor time, final revenue, and callback info are all entered
(`calibrationExclusionReasons()` in `lib/pricing/calibration.ts` explains
exactly what's missing when it doesn't qualify). Record Classification
does not by itself exclude a job from calibration — reports can filter by
it, but a fully-documented Test Job is still informative data, just kept
visually separate from real customer performance.

The `/calibration` page filters by Record Classification (checkboxes,
`?classifications=` query param). Default view: Customer Job +
Discounted Customer Job + unclassified/legacy rows (a blank classification
is treated as real customer work, not silently dropped — the same
assumption calibration already made before this column existed). Test
Job/Practice Job/Owner Property/Historical Import are excluded by
default and shown only when explicitly selected. A separate "excluded
from calibration" table lists non-qualifying completed jobs with their
specific missing-field reasons. A "standard-price-equivalent analysis"
section is kept entirely separate from the actual-revenue metrics —
never blended into the same average.

**Expanded filtering and metrics (Phase 7).** A completed Job row itself
doesn't carry story count/condition/access difficulty/scope — those are
read from the linked Quote's own Input Snapshot (the exact inputs that
quote was priced from), not guessed or re-derived
(`deriveJobSegmentation` in `lib/pricing/calibration.ts`). A job with no
linked Quote segments as "Unknown" in every dimension except window-count
band, which falls back to the Job's own Window Count. Filters: Record
Classification, Revenue Treatment, Story count, Condition, Access
difficulty, Interior/exterior scope, Window-count band, PricingConfig
version (only versions actually used by a comparable job appear as
options), and a Date Completed range — each is an independent
checkbox-group facet (all fields → AND across facets, all values within a
facet → OR), same pattern as the pre-existing classification filter.

All the richer metrics (qualifying/excluded counts, exclusion-reason
breakdown, average/median on-site hours, average/median revenue,
average/median revenue per on-site hour, average direct costs, callback
rate, average callback cost, distribution by classification) and the
Confidence Level/recommendation shown on the page are computed live from
whatever the current filter selects — "do not claim jobs are comparable
merely because they are completed." This is separate from the stored
CalibrationSnapshot row (still shown as "last full recalculation,
unfiltered"), which only updates on an explicit Recalculate or a Job
transition into Completed/Invoiced/Paid.

**Create Draft PricingConfig.** Appears once the filtered comparable-job
count reaches Moderate or Strong confidence (25+/50+). Copies every rate
field from the currently Active Residential PricingConfig into a new
Draft row, with Target Hourly Rate set to the filtered observed
revenue-per-on-site-hour (rounded) and Notes recording the basis (job
count, confidence, observed vs. target). Creating the draft never
activates it — `createPricingConfig` always defaults to Draft Status,
and only `activatePricingConfig` (on the Pricing Config page) can change
that. The Pricing Config page gained an inline edit form for any
non-Active row (`updatePricingConfigDraft` — refuses to touch an Active
row directly) so the owner can review and adjust every field before
activating, per the flow: review → edit if needed → save → explicitly
activate.

**Window-characteristic comparison.** Beyond the filters above,
`deriveJobSegmentation` also derives four Yes/No/Unknown dimensions from
data already sitting in every Quote — Has Oversized Windows / Has
French-Pane Windows (from the linked Quote's Input Snapshot `counts`,
already broken out per job — zero new field collection) and Has
Difficult-Access Items / Has Specialty-Access Items (from the Quote's own
Difficult/Specialty Access Item Count columns, populated only for
walkthrough-originated quotes). Each is also its own checkbox-group filter
facet, same pattern as Story/Condition/Access/Scope. `compareByCharacteristic`
(`lib/pricing/calibration.ts`) splits the currently-filtered comparable
jobs by each dimension and the page renders one "Estimate accuracy by
window characteristic" table per dimension — job count, Confidence Level,
average/median estimate variance (actual hours minus estimated hours),
and average on-site hours per group. Groups under 10 jobs show each job
individually instead of an average, same small-sample-size caution used
everywhere else on this page. Purely descriptive — never changes pricing;
only the owner deciding to create+activate a new PricingConfig after
reviewing this data does that.

## JobItems
Job Item ID, Job ID, Source Quote Item ID, Service Code, Description,
Actual Quantity, Unit, Final Unit Price, Actual Labor Minutes, Line Total,
Created At, Updated At, Archived At, Notes.

## CalibrationSnapshot
Calibration Snapshot ID, Generated At, Calculator Version,
Completed Job Count, Comparable Job Count, Observed Revenue Per Hour,
Median Revenue Per Hour, Average Estimate Variance, Median Estimate
Variance, Average Minutes Per Pane, Average Minutes Per Window,
Average Windows-to-Panes Ratio, Confidence Level, Date Range Start,
Date Range End, Notes.

Confidence thresholds (by **comparable** completed jobs): 0–9 Insufficient
data, 10–24 Early directional data, 25–49 Moderate confidence, 50+ Strong
internal benchmark.

## Walkthroughs
Walkthrough ID, Client ID, Property ID, Opportunity ID, Quote ID
(link — set once the walkthrough produces a quote), Walkthrough Date,
Status (Draft/In Progress/Completed/Converted to Quote/Cancelled),
Conducted By, Exterior Condition, Interior Condition, Story Count
Observed, Access Difficulty, Hard Water Present (Y/N), Construction
Debris Present (Y/N), Water-Fed Pole Suitable (Y/N), Ladder Required,
Roof Access Required, Estimated On-Site Labor Hours, Suggested Low
Price, Suggested Target Price, Suggested High Price, Owner Override
Price, Pricing Config ID, Notes, Created At, Updated At, Archived At.

A walkthrough-only visit is a standalone record — it never creates a Job
just to have somewhere to live. The Suggested Low/Target/High Price,
Estimated On-Site Labor Hours, and Pricing Config ID columns are now
populated by the guided mobile walkthrough mode (`/walkthroughs/new`,
`src/components/WalkthroughWizard.tsx`) — computed server-side via the
same shared pricing engine the in-field quoter uses
(`lib/pricing/walkthroughToQuote.ts`), never a second calculation path.
The historical-entry wizard still leaves these blank for past
walkthroughs rather than reconstructing a price recommendation after the
fact.

Condition values: Maintenance, Moderate Buildup, Heavy Buildup,
Restoration Required, Unknown. Access values: Easy, Standard, Difficult,
Specialty Access, Unknown.

## WalkthroughItems
Walkthrough Item ID, Walkthrough ID, Area (Front/Left/Rear/Right/
Interior/Garage/Basement/Other), Item Type (Window/Sliding Door/
Skylight), Quantity, Size Class (Standard/Oversized/French/Divided-Light
— only meaningful for Window), Interior Included (Y/N), Exterior
Included (Y/N), Screen Included (Y/N), Track Included (Y/N), Condition,
Access Difficulty, Hard Water (Y/N), Construction Debris (Y/N),
Estimated Labor Minutes, Notes, Sort Order, Created At, Updated At,
Archived At.

Item Type + Size Class + Interior/Exterior Included together select a
Services Service Code exactly the way the in-field quoter's window/door
counts do (e.g. Window + Oversized + Exterior Included ->
WINDOW_EXT_OVERSIZED) — reusing the existing Services taxonomy rather
than inventing a second one. Track Included always maps to the basic
track service; the deep-track distinction isn't captured at the
walkthrough-item level yet.

A completed Walkthrough can be converted into a Quote
(`createQuoteFromWalkthrough`), which reuses the walkthrough's item set
and the PricingConfig actually active at walkthrough time — never
re-resolved live, even if a newer config has since been activated, so
the quote stays reproducible. Idempotent: converting the same walkthrough
twice returns the existing Quote instead of creating a duplicate.

## ActivityLog
Activity ID, Entity Type, Entity ID, Action, Previous Value, New Value,
User, Timestamp, Request ID, Notes.

## Dashboard (`/`) — follow-up reminders (Phase 8)

No separate Tasks tab: every reminder type the spec calls for (Quote
follow-up, Walkthrough follow-up, Schedule accepted job, Collect payment,
Request review, Seasonal service reminder) is fully derivable from fields
that already exist, so a new tab would only duplicate state that could
drift out of sync. Purely surfaced in the app — nothing here sends an
email or text automatically.

- **Quote follow-up** — Pipeline rows in an open Stage with `Next
  Follow-up Date` on or before today.
- **Walkthrough follow-up** — Walkthroughs with Status "Completed" and no
  Quote ID (status-derived, no arbitrary "days since" threshold).
- **Schedule accepted job** — Jobs with Job Status "Unscheduled".
- **Collect payment** — Jobs Completed/Invoiced with Payment Status not
  "Paid in Full".
- **Request review** — Jobs Completed/Invoiced/Paid with no Review
  Requested At, or requested but Review Left still blank/Unknown.
- **Seasonal service reminder** — Jobs whose Next Maintenance Follow-up
  Date has arrived (set at job completion — see Jobs above) *and*
  Properties whose Next Recommended Service Date has arrived (Phase 9,
  for properties that never generated a per-job follow-up date).

Dashboard sections: Today (the six reminder buckets above, condensed),
Pipeline (stage counts + accepted-jobs-awaiting-scheduling), Recent
Performance (this calendar month's completed jobs/revenue/on-site hours/
revenue-per-hour/callbacks), Calibration (last snapshot's confidence/
target/observed average+median/excluded count, linking to `/calibration`
for the full filtered view — never an automatic pricing change), and Data
Quality (jobs missing labor time/direct costs/callback info/final
revenue, properties missing window counts, walkthroughs not converted or
closed — each with direct links to the record).

## Historical-entry wizard
`/historical-entry` (linked from the Dashboard and each Property detail
page) — a guided multi-step form for entering properties/jobs that
predate this app: Record Type → Client & Property (with duplicate
detection by phone/email/exact address/name+ZIP before creating new
records) → Property Characteristics → Walkthrough Details → Quote Details
→ Job Details → Review (shows exactly what will be created/reused and the
calibration-inclusion outcome) → Save. One `createRelatedRows()` call per
submission, so the whole thing is a single Write-Operation-ID-tagged,
idempotent-by-ID unit — safe to retry after a network error without
creating duplicates. A walkthrough-only visit never creates a fake Job;
Job Details only appears for record types where work was actually
performed.

## SystemTest
Dedicated scratch tab for live Sheets round-trip verification. Never used
for production business data — no writing to/deleting from Jobs, Clients,
etc. just to prove connectivity.

## QuickBooks one-way sync (Phase 14) — read-only mirror, QB stays source of truth

This app never writes back to QuickBooks. Four new tabs mirror QB's own
entities as read-only copies — they are never merged into Clients/Quotes/
Jobs:

- **QBCustomers**: QB Customer ID, Display Name, Email, Phone, Address
  (flattened billing address), QB Last Updated, Created At, Updated At,
  Archived At.
- **QBEstimates**: QB Estimate ID, QB Customer ID, Status, Total, Doc
  Number, Txn Date, QB Last Updated, Created At, Updated At, Archived At.
- **QBInvoices**: QB Invoice ID, QB Customer ID, Status (derived from
  Balance/Due Date — QB's Invoice API doesn't return a single status
  field the way Estimate does), Total, Balance, Due Date, Doc Number, Txn
  Date, QB Last Updated, Created At, Updated At, Archived At.
- **QBPayments**: QB Payment ID, QB Customer ID, Total, Payment Date,
  Method, Linked Invoice IDs (comma-joined QB Invoice IDs this payment
  applied to), QB Last Updated, Created At, Updated At, Archived At.

**The only connection to this app's own data** is `Clients.QB Customer
ID` — set once a human confirms a match in the match-review queue
(`/qb-match-review`, `lib/qb/matching.ts`), never auto-linked. Once set,
a Client's linked QBEstimates/QBInvoices/QBPayments display together on
that Client's detail page (`suggestQBLinksForClient`). The pre-existing
`Quotes.QB Estimate Link`/`Jobs.QB Invoice Link` fields stay manual,
owner-pasted URLs — QBO deep-link URLs
(`https://qbo.intuit.com/app/estimate?txnId={id}`) are available from
`qboEstimateWebUrl`/`qboInvoiceWebUrl` for convenience but nothing
auto-fills those fields.

**Auth**: OAuth2 Authorization Code flow against Intuit's Production
endpoints only (no Sandbox). Redirect URI is a real route on this app's
own domain (`/api/qb/callback`) — no loopback-server workaround needed.
Tokens (`lib/qb/tokens.ts`) live in a dedicated Cloudflare KV namespace
(`QB_TOKENS` — see `wrangler.toml`), not the Sheet, since they're
secrets/session state rather than business records. Refreshed
proactively within 60 seconds of expiry (`lib/qb/oauth.ts`'s
`getValidAccessToken`); Intuit rotates the refresh token on every
refresh call, and the rotated token is always persisted.

**Sync** (`lib/qb/sync.ts`): incremental by watermark (the *start* time
of the previous successful sync, so anything edited in QB mid-sync is
picked up next round rather than missed), all-or-nothing per entity
(every mapped record is schema-validated before anything is written),
idempotent upsert by QB's own ID against a `{qbId: row}` map fetched once
per entity. Two mechanisms:

- **Manual full sync** — the "Sync now" button on `/qb-settings`, the
  reliable baseline.
- **Webhook** (`/api/qb/webhook`, `lib/qb/webhook.ts`) — verifies the
  `intuit-signature` HMAC-SHA256 header (timing-safe compare) against
  the Webhook Verifier Token, then runs a targeted single-record sync
  directly in the same request — no relay Worker or KV event queue (that
  complexity only existed in the native-app predecessor to work around
  having no public endpoint, which doesn't apply here). `Delete`/`Merge`
  operations soft-delete the mirror row for the old id and, on a merge,
  re-fetch the surviving record under its new id. Explicitly
  non-critical: any failure here is logged to ActivityLog (Entity Type
  `QBSync`) and swallowed — the manual full sync remains authoritative
  regardless.

**Matching** (`lib/qb/matching.ts`): stateless, recomputed live whenever
`/qb-match-review` opens, never cached. Weighted signals: email exact
match (0.6), phone match on the last 10 digits (0.3), name similarity by
normalized edit distance — only counted if similarity ≥ 0.6 — (up to
0.3), address match on zip + leading street number against the
candidate's linked Property (0.2). Confidence tiers (UI grouping only,
never stored): ≥0.85 likely, ≥0.5 possible, ≥0.3 low-confidence (still
shown), below that filtered out entirely. `confirmQBLink` requires
explicit `confirmRelink` confirmation before overwriting a Client's
existing link to a *different* QB Customer.

**Setup** (this app's code is ready; connecting a real QuickBooks account
is a setup step the owner does, not something this app can do on its
own): create an Intuit Developer app and get Production Client ID/
Secret, enable webhooks for a Webhook Verifier Token, register
`https://{domain}/api/qb/callback` under Intuit's Production Redirect
URIs and a webhook subscription pointing at `https://{domain}/api/qb/
webhook` (Customer/Estimate/Invoice/Payment), create the real
`QB_TOKENS` KV namespace (`wrangler kv namespace create QB_TOKENS`) and
replace the placeholder id in `wrangler.toml`, then set
`QB_CLIENT_ID`/`QB_CLIENT_SECRET`/`QB_WEBHOOK_VERIFIER_TOKEN`/
`QB_REDIRECT_URI` as Cloudflare secrets (`wrangler pages secret put`) —
see `.dev.vars.example` for local dev. `/qb-settings` shows whether
credentials are configured and connection status.

**Explicitly out of scope**: no writing back to QuickBooks, ever; no
auto-linking of any QB Customer to any Client regardless of match
confidence; no multi-tenant/multi-company support (single realmId,
single KV blob); no relay Worker or KV event queue for webhooks.
