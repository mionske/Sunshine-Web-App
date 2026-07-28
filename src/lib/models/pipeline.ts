import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const PIPELINE_STAGES = [
	'New Lead',
	'Contacted',
	'Walkthrough Scheduled',
	'Quote Draft',
	'Quote Sent',
	'Follow-up',
	'Accepted',
	'Lost',
] as const;

export const pipelineSchema = z.object({
	'Opportunity ID': z.string().min(1),
	'Client ID': blank(),
	'Property ID': blank(),
	'Primary Quote ID': blank(),
	Stage: z.enum(PIPELINE_STAGES).default('New Lead'),
	Status: blank(),
	'Estimated Value': blank(),
	'Referral Source': blank(),
	'Next Follow-up Date': blank(),
	'Last Contact Date': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Closed At': blank(),
	'Archived At': blank(),
	'Lost Reason': blank(),
	Notes: blank(),
	// NOTE: a 'QB Estimate ID' column used to live here, written only by an
	// automatic QuickBooks→Pipeline sync that created and moved cards on its
	// own. That sync was removed (all QuickBooks activity is manual now, and
	// the board is entirely owner-driven), which left the column with no
	// writer and no reader, so it was dropped. The Quote↔QuickBooks link is
	// a different column on a different tab — see Quotes' own
	// 'QB Estimate ID' in models/quote.ts, which is very much still in use.
});

export type Opportunity = z.infer<typeof pipelineSchema>;

export const pipelineConfig: TabConfig<Opportunity> = {
	tab: 'Pipeline',
	idColumn: 'Opportunity ID',
	requiredColumns: Object.keys(pipelineSchema.shape),
	schema: pipelineSchema,
	entityType: 'Opportunity',
};
