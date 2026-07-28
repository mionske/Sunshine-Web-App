import { listActiveRows } from '../sheets';
import type { SheetsEnv } from '../sheets';
import { laborConfigConfig, type LaborConfig } from '../models/laborConfig';
import { windowProductionProfileConfig, type WindowProductionProfile } from '../models/windowProductionProfile';
import {
	COMPONENT_CONDITIONS,
	EXTERIOR_ACCESS_LEVELS,
	INTERIOR_ACCESS_LEVELS,
	PRODUCTION_CLASSES,
	SIZE_CLASSES,
	STORIES,
	type ComponentCondition,
	type ExteriorAccess,
	type InteriorAccess,
	type ProductionClass,
	type SizeClass,
	type Story,
} from './types';

/**
 * The labor configuration with every value already parsed into a number and
 * every option set resolved to a lookup.
 *
 * The estimator deals only in this shape, never in raw rows. Sheets stores
 * everything as strings, and a blank cell coerces to 0 — which is a perfectly
 * reasonable default for "minutes to add" and a disastrous one for "multiply
 * by this factor". Doing the parse once, here, is what keeps that distinction
 * from having to be remembered at thirty call sites.
 */
export interface LaborModel {
	configId: string;
	versionLabel: string;
	overhead: {
		arrival: number;
		unload: number;
		exteriorSetup: number;
		interiorSetup: number;
		inspection: number;
		breakdown: number;
	};
	sizeFactor: Record<SizeClass, number>;
	interiorAccessMinutes: Record<InteriorAccess, number>;
	exteriorAccessMinutes: Record<ExteriorAccess, number>;
	storyLogisticsMinutes: Record<Story, number>;
	conditionFactor: Record<ComponentCondition, number>;
	contingencyPercent: number;
	twoDayThresholdHours: number;
	crewThresholdHours: number;
	profiles: Record<ProductionClass, ProductionProfile>;
}

export interface ProductionProfile {
	productionClass: ProductionClass;
	interiorGlassMinutes: number;
	exteriorGlassMinutes: number;
	screenHandlingMinutes: number;
	screenCleaningMinutes: number;
	trackMinutes: number;
	frameMinutes: number;
	defaultPaneFactor: number;
}

/** Minutes and other additive values: a blank cell genuinely means zero. */
function minutes(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Multipliers: a blank cell must NOT become zero, or an unconfigured factor
 * would silently erase the labor it was supposed to scale. Falls back to 1,
 * which is the identity — "no adjustment configured" reads as "no
 * adjustment", never as "this work takes no time".
 */
function factor(value: string | undefined, fallback = 1): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

const EMPTY_PROFILE = (productionClass: ProductionClass): ProductionProfile => ({
	productionClass,
	interiorGlassMinutes: 0,
	exteriorGlassMinutes: 0,
	screenHandlingMinutes: 0,
	screenCleaningMinutes: 0,
	trackMinutes: 0,
	frameMinutes: 0,
	defaultPaneFactor: 1,
});

/** Pure: turns the stored rows into the estimator's input. Split out from the
 * Sheets loader below so every calculation test can build a model directly
 * without touching a fake spreadsheet. */
export function resolveLaborModel(config: LaborConfig, profileRows: WindowProductionProfile[]): LaborModel {
	const byClass = new Map(profileRows.map((p) => [p['Production Class'], p]));

	const profiles = Object.fromEntries(
		PRODUCTION_CLASSES.map((productionClass) => {
			const row = byClass.get(productionClass);
			// A class with no profile row contributes no cleaning minutes rather
			// than throwing. Access, size and condition still apply to it, so a
			// half-configured model degrades toward "too low" visibly instead of
			// taking the whole estimate down with it.
			if (!row) return [productionClass, EMPTY_PROFILE(productionClass)];
			return [
				productionClass,
				{
					productionClass,
					interiorGlassMinutes: minutes(row['Interior Glass Base Minutes']),
					exteriorGlassMinutes: minutes(row['Exterior Glass Base Minutes']),
					screenHandlingMinutes: minutes(row['Screen Handling Base Minutes']),
					screenCleaningMinutes: minutes(row['Screen Cleaning Base Minutes']),
					trackMinutes: minutes(row['Track Base Minutes']),
					frameMinutes: minutes(row['Frame Base Minutes']),
					defaultPaneFactor: factor(row['Default Pane Factor']),
				},
			];
		})
	) as Record<ProductionClass, ProductionProfile>;

	const sizeFactorColumns: Record<SizeClass, keyof LaborConfig> = {
		Small: 'Size Factor Small',
		Standard: 'Size Factor Standard',
		Large: 'Size Factor Large',
		Oversized: 'Size Factor Oversized',
	};

	const interiorAccessColumns: Record<InteriorAccess, keyof LaborConfig> = {
		'Floor Level': 'Interior Access Floor Level Minutes',
		'Step Ladder': 'Interior Access Step Ladder Minutes',
		'Extension Ladder': 'Interior Access Extension Ladder Minutes',
		'Pole Work': 'Interior Access Pole Work Minutes',
		'Vaulted or Obstructed': 'Interior Access Vaulted Or Obstructed Minutes',
		'Technical Interior Access': 'Interior Access Technical Minutes',
	};

	const exteriorAccessColumns: Record<ExteriorAccess, keyof LaborConfig> = {
		'Ground-Level Traditional': 'Exterior Access Ground Level Minutes',
		'Standard WFP': 'Exterior Access Standard WFP Minutes',
		'Extended WFP': 'Exterior Access Extended WFP Minutes',
		'Standard Ladder': 'Exterior Access Standard Ladder Minutes',
		'Difficult Ladder Positioning': 'Exterior Access Difficult Ladder Minutes',
		'Roof Access': 'Exterior Access Roof Access Minutes',
		'Technical Exterior Access': 'Exterior Access Technical Minutes',
	};

	const storyColumns: Record<Story, keyof LaborConfig> = {
		First: 'Story Logistics First Minutes',
		Second: 'Story Logistics Second Minutes',
		Third: 'Story Logistics Third Minutes',
		'Fourth+': 'Story Logistics Fourth Plus Minutes',
	};

	const conditionColumns: Record<ComponentCondition, keyof LaborConfig> = {
		Maintenance: 'Condition Factor Maintenance',
		'Light Buildup': 'Condition Factor Light Buildup',
		'Moderate Buildup': 'Condition Factor Moderate Buildup',
		'Heavy Buildup': 'Condition Factor Heavy Buildup',
	};

	const lookup = <K extends string>(keys: readonly K[], columns: Record<K, keyof LaborConfig>, read: (v: string) => number) =>
		Object.fromEntries(keys.map((k) => [k, read(String(config[columns[k]] ?? ''))])) as Record<K, number>;

	return {
		configId: config['Labor Config ID'],
		versionLabel: config['Version Label'] || config['Config Name'] || config['Labor Config ID'],
		overhead: {
			arrival: minutes(config['Overhead Arrival Minutes']),
			unload: minutes(config['Overhead Equipment Unload Minutes']),
			exteriorSetup: minutes(config['Overhead Exterior Setup Minutes']),
			interiorSetup: minutes(config['Overhead Interior Setup Minutes']),
			inspection: minutes(config['Overhead Final Inspection Minutes']),
			breakdown: minutes(config['Overhead Breakdown Minutes']),
		},
		sizeFactor: lookup(SIZE_CLASSES, sizeFactorColumns, (v) => factor(v)),
		interiorAccessMinutes: lookup(INTERIOR_ACCESS_LEVELS, interiorAccessColumns, minutes),
		exteriorAccessMinutes: lookup(EXTERIOR_ACCESS_LEVELS, exteriorAccessColumns, minutes),
		storyLogisticsMinutes: lookup(STORIES, storyColumns, minutes),
		conditionFactor: lookup(COMPONENT_CONDITIONS, conditionColumns, (v) => factor(v)),
		contingencyPercent: minutes(config['Scheduled Time Contingency Percent']),
		twoDayThresholdHours: minutes(config['Two-Day Threshold Hours']),
		crewThresholdHours: minutes(config['Crew Recommendation Threshold Hours']),
		profiles,
	};
}

export class LaborModelUnavailableError extends Error {
	constructor(propertyType: string) {
		super(
			`No Active labor configuration for property type "${propertyType}". Seed one via /api/admin/seed-labor-config before estimating.`
		);
		this.name = 'LaborModelUnavailableError';
	}
}

/**
 * The Active labor model for a property type. Falls back to a config with no
 * Property Type set (the single-segment case) before giving up, so a
 * residential-only business doesn't have to fill that column in to work.
 */
export async function loadActiveLaborModel(env: SheetsEnv, propertyType = 'Residential'): Promise<LaborModel> {
	const [configs, profiles] = await Promise.all([
		listActiveRows(env, laborConfigConfig),
		listActiveRows(env, windowProductionProfileConfig),
	]);

	const active = configs.filter((c) => c.Status === 'Active');
	const match = active.find((c) => c['Property Type'] === propertyType) ?? active.find((c) => !c['Property Type']);
	if (!match) throw new LaborModelUnavailableError(propertyType);

	const own = profiles.filter((p) => p['Labor Config ID'] === match['Labor Config ID']);
	return resolveLaborModel(match, own);
}

/**
 * The exact model a past walkthrough was estimated under, by config ID —
 * so re-opening an old review page explains the estimate that was actually
 * given, not what today's configuration would produce. Returns null when the
 * referenced config is gone.
 */
export async function loadLaborModelById(env: SheetsEnv, configId: string): Promise<LaborModel | null> {
	if (!configId) return null;
	const [configs, profiles] = await Promise.all([
		listActiveRows(env, laborConfigConfig),
		listActiveRows(env, windowProductionProfileConfig),
	]);
	const match = configs.find((c) => c['Labor Config ID'] === configId);
	if (!match) return null;
	return resolveLaborModel(
		match,
		profiles.filter((p) => p['Labor Config ID'] === configId)
	);
}
