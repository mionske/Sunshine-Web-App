import { describe, expect, it } from 'vitest';
import { resolveLaborModel, type LaborModel } from './config';
import { SEED_LABOR_CONFIG, SEED_WINDOW_PRODUCTION_PROFILES } from './seed';
import { emptyInventory, type WalkthroughInventory } from './inventory';
import { estimateInventoryLabor, type InventoryLaborInput } from './inventoryEstimate';
import { suggestSchedule } from './schedule';
import type { LaborConfig } from '../models/laborConfig';
import type { WindowProductionProfile } from '../models/windowProductionProfile';
import type { LaborScope } from './estimate';

const TIMESTAMPS = { 'Created At': '', 'Updated At': '', 'Archived At': '' };
const MODEL: LaborModel = resolveLaborModel(
	{ ...SEED_LABOR_CONFIG, ...TIMESTAMPS } as LaborConfig,
	SEED_WINDOW_PRODUCTION_PROFILES.map((p) => ({ ...p, ...TIMESTAMPS })) as WindowProductionProfile[]
);

const EXTERIOR_ONLY: LaborScope = { interior: false, exterior: true, screens: false, tracks: false, frames: false };

function inv(overrides: Partial<WalkthroughInventory> = {}): WalkthroughInventory {
	return { ...emptyInventory(), ...overrides };
}

function estimate(input: Partial<InventoryLaborInput> & { inventory: WalkthroughInventory }) {
	return estimateInventoryLabor(MODEL, { scope: EXTERIOR_ONLY, ...input });
}

describe('1. standard windows use one flat rate on every floor', () => {
	it('charges the same per-unit glass minutes upstairs as down', () => {
		const ground = estimate({ inventory: inv({ standardWindowsByStory: { first: 10, second: 0, third: 0, fourthPlus: 0 } }) });
		const upstairs = estimate({ inventory: inv({ standardWindowsByStory: { first: 0, second: 0, third: 10, fourthPlus: 0 } }) });

		expect(ground.breakdown.exteriorGlass).toBe(upstairs.breakdown.exteriorGlass);
		expect(ground.breakdown.exteriorGlass).toBe(10 * 2.5);
	});

	it('charges Story Logistics once per occupied story, not per window', () => {
		const one = estimate({ inventory: inv({ standardWindowsByStory: { first: 0, second: 4, third: 0, fourthPlus: 0 } }) });
		const many = estimate({ inventory: inv({ standardWindowsByStory: { first: 0, second: 40, third: 0, fourthPlus: 0 } }) });

		expect(one.breakdown.storyLogistics).toBe(MODEL.storyLogisticsMinutes.Second);
		expect(many.breakdown.storyLogistics).toBe(MODEL.storyLogisticsMinutes.Second);
	});

	it('adds a story charge for each distinct occupied floor', () => {
		const result = estimate({ inventory: inv({ standardWindowsByStory: { first: 5, second: 5, third: 5, fourthPlus: 0 } }) });
		expect(result.breakdown.storyLogistics).toBe(
			MODEL.storyLogisticsMinutes.First + MODEL.storyLogisticsMinutes.Second + MODEL.storyLogisticsMinutes.Third
		);
	});

	it('never charges for an unoccupied floor', () => {
		const result = estimate({ inventory: inv({ standardWindowsByStory: { first: 10, second: 0, third: 0, fourthPlus: 0 } }) });
		expect(result.breakdown.storyLogistics).toBe(MODEL.storyLogisticsMinutes.First);
	});
});

describe('2. height is never charged twice', () => {
	it('moving windows upstairs adds only the story charge, nothing per unit', () => {
		const downstairs = estimate({ inventory: inv({ standardWindowsByStory: { first: 20, second: 0, third: 0, fourthPlus: 0 } }) });
		const upstairs = estimate({ inventory: inv({ standardWindowsByStory: { first: 0, second: 0, third: 20, fourthPlus: 0 } }) });

		const difference = upstairs.productiveMinutes - downstairs.productiveMinutes;
		expect(difference).toBe(MODEL.storyLogisticsMinutes.Third - MODEL.storyLogisticsMinutes.First);
	});

	it('does not infer difficult access from being upstairs', () => {
		const upstairs = estimate({ inventory: inv({ standardWindowsByStory: { first: 0, second: 0, third: 20, fourthPlus: 0 } }) });
		expect(upstairs.breakdown.exteriorAccess).toBe(0);
		expect(upstairs.hazardousAccess).toEqual([]);
	});
});

describe('3. property-level access applies independently of Story Logistics', () => {
	it('adds access minutes per unit without touching the story charge', () => {
		const base = estimate({ inventory: inv({ standardWindowsByStory: { first: 0, second: 20, third: 0, fourthPlus: 0 } }) });
		const withAccess = estimate({
			inventory: inv({ standardWindowsByStory: { first: 0, second: 20, third: 0, fourthPlus: 0 } }),
			access: { exterior: 'Extended WFP' },
		});

		expect(withAccess.breakdown.storyLogistics).toBe(base.breakdown.storyLogistics);
		expect(withAccess.breakdown.exteriorAccess).toBe(20 * MODEL.exteriorAccessMinutes['Extended WFP']);
	});

	it('flags genuinely hazardous access, and only that', () => {
		expect(
			estimate({ inventory: inv({ standardWindowsByStory: { first: 5, second: 0, third: 0, fourthPlus: 0 } }), access: { exterior: 'Roof Access' } })
				.hazardousAccess
		).toEqual(['Roof Access']);
		expect(
			estimate({ inventory: inv({ standardWindowsByStory: { first: 5, second: 0, third: 0, fourthPlus: 0 } }), access: { exterior: 'Standard WFP' } })
				.hazardousAccess
		).toEqual([]);
	});

	it('charges interior access only when interior work is in scope', () => {
		const result = estimate({
			inventory: inv({ standardWindowsByStory: { first: 10, second: 0, third: 0, fourthPlus: 0 } }),
			access: { interior: 'Extension Ladder' },
		});
		expect(result.breakdown.interiorAccess).toBe(0);
	});
});

describe('special items', () => {
	it('prices each type from its own profile, never as a standard window', () => {
		const result = estimate({
			inventory: inv({ specialItems: [{ id: 'a', type: 'sliding_glass_door', quantity: 2, story: 'first' }] }),
		});
		expect(result.breakdown.exteriorGlass).toBe(2 * 7);
		expect(result.totals.windowUnits).toBe(2);
	});

	it('prices divided-light quantities per pane, and keeps them out of the unit count', () => {
		const french = MODEL.profiles['French Panes'];
		const result = estimate({
			inventory: inv({ specialItems: [{ id: 'a', type: 'divided_light_panes', quantity: 12, story: 'first' }] }),
		});
		expect(result.breakdown.exteriorGlass).toBeCloseTo((french.exteriorGlassMinutes / french.defaultPaneFactor) * 12, 6);
		expect(result.totals.windowUnits).toBe(0);
	});

	it('applies the size a type implies — an oversized picture costs more than a large one', () => {
		const large = estimate({ inventory: inv({ specialItems: [{ id: 'a', type: 'large_picture', quantity: 1, story: 'first' }] }) });
		const oversized = estimate({ inventory: inv({ specialItems: [{ id: 'a', type: 'oversized_picture', quantity: 1, story: 'first' }] }) });
		expect(oversized.breakdown.exteriorGlass).toBeCloseTo(large.breakdown.exteriorGlass * MODEL.sizeFactor.Oversized, 6);
	});

	it('charges a story for a special item on a real floor, but not for roof or multiple', () => {
		const onSecond = estimate({ inventory: inv({ specialItems: [{ id: 'a', type: 'large_picture', quantity: 1, story: 'second' }] }) });
		const onRoof = estimate({ inventory: inv({ specialItems: [{ id: 'a', type: 'skylight', quantity: 1, story: 'roof' }] }) });

		expect(onSecond.breakdown.storyLogistics).toBe(MODEL.storyLogisticsMinutes.Second);
		// Roof identifies no single floor to charge a trip for; guessing one
		// would invent a journey that may not happen.
		expect(onRoof.breakdown.storyLogistics).toBe(0);
	});
});

describe('accessories are taken as entered', () => {
	it('prices screens and tracks from the direct totals, not from the windows', () => {
		const scope: LaborScope = { interior: false, exterior: true, screens: true, tracks: true, frames: false };
		const result = estimateInventoryLabor(MODEL, {
			scope,
			inventory: inv({ standardWindowsByStory: { first: 4, second: 0, third: 0, fourthPlus: 0 }, screens: 44, tracks: 30 }),
		});
		const standard = MODEL.profiles['Standard Window'];
		expect(result.breakdown.screens).toBeCloseTo((standard.screenHandlingMinutes + standard.screenCleaningMinutes) * 44, 6);
		expect(result.breakdown.tracks).toBeCloseTo(standard.trackMinutes * 30, 6);
	});
});

describe('9. no duplicate charge for relocation or setup', () => {
	it('property modifiers are the only relocation charge, and add on top of story logistics', () => {
		const base = estimate({ inventory: inv({ standardWindowsByStory: { first: 5, second: 5, third: 0, fourthPlus: 0 } }) });
		const withZones = estimate({
			inventory: inv({ standardWindowsByStory: { first: 5, second: 5, third: 0, fourthPlus: 0 } }),
			adjustments: [{ kind: 'Modifier', label: 'Multiple Setup Zones', additionalMinutes: 20 }],
		});

		// Going up and going round are different work, so both are charged —
		// but nothing else in the estimator charges for relocation at all.
		expect(withZones.breakdown.storyLogistics).toBe(base.breakdown.storyLogistics);
		expect(withZones.breakdown.propertyModifiers).toBe(20);
		expect(withZones.productiveMinutes - base.productiveMinutes).toBe(20);
	});

	it('access adds reach time only — it never adds a second round of setup', () => {
		const base = estimate({ inventory: inv({ standardWindowsByStory: { first: 10, second: 0, third: 0, fourthPlus: 0 } }) });
		const withAccess = estimate({
			inventory: inv({ standardWindowsByStory: { first: 10, second: 0, third: 0, fourthPlus: 0 } }),
			access: { exterior: 'Difficult Ladder Positioning' },
		});
		expect(withAccess.breakdown.fixedOverhead).toBe(base.breakdown.fixedOverhead);
	});

	it('overhead is charged once a day, twice only for a two-day job', () => {
		const oneDay = estimate({ inventory: inv({ standardWindowsByStory: { first: 30, second: 0, third: 0, fourthPlus: 0 } }) });
		const twoDay = estimate({
			inventory: inv({ standardWindowsByStory: { first: 30, second: 0, third: 0, fourthPlus: 0 } }),
			scope: { ...EXTERIOR_ONLY, twoDay: true },
		});
		expect(twoDay.breakdown.fixedOverhead).toBe(oneDay.breakdown.fixedOverhead * 2);
	});
});

describe('10. 2690 6th Street regression', () => {
	// The same property recorded the new way: 44 standard units across three
	// floors, three oversized picture windows, two patio doors, 77 panes,
	// 44 screens. Interior and exterior, frames included, tracks not.
	const SCOPE: LaborScope = { interior: true, exterior: true, screens: true, tracks: false, frames: true };
	const INVENTORY = inv({
		standardWindowsByStory: { first: 24, second: 14, third: 6, fourthPlus: 0 },
		specialItems: [
			{ id: 'a', type: 'oversized_picture', quantity: 3, story: 'third' },
			{ id: 'b', type: 'sliding_glass_door', quantity: 2, story: 'first' },
		],
		totalGlassPanes: 77,
		screens: 44,
	});

	const result = estimateInventoryLabor(MODEL, {
		inventory: INVENTORY,
		scope: SCOPE,
		conditions: {
			interiorGlass: 'Light Buildup',
			exteriorGlass: 'Moderate Buildup',
			exteriorFrame: 'Moderate Buildup',
			screen: 'Light Buildup',
		},
		access: { interior: 'Step Ladder', exterior: 'Extended WFP' },
	});

	it('counts the property correctly', () => {
		expect(result.totals.windowUnits).toBe(49);
		expect(result.totals.glassPanes).toBe(77);
		expect(result.totals.screens).toBe(44);
	});

	it('lands in a realistic range for a full-day-plus job', () => {
		const hours = result.productiveMinutes / 60;
		// Calibration reference from the field: about ten working hours, likely
		// split over two days. Kept as a band rather than a target — the
		// seeded minutes are starting values and are expected to move.
		expect(hours).toBeGreaterThanOrEqual(8);
		expect(hours).toBeLessThanOrEqual(13);
	});

	it('still recommends more than a single day', () => {
		const schedule = suggestSchedule(MODEL, result.productiveMinutes, { hazardousAccess: result.hazardousAccess });
		expect(schedule.scheduledMinutes / 60).toBeGreaterThan(MODEL.twoDayThresholdHours);
	});
});
