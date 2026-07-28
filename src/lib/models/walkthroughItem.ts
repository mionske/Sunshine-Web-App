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

// A row in this tab is one of three shapes, told apart by which columns are
// filled — no discriminator column, so rows written before each successive
// change keep working unchanged:
//
//  1. AREA ROW (the optional per-area breakdown): 'Window Units'/'Pane
//     Count' are set and both 'Item Type' and 'Production Class' are blank.
//     One row per floor/side/room, summed into the walkthrough's totals.
//  2. DETAILED ITEM ROW (legacy Advanced / item-level breakdown): 'Item
//     Type' is set. Item Type + Size Class together select a Service Code
//     (see lib/pricing/walkthroughToQuote.ts) — e.g. Window + Oversized +
//     Exterior Included -> WINDOW_EXT_OVERSIZED.
//  3. WINDOW GROUP ROW (the current model): 'Production Class' is set. A
//     group of similar windows with a quantity — never one row per physical
//     window. This is what the labor model reads; see lib/labor/estimate.ts.
//
// Shapes 1 and 2 are read-only history now. Nothing writes them any more,
// and a walkthrough built from them stays on its original pricing path.
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
	// Shared by shapes 2 and 3, with different option sets: a legacy detailed
	// row holds WALKTHROUGH_SIZE_CLASSES above, a window group row holds
	// SIZE_CLASSES from lib/labor/types.ts. Unambiguous in practice because
	// 'Production Class' already tells the shapes apart, and reusing the
	// column keeps one "how big is it" concept rather than two.
	'Size Class': blank(),
	// --- Window group row (shape 3) ---
	// PRODUCTION_CLASSES in lib/labor/types.ts. Set means this is a group
	// row; blank means it isn't.
	'Production Class': blank(),
	Story: blank(),
	// Selected independently, because they genuinely are independent: a
	// third-floor window can be trivial from a balcony inside and a rope job
	// outside. Required only for the side actually being cleaned.
	'Interior Access': blank(),
	'Exterior Access': blank(),
	// Per-unit counts. Blank means "the typical amount for this class" — the
	// production profile's own defaults apply, rather than a fabricated zero.
	'Panes Per Unit': blank(),
	'Screens Per Unit': blank(),
	'Tracks Per Unit': blank(),
	// Required when Production Class is Specialty Shape, so an odd window is
	// described once instead of becoming a new permanent category.
	'Specialty Description': blank(),
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
