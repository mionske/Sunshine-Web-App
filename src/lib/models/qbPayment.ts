import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Read-only mirror of QB's Payment entity. 'Linked Invoice IDs' is a
// comma-joined list of QB Invoice IDs this payment applied to (from the
// Payment's Line[].LinkedTxn) — plain string, same convention as every
// other comma-joined multi-value cell in this app (see property.ts).
export const qbPaymentSchema = z.object({
	'QB Payment ID': z.string().min(1),
	'QB Customer ID': blank(),
	Total: blank(),
	'Payment Date': blank(),
	Method: blank(),
	'Linked Invoice IDs': blank(),
	'QB Last Updated': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type QBPayment = z.infer<typeof qbPaymentSchema>;

export const qbPaymentConfig: TabConfig<QBPayment> = {
	tab: 'QBPayments',
	idColumn: 'QB Payment ID',
	requiredColumns: Object.keys(qbPaymentSchema.shape),
	schema: qbPaymentSchema,
	entityType: 'QBPayment',
};
