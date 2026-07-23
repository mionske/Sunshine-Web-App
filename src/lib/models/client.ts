import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const clientSchema = z.object({
	'Client ID': z.string().min(1),
	'First Name': blank(),
	'Last Name': blank(),
	Phone: blank(),
	Email: blank(),
	// Deprecated: clients don't carry their own address — every client
	// always lives at the property being serviced, so the address lives
	// once on Properties instead of being duplicated here. Kept declared
	// (not deleted) purely so any pre-existing value round-trips safely on
	// read/update instead of silently being dropped; forms never write to
	// it or ask for it.
	Address: blank(),
	'Referral Source': blank(),
	'First Contact Date': blank(),
	'Customer Since': blank(),
	'Preferred Contact Method': blank(),
	Notes: blank(),
	// Phase 14 (QuickBooks one-way sync): set only once a human confirms a
	// match in the QB match-review queue — never auto-linked. This is the
	// only field connecting this app's data to QB's; QBCustomers/
	// QBEstimates/QBInvoices/QBPayments stay parallel mirror tabs, never
	// merged into Clients/Quotes/Jobs.
	'QB Customer ID': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type Client = z.infer<typeof clientSchema>;

export const clientConfig: TabConfig<Client> = {
	tab: 'Clients',
	idColumn: 'Client ID',
	requiredColumns: Object.keys(clientSchema.shape),
	schema: clientSchema,
	entityType: 'Client',
};
