import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'] as const;
export const QUOTE_TYPES = ['ballpark', 'in-field'] as const;

export const quoteSchema = z.object({
	'Quote ID': z.string().min(1),
	'Quote Type': z.enum(QUOTE_TYPES).default('in-field'),
	'Client ID': blank(),
	'Property ID': blank(),
	'Opportunity ID': blank(),
	'Walkthrough ID': blank(),
	'Pricing Config ID': blank(),
	'Calculator Version': blank(),
	'Input Snapshot': blank(),
	'Calculation Result Snapshot': blank(),
	'Rounding Policy': blank(),
	Currency: blank(),
	'Calculated Base Amount': blank(),
	'Calculated Add-ons': blank(),
	'Calculated Surcharges': blank(),
	'Estimated Labor Hours': blank(),
	'Target Hourly Rate': blank(),
	'Target Price Before Adjustments': blank(),
	'Manual Adjustment': blank(),
	Discount: blank(),
	'Final Quoted Price': blank(),
	'Expected Revenue Per Labor Hour': blank(),
	'Override Reason': blank(),
	'Quote Status': z.enum(QUOTE_STATUSES).default('Draft'),
	'Created At': blank(),
	'Updated At': blank(),
	'Sent At': blank(),
	'Accepted At': blank(),
	'Declined At': blank(),
	'Expired At': blank(),
	'Archived At': blank(),
	'Created By': blank(),
	Notes: blank(),
});

export type Quote = z.infer<typeof quoteSchema>;

export const quoteConfig: TabConfig<Quote> = {
	tab: 'Quotes',
	idColumn: 'Quote ID',
	requiredColumns: Object.keys(quoteSchema.shape),
	schema: quoteSchema,
	entityType: 'Quote',
};
