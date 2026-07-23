import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const WALKTHROUGH_ITEM_AREAS = [
	'Front',
	'Left',
	'Rear',
	'Right',
	'Interior',
	'Garage',
	'Basement',
	'Other',
] as const;

// Reuses the Services catalog's own taxonomy instead of inventing a second
// one: Item Type + Size Class together select a Service Code (see
// lib/pricing/walkthroughToQuote.ts) — e.g. Window + Oversized + Exterior
// Included -> WINDOW_EXT_OVERSIZED. Size Class only applies to Window.
export const WALKTHROUGH_ITEM_TYPES = ['Window', 'Sliding Door', 'Skylight'] as const;
export const WALKTHROUGH_SIZE_CLASSES = ['Standard', 'Oversized', 'French/Divided-Light'] as const;

export const walkthroughItemSchema = z.object({
	'Walkthrough Item ID': z.string().min(1),
	'Walkthrough ID': blank(),
	Area: blank(),
	'Item Type': blank(),
	Quantity: blank(),
	'Size Class': blank(),
	'Interior Included': blank(),
	'Exterior Included': blank(),
	'Screen Included': blank(),
	'Track Included': blank(),
	Condition: blank(),
	'Access Difficulty': blank(),
	'Hard Water': blank(),
	'Construction Debris': blank(),
	'Estimated Labor Minutes': blank(),
	Notes: blank(),
	'Sort Order': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type WalkthroughItem = z.infer<typeof walkthroughItemSchema>;

export const walkthroughItemConfig: TabConfig<WalkthroughItem> = {
	tab: 'WalkthroughItems',
	idColumn: 'Walkthrough Item ID',
	requiredColumns: Object.keys(walkthroughItemSchema.shape),
	schema: walkthroughItemSchema,
	entityType: 'WalkthroughItem',
};
