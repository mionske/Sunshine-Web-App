import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const LABOR_CONFIG_STATUSES = ['Draft', 'Active', 'Superseded', 'Archived'] as const;

/**
 * Every labor assumption in the app, in one versioned row.
 *
 * Two rules this exists to enforce:
 *
 *  1. No production constant lives in a component, a controller, or the
 *     engine. If a number changes how long a job takes, it is a column here.
 *  2. A walkthrough stores the 'Version Label' it was estimated under, so an
 *     estimate from six months ago stays explainable after these values move.
 *     Rows are superseded, never edited in place, for the same reason
 *     PricingConfig is.
 *
 * All minute values are per window unit unless the column name says
 * otherwise. All factor values are multipliers where 1 means "no change" —
 * never percentages, so nothing has to remember to divide by 100.
 *
 * Per-class base minutes are NOT here; they live one row per production class
 * in WindowProductionProfiles (see windowProductionProfile.ts), keyed by this
 * row's ID.
 */
export const laborConfigSchema = z.object({
	'Labor Config ID': z.string().min(1),
	'Config Name': blank(),
	// What the owner sees, e.g. "Residential v2". The UUID above is stored but
	// never shown — a walkthrough review page says "Labor model: Residential
	// v2", not a raw identifier.
	'Version Label': blank(),
	'Property Type': blank(),
	Status: z.enum(LABOR_CONFIG_STATUSES).default('Draft'),
	'Effective Date': blank(),
	'End Date': blank(),

	// Fixed job overhead. Applied by scope: exterior setup only when exterior
	// work is included, interior setup only when interior work is, and both
	// again on the second day of a two-day job.
	'Overhead Arrival Minutes': blank(),
	'Overhead Equipment Unload Minutes': blank(),
	'Overhead Exterior Setup Minutes': blank(),
	'Overhead Interior Setup Minutes': blank(),
	'Overhead Final Inspection Minutes': blank(),
	'Overhead Breakdown Minutes': blank(),

	// Multiplies a group's glass and frame minutes. Blank size on a group
	// means Standard.
	'Size Factor Small': blank(),
	'Size Factor Standard': blank(),
	'Size Factor Large': blank(),
	'Size Factor Oversized': blank(),

	// Added per window unit, on top of the group's cleaning minutes. This is
	// the mechanism that makes a third-floor window on difficult ladder
	// positioning cost real time instead of a property-wide percentage.
	'Interior Access Floor Level Minutes': blank(),
	'Interior Access Step Ladder Minutes': blank(),
	'Interior Access Extension Ladder Minutes': blank(),
	'Interior Access Pole Work Minutes': blank(),
	'Interior Access Vaulted Or Obstructed Minutes': blank(),
	'Interior Access Technical Minutes': blank(),

	'Exterior Access Ground Level Minutes': blank(),
	'Exterior Access Standard WFP Minutes': blank(),
	'Exterior Access Extended WFP Minutes': blank(),
	'Exterior Access Standard Ladder Minutes': blank(),
	'Exterior Access Difficult Ladder Minutes': blank(),
	'Exterior Access Roof Access Minutes': blank(),
	'Exterior Access Technical Minutes': blank(),

	// Per GROUP, not per unit, and deliberately small — moving gear upstairs
	// is a real cost, but the height itself is already paid for through
	// access. Charging both per unit would double-count.
	'Story Logistics First Minutes': blank(),
	'Story Logistics Second Minutes': blank(),
	'Story Logistics Third Minutes': blank(),
	'Story Logistics Fourth Plus Minutes': blank(),

	// Multiplies only the component it belongs to. Moderate exterior frames
	// increase frame minutes and nothing else; interior condition never
	// touches exterior labor.
	'Condition Factor Maintenance': blank(),
	'Condition Factor Light Buildup': blank(),
	'Condition Factor Moderate Buildup': blank(),
	'Condition Factor Heavy Buildup': blank(),

	// Productive labor is the work. Scheduled time is the day: floor changes,
	// hose repositioning, breaks, drying, contingency.
	'Scheduled Time Contingency Percent': blank(),
	'Two-Day Threshold Hours': blank(),
	'Crew Recommendation Threshold Hours': blank(),

	Notes: blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type LaborConfig = z.infer<typeof laborConfigSchema>;

export const laborConfigConfig: TabConfig<LaborConfig> = {
	tab: 'LaborConfig',
	idColumn: 'Labor Config ID',
	requiredColumns: Object.keys(laborConfigSchema.shape),
	schema: laborConfigSchema,
	entityType: 'LaborConfig',
};
