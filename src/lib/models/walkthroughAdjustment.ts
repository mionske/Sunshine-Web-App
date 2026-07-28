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
 * 'Additional Minutes' is the resolved cost of this line, stored so the record
 * still explains itself after the configured rates move on. For restoration it
 * comes from 'Affected Panes' × the rate for 'Severity'; for a property
 * modifier it's that modifier's configured flat cost. Rows written before those
 * rates existed hold a hand-entered number instead, and are still read at it —
 * see adjustmentMinutes() in lib/labor/walkthroughLabor.ts.
 */
export const walkthroughAdjustmentSchema = z.object({
	'Adjustment ID': z.string().min(1),
	'Walkthrough ID': blank(),
	Kind: blank(),
	Label: blank(),
	'Affected Units': blank(),
	'Affected Panes': blank(),
	// SEVERITY_LEVELS in lib/labor/types.ts. Restoration rows only.
	Severity: blank(),
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
