import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

/**
 * Base cleaning minutes for one window unit of a given production class, at
 * standard size, standard access, and Maintenance condition. Everything else
 * in the labor model scales these numbers — size factor, access additions,
 * component condition factors — so this row is the single place a class's
 * inherent difficulty is expressed.
 *
 * One row per production class per LaborConfig version, keyed by 'Labor
 * Config ID'. A new config version copies the whole set rather than editing
 * these in place, so past estimates stay reproducible.
 *
 * 'Default Pane Factor' is how many panes a typical unit of this class has.
 * A group that records its own panes-per-unit scales its glass minutes by the
 * ratio — so a 12-pane french unit costs twice a 6-pane one, while a class
 * whose pane count doesn't vary just leaves it alone.
 */
export const windowProductionProfileSchema = z.object({
	'Profile ID': z.string().min(1),
	'Labor Config ID': blank(),
	'Production Class': blank(),
	'Interior Glass Base Minutes': blank(),
	'Exterior Glass Base Minutes': blank(),
	// Removing and re-hanging a screen, separate from washing it — a screen
	// that comes out and goes back costs handling time even when it's clean.
	'Screen Handling Base Minutes': blank(),
	'Screen Cleaning Base Minutes': blank(),
	'Track Base Minutes': blank(),
	'Frame Base Minutes': blank(),
	'Default Pane Factor': blank(),
	'Sort Order': blank(),
	Notes: blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type WindowProductionProfile = z.infer<typeof windowProductionProfileSchema>;

export const windowProductionProfileConfig: TabConfig<WindowProductionProfile> = {
	tab: 'WindowProductionProfiles',
	idColumn: 'Profile ID',
	requiredColumns: Object.keys(windowProductionProfileSchema.shape),
	schema: windowProductionProfileSchema,
	entityType: 'WindowProductionProfile',
};
