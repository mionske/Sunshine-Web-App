import type { LaborModel, ProductionProfile } from './config';
import type { ComponentConditions, LaborAdjustment, LaborBreakdown, LaborEstimate, LaborScope } from './estimate';
import { inventoryTotals, type WalkthroughInventory } from './inventory';
import {
	PANE_COUNTED_TYPE,
	STANDARD_FLOORS,
	type ExteriorAccess,
	type InteriorAccess,
	type ProductionClass,
	type SizeClass,
	type SpecialItemStory,
	type SpecialItemType,
	type StandardFloor,
	type Story,
} from './types';

/**
 * Labor from the simplified (v3) inventory.
 *
 * PRICING AUDIT — where each physical difficulty is charged, once:
 *
 *  Height          Story Logistics only, once per distinct occupied story.
 *                  There is deliberately NO per-unit second/third-floor
 *                  multiplier on the standard rate. Adding one would bill
 *                  height twice: once for hauling the gear up, once again on
 *                  every window it reaches. A standard window costs the same
 *                  base minutes on any floor.
 *
 *  Access          The property-level interior/exterior selections, per unit.
 *                  This is genuinely separate from height: a third-floor
 *                  window reached from a balcony and one reached off a ladder
 *                  on a slope are the same story and very different work. It
 *                  is never inferred from floor — being upstairs does not by
 *                  itself mean difficult access.
 *
 *  Setup/teardown  Fixed job overhead only, once per day worked. Access
 *                  modifiers add reach time per window, never another round
 *                  of setup.
 *
 *  Relocation      Multiple Setup Zones / Long Equipment Carry / Difficult
 *                  Hose Routing are operator-entered property modifiers and
 *                  are the ONLY charge for moving equipment around. They are
 *                  legitimately additional to Story Logistics — going up is
 *                  not the same as going round — but nothing else in this
 *                  file charges for relocation, so they cannot double up.
 *
 *  Specials        Per-type production profiles. A special item never also
 *                  counts as a standard window.
 */

/** Each special type's production profile, and a size where the type itself
 * implies one. Nothing here invents a rate — it selects among the profiles
 * already configured in WindowProductionProfiles. */
const SPECIAL_PROFILE: Record<SpecialItemType, { productionClass: ProductionClass; size?: SizeClass }> = {
	large_picture: { productionClass: 'Large Picture Window' },
	oversized_picture: { productionClass: 'Large Picture Window', size: 'Oversized' },
	sliding_glass_door: { productionClass: 'Sliding Door' },
	divided_light_panes: { productionClass: 'French Panes' },
	skylight: { productionClass: 'Skylight' },
	large_triangle: { productionClass: 'Specialty Shape', size: 'Large' },
	small_triangle: { productionClass: 'Specialty Shape', size: 'Small' },
	specialty_shape: { productionClass: 'Specialty Shape' },
	bay_bow: { productionClass: 'Specialty Shape', size: 'Large' },
	// Conservative: an unclassified item is priced as an ordinary specialty
	// shape rather than guessed upward.
	custom: { productionClass: 'Specialty Shape' },
};

const SPECIAL_STORY_TO_STORY: Partial<Record<SpecialItemStory, Story>> = {
	first: 'First',
	second: 'Second',
	third: 'Third',
	fourth_plus: 'Fourth+',
	// Roof, Multiple and Not applicable deliberately map to nothing: none of
	// them identifies a single floor to charge logistics for, and guessing
	// one would invent a trip that may not happen.
};

const FLOOR_TO_STORY: Record<StandardFloor, Story> = {
	first: 'First',
	second: 'Second',
	third: 'Third',
	fourthPlus: 'Fourth+',
};

export interface InventoryLaborInput {
	inventory: WalkthroughInventory;
	scope: LaborScope;
	conditions?: ComponentConditions;
	adjustments?: LaborAdjustment[];
	/** One selection each for the whole property — see the audit note above. */
	access?: { interior?: InteriorAccess | ''; exterior?: ExteriorAccess | '' };
}

function emptyBreakdown(): LaborBreakdown {
	return {
		fixedOverhead: 0,
		interiorGlass: 0,
		exteriorGlass: 0,
		exteriorFrames: 0,
		screens: 0,
		tracks: 0,
		interiorAccess: 0,
		exteriorAccess: 0,
		storyLogistics: 0,
		condition: 0,
		restoration: 0,
		propertyModifiers: 0,
	};
}

function overheadMinutes(model: LaborModel, scope: LaborScope): number {
	const { overhead } = model;
	const perDay =
		overhead.arrival +
		overhead.unload +
		(scope.exterior ? overhead.exteriorSetup : 0) +
		(scope.interior ? overhead.interiorSetup : 0) +
		overhead.inspection +
		overhead.breakdown;
	return scope.twoDay ? perDay * 2 : perDay;
}

function conditionDelta(model: LaborModel, componentMinutes: number, condition: string | undefined): number {
	if (!condition || componentMinutes === 0) return 0;
	const factor = model.conditionFactor[condition as keyof typeof model.conditionFactor] ?? 1;
	return componentMinutes * (factor - 1);
}

export function estimateInventoryLabor(model: LaborModel, input: InventoryLaborInput): LaborEstimate {
	const { inventory, scope, conditions = {}, adjustments = [], access = {} } = input;
	const breakdown = emptyBreakdown();
	const totals = inventoryTotals(inventory);

	const standard = model.profiles['Standard Window'];
	const occupiedStories = new Set<Story>();

	// --- Standard windows: one flat rate, whatever floor they are on -------
	for (const floor of STANDARD_FLOORS) {
		const units = inventory.standardWindowsByStory[floor] ?? 0;
		if (units <= 0) continue;
		occupiedStories.add(FLOOR_TO_STORY[floor]);
		if (!standard) continue;

		if (scope.interior) breakdown.interiorGlass += standard.interiorGlassMinutes * units;
		if (scope.exterior) breakdown.exteriorGlass += standard.exteriorGlassMinutes * units;
		if (scope.exterior && scope.frames) breakdown.exteriorFrames += standard.frameMinutes * units;
	}

	// --- Special items: per-type profiles ----------------------------------
	for (const item of inventory.specialItems) {
		const quantity = item.quantity > 0 ? item.quantity : 0;
		if (quantity === 0) continue;

		const mapping = SPECIAL_PROFILE[item.type];
		const profile: ProductionProfile | undefined = mapping ? model.profiles[mapping.productionClass] : undefined;
		if (!profile) continue;

		const size = mapping.size ? (model.sizeFactor[mapping.size] ?? 1) : 1;
		const story = SPECIAL_STORY_TO_STORY[item.story];
		if (story) occupiedStories.add(story);

		if (item.type === PANE_COUNTED_TYPE) {
			// Quantity is PANES here. The french profile's base minutes cover a
			// typical unit of `defaultPaneFactor` lights, so the per-pane cost
			// is that divided out — the operator counted glass, not openings.
			const panes = profile.defaultPaneFactor > 0 ? profile.defaultPaneFactor : 1;
			if (scope.interior) breakdown.interiorGlass += (profile.interiorGlassMinutes / panes) * quantity;
			if (scope.exterior) breakdown.exteriorGlass += (profile.exteriorGlassMinutes / panes) * quantity;
			continue;
		}

		if (scope.interior) breakdown.interiorGlass += profile.interiorGlassMinutes * size * quantity;
		if (scope.exterior) breakdown.exteriorGlass += profile.exteriorGlassMinutes * size * quantity;
		if (scope.exterior && scope.frames) breakdown.exteriorFrames += profile.frameMinutes * size * quantity;
	}

	// --- Accessories: counted directly, never derived from the windows -----
	if (scope.screens && standard) {
		breakdown.screens += (standard.screenHandlingMinutes + standard.screenCleaningMinutes) * totals.screens;
	}
	if (scope.tracks && standard) {
		breakdown.tracks += standard.trackMinutes * totals.tracks;
	}

	// --- Access: property-level, per unit ----------------------------------
	// Charged across the window units actually being cleaned. Not inferred
	// from floor, and never a substitute for Story Logistics below.
	const accessUnits = totals.totalWindowUnits;
	if (scope.interior && access.interior) {
		breakdown.interiorAccess += (model.interiorAccessMinutes[access.interior] ?? 0) * accessUnits;
	}
	if (scope.exterior && access.exterior) {
		breakdown.exteriorAccess += (model.exteriorAccessMinutes[access.exterior] ?? 0) * accessUnits;
	}

	// --- Height: once per distinct occupied story, and only here ----------
	for (const story of occupiedStories) {
		breakdown.storyLogistics += model.storyLogisticsMinutes[story] ?? 0;
	}

	breakdown.condition =
		conditionDelta(model, breakdown.interiorGlass, conditions.interiorGlass) +
		conditionDelta(model, breakdown.exteriorGlass, conditions.exteriorGlass) +
		conditionDelta(model, breakdown.exteriorFrames, conditions.exteriorFrame) +
		conditionDelta(model, breakdown.screens, conditions.screen) +
		conditionDelta(model, breakdown.tracks, conditions.track);

	for (const adjustment of adjustments) {
		const extra = adjustment.additionalMinutes > 0 ? adjustment.additionalMinutes : 0;
		if (adjustment.kind === 'Restoration') breakdown.restoration += extra;
		else breakdown.propertyModifiers += extra;
	}

	breakdown.fixedOverhead = overheadMinutes(model, scope);

	const productiveMinutes = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
	const hazardous = hazardousAccessFrom(access);

	return {
		breakdown,
		productiveMinutes,
		totals: {
			windowUnits: totals.totalWindowUnits,
			glassPanes: totals.totalGlassPanes,
			screens: totals.screens,
			tracks: totals.tracks,
			// Accessories are entered directly now, so "manual" is always true —
			// there is no grouped calculation left for them to override.
			screensManual: true,
			tracksManual: true,
		},
		laborModelVersion: model.versionLabel,
		laborConfigId: model.configId,
		explanation: explain(breakdown, totals, hazardous),
		hazardousAccess: hazardous,
	};
}

const HAZARDOUS_EXTERIOR: readonly string[] = ['Difficult Ladder Positioning', 'Roof Access', 'Technical Exterior Access'];
const HAZARDOUS_INTERIOR: readonly string[] = ['Vaulted or Obstructed', 'Technical Interior Access'];

function hazardousAccessFrom(access: { interior?: string; exterior?: string }): string[] {
	const flagged: string[] = [];
	if (access.exterior && HAZARDOUS_EXTERIOR.includes(access.exterior)) flagged.push(access.exterior);
	if (access.interior && HAZARDOUS_INTERIOR.includes(access.interior)) flagged.push(access.interior);
	return flagged;
}

const DRIVER_LABELS: { key: keyof LaborBreakdown; label: string }[] = [
	{ key: 'exteriorAccess', label: 'exterior access' },
	{ key: 'interiorAccess', label: 'interior access' },
	{ key: 'condition', label: 'component condition' },
	{ key: 'screens', label: 'screens' },
	{ key: 'tracks', label: 'tracks' },
	{ key: 'exteriorFrames', label: 'frames and sills' },
	{ key: 'restoration', label: 'restoration work' },
	{ key: 'propertyModifiers', label: 'property-level factors' },
];

function explain(breakdown: LaborBreakdown, totals: ReturnType<typeof inventoryTotals>, hazardous: string[]): string {
	const parts: string[] = [];
	if (hazardous.length > 0) parts.push(`${hazardous.join(' and ').toLowerCase()} across the property`);
	if (totals.screens >= 20) parts.push(`${totals.screens} screens`);

	const drivers = DRIVER_LABELS.filter((d) => breakdown[d.key] > 0)
		.sort((a, b) => breakdown[b.key] - breakdown[a.key])
		.slice(0, 3)
		.map((d) => `${d.label} (${(breakdown[d.key] / 60).toFixed(1)} h)`);

	const lead = parts.length > 0 ? `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}. ` : '';
	if (drivers.length === 0) return `${lead}Glass cleaning accounts for the whole estimate.`;
	return `${lead}Largest contributors beyond the glass itself: ${drivers.join(', ')}.`;
}
