import type { LaborConfig } from '../models/laborConfig';
import type { WindowProductionProfile } from '../models/windowProductionProfile';
import { PRODUCTION_CLASSES, type ProductionClass } from './types';

/**
 * The starting labor model, seeded once into the live spreadsheet.
 *
 * These are calibration starting points, not permanent constants. They exist
 * in code only so a fresh environment has something coherent to boot from —
 * the LaborConfig / WindowProductionProfiles rows in the spreadsheet are the
 * real source of truth the moment they exist, and nothing here is read again
 * afterward.
 *
 * How they were chosen: base minutes are a solo operator's realistic pace on
 * a Maintenance-condition, standard-size, ground-access unit, with every
 * other cost — size, access, condition, restoration — layered on top rather
 * than baked in. The numbers were checked against the shape of a real
 * three-story property with roughly 44 units and 44 screens, which lands
 * around 10 productive hours. That check lives as a test in estimate.test.ts
 * rather than as an assertion here.
 */
export const SEED_LABOR_CONFIG_ID = 'labor-config-residential-v2';
export const SEED_LABOR_VERSION_LABEL = 'Residential v2';

export const SEED_LABOR_CONFIG: Omit<LaborConfig, 'Created At' | 'Updated At' | 'Archived At'> = {
	'Labor Config ID': SEED_LABOR_CONFIG_ID,
	'Config Name': 'Residential production model',
	'Version Label': SEED_LABOR_VERSION_LABEL,
	'Property Type': 'Residential',
	Status: 'Active',
	'Effective Date': '',
	'End Date': '',

	// ~70 minutes of overhead on a full interior+exterior day, which is about
	// what arrival, unloading, two setups, a final walk and packing up
	// actually costs.
	'Overhead Arrival Minutes': '10',
	'Overhead Equipment Unload Minutes': '10',
	'Overhead Exterior Setup Minutes': '15',
	'Overhead Interior Setup Minutes': '10',
	'Overhead Final Inspection Minutes': '10',
	'Overhead Breakdown Minutes': '15',

	'Size Factor Small': '0.75',
	'Size Factor Standard': '1',
	'Size Factor Large': '1.35',
	'Size Factor Oversized': '1.75',

	// Minutes added per unit. The gap between Extended WFP and Difficult
	// Ladder Positioning is deliberately wide — reaching a third-floor window
	// from a pole is slower than from the ground, but setting and re-setting
	// a ladder on bad footing is a different order of work, and flattening
	// the two is how a hard property gets underquoted.
	'Interior Access Floor Level Minutes': '0',
	'Interior Access Step Ladder Minutes': '0.75',
	'Interior Access Extension Ladder Minutes': '2.5',
	'Interior Access Pole Work Minutes': '1.5',
	'Interior Access Vaulted Or Obstructed Minutes': '4',
	'Interior Access Technical Minutes': '6',

	'Exterior Access Ground Level Minutes': '0',
	'Exterior Access Standard WFP Minutes': '0.5',
	'Exterior Access Extended WFP Minutes': '2',
	'Exterior Access Standard Ladder Minutes': '2.5',
	'Exterior Access Difficult Ladder Minutes': '5',
	'Exterior Access Roof Access Minutes': '6',
	'Exterior Access Technical Minutes': '8',

	// Per group, and small on purpose: height is already paid for through
	// access, so this only covers hauling gear up and down.
	'Story Logistics First Minutes': '0',
	'Story Logistics Second Minutes': '3',
	'Story Logistics Third Minutes': '6',
	'Story Logistics Fourth Plus Minutes': '10',

	'Condition Factor Maintenance': '1',
	'Condition Factor Light Buildup': '1.1',
	'Condition Factor Moderate Buildup': '1.35',
	'Condition Factor Heavy Buildup': '1.75',

	'Scheduled Time Contingency Percent': '12',
	'Two-Day Threshold Hours': '9',
	'Crew Recommendation Threshold Hours': '14',

	Notes: 'Initial calibration values. Revise by superseding this row with a new version, never by editing it in place.',
};

interface ProfileSeed {
	interiorGlass: string;
	exteriorGlass: string;
	screenHandling: string;
	screenCleaning: string;
	track: string;
	frame: string;
	paneFactor: string;
	notes: string;
}

const PROFILE_SEEDS: Record<ProductionClass, ProfileSeed> = {
	'Standard Window': {
		interiorGlass: '3',
		exteriorGlass: '2.5',
		screenHandling: '0.8',
		screenCleaning: '1.2',
		track: '1.8',
		frame: '1.2',
		paneFactor: '1',
		notes: 'Casements, double-hungs, sliders, awnings. The reference unit everything else is judged against.',
	},
	'Large Picture Window': {
		interiorGlass: '7',
		exteriorGlass: '6',
		screenHandling: '0',
		screenCleaning: '0',
		track: '0',
		frame: '3',
		paneFactor: '1',
		notes: 'Big fixed glass. No screen, no track, but a lot of surface and a long edge.',
	},
	'Specialty Shape': {
		interiorGlass: '6',
		exteriorGlass: '5',
		screenHandling: '0.5',
		screenCleaning: '1.2',
		track: '0.5',
		frame: '2.5',
		paneFactor: '1',
		notes: 'Triangles, arches, trapezoids. Angled edges cost time no straight-run technique recovers.',
	},
	'Sliding Door': {
		interiorGlass: '8',
		exteriorGlass: '7',
		screenHandling: '2',
		screenCleaning: '3',
		track: '6',
		frame: '3',
		paneFactor: '2',
		notes: 'Track work dominates. A neglected patio door track is often the slowest single item on a property.',
	},
	'French Panes': {
		interiorGlass: '10',
		exteriorGlass: '9',
		screenHandling: '0.8',
		screenCleaning: '1.2',
		track: '1.8',
		frame: '2',
		paneFactor: '6',
		notes: 'Base assumes a typical 6-pane unit; a group recording its own panes-per-unit scales from there.',
	},
	Skylight: {
		interiorGlass: '9',
		exteriorGlass: '8',
		screenHandling: '0',
		screenCleaning: '0',
		track: '0',
		frame: '2',
		paneFactor: '1',
		notes: 'The glass itself is ordinary. Everything expensive about a skylight is in the access selection.',
	},
};

export function seedProfileId(productionClass: ProductionClass): string {
	return `wpp-residential-v2-${productionClass.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export const SEED_WINDOW_PRODUCTION_PROFILES: Omit<
	WindowProductionProfile,
	'Created At' | 'Updated At' | 'Archived At'
>[] = PRODUCTION_CLASSES.map((productionClass, index) => {
	const seed = PROFILE_SEEDS[productionClass];
	return {
		'Profile ID': seedProfileId(productionClass),
		'Labor Config ID': SEED_LABOR_CONFIG_ID,
		'Production Class': productionClass,
		'Interior Glass Base Minutes': seed.interiorGlass,
		'Exterior Glass Base Minutes': seed.exteriorGlass,
		'Screen Handling Base Minutes': seed.screenHandling,
		'Screen Cleaning Base Minutes': seed.screenCleaning,
		'Track Base Minutes': seed.track,
		'Frame Base Minutes': seed.frame,
		'Default Pane Factor': seed.paneFactor,
		'Sort Order': String(index),
		Notes: seed.notes,
	};
});

/**
 * The owner's hourly production targets and job minimum, seeded onto the
 * Active PricingConfig row. Set once, deliberately: the standing instruction
 * is that pricing accuracy comes from sharpening the production model, not
 * from moving these three numbers.
 */
export const SEED_HOURLY_TARGETS = {
	'Low Hourly Production Target': '150',
	'Target Hourly Production Target': '175',
	'High Hourly Production Target': '200',
	'Minimum Job Price': '250',
} as const;
