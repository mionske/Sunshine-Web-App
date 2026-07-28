import type { LaborModel, ProductionProfile } from './config';
import {
	type ComponentCondition,
	type ExteriorAccess,
	type InteriorAccess,
	type ProductionClass,
	type SizeClass,
	type Story,
} from './types';

/**
 * One row of grouped inventory. A group is "eight standard casements on the
 * second floor, extended WFP outside, step ladder inside" — never one record
 * per physical window.
 */
export interface WindowGroup {
	id: string;
	quantity: number;
	productionClass: ProductionClass;
	/** Blank means Standard. Only set when a group is meaningfully off-typical. */
	sizeClass?: SizeClass | '';
	story?: Story | '';
	interiorAccess?: InteriorAccess | '';
	exteriorAccess?: ExteriorAccess | '';
	/** Blank/0 means "the typical amount for this class" — the profile decides. */
	panesPerUnit?: number;
	screensPerUnit?: number;
	tracksPerUnit?: number;
}

/** What this visit covers. Every component can be excluded independently. */
export interface LaborScope {
	interior: boolean;
	exterior: boolean;
	screens: boolean;
	tracks: boolean;
	frames: boolean;
	/** Setup and breakdown happen twice when the work spans two days. */
	twoDay?: boolean;
}

/** Blank is legitimate: a component that isn't in scope is never rated. */
export interface ComponentConditions {
	interiorGlass?: ComponentCondition | '';
	track?: ComponentCondition | '';
	exteriorGlass?: ComponentCondition | '';
	exteriorFrame?: ComponentCondition | '';
	screen?: ComponentCondition | '';
}

/** A restoration service or property-level modifier, with the owner's own minutes. */
export interface LaborAdjustment {
	kind: 'Restoration' | 'Modifier';
	label: string;
	additionalMinutes: number;
}

/** Owner-stated totals that override what the groups add up to. */
export interface ManualTotals {
	screens?: number;
	tracks?: number;
}

export interface LaborEstimateInput {
	groups: WindowGroup[];
	scope: LaborScope;
	conditions?: ComponentConditions;
	adjustments?: LaborAdjustment[];
	manualTotals?: ManualTotals;
}

export interface LaborBreakdown {
	fixedOverhead: number;
	interiorGlass: number;
	exteriorGlass: number;
	exteriorFrames: number;
	screens: number;
	tracks: number;
	interiorAccess: number;
	exteriorAccess: number;
	storyLogistics: number;
	/** What the component conditions added on top of the base component lines. */
	condition: number;
	restoration: number;
	propertyModifiers: number;
}

export interface CountTotals {
	windowUnits: number;
	glassPanes: number;
	screens: number;
	tracks: number;
	/** True when the owner's own total replaced the grouped sum. */
	screensManual: boolean;
	tracksManual: boolean;
}

export interface LaborEstimate {
	breakdown: LaborBreakdown;
	productiveMinutes: number;
	totals: CountTotals;
	laborModelVersion: string;
	laborConfigId: string;
	/** Plain-language summary of what drove this estimate up. */
	explanation: string;
	/** Access selections that carry real risk, for the schedule recommendation. */
	hazardousAccess: string[];
}

const HAZARDOUS_EXTERIOR_ACCESS: readonly ExteriorAccess[] = [
	'Difficult Ladder Positioning',
	'Roof Access',
	'Technical Exterior Access',
];
const HAZARDOUS_INTERIOR_ACCESS: readonly InteriorAccess[] = ['Vaulted or Obstructed', 'Technical Interior Access'];

function positive(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Screens and tracks per unit when the group doesn't say.
 *
 * The profile is the answer: a class whose screen minutes are zero is a class
 * that typically has no screen (fixed picture glass, skylights), and one with
 * real screen minutes typically has one. Better than defaulting everything to
 * 1 and quietly charging screen labor on a wall of picture windows.
 */
function defaultScreensPerUnit(profile: ProductionProfile): number {
	return profile.screenHandlingMinutes + profile.screenCleaningMinutes > 0 ? 1 : 0;
}

function defaultTracksPerUnit(profile: ProductionProfile): number {
	return profile.trackMinutes > 0 ? 1 : 0;
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

/**
 * Fixed job overhead, responding to scope.
 *
 * Arrival, unloading, inspection and breakdown happen on any visit. Exterior
 * and interior setup are each charged only when that side is actually being
 * worked, and a two-day job pays setup and breakdown a second time — the
 * truck gets packed at the end of day one either way.
 */
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

/**
 * Productive labor from the work actually involved.
 *
 * The shape that matters: every component is computed at its own base first,
 * and the component conditions are then applied per component and reported as
 * one separate `condition` line. That keeps the breakdown additive — the
 * lines sum to the total, so the review page can show a real explanation
 * rather than a number with a multiplier hidden inside it — and it enforces
 * the rule that a condition only ever inflates its own component. Moderate
 * frames cost frame time. They do not make the glass take longer.
 */
export function estimateLabor(model: LaborModel, input: LaborEstimateInput): LaborEstimate {
	const { groups, scope, conditions = {}, adjustments = [], manualTotals = {} } = input;
	const breakdown = emptyBreakdown();

	let windowUnits = 0;
	let glassPanes = 0;
	let groupedScreens = 0;
	let groupedTracks = 0;
	const hazardous = new Set<string>();
	const storiesPresent = new Set<Story>();

	for (const group of groups) {
		const quantity = positive(group.quantity);
		if (quantity === 0) continue;

		const profile = model.profiles[group.productionClass];
		if (!profile) continue;

		const size = model.sizeFactor[(group.sizeClass || 'Standard') as SizeClass] ?? 1;

		// Glass scales with pane count relative to what's typical for the
		// class. A 12-pane french unit is twice the detailing of a 6-pane one;
		// a class whose pane count doesn't vary simply never sets this.
		const panesPerUnit = positive(group.panesPerUnit) || profile.defaultPaneFactor;
		const paneScale = profile.defaultPaneFactor > 0 ? panesPerUnit / profile.defaultPaneFactor : 1;

		const screensPerUnit = group.screensPerUnit === undefined ? defaultScreensPerUnit(profile) : positive(group.screensPerUnit);
		const tracksPerUnit = group.tracksPerUnit === undefined ? defaultTracksPerUnit(profile) : positive(group.tracksPerUnit);

		windowUnits += quantity;
		glassPanes += quantity * panesPerUnit;
		if (scope.screens) groupedScreens += quantity * screensPerUnit;
		if (scope.tracks) groupedTracks += quantity * tracksPerUnit;

		// Size and panes scale the glass; size alone scales the frame. A
		// screen is a screen and a track is a track — neither gets bigger
		// because the opening is, so they are counted, not scaled.
		if (scope.interior) breakdown.interiorGlass += profile.interiorGlassMinutes * size * paneScale * quantity;
		if (scope.exterior) breakdown.exteriorGlass += profile.exteriorGlassMinutes * size * paneScale * quantity;
		// Frames and sills are exterior work — never charged on an
		// interior-only visit, however the frames flag is set.
		if (scope.exterior && scope.frames) breakdown.exteriorFrames += profile.frameMinutes * size * quantity;
		if (scope.screens) {
			breakdown.screens += (profile.screenHandlingMinutes + profile.screenCleaningMinutes) * screensPerUnit * quantity;
		}
		if (scope.tracks) breakdown.tracks += profile.trackMinutes * tracksPerUnit * quantity;

		// Access is charged per unit and only for the side being worked. This
		// is what makes a third-floor window on difficult ladder positioning
		// cost real time instead of a property-wide percentage.
		if (scope.interior && group.interiorAccess) {
			breakdown.interiorAccess += (model.interiorAccessMinutes[group.interiorAccess] ?? 0) * quantity;
			if (HAZARDOUS_INTERIOR_ACCESS.includes(group.interiorAccess)) hazardous.add(group.interiorAccess);
		}
		if (scope.exterior && group.exteriorAccess) {
			breakdown.exteriorAccess += (model.exteriorAccessMinutes[group.exteriorAccess] ?? 0) * quantity;
			if (HAZARDOUS_EXTERIOR_ACCESS.includes(group.exteriorAccess)) hazardous.add(group.exteriorAccess);
		}

		// Charged once per distinct story, below — not here.
		if (group.story) storiesPresent.add(group.story);
	}

	// Hauling gear to the third floor is one cost regardless of how many
	// windows are up there, and regardless of how many rows the operator
	// chose to split them across. Per group would mean splitting "8 casements
	// upstairs" into two rows of 4 silently raised the estimate; per unit
	// would double-count the height that access already charges for.
	for (const story of storiesPresent) {
		breakdown.storyLogistics += model.storyLogisticsMinutes[story] ?? 0;
	}

	// An owner-stated total wins over the grouped sum and scales its own
	// labor line with it. "There are actually 44 screens" has to mean 44
	// screens' worth of work, not just a different number on the summary.
	const totals: CountTotals = {
		windowUnits,
		glassPanes,
		screens: groupedScreens,
		tracks: groupedTracks,
		screensManual: false,
		tracksManual: false,
	};

	if (scope.screens && positive(manualTotals.screens) > 0) {
		const manual = positive(manualTotals.screens);
		breakdown.screens = rescaleToManualTotal(breakdown.screens, groupedScreens, manual, perScreenFallback(model));
		totals.screens = manual;
		totals.screensManual = true;
	}
	if (scope.tracks && positive(manualTotals.tracks) > 0) {
		const manual = positive(manualTotals.tracks);
		breakdown.tracks = rescaleToManualTotal(breakdown.tracks, groupedTracks, manual, perTrackFallback(model));
		totals.tracks = manual;
		totals.tracksManual = true;
	}

	// Conditions, applied per component and reported as one line.
	breakdown.condition =
		conditionDelta(model, breakdown.interiorGlass, conditions.interiorGlass) +
		conditionDelta(model, breakdown.exteriorGlass, conditions.exteriorGlass) +
		conditionDelta(model, breakdown.exteriorFrames, conditions.exteriorFrame) +
		conditionDelta(model, breakdown.screens, conditions.screen) +
		conditionDelta(model, breakdown.tracks, conditions.track);

	for (const adjustment of adjustments) {
		const extra = positive(adjustment.additionalMinutes);
		if (adjustment.kind === 'Restoration') breakdown.restoration += extra;
		else breakdown.propertyModifiers += extra;
	}

	breakdown.fixedOverhead = overheadMinutes(model, scope);

	const productiveMinutes = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

	return {
		breakdown,
		productiveMinutes,
		totals,
		laborModelVersion: model.versionLabel,
		laborConfigId: model.configId,
		explanation: explain(breakdown, totals, conditions, [...hazardous]),
		hazardousAccess: [...hazardous],
	};
}

/**
 * Scales a labor line to an owner-stated count. When the groups accounted for
 * none of that component at all there is nothing to scale from, so a
 * per-unit fallback is used instead — otherwise "44 screens" on a walkthrough
 * whose groups all say zero screens would silently cost nothing.
 */
function rescaleToManualTotal(lineMinutes: number, groupedCount: number, manualCount: number, fallbackPerUnit: number): number {
	if (groupedCount > 0) return (lineMinutes / groupedCount) * manualCount;
	return fallbackPerUnit * manualCount;
}

function perScreenFallback(model: LaborModel): number {
	const standard = model.profiles['Standard Window'];
	return standard ? standard.screenHandlingMinutes + standard.screenCleaningMinutes : 0;
}

function perTrackFallback(model: LaborModel): number {
	const standard = model.profiles['Standard Window'];
	return standard ? standard.trackMinutes : 0;
}

/** The extra minutes a condition adds to one component — never the whole. */
function conditionDelta(model: LaborModel, componentMinutes: number, condition: ComponentCondition | '' | undefined): number {
	if (!condition || componentMinutes === 0) return 0;
	const f = model.conditionFactor[condition] ?? 1;
	return componentMinutes * (f - 1);
}

const EXPLANATION_LINES: { key: keyof LaborBreakdown; label: string }[] = [
	{ key: 'exteriorAccess', label: 'exterior access' },
	{ key: 'interiorAccess', label: 'interior access' },
	{ key: 'condition', label: 'component condition' },
	{ key: 'screens', label: 'screens' },
	{ key: 'tracks', label: 'tracks' },
	{ key: 'exteriorFrames', label: 'frames and sills' },
	{ key: 'restoration', label: 'restoration work' },
	{ key: 'propertyModifiers', label: 'property-level modifiers' },
];

/**
 * A sentence naming what actually drove this estimate, so the review page can
 * answer "why is this ten hours" without the reader decoding a table. Names
 * the three largest non-glass contributors — glass is always the biggest line
 * and saying so explains nothing.
 */
function explain(
	breakdown: LaborBreakdown,
	totals: CountTotals,
	conditions: ComponentConditions,
	hazardousAccess: string[]
): string {
	const parts: string[] = [];

	const drivers = EXPLANATION_LINES.filter((line) => breakdown[line.key] > 0)
		.sort((a, b) => breakdown[b.key] - breakdown[a.key])
		.slice(0, 3)
		.map((line) => `${line.label} (${(breakdown[line.key] / 60).toFixed(1)} h)`);

	if (hazardousAccess.length > 0) {
		parts.push(`${hazardousAccess.join(' and ').toLowerCase()} on part of the property`);
	}

	const heavy = Object.entries(conditions)
		.filter(([, value]) => value === 'Heavy Buildup')
		.map(([key]) => CONDITION_LABELS[key as keyof ComponentConditions]);
	if (heavy.length > 0) parts.push(`heavy buildup on ${heavy.join(' and ')}`);

	if (totals.screens >= 20) parts.push(`${Math.round(totals.screens)} screens`);

	const lead = parts.length > 0 ? `${capitalize(parts.join(', '))}. ` : '';
	if (drivers.length === 0) return `${lead}Glass cleaning accounts for the whole estimate.`;
	return `${lead}Largest contributors beyond the glass itself: ${drivers.join(', ')}.`;
}

const CONDITION_LABELS: Record<keyof ComponentConditions, string> = {
	interiorGlass: 'interior glass',
	track: 'tracks',
	exteriorGlass: 'exterior glass',
	exteriorFrame: 'frames',
	screen: 'screens',
};

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
