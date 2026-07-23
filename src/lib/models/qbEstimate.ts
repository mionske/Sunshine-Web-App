import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Read-only mirror of QB's Estimate entity. 'QB Customer ID' is a plain
// reference to QBCustomers, not a Clients join — the Clients<->QB link
// only ever happens through Clients.QB Customer ID.
export const qbEstimateSchema = z.object({
	'QB Estimate ID': z.string().min(1),
	'QB Customer ID': blank(),
	Status: blank(),
	Total: blank(),
	'Doc Number': blank(),
	'Txn Date': blank(),
	'QB Last Updated': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type QBEstimate = z.infer<typeof qbEstimateSchema>;

export const qbEstimateConfig: TabConfig<QBEstimate> = {
	tab: 'QBEstimates',
	idColumn: 'QB Estimate ID',
	requiredColumns: Object.keys(qbEstimateSchema.shape),
	schema: qbEstimateSchema,
	entityType: 'QBEstimate',
};
