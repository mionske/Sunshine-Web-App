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

**Columns no longer declared by the app** (left in the sheet, preserved
verbatim on every write by `propertySchema`'s `.catchall()`, never read):
the per-window-style counts `Count - Standard`, `Count - Double Hung`,
`Count - Casement`, `Count - Picture`, `Count - Sliding`, `Count - French`,
`Count - Awning`, `Count - Skylights`, `Count - Solar Panels`, and
`Sliding Glass Door Pane Count`. Identifying every window type in a house
was field busywork nothing downstream ever read — pricing, calibration and
reporting all work from window units and panes. One property has a real
breakdown recorded; it stays readable in the sheet.

**Why `.catchall()` matters here.** `updateRow` rewrites the entire row, and
`objectToRowValues` writes an empty string for any header missing from the
validated record. A strict zod object strips keys it doesn't declare, so
without `.catchall()` every column removed above would be silently blanked
on the next save of that property. This is not cosmetic.

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

**Repeat Business Status** (`Property Status` in the spec that introduced
it — renamed on this tab to avoid colliding with `properties/[id].astro`'s
own derived, never-stored "property status" badge, e.g. "Prospect"/
"Established Client", computed by `derivePropertyStatus()` from Pipeline/
Job data): a plain optional field — `Active` / `Quote Pending` /
`One-time Job`, or blank — flagging a second-property or one-off add-on
request from an *existing* Client. Set manually on the Property Detail
page's Property Notes card; never auto-set. This is the mechanism for
"repeat business on an existing Client" from the Leads/Clients separation
below — it deliberately reuses the existing Job-driven follow-up
mechanism (`Next Maintenance Follow-up Date`/`Maintenance Follow-up
Status` on Jobs) for scheduling, rather than creating a second sales
pipeline.

## Leads (cold, pre-Client opportunities — Leads/Clients separation)
Lead ID, First Name, Last Name, Phone, Email, Street Address, City, State,
Zip, Source, Stage, Next Follow-up Date, Notes, Quote Link, Outcome,
Converted Client ID, Converted Property ID, Created At, Updated At, Closed
At, Archived At.

A Lead is a genuinely lighter-weight record than a Pipeline Opportunity —
it never requires an existing Client or Property, just enough (rough
Street Address/City/State/Zip — reusing Property's own field names, not a
single free-text blob) to schedule a walkthrough. Two entry points exist
side by side: create a Client directly with a Property attached (used
when the relationship is already committed), or create a Lead with no
Client/Property at all (used for cold opportunities that haven't been
walked yet) — see `/leads` and `/clients`.

Stages: `New Lead → Contacted → Walkthrough Scheduled → Quoted → Won /
Lost` (its own enum, distinct from `PIPELINE_STAGES` — Quote
Draft/Quote Sent/Follow-up collapse into a single "Quoted" stage here).
`Quote Link` is a manual reference only (e.g. a QuickBooks estimate doc
number/link) — QuickBooks remains the sole source of truth for real
quote/invoice dollar amounts; nothing here is authoritative pricing data.

**Convert to Client** (`convertLeadToClient()` in `lib/leads.ts`),
enabled once Stage is `Quoted` or `Won`: creates a new Client from
First/Last Name, Phone, Email, Referral Source (from the Lead's Source);
auto-creates a full Property on that Client from the Lead's rough
address (`Property Type` defaults to `Residential` — correctable
immediately on the new Property's own detail page); leaves every
Property-specific field not knowable from a Lead (window inventory,
access notes, hard water history, desired maintenance frequency) blank
for the operator to fill in after the walkthrough — no duplicate data
entry. The Lead itself is then set to `Stage: Won`, `Outcome: Won`,
stamped with `Converted Client ID`/`Converted Property ID`/`Closed At`,
and archived out of the active Leads list — never deleted, kept for
close-rate/lead-source reporting (`/leads?archived=1`).

**Lost handling** (`markLeadLost()`): sets `Stage: Lost`, `Outcome: Lost`,
`Closed At`, and archives the Lead the exact same way as a Won
conversion — same reporting retention, no deletion. A separate `delete-
lead` action exists too, for a genuinely mistaken entry (archives without
setting `Outcome`, so it's distinguishable from a real Won/Lost close).

**Relationship to Pipeline (deliberate, scoped decision)**: the existing
Pipeline/Opportunity board (see below) is left completely untouched by
this feature. Today's real Pipeline data all requires an existing Client
already (Property is optional, Client is not) — it doesn't structurally
match a Lead (no Client yet), and it's wired into live, unattended
QuickBooks sync automation (webhook + the qb-settings "Sync now" button +
`refresh-qb-estimate`). Retiring or migrating that is a real product/data
decision with production risk that the Leads/Clients spec didn't
explicitly ask for, so Pipeline keeps its current role unchanged (nav
item, board, QB sync) rather than being merged or removed. The Dashboard
gets a new "Leads needing follow-up" reminder (`Next Follow-up Date <=
today` on an active Lead) alongside — not replacing — Pipeline's own
"Open follow-ups" reminder.

## Pipeline (sales opportunities only — not job operations)
Opportunity ID, Client ID, Property ID, Stage, Status, Estimated Value,
Referral Source, Next Follow-up Date, Last Contact Date, Created At,
Updated At, Closed At, Archived At, Lost Reason, Notes.

**Stages (6 working + Lost):** New Lead, Walkthrough or Quote Needed,
Quote Sent, Approved or Scheduling, Scheduled, Completed or Follow-Up,
Lost. The board shows the six by default; Lost is reachable through the
outcome filter, so a lost opportunity stays a real, reportable outcome
rather than a badge or a silent archive. Approval is the hand-off point to
the job workflow, so it stamps `Closed At` even though the work is still
ahead. Secondary states — walkthrough scheduled, quote accepted/declined,
invoice sent, paid, review requested — are badges on the card, not columns.

**Columns no longer declared** (left in the sheet, preserved verbatim by
`pipelineSchema`'s `.catchall()`, never read or written):
- `Primary Quote ID` — had exactly one writer (the public ballpark-estimate
  flow) and no readers. The board derives an opportunity's latest quote by
  scanning Quotes for its own `Opportunity ID`, which works for every quote
  rather than just the first.
- `QB Estimate ID` — belonged to the automatic QuickBooks→Pipeline sync,
  which was removed. QuickBooks no longer creates or moves Pipeline cards.
  Not to be confused with Quotes' own `QB Estimate ID`, which is the manual
  quote↔estimate link and is very much still in use.

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
QB Estimate Link (legacy — a manually-pasted raw URL, superseded below,
never written to again), QB Estimate ID (the real link — set only via
`lib/qb/recordLinking.ts`'s `confirmQBEstimateLink()`, never hand-typed;
once set, the linked `QBEstimates` row's Status/Total/Doc Number/Txn
Date/Updated At become the authoritative display on the Quote detail
page's read-only "QuickBooks Estimate" summary card, with a "View
Estimate in QuickBooks ↗" deep link — see the QuickBooks section below),
QB Match Suggestion Dismissed (a QB Estimate ID the owner dismissed from
the "Potential QuickBooks Match Found" suggestion, so it stops
reappearing), Difficult Access Item Count, Specialty Access Item Count, Service Scope, Inventory Coverage,
Labor Estimate Solo Hours, Labor Estimate Crew Size, Labor Estimate
Confidence, Labor Estimate Notes, Job High Interior Glass (Y/N), Job Steep
Or Uneven Terrain (Y/N), Job Exterior Access Obstructed (Y/N), Job
Furniture Movement Required (Y/N), Job Water Access Difficult (Y/N), Job
Silicone Or Sticker Residue (Y/N), Job Heavy Interior Residue (Y/N), Job
Other Condition Notes (the 7 **Job \*** columns and Job Other Condition
Notes are **legacy** — superseded by the Job Assessment redesign below,
kept declared only so older quotes' values still round-trip; the Quoter
never writes any of them again).

**Job Assessment redesign** (Quoter rebuilt to match Walkthrough/Historical
Entry's own model instead of a flat ad-hoc checklist): Exterior/Interior
Glass Condition (`GLASS_CONDITION_LEVELS`), Overall Access Difficulty
(Easy/Standard/Difficult), the 10-item Access & Equipment Modifiers set,
and the 8-item Restoration Services Required set (Construction Debris,
Window Stickers/Adhesive, Paint Overspray, Hard Water, Razor Scraping,
Steel Wool, Non-Scratch Pad, notes) all live inside **Input Snapshot**
(`QuoteInput`, `lib/pricing/types.ts`) rather than as dedicated Quote
columns — matching how Manual Adjustment/Discount/Override Reason were
already stored, and avoiding another schema migration for what's mostly
reporting data. The Quote Detail page parses Input Snapshot to display a
"Job Assessment" card (segmented values + badges, matching the Walkthrough
Detail page's own style). Exterior Glass Condition + whether any
Restoration Services box is checked together drive the engine's condition
tier via `conditionForEngine()`/`hasAnyRestorationFlag()`
(`lib/pricing/condition.ts` — extracted from `walkthroughToQuote.ts` so
it's dependency-free enough to run client-side for the Quoter's live price
preview); Overall Access Difficulty (`'Difficult'`) is the sole trigger for
`difficultAccess`, replacing the old OR-of-checkboxes logic. The 10 Access
& Equipment Modifiers never affect price, matching Walkthrough's own
identical set. Quoter also auto-defaults this whole section from the
property's latest completed Walkthrough (a real per-visit observation)
instead of Property's legacy Window Condition/Access Considerations fields
(which are no longer read here at all).

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
decision. The legacy **Job \* (Y/N)** flags (see "Job Assessment redesign"
above for their replacement) used to mirror the corresponding Property
Access Considerations/Glass Condition columns and derive `difficultAccess`
from an OR of the access-related ones — both superseded by Overall Access
Difficulty and the property's latest Walkthrough as the pre-fill source.

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

**Labor-model price band** (added with the labor model): Suggested Low
Price, Suggested Target Price, Suggested High Price, Owner Selected
Price, Labor Model Version, Pricing Model Version, Owner Override
Reason. Written only for quotes built from a grouped-inventory
walkthrough. The three suggestions are productive hours times the
low/target/high hourly production targets in PricingConfig.

`Owner Selected Price` is whatever the owner actually decided and is
never clamped toward the suggestion — a ten-hour job priced at $1,700 is
a legitimate answer, and the app's job is to record it, not argue with
it. Both model versions are stored so a past quote stays explainable
after either model changes.

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
Estimate Low Variance, Estimate High Variance,
Low Hourly Production Target, Target Hourly Production Target,
High Hourly Production Target, Created At, Updated At,
Archived At, Notes.

**Hourly production targets** (150 / 175 / 200, seeded 2026-07-28) are
revenue per *productive* labor hour and belong to the labor model — the
walkthrough's estimated productive hours times these three produce the
suggested low/target/high band (see the Labor model section). Target is
the default recommendation; low and high are guidance either side of it.
Distinct from `Target Hourly Rate` above, which the older per-service
engine still uses to price standard-window line items.

Standing instruction from the owner: these three are a stable reference
point, not a tuning knob. When an estimate comes out wrong the fix
belongs in the production model — classes, access, condition, screens,
tracks — never in moving the rate. `Minimum Job Price` was set to 250 at
the same time; it had been blank, so no job minimum was being enforced
at all before that.

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

**Why the header row has a gap.** The app's own Jobs columns start at
column **Z**, deliberately: columns X–Y hold the original hand-maintained
calibration summary block, including two intentionally blank headers. An
early run of the (now deleted) `extend-jobs-tab` migration wrote one column
too far left, into column Y, and a repair step in that same script moved it
back — which is why the gap looks slightly irregular in the live sheet.
Nothing reads those blank columns; they are preserved only because the
Jobs-preservation protocol says existing columns are never reordered or
removed. This note exists because that history used to live only in the
migration script, which has since been deleted.

**Columns no longer declared by the app** (present in the sheet, preserved
verbatim on every write by `jobSchema`'s `.catchall()`, never read):
`Photos` and `Customer Rating`. Both were added by a migration but never
wired to any surface. `Customer Rating` was reserved for a score from a
real customer-left review, alongside the still-live `Review Requested At` /
`Review Left` pair; it was never collected. Distinct from `Customer
Satisfaction Rating`, which is the owner's own retrospective judgment.

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
above). Callback Category (Quality/Customer/Weather/Equipment/Scheduling/
Other) and Callback Reason are a two-tier pair — Callback Category is the
primary bucket, Callback Reason is the specific reason within that bucket
(Quality → Quality Issue/Operator Error/Streaking/Hard Water Rework/
Missed Windows; Customer → Customer Request; Weather → Weather;
Equipment → Equipment Failure; Scheduling → Scheduling Error; Other →
Other — see `CALLBACK_PRIMARY_CATEGORIES`/`CALLBACK_SPECIFIC_REASONS` in
`lib/models/job.ts`), so the wizard only ever shows relevant specific
reasons instead of one long flat list. Callback Root Cause, Callback
Corrective Action, Callback Lessons Learned — only meaningful when
Callback Required (Y/N) is Y; distinct
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
QB Invoice Link (legacy — a manually-pasted raw URL, superseded below,
never written to again), QB Invoice ID (the real link — set only via
`lib/qb/recordLinking.ts`'s `confirmQBInvoiceLink()`; once set, the linked
`QBInvoices` row's Status/Total/Balance/Doc Number/Updated At, plus any
matching `QBPayments` row's Payment Date, become the authoritative display
on the Quote detail page's read-only "QuickBooks Invoice" summary card —
see the QuickBooks section below), QB Match Suggestion Dismissed (same
purpose as Quotes' own column, for the Invoice-matching suggestion).

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

## JobItems — REMOVED
This tab was declared in the bootstrap schema but never had a model file, a
reader or a writer; bootstrapping only ever created an empty tab in each new
environment. It was removed from the schema in the simplification pass. If a
`JobItems` tab exists in a live spreadsheet it is inert and can be deleted
by hand. Per-line completed-job detail was never actually captured — Jobs
carries the totals.

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

## PropertyPhotos
Photo ID, Property ID, R2 Key, Original Filename, Content Type, Size
Bytes, Caption, Created At, Updated At, Archived At.

Photo bytes never live in the Sheet (a cell caps around 50k characters,
and base64 would blow through the Sheets API's own per-minute quota) —
they live in a Cloudflare R2 bucket (`PROPERTY_PHOTOS` binding,
`sww-property-photos`), one object per photo at key
`properties/{propertyId}/{photoId}.{ext}`. This tab only ever holds
metadata pointing at that key. See `lib/propertyPhotos.ts` for
upload/list/delete, and `pages/api/property-photos/` for the routes
(upload is multipart `POST /api/property-photos`; bytes are served back
via `GET /api/property-photos/{id}/file`, auth-gated the same as every
other internal route by `src/middleware.ts` — no per-route auth code).
Delete is soft-delete-only (metadata row archived, R2 object left as a
harmless orphan — never hard-deleted, matching this app's convention
everywhere else). Surfaced on Property Detail via the `PropertyPhotos.tsx`
React island (drag-and-drop zone + a plain `accept="image/*"` file input
as the actually-load-bearing path for the app's real mobile-first usage,
since iOS Safari has no true OS drag-and-drop).

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

**Component conditions** (added with the labor model): Interior Glass
Condition, Track Condition, Exterior Glass Condition, Exterior Frame
Condition, Screen Condition. One rating per component on the same
four-level scale, replacing the two broad `Exterior Condition` /
`Interior Condition` fields — those stay declared and are still read as
the fallback for walkthroughs recorded before the split.

Each condition only ever inflates its own labor: moderate frames slow
down frame work, not glass work, and nothing interior ever makes the
exterior cost more. Blank is meaningful and left blank on purpose —
track condition isn't asked when tracks are excluded, screen condition
isn't asked when screens aren't included, and an exterior-only visit
never rates the interior.

**Scope and overrides**: Screens Included (Y/N), Tracks Included (Y/N),
Frames Included (Y/N) say which components this visit covers (the
interior/exterior sides are the existing `Interior Included (Y/N)` /
`Exterior Included (Y/N)`). Manual Screen Total and Manual Track Total
override the totals summed from the window groups — blank means use the
calculated total, and a value here always wins and is labeled as manual
rather than silently merged.

**Labor results**: Productive Labor Minutes, Scheduled Minutes,
Scheduled Minutes Override, Schedule Recommendation, Labor Breakdown
(JSON), Labor Model Version, Labor Config ID, Inventory Model.
Productive labor is the work; scheduled time is the day it occupies —
floor changes, hose repositioning, breaks, drying, contingency — and the
owner can move scheduled time without touching the estimate underneath.
The breakdown is stored as JSON so the review page can still explain a
past estimate after the labor configuration moves on.

`Inventory Model` is `legacy-aggregate` or `grouped-v2`; blank reads as
legacy. A walkthrough recorded before window groups existed keeps its
stored numbers and its original pricing path, and is labeled **"Legacy
aggregate estimate"** rather than back-filled with invented classes,
sizes or component conditions. It can be manually upgraded; nothing
upgrades automatically.

A walkthrough-only visit is a standalone record — it never creates a Job
just to have somewhere to live. The Suggested Low/Target/High Price,
Estimated On-Site Labor Hours, and Pricing Config ID columns are now
populated by the guided mobile walkthrough mode (`/walkthroughs/new`,
`src/components/WalkthroughWizard.tsx`) — computed server-side via the
same shared pricing engine the in-field quoter uses
(`lib/pricing/walkthroughToQuote.ts`), never a second calculation path.
The historical-entry form never creates a Walkthrough at all, so it
never reconstructs a price recommendation after the fact.

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
Interior/Garage/Basement/Other), Window Units, Pane Count, Item Type
(Window/Sliding Door/Skylight), Quantity, Size Class, Production Class,
Story, Interior Access, Exterior Access, Panes Per Unit, Screens Per
Unit, Tracks Per Unit, Specialty Description, Interior Included (Y/N),
Exterior Included (Y/N), Screen Included (Y/N), Track Included (Y/N),
Condition, Access Difficulty, Hard Water (Y/N), Construction Debris
(Y/N), Estimated Labor Minutes, Notes, Sort Order, Created At, Updated
At, Archived At.

**A row here is one of three shapes**, told apart by which columns are
filled — there is no discriminator column, so rows written before each
successive change keep working unchanged:

1. **Area row** — `Window Units`/`Pane Count` set, `Item Type` and
   `Production Class` both blank. The optional per-area breakdown.
2. **Detailed item row** — `Item Type` set. The legacy item-level path.
3. **Window group row** — `Production Class` set. The current model: a
   group of similar windows with a quantity, never one row per physical
   window.

Shapes 1 and 2 are read-only history. Nothing writes them any more, and
a walkthrough built from them stays on its original pricing path.

**Window group rows** carry `Production Class` (Standard Window / Large
Picture Window / Specialty Shape / Sliding Door / French Panes /
Skylight), an optional `Size Class` (Small/Standard/Large/Oversized —
set only when a group is meaningfully off-typical), `Story`, and
independently selected `Interior Access` and `Exterior Access`. Panes,
screens and tracks per unit are optional; blank means "the typical
amount for this class", which the production profile supplies rather
than a fabricated zero. `Specialty Description` is required when the
class is Specialty Shape.

Production class deliberately is **not** architectural window type. A
standard casement and a standard double-hung take about the same time,
so asking which is which would be field busywork that changes no number;
a large picture window, a sliding door and a wall of french panes
genuinely differ, so those get their own classes.

`Size Class` is shared between shapes 2 and 3 with different option sets
(legacy Standard/Oversized/French-Divided-Light vs. the four new sizes).
Unambiguous in practice because `Production Class` already tells the
shapes apart.

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

## Labor model — LaborConfig, WindowProductionProfiles, WalkthroughLaborAdjustments

The labor model answers "how many productive hours is this job?" from
the work actually involved, rather than from a count times a flat
minutes-per-window. Before it existed, every window contributed the same
minutes regardless of class, size, story, access or condition, which is
why detailed properties compressed toward an unrealistically low
estimate.

### LaborConfig
Labor Config ID, Config Name, Version Label, Property Type, Status
(Draft/Active/Superseded/Archived), Effective Date, End Date, six
`Overhead ... Minutes` columns, four `Size Factor ...` columns, six
`Interior Access ... Minutes` columns, seven `Exterior Access ...
Minutes` columns, four `Story Logistics ... Minutes` columns, four
`Condition Factor ...` columns, Scheduled Time Contingency Percent,
Two-Day Threshold Hours, Crew Recommendation Threshold Hours, Notes,
Created At, Updated At, Archived At.

Every labor assumption in the app lives in one versioned row. No
production constant belongs in a component, a controller, or the engine.
Minute columns are per window unit unless the name says otherwise;
factor columns are multipliers where 1 means no change. Rows are
superseded, never edited in place — a walkthrough stores the
`Version Label` it was estimated under, so an old estimate stays
explainable after the numbers move. Seeded row: `Residential v2`.

Access minutes are the mechanism that makes dangerous access cost real
time. The gap between Extended WFP and Difficult Ladder Positioning is
deliberately wide, and story logistics are per *group* and small, since
height is already paid for through access — charging both per unit would
double-count.

### WindowProductionProfiles
Profile ID, Labor Config ID, Production Class, Interior Glass Base
Minutes, Exterior Glass Base Minutes, Screen Handling Base Minutes,
Screen Cleaning Base Minutes, Track Base Minutes, Frame Base Minutes,
Default Pane Factor, Sort Order, Notes, Created At, Updated At,
Archived At.

One row per production class per config version. Base minutes are for a
single unit at standard size, standard access, Maintenance condition;
everything else scales them. `Default Pane Factor` is the typical pane
count for the class — a group that records its own panes-per-unit scales
its glass minutes by the ratio, so a 12-pane french unit costs twice a
6-pane one.

### WalkthroughLaborAdjustments
Adjustment ID, Walkthrough ID, Kind (Restoration/Modifier), Label,
Affected Units, Affected Panes, Additional Minutes, Notes, Sort Order,
Created At, Updated At, Archived At.

One row per selected restoration service or property-level labor
modifier. Rows rather than columns on Walkthrough because restoration
almost never applies to every window: "razor scraping" as a boolean
can't say whether it's four panes on the sunroom or the whole south
elevation, and pricing a checkbox is how a restoration job gets
underquoted. `Additional Minutes` is always the owner's own estimate —
no configuration can know how bad the overspray is until someone looks.

Restoration supplements the component condition ratings rather than
replacing them: a two-year-old house with construction residue is not
Heavy Buildup, it is a light-dirt job that also needs a razor.

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

- **Lead follow-up** (Leads/Clients separation) — active Leads (see the
  Leads section above) with `Next Follow-up Date` on or before today.
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

Dashboard sections: Today (the six reminder buckets above, condensed,
plus "Appointments today" from Google Calendar — see below), This Week
(a 7-day-at-a-glance calendar strip), Pipeline (stage counts +
accepted-jobs-awaiting-scheduling), Recent Performance (a revenue line
chart with Last Week/Month/Quarter/YTD toggle pills, plus completed
jobs/revenue/on-site hours/revenue-per-hour/callbacks for the selected
range), Calibration (last snapshot's confidence/target/observed
average+median/excluded count, linking to `/calibration` for the full
filtered view — never an automatic pricing change), and Data Quality
(jobs missing labor time/direct costs/callback info/final revenue,
properties missing window counts, walkthroughs not converted or closed
— each with direct links to the record).

## Google Calendar integration (`lib/calendar/client.ts`) — Dashboard "Today"/"This Week"

Google Calendar, not this app, is the actual source of truth for
scheduled walkthroughs/appointments — the app has no in-app
walkthrough-scheduling concept of its own (a Walkthrough record only
ever gets created the moment a field visit starts). Rather than build a
second OAuth login flow, the Dashboard reads the business's calendar
**read-only** using the same Google service account already used for
Sheets (`GOOGLE_SERVICE_ACCOUNT_JSON`) — just with the Calendar readonly
scope instead of the Sheets scope (`lib/sheets/googleAuth.ts`'s
`getAccessToken(env, scope)` now caches a token per scope, one call
site per scope in use). One-time setup, no code changes needed to
change which calendar it reads:

1. Enable the Google Calendar API on the same Cloud project as the
   Sheets service account.
2. Share the target calendar with the service account's own email
   (e.g. `ww-app-sheets@sunshine-window-works.iam.gserviceaccount.com`),
   permission "See all event details" (view-only — this app never
   writes to the calendar).
3. Set the `CALENDAR_ID` secret to that calendar's own address (e.g.
   `info@sunshinewindowworks.com`).

The Dashboard computes "today" and the Monday–Sunday week using the
`America/Denver` timezone (the business's own — hardcoded, since this
app has no other timezone concept anywhere), fetches a padded window
via `listEventsInRange()`, then buckets each event into its real
America/Denver calendar date (all-day events use Calendar's own bare
date string directly; timed events convert via `Intl.DateTimeFormat`).
A failure here (API not yet enabled, calendar unshared, transient
error) never breaks the Dashboard — both sections just show a quiet
one-line "Calendar unavailable" note instead of the reminder content.

## Historical-entry form
`/historical-entry` (linked from the Dashboard and each Property detail
page) — a single compact form for backfilling a job that predates this
app. Historical records exist for exactly one reason, supporting pricing
calibration, so the form asks only for what a calibration data point
needs: **service date, final price, actual labor hours and a one-line
scope summary** (required), plus optional client/property (pick an
existing one or type a new name/address), window units, panes, screens,
scope dropdown, stories, notes, and "would you price this differently
today?". It does not ask for a window inventory, walkthrough conditions,
QuickBooks or Pipeline records, or a callback/ratings writeup — the
multi-step wizard that used to collect all of that is gone.

Entered hours are converted to minutes at the write boundary; the
`Setup/Cleaning/Inspection/Pack-up Time` breakdown columns are left
blank, which is what makes the single entered total authoritative for
`Actual Time (hrs)` (see `onSiteMinutes()` in
`lib/pricing/historicalEntry.ts`). Jobs has no dedicated scope column
beyond the free-text `Scope Summary`, so the scope dropdown is stored as
a prefix on that same column (`"Interior & Exterior — 2 stories,
screens"`) and split back out on edit — the option list is closed, so the
round-trip is exact. "Would you price this differently today?" maps onto
the existing Pricing Review pair: Higher/Lower both set `Would Price
Differently Today (Y/N)` to `Y` with the direction kept as `Reason
Pricing Changed`; Same sets `N`; blank leaves the question unanswered.
Every save sets `Record Classification` to `Historical Import`, which is
what makes the record findable (see below). Saving goes through one
`createRelatedRows()` call, so the whole submission is a single
Write-Operation-ID-tagged, idempotent-by-ID unit — safe to retry after a
network error without creating duplicates.

**Historical Records** (`/historical-records`, linked from the Dashboard
and from `/historical-entry`) — lists every Job with a non-blank Record
Classification (a reliable signal since only this form's save/update path
ever writes that column), linking each to `/historical-entry/[jobId]` for
**true edit mode**: the same form component
(`components/HistoricalEntryForm.astro`), pre-loaded from the real
Client/Property/Job rows. `updateHistoricalEntry()`
(`lib/pricing/historicalEntry.ts`) updates each included sub-record in
place via `updateRow()` — deliberately not `createRelatedRows()`, whose
idempotent-by-ID create semantics would silently skip rewriting a row
whose ID already exists. Because both write paths rewrite every column
they map, the edit page reads the existing Client/Property/Job back in
first and layers the form values on top, so saving never blanks a field
the compact form doesn't display. Client and Property are both optional
and skipped when absent — a price/hours/scope data point is still useful
with no idea whose house it was. Every field-mapping literal is shared
between the create and update paths via `buildClientRecord()`/
`buildPropertyRecord()`/etc., so the two write paths can't drift apart.
Walkthrough-only historical entries (no Job ever created) have no
equivalent list/edit support today — they remain viewable only via their
own Walkthrough Detail page.

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

**The connection to this app's own data** happens at two levels:
`Clients.QB Customer ID` — set once a human confirms a match in the
match-review queue (`/qb-match-review`, `lib/qb/matching.ts`), never
auto-linked — and, one level down, `Quotes.QB Estimate ID`/`Jobs.QB
Invoice ID` (`lib/qb/recordLinking.ts`). Once a Client is linked, its
QBEstimates/QBInvoices/QBPayments display together on that Client's
detail page (`suggestQBLinksForClient`); once a Quote/Job is linked, the
specific matched record's financial data displays as a read-only summary
card on the Quote detail page (`/quotes/[id]`) — never a manually-pasted
URL, and never editable in the app. QBO deep-link URLs
(`https://qbo.intuit.com/app/estimate?txnId={id}`) come from
`qboEstimateWebUrl`/`qboInvoiceWebUrl`.

**Quote↔QBEstimate / Job↔QBInvoice linking** (`lib/qb/recordLinking.ts`,
surfaced on `/quotes/[id]`) mirrors `confirmQBLink`'s own re-link-guard
pattern exactly (shared `QBRelinkConfirmationRequiredError` class, generic
across all three link types):
- **Linked** — the Quote/Job's `QB Estimate ID`/`QB Invoice ID` is set and
  the mirror row exists: shows Estimate/Invoice #, Status, Total (Invoice
  also shows Amount Paid/Balance Due/Payment Date, the latter from the
  linked `QBPayments` row via `findPaymentsForInvoice`), Last Synced (the
  row's own `Updated At`), and "View Estimate/Invoice in QuickBooks ↗". A
  **mismatch warning** ("Historical amount: $X · QuickBooks estimate: $Y")
  appears when the Quote's own `Final Quoted Price` (or Job's `Final Price
  ($)`) differs from the linked record's Total — both values are kept,
  never auto-overwritten; QuickBooks is just displayed as authoritative. A
  "Refresh QuickBooks Data" button re-runs `syncSingleEntity` for that one
  record — a plain form POST/redirect/reload, no live spinner; a failed
  refresh leaves the last successfully synced data in place, since
  `syncSingleEntity` only overwrites the mirror row on a successful QBO
  fetch.
- **Not linked, no suggestion** — "No QuickBooks Estimate/Invoice Linked"
  plus a `<details>` "Link Existing Estimate/Invoice" search: defaults to
  the Quote's own Client's QB Customer ID when that link exists (a
  "Search All QuickBooks Records" checkbox widens it), searches the whole
  mirror by customer/number/date/total when the Client isn't linked yet.
- **Not linked, one strong suggestion** — `findStrongQuoteMatchSuggestion`/
  `findStrongJobMatchSuggestion` surface a "Potential QuickBooks Match
  Found" banner (Link/Dismiss) only when the Client is already QB-linked
  and exactly one of its unlinked Estimates/Invoices falls within total
  tolerance (larger of $5 or 2%) and ~45 days of the Quote's/Job's own
  amount and date. Zero or multiple candidates never suggest — ambiguity
  always falls back to manual search, never a guess. Dismissing a
  suggestion stores its ID in `QB Match Suggestion Dismissed` so it
  doesn't reappear. Computed lazily at page-render time (this app has no
  push/notification system).
- **Object missing** — the ID is set but the mirror row is gone (deleted/
  merged in QuickBooks): shows a "could not be found" message plus the
  same search UI to re-link.

`Jobs['Payment Status']` (the existing Job-Day-mode field driving
`completeJobDay()`'s completion transitions) is a separate, unchanged
concept from the Invoice card's own derived Paid/Partial/Open display —
neither overwrites the other.

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
