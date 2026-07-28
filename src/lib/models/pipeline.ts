import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Six working stages plus Lost. The board shows the six by default; Lost is
// reachable through the outcome filter, so losing an opportunity is still a
// real, reportable outcome rather than a badge or a silent archive.
//
// Secondary states — walkthrough scheduled, quote accepted or declined,
// invoice sent, paid, review requested — are badges on the card, not columns.
// They are facts about a job or a quote, and giving each one a column made
// the board wide without making it more informative.
export const PIPELINE_STAGES = [
	'New Lead',
	'Walkthrough or Quote Needed',
	'Quote Sent',
	'Approved or Scheduling',
	'Scheduled',
	'Completed or Follow-Up',
	'Lost',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Shown as board columns by default. */
export const DEFAULT_VISIBLE_STAGES = PIPELINE_STAGES.filter((s) => s !== 'Lost');

/** Still being sold — the opportunity is live and needs attention. */
export const OPEN_PIPELINE_STAGES: readonly PipelineStage[] = ['New Lead', 'Walkthrough or Quote Needed', 'Quote Sent'];

/** Won: the sale is made and the work has handed off to the job workflow. */
export const WON_PIPELINE_STAGES: readonly PipelineStage[] = ['Approved or Scheduling', 'Scheduled', 'Completed or Follow-Up'];

/** No longer an open sales opportunity, won or lost. */
export const CLOSED_PIPELINE_STAGES: readonly PipelineStage[] = [...WON_PIPELINE_STAGES, 'Lost'];

/** The stage an opportunity moves to when its quote is accepted. */
export const STAGE_ON_QUOTE_ACCEPTED: PipelineStage = 'Approved or Scheduling';

/** Stage values written before the board was reduced to six columns. Used by
 * the one-time migration and to read any row that predates it. */
export const LEGACY_STAGE_MAP: Record<string, PipelineStage> = {
	Contacted: 'Walkthrough or Quote Needed',
	'Walkthrough Scheduled': 'Walkthrough or Quote Needed',
	'Quote Draft': 'Walkthrough or Quote Needed',
	'Follow-up': 'Completed or Follow-Up',
	Accepted: 'Approved or Scheduling',
};

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
