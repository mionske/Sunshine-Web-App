import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Data-ownership separation: MAINTENANCE_FREQUENCY_OPTIONS /
// PREFERRED_SERVICE_SEASON_OPTIONS for the two fields below are defined
// once on lib/models/property.ts (Phase 9) and imported from there by the
// Client Detail page's form — not re-declared here, same as Property's own
// schema keeps these fields as plain strings and leaves the option set to
// the form layer.

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
	// Data-ownership separation: moved from Property ('Desired Maintenance
	// Frequency' / 'Preferred Service Season' there, now deprecated) —
	// these are customer preferences, not physical property facts, so they
	// survive a client moving, selling, or owning multiple properties.
	// Copy-on-read migration: the first time a linked Property page loads
	// after this shipped, if this field is blank here, the legacy Property
	// value is copied over (never overwriting an existing Client value).
	'Desired Maintenance Frequency': blank(),
	'Preferred Service Season': blank(),
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
