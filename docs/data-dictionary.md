# Spreadsheet data dictionary

Single Google Sheet (the existing Jobs spreadsheet), multiple tabs. Every tab
has `Created At`, `Updated At`, `Archived At` (soft delete only — never hard
delete a business record). All primary IDs are UUIDs, never row numbers.
Full rationale for each decision lives in the plan this was generated from;
this file is the quick column reference kept in sync with the live sheet.

## Data ownership (Property / Walkthrough / Client / Quote / Job separation)
As of the data-ownership separation pass, each tab owns a specific kind of
fact, and a field only lives on the tab whose lifetime actually matches it:
**Property** — permanent or mostly-permanent facts about the physical
location (address, inventory, typical access/water/cleaning method).
**Walkthrough** — what was observed on one particular visit (current glass
condition, temporary obstructions) — can differ visit to visit, so it never
lives on Property. **Client** — customer preferences (maintenance
frequency/season) — survive the client moving, selling, or owning multiple
properties, so they never live on Property. **Quote** — what's being
offered/charged for one scope of work. **Job** — what actually happened
(actual hours, revenue, callbacks, review tracking). The rule of thumb used
throughout: "generally true about the property" → Property; "observed
today, could be different next time" → Walkthrough; "a customer
preference" → Client; "part of the current proposed price" → Quote; "did
this happen during completed work" → Job.

## Clients
Client ID, First Name, Last Name, Phone, Email, Address (deprecated, kept
only for safe round-tripping of one pre-existing value — clients don't
carry their own address at all; every client lives at the property being
serviced, so the address lives once on Properties instead), Referral
Source, First Contact Date, Customer Since, **Preferred Contact Method**
(Email/Text — dropdown; plain string column, not a zod enum, so blank/
legacy free-text values still round-trip),
**Desired Maintenance Frequency** (One Time/Quarterly/Twice Yearly/
Yearly/Custom/Unknown) and **Preferred Service Season** (Spring/Summer/
Fall/Winter/No preference/Unknown) — moved here from Properties (see the
Properties section's migration note) since these are customer
preferences, not physical facts about a location; a client may move,
sell, or own several properties without either preference changing.
Editable on the Client Detail page's **Service Preferences** card (same
`?edit=1` toggle as Contact Info, but its own POST action so submitting
one card's form can never blank the other's fields). Shown read-only on
the Property Detail page's utility line. Notes, Created At, Updated At,
Archived At.

## Properties
Property ID, Client ID, Property Type (Residential/Commercial/New
Build-Construction — required; drives which PricingConfig segment
applies and is a calibration segmentation dimension), Street Address,
City, State, Zip, Year Built, Square Footage, Stories, Building/Complex
Name (optional — display/logistics grouping only, e.g. "all units in
this condo building"; not a data relationship the app enforces), Unit
Identifier (optional), Created At, Updated At, Archived At — the
**Property Information** card, always expanded.

**Permanent Access & Setup** card: **Interior Access Difficulty**,
**Exterior Access Difficulty** (each Easy/Standard/Difficult — radio),
**Roof Access Required (Y/N)**, **Exterior Cleaning Method** ("Typical
Exterior Method" in the UI; Water-Fed Pole/Traditional/Mixed/
Undetermined — radio), **Ladder Requirement** (None/Step Ladder/
Extension Ladder/Tall Extension Ladder/Specialty Access — radio), Access
Considerations checkboxes — **High Interior Glass (Y/N)**, **Steep Or
Uneven Terrain (Y/N)**, **Restricted Work Or Setup Area (Y/N)** —
**Water Access Method** (Exterior Spigot/Interior Connection Only/No
Usable Connection/Unknown — radio, "Water Access" in the UI) and **Water
Supply** (Municipal/Well/Unknown — radio), **Parking And Setup
Difficulty** (Easy/Limited/Difficult/Unknown — radio, "Parking & Setup"
in the UI — replaces the two checkboxes below), **Gate Or Entry
Restriction (Y/N)**, **Long Hose Run (Y/N)**, **Water Source Far From
Work Area (Y/N)**, and **Access Notes** ("Access & Setup Notes" in the
UI — permanent gate/parking/hose/water-connection/staging instructions;
merges the deprecated Site Access Notes below on first display if both
held content).

**Window & Door Inventory** card: Total Window Units (approximate number
of window assemblies — subjective), Total Glass Panes (total individual
glass panes — objective; validated live against the fields below),
**Count - Standard** (new primary aggregate — "Standard Windows" in the
UI; a quick top-level count distinct from the detailed Double Hung/
Casement/Picture/Sliding Window breakdown, the same relationship Total
Glass Panes already has to its own breakdown — optional, never required
just because the detailed fields are used and vice versa), Count -
French ("French/Divided-Light"), Sliding Glass Door Pane Count ("Sliding
Glass Doors"), Count - Skylights, Screen Count, Track Count, Count -
Solar Panels (Screens/Tracks/Solar Panels are accessories, never counted
toward pane totals), a collapsed **"Detailed inventory"** disclosure
holding Count - Double Hung, Count - Casement, Count - Picture, Count -
Sliding, Count - Awning (optional legacy-style breakdown by operating
type — when any of these are non-zero, they stand in for Count -
Standard in the Total Glass Panes validation instead of double-counting
alongside it), and **Inventory Verified At** (timestamp, set only via the
independent "Mark Inventory Verified" action — never touched by a plain
field save).

**Property Notes** card: Pet Notes, General Notes ("Property Notes" in
the UI) — permanent/recurring notes only; no condition notes and no
general maintenance-notes field live here anymore (see migration note).

**Summary strip** tiles: Type, Window Units, Glass Panes, Stories, and
**Next Service** — derived, not a stored field: the earliest future
`Scheduled Date` among this property's `Scheduled` Jobs ("Next visit: ..."),
else the most recent completed Job's already-computed `Next Maintenance
Follow-up Date` ("Next recommended: ..."), else "Not scheduled".

Legacy columns kept declared (pre-existing values still round-trip) but
no longer written by the current form: **Roof Access Difficulty**,
**Overall Access Difficulty**, **Water Access** (superseded by Water
Access Method — a different column, kept under its original name to
avoid a collision), **Equipment Suitability**, **Water Source**
(superseded by the Water Access Method/Water Supply split — see the
migration mapping below), **Water-Fed Pole Suitable (Y/N)** (superseded
by Exterior Cleaning Method), **Easy Parking And Setup (Y/N)** / **Limited
Parking Or Setup Space (Y/N)** (superseded by Parking And Setup
Difficulty — Limited wins if a property somehow has both checked), **Site
Access Notes** (merged into Access Notes). Migration mapping: old `Water
Source = Exterior Spigot` → Water Access Method `Exterior Spigot`; old `No
On-Site Water` → `No Usable Connection`; old `Well Water` → Water Supply
`Well` (Water Access Method defaults to `Unknown` for this case, since the
old value described supply, not access). `Ladder Requirement`'s old
abbreviated ranges map onto full-word equivalents (`Step Ladder`/
`Extension Ladder`/`Tall Extension Ladder`); `Specialty Access` has no
legacy equivalent. `Exterior Cleaning Method`'s old two-option values map
onto the new four-option set, falling back to the even-older
`Water-Fed Pole Suitable (Y/N)` checkbox. As with every legacy migration
in this app, these are read-time-only compatibility defaults — nothing
is rewritten in the sheet until the owner actually saves the record.

**Data-ownership separation (Glass Condition + temporary access moved to
Walkthrough).** These columns are deprecated on Property — kept declared,
never written by the current form: **Window Condition**, **Hard Water
History (Y/N)**, **Construction Debris (Y/N)**, **Silicone Adhesive Or
Sticker Residue (Y/N)**, **Heavy Interior Residue (Y/N)**, **Oxidized
Frames Or Screens (Y/N)**, **Condition Varies By Area (Y/N)**, **Condition
Notes**, **Exterior Access Obstructed (Y/N)**, **Furniture Or Belongings
Movement Required (Y/N)** — all describe what a *particular visit* found,
which can differ next time, so they now live on Walkthrough instead (see
the Walkthroughs section) — reusing Walkthrough's pre-existing `Exterior
Condition`/`Hard Water Present (Y/N)`/`Construction Debris Present (Y/N)`
for the first three, new Walkthrough columns for the rest. **Desired
Maintenance Frequency** and **Preferred Service Season** are deprecated
here too — moved to Client (see the Clients section); the first Property
save after this shipped copies either legacy value onto the linked Client
only if the Client's own field is still blank, never overwriting an
existing Client value. **Next Recommended Service Date**, **Next
Scheduled Visit**, **Last Review Requested Date**, **Last Review Received
Date**, and **Maintenance Notes** are also deprecated — the first four
were manually-typed CRM fields disconnected from the real Job-level data
that already tracks this (Job's `Next Maintenance Follow-up Date` and
`Review Requested At`/`Review Left`, both already surfaced on the
Dashboard); Next Service is now derived (see the summary strip above) and
review tracking stays exactly where it already worked, on Job. Maintenance
Notes has no single auto-obvious destination and is simply dropped from
the editable form; historical content stays in the legacy column.

**One-time legacy-condition migration.** If a property has any non-blank
legacy Glass Condition or temporary-access value and no migration
Walkthrough has been created for it yet, the Property Detail page shows a
one-time notice — "Legacy condition information exists on this property —
copy it into a historical walkthrough?" — with a single action that
creates one `Status: Completed` Walkthrough carrying those values over,
dated from the property's own `Updated At` (the exact original observation
date isn't known, so the Walkthrough's Notes say so explicitly and the
Walkthrough Date is the closest honest proxy available) with a Notes
prefix (`Migrated from legacy Property condition data`) that lets the
notice detect it already ran and never show again. The legacy Property
columns are never cleared — this only ever adds a record, never rewrites
one.

None of the fields on the Property Detail page (access difficulty, water,
cleaning method, ladder, notes) are read by `calculateQuote`,
`walkthroughToQuote.ts`, or `calibration.ts` — pricing and calibration are
driven entirely by the parallel set of Walkthrough-level fields described
above, so changes on this page carry zero pricing blast radius.

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

## Pipeline (sales opportunities only — not job operations)
Opportunity ID, Client ID, Property ID, Primary Quote ID, Stage, Status,
Estimated Value, Referral Source, Next Follow-up Date, Last Contact Date,
Created At, Updated At, Closed At, Archived At, Lost Reason, Notes,
QB Estimate ID (set only for opportunities this app's own QuickBooks sync
created/maintains — see the QuickBooks section's "Pipeline auto-sync from
Estimates"; blank on every manually-created opportunity).

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
Count, Specialty Access Item Count, Service Scope, Inventory Coverage,
Labor Estimate Solo Hours, Labor Estimate Crew Size, Labor Estimate
Confidence, Labor Estimate Notes, Job High Interior Glass (Y/N), Job Steep
Or Uneven Terrain (Y/N), Job Exterior Access Obstructed (Y/N), Job
Furniture Movement Required (Y/N), Job Water Access Difficult (Y/N), Job
Silicone Or Sticker Residue (Y/N), Job Heavy Interior Residue (Y/N), Job
Other Condition Notes.

The saved Quote + QuoteItems rows are always the authoritative record of
what was charged. Reproducibility means the stored snapshots + config
reference let anyone audit how the price was reached later — not that the
app recomputes a past quote from current logic and treats that as truth.

`/quotes` (nav item) lists every quote (Property/Client/Status/Final
Quoted Price, linking to `/quotes/[id]`) — previously only `/quoter` (the
*creation* tool) was in the nav, so an existing quote could only be
reached via a direct link from elsewhere.

**Difficult/Specialty Access Item Count** (window-characteristic calibration
reporting): populated only for quotes created from a completed Walkthrough
(`createQuoteFromWalkthrough` in `lib/pricing/walkthroughToQuote.ts`) —
summed from each WalkthroughItem's own per-item Access Difficulty
(Quantity-weighted, not row-counted; see `countAccessDifficultyItems`).
Blank — never a fabricated `0` — for quotes created directly via the
plain in-field quoter, which has no per-item data at all. Reporting-only:
feeds `deriveJobSegmentation`'s calibration dimensions, never the pricing
engine.

**Quoter redesign fields** — all reporting-only; none are read by
`calculateQuote`. **Service Scope** (Exterior Only/Interior & Exterior/
Interior Only/Custom Selection) and **Inventory Coverage** (Entire
Property/Selected Windows Only) just record which UI path produced the
submitted Quote Inventory counts — the counts themselves (already in
Input Snapshot) are what actually price the job. **Labor Estimate Solo
Hours/Crew Size/Confidence/Notes** are a second, independently
human-entered labor figure — never read by `calculateQuote`'s own
itemized `estimatedLaborHours`, per the owner's explicit "reporting only"
decision. The **Job \* (Y/N)** flags mirror the corresponding Property
Access Considerations/Glass Condition columns 1:1 (see the Properties
section above) but describe *this specific visit*, which can diverge from
the property's general saved condition — the Quoter pre-fills them from
the property's saved flags and shows an inline "this quote differs from
the saved property details" notice when the rep changes them, without
ever auto-updating the Property record. The engine's single
`difficultAccess` boolean (unchanged) is derived from whichever of the
access-related Job flags are checked, so there's still exactly one
pricing input driving the access surcharge even though the form now
captures the specific reasons why.

**Adjustment Reason.** The existing **Override Reason** column is now
required whenever Manual Adjustment or Discount is non-zero — enforced by
a hand-written check in `createQuote()` (`lib/pricing/quotes.ts`), the
same pattern as Pipeline's Lost Reason requirement in
`api/pipeline/[id].ts` (no zod enum/refinement precedent in this
codebase for "field X required when field Y is non-zero"). The Quoter's
UI offers a defined option set (Competitive Pricing, Referral or
Relationship, First-Service Uncertainty, Bundled Property Discount,
Minimum Charge, Access Complexity, Pricing Experiment, Owner Discretion,
Other — free text when "Other" is picked), but the column itself stays
plain text, unchanged.

**Quote Inventory default source.** The Quoter's Quote Inventory card
defaults from the property's **latest completed Walkthrough**
(`Status` = Completed or Converted to Quote, most recent by Walkthrough
Date) via the existing `itemsToQuoteCounts()` — not from the Property's
own Windows & Doors counts, which use a categorically different taxonomy
(no interior/exterior split, no Standard-vs-Oversized distinction) that
can't be mapped into `QuoteCounts` without guessing. Falls back to blank/
manual entry when no qualifying walkthrough exists yet. Switching
Inventory Coverage to "Selected Windows Only" (or Service Scope to
"Custom Selection") makes the counts directly editable for that one
quote only — never rewrites the walkthrough or property record.

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

**Historical Job Entry — Callback & Quality, Pricing Review, Job
Performance Review** (Historical Entry Wizard only; free-text/blank
columns, same non-fabrication reasoning as the classification fields
above). Callback Reason (Quality Issue/Customer Request/Missed Windows/
Streaking/Hard Water Rework/Equipment Failure/Weather/Scheduling Error/
Other), Callback Root Cause, Callback Corrective Action, Callback Lessons
Learned — only meaningful when Callback Required (Y/N) is Y; distinct
from the pre-existing Callback Labor Minutes/Callback Cost columns (which
capture the time/money impact, not the why). The wizard's own UI field is
labeled "Callback Hours" (decimal) but still writes minutes into the
shared Callback Labor Minutes column — converted at save time — since that
column is also written in minutes by the live Job Day completion path
(`jobDay.ts`). Callback time is never folded into Actual Time (hrs);
`historicalEntry.ts`'s `onSiteMinutes()` already excludes it.

Pricing Confidence (Very Low/Low/Medium/High/Very High), Would Price
Differently Today (Y/N), Current Retail Price Estimate ($), Reason
Pricing Changed — pricing hindsight only, never read by
`calculateQuote`/`walkthroughToQuote.ts`/`calibration.ts`'s eligibility
check, so none of it auto-influences pricing recommendations.

Overall Job Rating, Customer Satisfaction Rating (both 1–5, free string),
Would Accept Job Again (Y/N), Would Change Process (Y/N), Process
Improvements. Customer Satisfaction Rating is a deliberately distinct
column from the pre-existing Customer Rating — Customer Rating sits
alongside Review Requested At/Review Left and is reserved for an actual
score from a real customer-left review; Customer Satisfaction Rating is
the owner's own retrospective judgment entered during historical data
entry.

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

Condition values (`GLASS_CONDITION_LEVELS`, `lib/models/walkthrough.ts`):
Maintenance, Light Buildup, Moderate Buildup, Heavy Buildup — a pure
dirtiness scale, both fields rendered as segmented-radio pills in
`WalkthroughWizard.tsx` (Interior Glass Condition + Exterior Glass
Condition). `Light Buildup` maps to the same no-surcharge `'light'`
pricing tier as Maintenance for now (see `conditionForEngine()` —
revisit with its own factor once enough historical data justifies it).
Access values: Easy, Standard, Difficult, Specialty Access, Unknown.

**Restoration Services Required** — a separate concept from Glass
Condition, added below the two condition controls in the wizard: what
specialized technique the job needs (construction residue, adhesive,
scraping, etc.), as opposed to how dirty the glass is. A modern home
that's never been cleaned can need heavy restoration work without being
"Heavy Buildup" dirty, and vice versa — this is why the two are tracked
separately rather than as one blended value. Eight checkboxes total,
three of them reused existing Walkthrough columns rather than
duplicating them: **Construction Debris Present (Y/N)**, **Hard Water
Present (Y/N)**, **Silicone Adhesive Or Sticker Residue (Y/N)** (labeled
"Window Stickers / Adhesive" in the restoration card). Five are new:
**Paint Overspray (Y/N)**, **Razor Scraping Required (Y/N)**, **Steel
Wool Required (Y/N)**, **Non-Scratch Pad Required (Y/N)**,
**Restoration Notes** (the "Other" free-text field). Checking any of the
8 restoration flags overrides the Glass Condition-derived pricing tier
to `'firstTime'` in `conditionForEngine()` — the same First-Time Cleaning
Factor surcharge the old single "Restoration Required" condition level
used to trigger, just via a more accurate trigger condition now that
restoration is tracked separately. All 8 flags flow into a
walkthrough-originated Quote's `'Input Snapshot'` JSON (via `QuoteInput`
in `lib/pricing/types.ts`), the prerequisite for future calibration
segmentation by restoration technique — no new segmentation
dimensions/report card exist yet, this just makes that possible later.

**Data-ownership separation additions** — temporary condition/access
observations moved here from Property (see the Properties section),
since a maintenance visit can change every one of them: **Heavy Interior
Residue (Y/N)**, **Oxidized Frames Or Screens (Y/N)**, **Condition
Varies By Area (Y/N)**, **Condition Notes**, **Exterior Access
Obstructed (Y/N)**, **Furniture Or Belongings Movement Required (Y/N)**,
**Temporary Access Notes** (also covers any other one-off setup
obstruction, rather than a dedicated boolean for a vague "other" case).
These, plus `Exterior Condition`, are reporting-only; none are read by
the pricing engine directly (only `Exterior Condition`, via
`conditionForEngine()`, and the 8 restoration flags above feed pricing).
`Roof Access Required` exists in the schema but has no rendered control
in the wizard today — a pre-existing gap, unrelated to this change.

**Access & Equipment Modifiers** (Historical Entry Wizard only) —
checkbox-level equipment/complexity detail recorded for a completed
historical job, purely for reporting, never read by the pricing engine:
**Second-Story Exterior (Y/N)**, **Ladder Required (Y/N)**, **Vaulted
Interior Glass (Y/N)**, **Roof Access Required (Y/N)**, **Oversized Glass
Or Large Sliders (Y/N)**, **Tight Landscaping Or Obstructions (Y/N)**,
**Limited Interior Access (Y/N)**, **Water-Fed Pole Used (Y/N)**,
**Traditional Exterior Cleaning Used (Y/N)**, **Other Access Issue
(Y/N)** + **Other Access Notes**. These are genuinely new columns, not
reuses of the live wizard's similarly-named `Ladder Required`/`Roof
Access Required`/`Water-Fed Pole Suitable (Y/N)`/`Exterior Access
Obstructed (Y/N)`/`Furniture Or Belongings Movement Required (Y/N)`
above — each of those is a free-text or prospective property-capability
concept populated by the live `WalkthroughWizard.tsx`, while these ten
are a retrospective Y/N record of what a specific historical job actually
involved. The Historical Entry Wizard's own "Overall Access Difficulty"
select (relabeled from "Access difficulty") still writes the same
`Access Difficulty` column above, but offers only Easy/Standard/Difficult
(vs. the live wizard's 5-value list) — a genuinely difficult/specialty-
access historical job is recorded as `Difficult` plus the relevant
modifier checkboxes above, rather than a separate `Specialty Access`
level.

The Walkthrough intake step (`/walkthroughs/new`) shows a read-only
**Property reference** block (window units, panes, stories, typical
exterior method, ladder requirement, water access, roof access required,
pet notes) sourced from the linked Property record, so permanent facts
don't have to be re-typed at every visit — purely informational; nothing
here is ever treated as an editable override, and the Walkthrough always
saves its own independent values regardless of what the reference shows.

**One-time legacy-condition migration.** A Walkthrough created by the
Property Detail page's migration action (see the Properties section) is
tagged by a recognizable `Notes` prefix (`Migrated from legacy Property
condition data`) rather than a dedicated schema flag — this is how the
one-time notice knows not to show again for that property.

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

Timestamps render human-readable ("Jul 24, 2026 at 9:03 AM") wherever an
Activity Timeline shows them, via `formatTimestamp()` in `src/lib/format.ts`
(the first date-display helper in the codebase) — the stored value is
always the raw ISO timestamp; only the display changes. Fixed a real
duplicate-logging bug behind repeated near-identical QuickBooks entries:
`confirmQBLink` (`lib/qb/matching.ts`) and the Pipeline-stage-sync branch
of `syncPipelineFromEstimates` (`lib/qb/pipelineSync.ts`) each called
`updateRow(..., {action: '...'})` — which already logs internally — and
then called `logActivity()` again explicitly with the same entityType/
action, producing two rows per one logical event. Fixed at the source by
deleting the redundant explicit call in both places, rather than adding a
display-layer de-duplication step. Source ActivityLog rows are never
deleted for any reason — only how they're written and displayed changed.

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
  Date has arrived (set at job completion — see Jobs above, now sourced
  from the linked Client's Desired Maintenance Frequency, falling back to
  Property's deprecated legacy field for un-migrated clients). No longer
  also checks a Property-level "Next Recommended Service Date" fallback —
  that field is deprecated (see the Properties section's data-ownership
  separation note) and there's no other data to derive a reminder from for
  a property with zero completed-job history, so that fallback is gone
  rather than faked.

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
performed. Walkthrough Details also carries Access & Equipment Modifiers
(below the renamed "Overall Access Difficulty" field); Job Details also
carries an expanded Callback & Quality section (Callback Required →
Callback Hours/Reason/Root Cause/Corrective Action/Lessons Learned when
checked), plus new Pricing Review and Job Performance Review cards below
Classification — see the Jobs and Walkthroughs sections above for the
exact columns.

**Historical Records** (`/historical-records`, linked from the Dashboard
and from `/historical-entry`) — lists every Job with a non-blank Record
Classification (a reliable signal since only this wizard's save/update
path ever writes that column), linking each to
`/historical-entry/[jobId]` for **true edit mode**: the same wizard UI,
pre-loaded from the real Client/Property/Walkthrough/Quote/Job rows via
`buildEditState()`, posting `action: 'update'` instead of `'save'` on
submit. `updateHistoricalEntry()` (`lib/pricing/historicalEntry.ts`)
updates each included sub-record in place via `updateRow()` — deliberately
not `createRelatedRows()`, whose idempotent-by-ID create semantics would
silently skip rewriting a row whose ID already exists. Every field-mapping
literal (Client/Property/Walkthrough/Quote/Job) is shared between the
create and update paths via `buildClientRecord()`/`buildPropertyRecord()`/
etc., so the two write paths can't drift apart. Walkthrough-only
historical entries (no Job ever created) have no equivalent list/edit
support today — they remain viewable only via their own Walkthrough
Detail page.

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
never stored): ≥0.85 likely, ≥0.5 possible, ≥0.3 low-confidence, below
that "no signal" — every Client is shown, ranked best-first, regardless of
tier. There's no hidden threshold: linking is always an explicit human
confirmation (never automatic), so there's no safety reason to hide a
weak-looking candidate the owner can still recognize by eye.
`confirmQBLink` requires explicit `confirmRelink` confirmation before
overwriting a Client's
existing link to a *different* QB Customer.

**Import a QB Customer as a new Client** (`/qb-match-review`'s "Create
Client from this QB Customer" button): for a QB Customer with no good
existing Client match, creates a new Client directly from QB's Display
Name (split into First/Last on the last whitespace run — see
`splitDisplayName`), Email, and Phone, and links it immediately (no
separate confirm step, since there's nothing to conflict with). QB's
billing address is parsed back into street/city/state/zip (`parseFlatAddress`
— only when the flattened string has exactly the expected 4 comma-separated
parts, otherwise left as one blob rather than risk mis-assigning it) and
carried over as a prefill on that new Client's "Add property" form —
never auto-saved, just a starting point to review before submitting.

**Pipeline auto-sync from Estimates** (`lib/qb/pipelineSync.ts`): for every
Estimate belonging to an already-*linked* Client, automatically creates (or
updates the Stage of) exactly one Pipeline opportunity, tracked by a new
`Pipeline.QB Estimate ID` column so this sync can find "its own" card again
without ever touching an opportunity the owner created by hand (one with
no `QB Estimate ID` set). Runs at the end of every full sync and
immediately after a webhook-triggered Estimate update — QuickBooks is the
source of truth for these particular cards' Stage. Status mapping
(`estimateStageMapping`): QBO's Estimate status is one of
Pending/Accepted/Closed/Rejected — Pending → `Quote Sent` (an Estimate
existing at all is the strongest signal this app can read automatically
that a quote went out — QB doesn't separately expose "drafted but not
sent"), Accepted and Closed both → `Accepted` (Closed most commonly means
completed/converted in QBO's model, not abandoned), Rejected → `Lost` with
Lost Reason "QuickBooks Estimate rejected", anything else/blank → `Quote
Sent`. An Estimate for a QB Customer with no linked Client yet is skipped
(not queued, not retried specially) — once the owner links it via
`/qb-match-review`, the next sync picks it up and creates the card, same
as any other Estimate.

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
