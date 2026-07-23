# Spreadsheet data dictionary

Single Google Sheet (the existing Jobs spreadsheet), multiple tabs. Every tab
has `Created At`, `Updated At`, `Archived At` (soft delete only — never hard
delete a business record). All primary IDs are UUIDs, never row numbers.
Full rationale for each decision lives in the plan this was generated from;
this file is the quick column reference kept in sync with the live sheet.

## Clients
Client ID, First Name, Last Name, Phone, Email, Address, Referral Source,
First Contact Date, Customer Since, Preferred Contact Method, Notes,
Created At, Updated At, Archived At.

## Properties
Property ID, Client ID, Street Address, City, Zip, Year Built,
Square Footage, Stories, Roof Access Difficulty, Overall Access Difficulty,
Water Access, Equipment Suitability, Hard Water History (Y/N),
Construction Debris (Y/N), Window Condition, Total Window Units,
Total Glass Panes, Count — Double Hung, Count — Casement, Count — Picture,
Count — Sliding, Count — French, Count — Awning, Count — Skylights,
Count — Solar Panels, Screen Count, Track Count,
Desired Maintenance Frequency, Next Scheduled Visit,
Last Review Requested Date, Last Review Received Date, Created At,
Updated At, Archived At.

## Pipeline (sales opportunities only — not job operations)
Opportunity ID, Client ID, Property ID, Primary Quote ID, Stage, Status,
Estimated Value, Referral Source, Next Follow-up Date, Last Contact Date,
Created At, Updated At, Closed At, Archived At, Lost Reason, Notes.

Stages: New Lead → Contacted → Walkthrough Scheduled → Quote Draft →
Quote Sent → Follow-up → Accepted → Lost. Paid is never a pipeline stage —
Accepted closes the opportunity and starts the Job workflow.

## Quotes
Quote ID, Client ID, Property ID, Opportunity ID, Pricing Config ID,
Calculator Version, Input Snapshot (JSON), Calculation Result Snapshot
(JSON), Rounding Policy, Currency, Calculated Base Amount,
Calculated Add-ons, Calculated Surcharges, Estimated Labor Hours,
Target Hourly Rate, Target Price Before Adjustments, Manual Adjustment,
Discount, Final Quoted Price, Expected Revenue Per Labor Hour,
Override Reason, Quote Status, Created At, Updated At, Sent At,
Accepted At, Declined At, Expired At, Archived At, Created By, Notes.

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

## PricingConfig (versioned, exactly one Active row at a time)
Pricing Config ID, Config Name, Effective Date, End Date, Status,
Calculator Version, Target Hourly Rate, Minimum Job Price,
Exterior Labor Weight, Interior Labor Weight, Screen Unit Price,
Track Unit Price, Deep Track Unit Price, Skylight Unit Price,
Sliding Door Unit Price, French Pane Unit Price, Oversized Glass Unit Price,
Second Story Factor, Third Story Factor, Moderate Condition Factor,
Heavy Condition Factor, First-Time Cleaning Factor, Hard Water Minimum,
Construction Debris Minimum, Access Surcharge Minimum,
Estimate Low Variance, Estimate High Variance, Created At, Updated At,
Archived At, Notes.

Initial row: Target Hourly Rate = 150 (per estimated **on-site** labor
hour — setup, active cleaning, inspection, pack-up; travel and off-site
admin are tracked separately), Status = Active.

## Jobs (existing tab, extended in place — see preservation protocol)
Existing columns untouched: Job ID, date, property, job type, lead source,
window counts, total panes, screens, hard water treatment,
quoted/final/add-on/total revenue, estimated/actual/WFP time,
time accuracy, effective $/hr, notes, calibration summary block
(columns X–Y).

Appended columns: Window Count, Quote ID (link), Opportunity ID (link),
Job Status (Unscheduled/Scheduled/In Progress/Completed/Invoiced/Paid/
Cancelled), Arrival/Start/Finish/Departure Timestamps,
Travel/Setup/Cleaning/Pack-up Time, Supplies Cost, Gas, Other Expenses,
Total Job Cost, Net Profit, Customer Rating, Callback Required (Y/N),
Photos (link), Version, Archived At.

A Job counts toward calibration only once Status is Completed/Invoiced/Paid
AND actual labor time, final revenue, direct costs (where applicable), and
callback info are all entered.

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

## ActivityLog
Activity ID, Entity Type, Entity ID, Action, Previous Value, New Value,
User, Timestamp, Request ID, Notes.

## SystemTest
Dedicated scratch tab for live Sheets round-trip verification. Never used
for production business data — no writing to/deleting from Jobs, Clients,
etc. just to prove connectivity.
