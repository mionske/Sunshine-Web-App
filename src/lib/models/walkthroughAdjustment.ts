import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

/**
 * One selected restoration service or property-level labor modifier on a
 * walkthrough. Both shapes share this tab because they are the same thing
 * structurally — a named extra with its own scope and its own minutes — and
 * 'Kind' tells them apart (see ADJUSTMENT_KINDS in lib/labor/types.ts).
 *
 * Why rows rather than columns on Walkthrough: restoration almost never
 * applies to every window. "Razor scraping" as a boolean can't say whether
 * it's four panes on the sunroom or the whole south elevation, and pricing a
 * checkbox is exactly how a restoration job gets underquoted. Each row
 * carries its own affected counts, its own minutes, and its own note.
 *
 * 'Additional Minutes' is the owner's estimate for this line and is always
 * theirs to set — nothing in the labor model derives it, since no
 * configuration can know how bad the overspray is until someone looks at it.
 */
export const walkthroughAdjustmentSchema = z.object({
	'Adjustment ID': z.string().min(1),
	'Walkthrough ID': blank(),
	Kind: blank(),
	Label: blank(),
	'Affected Units': blank(),
	'Affected Panes': blank(),
	'Additional Minutes': blank(),
	Notes: blank(),
	'Sort Order': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type WalkthroughAdjustment = z.infer<typeof walkthroughAdjustmentSchema>;

export const walkthroughAdjustmentConfig: TabConfig<WalkthroughAdjustment> = {
	tab: 'WalkthroughLaborAdjustments',
	idColumn: 'Adjustment ID',
	requiredColumns: Object.keys(walkthroughAdjustmentSchema.shape),
	schema: walkthroughAdjustmentSchema,
	entityType: 'WalkthroughAdjustment',
};
