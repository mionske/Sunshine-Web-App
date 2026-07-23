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
		'Job Status': z.enum(JOB_STATUSES).default('Unscheduled'),
		'Arrival Timestamp': blank(),
		'Start Timestamp': blank(),
		'Finish Timestamp': blank(),
		'Departure Timestamp': blank(),
		'Travel Time': blank(),
		'Setup Time': blank(),
		'Cleaning Time': blank(),
		'Pack-up Time': blank(),
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
