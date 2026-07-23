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
		'Supplies Cost': blank(),
		Gas: blank(),
		'Other Expenses': blank(),
		'Total Job Cost': blank(),
		'Net Profit': blank(),
		'Customer Rating': blank(),
		'Callback Required (Y/N)': blank(),
		Photos: blank(),
		Version: blank(),
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
