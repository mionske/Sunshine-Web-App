import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const quoteItemSchema = z.object({
	'Quote Item ID': z.string().min(1),
	'Quote ID': blank(),
	'Service Code': blank(),
	'Service Category': blank(),
	Description: blank(),
	Quantity: blank(),
	Unit: blank(),
	'Unit Price': blank(),
	'Estimated Labor Minutes': blank(),
	'Line Total': blank(),
	Taxable: blank(),
	'Sort Order': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
	'Internal Notes': blank(),
});

export type QuoteItem = z.infer<typeof quoteItemSchema>;

export const quoteItemConfig: TabConfig<QuoteItem> = {
	tab: 'QuoteItems',
	idColumn: 'Quote Item ID',
	requiredColumns: Object.keys(quoteItemSchema.shape),
	schema: quoteItemSchema,
	entityType: 'QuoteItem',
};
