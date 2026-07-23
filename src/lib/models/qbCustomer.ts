import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// A parallel read-only mirror of QB's Customer entity — never merged into
// Clients. The only connection between the two is Clients' own
// 'QB Customer ID' field, set once a human confirms a match (see
// lib/qb/matching.ts). This app never writes back to QuickBooks.
export const qbCustomerSchema = z.object({
	'QB Customer ID': z.string().min(1),
	'Display Name': blank(),
	Email: blank(),
	Phone: blank(),
	Address: blank(),
	'QB Last Updated': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type QBCustomer = z.infer<typeof qbCustomerSchema>;

export const qbCustomerConfig: TabConfig<QBCustomer> = {
	tab: 'QBCustomers',
	idColumn: 'QB Customer ID',
	requiredColumns: Object.keys(qbCustomerSchema.shape),
	schema: qbCustomerSchema,
	entityType: 'QBCustomer',
};
