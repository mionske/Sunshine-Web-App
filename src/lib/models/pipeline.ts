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
});

export type Opportunity = z.infer<typeof pipelineSchema>;

export const pipelineConfig: TabConfig<Opportunity> = {
	tab: 'Pipeline',
	idColumn: 'Opportunity ID',
	requiredColumns: Object.keys(pipelineSchema.shape),
	schema: pipelineSchema,
	entityType: 'Opportunity',
};
