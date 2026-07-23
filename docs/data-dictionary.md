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
applies and is a calibration segmentation dimension), Street Address, City, State, Zip, Year Built,
Square Footage, Stories, Roof Access Difficulty, Overall Access Difficulty,
Water Access, Equipment Suitability, Hard Water History (Y/N) (background
flag — is this property in a hard-water area — distinct from a given
visit's observed severity, which is job-specific), Construction Debris
(Y/N), Window Condition, Total Window Units, Total Glass Panes,
Count — Double Hung, Count — Casement, Count — Picture, Count — Sliding
(sliding *windows* — a window type, like Double Hung/Casement), Count —
French (divided-light/grid-pane windows — same concept the quoter calls
"French/grid pane"), Count — Awning, Count — Skylights,
Count — Solar Panels, Screen Count, Track Count,
Desired Maintenance Frequency, Next Scheduled Visit,
Last Review Requested Date, Last Review Received Date,
Sliding Glass Door Pane Count (sliding *doors* — a distinct pricing-catalog
service from sliding windows, so tracked separately from Count — Sliding),
Water-Fed Pole Suitable (Y/N), Ladder Requirement, Access Notes (exterior/
interior/parking/gate/water-source access, consolidated into one field),
Pet Notes, General Notes, Building/Complex Name (optional — display/
logistics grouping only, e.g. "all units in this condo building"; not a
data relationship the app enforces), Unit Identifier (optional — unit
number/letter within that building), Created At, Updated At, Archived At.

The Property is the operational center for a physical location's service
history — Client, Pipeline, Quotes, and Jobs all reference it by Property
ID rather than duplicating address/characteristic data.

A multi-unit building (e.g. a 4-unit condo building) is still one full
Property record per unit, each with its own Client — the "a Client always
lives at one Property" rule is unchanged. Building/Complex Name just lets
units in the same building be found/filtered together.

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
stores the link, never talks to the QuickBooks API).

The saved Quote + QuoteItems rows are always the authoritative record of
what was charged. Reproducibility means the stored snapshots + config
reference let anyone audit how the price was reached later — not that the
app recomputes a past quote from current logic and treats that as truth.

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
just to have somewhere to live. The Suggested Low/Target/High Price and
Pricing Config ID columns exist now but are only populated once the
guided mobile walkthrough mode computes live pricing suggestions; the
historical-entry wizard leaves them blank for past walkthroughs rather
than reconstructing a price recommendation after the fact.

Condition values: Maintenance, Moderate Buildup, Heavy Buildup,
Restoration Required, Unknown. Access values: Easy, Standard, Difficult,
Specialty Access, Unknown.

## ActivityLog
Activity ID, Entity Type, Entity ID, Action, Previous Value, New Value,
User, Timestamp, Request ID, Notes.

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
