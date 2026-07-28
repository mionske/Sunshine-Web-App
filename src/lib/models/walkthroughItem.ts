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

// A row in this tab is one of two shapes, told apart by which columns are
// filled — no discriminator column, so rows written before the whole-
// property simplification keep working unchanged:
//
//  1. AREA ROW (the optional per-area breakdown): 'Window Units'/'Pane
//     Count' are set and 'Item Type' is blank. One row per floor/side/room,
//     summed into the walkthrough's totals.
//  2. DETAILED ITEM ROW (Advanced / item-level breakdown, and every row
//     written before this change): 'Item Type' is set. Item Type + Size
//     Class together select a Service Code (see
//     lib/pricing/walkthroughToQuote.ts) — e.g. Window + Oversized +
//     Exterior Included -> WINDOW_EXT_OVERSIZED. Size Class only applies to
//     Window.
//
// Window type is never required in the normal workflow; it exists only on
// the detailed path.
export const WALKTHROUGH_ITEM_TYPES = ['Window', 'Sliding Door', 'Skylight'] as const;
export const WALKTHROUGH_SIZE_CLASSES = ['Standard', 'Oversized', 'French/Divided-Light'] as const;

export const walkthroughItemSchema = z.object({
	'Walkthrough Item ID': z.string().min(1),
	'Walkthrough ID': blank(),
	Area: blank(),
	// Area-row counts. Stored separately and never derived from one another
	// — see the note on the Walkthrough's own totals.
	'Window Units': blank(),
	'Pane Count': blank(),
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
