import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const JOB_STATUSES = [
	'Unscheduled',
	'Scheduled',
	'In Progress',
	'Completed',
	'Invoiced',
	'Paid',
	'Cancelled',
] as const;

// Walkthrough-only visits never create a Job at all (see the Walkthroughs
// tab) — a Job row always means work was, or will be, actually performed.
export const RECORD_CLASSIFICATIONS = [
	'Customer Job',
	'Discounted Customer Job',
	'Test Job',
	'Practice Job',
	'Owner Property',
	'Historical Import',
] as const;

export const REVENUE_TREATMENTS = ['Full Price', 'Discounted', 'No Charge', 'Test Price', 'Unknown'] as const;

export const DATA_QUALITY_LEVELS = ['Complete', 'Mostly Complete', 'Partial', 'Estimate Only'] as const;

export const REVIEW_LEFT_VALUES = ['Yes', 'No', 'Unknown'] as const;

// Historical Entry Wizard: Callback & Quality detail (only meaningful when
// 'Callback Required (Y/N)' is 'Y') and Pricing Review. Free strings, not
// enums on the schema itself — same "never fabricate legacy completeness"
// reasoning as Record Classification etc. below; these constants only
// constrain the <select> options offered in the wizard.
// Two-tier so the wizard only ever shows relevant specific reasons for the
// chosen category, instead of one long flat list. 'Operator Error' lives
// under Quality (a human-error quality issue, not its own category).
export const CALLBACK_PRIMARY_CATEGORIES = ['Quality', 'Customer', 'Weather', 'Equipment', 'Scheduling', 'Other'] as const;

export const CALLBACK_SPECIFIC_REASONS: Record<(typeof CALLBACK_PRIMARY_CATEGORIES)[number], readonly string[]> = {
	Quality: ['Quality Issue', 'Operator Error', 'Streaking', 'Hard Water Rework', 'Missed Windows'],
	Customer: ['Customer Request'],
	Weather: ['Weather'],
	Equipment: ['Equipment Failure'],
	Scheduling: ['Scheduling Error'],
	Other: ['Other'],
};

export const PRICING_CONFIDENCE_LEVELS = ['Very Low', 'Low', 'Medium', 'High', 'Very High'] as const;

export const MAINTENANCE_FOLLOW_UP_STATUSES = ['Not yet due', 'Due', 'Contacted', 'Scheduled', 'Declined'] as const;

// Job Day state machine (Phase 6) — distinct from Job Status above: this
// tracks where a single day's on-site visit is right now, not the job's
// overall lifecycle stage.
export const JOB_DAY_STATES = [
	'Not Started',
	'Setup',
	'Cleaning',
	'Inspection',
	'Pack-up',
	'Paused',
	'Completed',
] as const;

export const PAYMENT_STATUSES = ['Not Paid', 'Partially Paid', 'Paid in Full', 'Unknown'] as const;

// Only these values have a defined interval (see
// jobLifecycle.ts's computeNextMaintenanceFollowUpDate) — matches
// Properties' "Desired Maintenance Frequency" options. Anything else
// (One Time/Custom/Unknown/blank) never auto-computes a follow-up date;
// there is no global default cadence.
export const MAINTENANCE_FREQUENCY_INTERVAL_MONTHS: Record<string, number> = {
	Quarterly: 3,
	'Twice Yearly': 6,
	Yearly: 12,
};

// The Jobs tab is the pre-existing, hand-edited legacy sheet (see the Jobs-
// preservation protocol) — it has many columns this app never touches
// (Windows - Small/Medium/..., Total Panes, the calibration block, etc.).
// `.passthrough()` keeps those verbatim on every read/update round-trip
// instead of the normal strict-schema behavior of stripping unknown keys,
// which would otherwise silently blank out real data on any row this app
// updates. Only the columns actually used by app logic — Job ID plus the
// 22 columns appended in Phase 8 and a few pre-existing ones read for
// display — are declared here.
export const jobSchema = z
	.object({
		'Job ID': z.string().min(1),
		'Date Completed': blank(),
		'Property Address': blank(),
		'Job Type': blank(),
		'Quoted Price ($)': blank(),
		'Final Price ($)': blank(),
		'Estimated Time (hrs)': blank(),
		'Actual Time (hrs)': blank(),
		'Window Count': blank(),
		'Quote ID': blank(),
		'Opportunity ID': blank(),
		'Property ID': blank(),
		'Scheduled Date': blank(),
		'Job Status': z.enum(JOB_STATUSES).default('Unscheduled'),
		// Free strings rather than a strict z.enum (unlike Job Status): these
		// are informational classification fields most existing rows will
		// simply lack, and defaulting them to a specific enum value would
		// silently mislabel every un-set legacy/historical row as e.g.
		// "Customer Job"/"Full Price"/"Complete" — exactly the fabricated-
		// completeness the historical-entry workflow is designed to avoid.
		// The RECORD_CLASSIFICATIONS/REVENUE_TREATMENTS/DATA_QUALITY_LEVELS
		// constants still constrain the <select> options offered in forms.
		'Record Classification': blank(),
		'Revenue Treatment': blank(),
		'Standard Price Equivalent': blank(),
		'Data Quality': blank(),
		'Data Quality Notes': blank(),
		// Pricing Review (Historical Entry Wizard) — pricing hindsight only;
		// never fed back into calculateQuote/walkthroughToQuote.ts
		// automatically (see calibrationExclusionReasons in calibration.ts,
		// which never reads these).
		'Pricing Confidence': blank(),
		'Would Price Differently Today (Y/N)': blank(),
		'Current Retail Price Estimate ($)': blank(),
		'Reason Pricing Changed': blank(),
		// Job Performance Review (Historical Entry Wizard). 'Customer
		// Satisfaction Rating' is deliberately distinct from 'Customer
		// Rating' below: 'Customer Rating' sits alongside 'Review Requested
		// At'/'Review Left' and is reserved for an actual score from a real
		// customer-left review; this field is the owner's own retrospective
		// judgment entered during historical data entry.
		'Overall Job Rating': blank(),
		'Customer Satisfaction Rating': blank(),
		'Would Accept Job Again (Y/N)': blank(),
		'Would Change Process (Y/N)': blank(),
		'Process Improvements': blank(),
		'Arrival Timestamp': blank(),
		'Start Timestamp': blank(),
		'Finish Timestamp': blank(),
		'Departure Timestamp': blank(),
		'Travel Time': blank(),
		'Setup Time': blank(),
		'Cleaning Time': blank(),
		'Inspection Time': blank(),
		'Pack-up Time': blank(),
		'Off-Site Admin Time': blank(),
		'Callback Labor Minutes': blank(),
		// Was already read by calibration.ts's computeJobPerformance() but
		// never actually declared here or added to the live sheet — this
		// closes that gap rather than introducing a new one.
		'Callback Cost': blank(),
		// Callback & Quality detail (Historical Entry Wizard) — captures why
		// a callback happened and what was learned, distinct from the
		// minutes/cost columns above which only capture the time/money
		// impact. Never folded into 'Actual Time (hrs)' — see
		// historicalEntry.ts's onSiteMinutes(), which already excludes
		// Callback Labor Minutes from that total.
		// 'Callback Category' is the primary category (Quality/Customer/
		// Weather/Equipment/Scheduling/Other); 'Callback Reason' holds the
		// more granular specific reason within that category (see
		// CALLBACK_SPECIFIC_REASONS above).
		'Callback Category': blank(),
		'Callback Reason': blank(),
		'Callback Root Cause': blank(),
		'Callback Corrective Action': blank(),
		'Callback Lessons Learned': blank(),
		'Supplies Cost': blank(),
		Gas: blank(),
		'Other Expenses': blank(),
		'Total Job Cost': blank(),
		'Net Profit': blank(),
		'Customer Rating': blank(),
		'Callback Required (Y/N)': blank(),
		Photos: blank(),
		Version: blank(),
		'Review Requested At': blank(),
		'Review Left': blank(),
		// Pre-filled by jobLifecycle.ts's updateJobStatus() when the job is
		// marked Completed/Invoiced/Paid, from the property's maintenance
		// frequency — but always a plain editable field, never re-computed
		// or locked afterward (varies per client/property/job).
		'Next Maintenance Follow-up Date': blank(),
		'Maintenance Follow-up Status': blank(),
		// Legacy — superseded by 'QB Invoice ID' below. Was a manually-pasted
		// raw QuickBooks URL; never written to again by the new QuickBooks
		// linking UI (see lib/qb/recordLinking.ts). Kept declared so old rows
		// still round-trip.
		'QB Invoice Link': blank(),
		// The real link to a synced QBInvoices row (see
		// lib/models/qbInvoice.ts) — set only via lib/qb/recordLinking.ts's
		// confirmQBInvoiceLink(), never hand-typed. This app never writes
		// back to QuickBooks.
		'QB Invoice ID': blank(),
		// A QB Invoice ID the owner explicitly dismissed from the "Potential
		// QuickBooks Match Found" suggestion (see findStrongJobMatchSuggestion
		// in lib/qb/recordLinking.ts).
		'QB Match Suggestion Dismissed': blank(),
		// Phase 6 (Job-Day Mode) additions. Job Day State is always a plain
		// blank()/free string here (not a strict enum) for the same reason as
		// Record Classification etc. above: every pre-existing row lacks it,
		// and a strict enum would force a default value onto rows this app
		// never actually walked through Job Day mode for.
		'Job Day State': blank(),
		'Job Checklist (JSON)': blank(),
		'Job Notes': blank(),
		'Scope Changes': blank(),
		'Payment Status': blank(),
		'Archived At': blank(),
	})
	.catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));

export type Job = z.infer<typeof jobSchema>;

export const jobConfig: TabConfig<Job> = {
	tab: 'Jobs',
	idColumn: 'Job ID',
	requiredColumns: Object.keys(jobSchema.shape),
	schema: jobSchema,
	entityType: 'Job',
};
