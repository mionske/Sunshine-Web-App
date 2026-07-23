import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const clientSchema = z.object({
	'Client ID': z.string().min(1),
	'First Name': blank(),
	'Last Name': blank(),
	Phone: blank(),
	Email: blank(),
	Address: blank(),
	'Referral Source': blank(),
	'First Contact Date': blank(),
	'Customer Since': blank(),
	'Preferred Contact Method': blank(),
	Notes: blank(),
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
