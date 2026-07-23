import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Read-only mirror of QB's Invoice entity. Status is derived at sync time
// from Balance/DueDate (Paid/Open/Overdue) — QB's own API doesn't return a
// single status field for Invoice the way it does for Estimate.
export const qbInvoiceSchema = z.object({
	'QB Invoice ID': z.string().min(1),
	'QB Customer ID': blank(),
	Status: blank(),
	Total: blank(),
	Balance: blank(),
	'Due Date': blank(),
	'Doc Number': blank(),
	'Txn Date': blank(),
	'QB Last Updated': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type QBInvoice = z.infer<typeof qbInvoiceSchema>;

export const qbInvoiceConfig: TabConfig<QBInvoice> = {
	tab: 'QBInvoices',
	idColumn: 'QB Invoice ID',
	requiredColumns: Object.keys(qbInvoiceSchema.shape),
	schema: qbInvoiceSchema,
	entityType: 'QBInvoice',
};
