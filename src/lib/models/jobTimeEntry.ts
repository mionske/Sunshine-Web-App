import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Only Setup/Cleaning/Inspection/Pack-up are on-site labor (the $150/hour
// target rate's denominator) — Travel/Off-Site Admin/Callback are tracked
// for cost/performance visibility but never count toward that rate.
export const ON_SITE_TIME_CATEGORIES = ['Setup', 'Cleaning', 'Inspection', 'Pack-up'] as const;
export const TIME_CATEGORIES = [...ON_SITE_TIME_CATEGORIES, 'Travel', 'Off-Site Admin', 'Callback'] as const;

export const jobTimeEntrySchema = z.object({
	'Job Time Entry ID': z.string().min(1),
	'Job ID': blank(),
	'Time Category': z.enum(TIME_CATEGORIES),
	'Started At': blank(),
	'Ended At': blank(),
	'Duration Minutes': blank(),
	Notes: blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type JobTimeEntry = z.infer<typeof jobTimeEntrySchema>;

export const jobTimeEntryConfig: TabConfig<JobTimeEntry> = {
	tab: 'JobTimeEntries',
	idColumn: 'Job Time Entry ID',
	requiredColumns: Object.keys(jobTimeEntrySchema.shape),
	schema: jobTimeEntrySchema,
	entityType: 'JobTimeEntry',
};
