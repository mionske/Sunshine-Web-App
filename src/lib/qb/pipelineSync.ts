// Keeps Pipeline opportunities in sync with QuickBooks Estimates for
// already-linked Clients — one-way (QB -> Pipeline), same as the rest of
// the QB mirror. Never touches an opportunity the owner created by hand;
// only ever manages opportunities it created itself, tracked by the
// 'QB Estimate ID' column (see models/pipeline.ts).
import { createRow, listActiveRows, logActivity, updateRow, type SheetsEnv } from '../sheets';
import { clientConfig } from '../models/client';
import { pipelineConfig, type Opportunity } from '../models/pipeline';
import { qbEstimateConfig, type QBEstimate } from '../models/qbEstimate';

interface StageMapping {
	stage: Opportunity['Stage'];
	lostReason?: string;
}

// QBO's Estimate TxnStatus is one of Pending/Accepted/Closed/Rejected.
// Pending -> 'Quote Sent': an Estimate existing in QB is the strongest
// signal this app can read automatically that a quote has gone out to the
// customer (QB doesn't separately expose "drafted but not sent"). Closed
// is treated the same as Accepted — in QBO's model it most commonly means
// the estimate was completed/converted rather than abandoned; genuinely
// lost opportunities show up as Rejected instead. Any other/blank status
// falls back to 'Quote Sent' rather than leaving it unmapped, since an
// Estimate existing at all already means at least that much progress.
const ESTIMATE_STATUS_TO_STAGE: Record<string, StageMapping> = {
	Pending: { stage: 'Quote Sent' },
	Accepted: { stage: 'Accepted' },
	Closed: { stage: 'Accepted' },
	Rejected: { stage: 'Lost', lostReason: 'QuickBooks Estimate rejected' },
};

export function estimateStageMapping(status: string): StageMapping {
	return ESTIMATE_STATUS_TO_STAGE[status] ?? { stage: 'Quote Sent' };
}

export interface PipelineSyncResult {
	created: number;
	updated: number;
	skippedUnlinked: number;
}

/**
 * For every active QBEstimate belonging to an already-linked Client
 * (Clients.QB Customer ID), creates or updates the one Pipeline
 * opportunity this sync owns for that Estimate (matched by
 * 'QB Estimate ID'), setting Stage from the Estimate's QB status. Skips
 * Estimates for QB Customers with no linked Client — the owner links via
 * /qb-match-review or "Create Client from this QB Customer" first, and the
 * next sync picks it up automatically once linked. Never creates a second
 * opportunity for the same Estimate, and never touches an opportunity that
 * doesn't carry this Estimate's own ID (i.e. one the owner created by
 * hand).
 */
export async function syncPipelineFromEstimates(env: SheetsEnv, meta: { user?: string; requestId?: string } = {}): Promise<PipelineSyncResult> {
	const [estimates, clients, opportunities] = await Promise.all([
		listActiveRows(env, qbEstimateConfig),
		listActiveRows(env, clientConfig),
		listActiveRows(env, pipelineConfig),
	]);

	const clientIdByQBCustomerId = new Map(clients.filter((c) => c['QB Customer ID']).map((c) => [c['QB Customer ID'], c['Client ID']]));
	const opportunityByEstimateId = new Map(opportunities.filter((o) => o['QB Estimate ID']).map((o) => [o['QB Estimate ID'], o]));

	let created = 0;
	let updated = 0;
	let skippedUnlinked = 0;

	for (const estimate of estimates as QBEstimate[]) {
		const clientId = clientIdByQBCustomerId.get(estimate['QB Customer ID']);
		if (!clientId) {
			skippedUnlinked++;
			continue;
		}

		const { stage, lostReason } = estimateStageMapping(estimate.Status);
		const existing = opportunityByEstimateId.get(estimate['QB Estimate ID']);

		if (!existing) {
			await createRow(env, pipelineConfig, {
				'Client ID': clientId,
				Stage: stage,
				'Estimated Value': estimate.Total,
				'Lost Reason': lostReason ?? '',
				Notes: `Created from QuickBooks Estimate ${estimate['Doc Number'] || estimate['QB Estimate ID']}.`,
				'QB Estimate ID': estimate['QB Estimate ID'],
			});
			created++;
			await logActivity(env, {
				entityType: 'Opportunity',
				entityId: estimate['QB Estimate ID'],
				action: 'Pipeline opportunity created from QuickBooks Estimate',
				newValue: stage,
				user: meta.user,
				requestId: meta.requestId,
			});
		} else if (existing.Stage !== stage) {
			await updateRow(
				env,
				pipelineConfig,
				existing['Opportunity ID'],
				{ Stage: stage, 'Lost Reason': lostReason ?? existing['Lost Reason'] },
				{ action: 'Pipeline stage synced from QuickBooks Estimate', user: meta.user, requestId: meta.requestId }
			);
			updated++;
			await logActivity(env, {
				entityType: 'Opportunity',
				entityId: existing['Opportunity ID'],
				action: 'Pipeline stage synced from QuickBooks Estimate',
				previousValue: existing.Stage,
				newValue: stage,
				user: meta.user,
				requestId: meta.requestId,
			});
		}
	}

	return { created, updated, skippedUnlinked };
}
