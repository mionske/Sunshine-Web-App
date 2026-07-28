import { describe, expect, it } from 'vitest';
import { resolveLaborModel, type LaborModel } from './config';
import { estimateLabor, type LaborEstimateInput, type LaborScope, type WindowGroup } from './estimate';
import { suggestSchedule } from './schedule';
import { describeOwnerPrice, suggestPriceBand } from './price';
import { SEED_LABOR_CONFIG, SEED_WINDOW_PRODUCTION_PROFILES } from './seed';
import type { LaborConfig } from '../models/laborConfig';
import type { WindowProductionProfile } from '../models/windowProductionProfile';
import type { PricingConfig } from '../models/pricingConfig';

// Tests run against the ACTUAL seeded configuration, not invented numbers.
// The point of the labor model is that the values live in configuration, so a
// test suite with its own private constants would prove the arithmetic while
// saying nothing about whether the shipped model produces sane estimates.
const TIMESTAMPS = { 'Created At': '', 'Updated At': '', 'Archived At': '' };

const MODEL: LaborModel = resolveLaborModel(
	{ ...SEED_LABOR_CONFIG, ...TIMESTAMPS } as LaborConfig,
	SEED_WINDOW_PRODUCTION_PROFILES.map((p) => ({ ...p, ...TIMESTAMPS })) as WindowProductionProfile[]
);

const BOTH_SIDES: LaborScope = { interior: true, exterior: true, screens: true, tracks: true, frames: true };

function group(overrides: Partial<WindowGroup> = {}): WindowGroup {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		quantity: 1,
		productionClass: 'Standard Window',
		story: 'First',
		interiorAccess: 'Floor Level',
		exteriorAccess: 'Ground-Level Traditional',
		...overrides,
	};
}

function estimate(input: Partial<LaborEstimateInput> & { groups: WindowGroup[] }) {
	return estimateLabor(MODEL, { scope: BOTH_SIDES, ...input });
}

/** Overhead is scope-dependent and present on every estimate; subtracting it
 * isolates the part a scenario is actually about. */
function workMinutes(result: ReturnType<typeof estimate>): number {
	return result.productiveMinutes - result.breakdown.fixedOverhead;
}

describe('window type, size and access drive labor', () => {
	it('1. a first-floor picture window with easy access is quick', () => {
		const result = estimate({
			groups: [group({ productionClass: 'Large Picture Window' })],
			scope: { interior: false, exterior: true, screens: false, tracks: false, frames: false },
		});
		// Exterior glass only, ground access, no screen or track on this class.
		expect(result.breakdown.exteriorGlass).toBe(6);
		expect(result.breakdown.exteriorAccess).toBe(0);
		expect(workMinutes(result)).toBe(6);
	});

	it('2. the same window on the third floor with extended WFP takes materially longer', () => {
		const easy = estimate({
			groups: [group({ productionClass: 'Large Picture Window' })],
			scope: { interior: false, exterior: true, screens: false, tracks: false, frames: false },
		});
		const hard = estimate({
			groups: [group({ productionClass: 'Large Picture Window', story: 'Third', exteriorAccess: 'Extended WFP' })],
			scope: { interior: false, exterior: true, screens: false, tracks: false, frames: false },
		});
		expect(workMinutes(hard)).toBeGreaterThan(workMinutes(easy));
		expect(hard.breakdown.exteriorAccess).toBe(2);
		expect(hard.breakdown.storyLogistics).toBe(6);
	});

	it('3. difficult ladder positioning costs substantially more than extended WFP', () => {
		const wfp = estimate({
			groups: [group({ quantity: 10, story: 'Third', exteriorAccess: 'Extended WFP' })],
			scope: { interior: false, exterior: true, screens: false, tracks: false, frames: false },
		});
		const ladder = estimate({
			groups: [group({ quantity: 10, story: 'Third', exteriorAccess: 'Difficult Ladder Positioning' })],
			scope: { interior: false, exterior: true, screens: false, tracks: false, frames: false },
		});
		expect(ladder.breakdown.exteriorAccess).toBe(50);
		expect(wfp.breakdown.exteriorAccess).toBe(20);
		expect(ladder.breakdown.exteriorAccess).toBeGreaterThan(wfp.breakdown.exteriorAccess * 2);
	});

	it('19. dangerous exterior access materially increases labor and is flagged', () => {
		const safe = estimate({
			groups: [group({ quantity: 12, exteriorAccess: 'Standard WFP' })],
			scope: { interior: false, exterior: true, screens: false, tracks: false, frames: false },
		});
		const dangerous = estimate({
			groups: [group({ quantity: 12, exteriorAccess: 'Roof Access' })],
			scope: { interior: false, exterior: true, screens: false, tracks: false, frames: false },
		});
		expect(workMinutes(dangerous) - workMinutes(safe)).toBe(12 * (6 - 0.5));
		expect(dangerous.hazardousAccess).toEqual(['Roof Access']);
		expect(safe.hazardousAccess).toEqual([]);
	});

	it('20. the third story alone does not double-charge access', () => {
		// Same easy access, only the story differs. Story is a per-group
		// logistics cost, so it must not scale with unit count — otherwise
		// height would be charged twice, once here and once through access.
		const first = estimate({ groups: [group({ quantity: 20, story: 'First' })] });
		const third = estimate({ groups: [group({ quantity: 20, story: 'Third' })] });

		expect(third.breakdown.storyLogistics - first.breakdown.storyLogistics).toBe(6);
		expect(third.breakdown.exteriorAccess).toBe(first.breakdown.exteriorAccess);
		expect(workMinutes(third) - workMinutes(first)).toBe(6);
	});

	it('4. a casement with screen removal costs handling plus cleaning', () => {
		const withScreens = estimate({ groups: [group({ quantity: 4 })] });
		const withoutScreens = estimate({
			groups: [group({ quantity: 4 })],
			scope: { ...BOTH_SIDES, screens: false },
		});
		expect(withScreens.breakdown.screens).toBe(4 * 1.5);
		expect(withoutScreens.breakdown.screens).toBe(0);
		expect(withScreens.totals.screens).toBe(4);
	});

	it('14. mixed classes and access levels each contribute their own labor', () => {
		const result = estimate({
			groups: [
				group({ quantity: 10 }),
				group({ productionClass: 'French Panes', quantity: 2, story: 'Second', exteriorAccess: 'Extended WFP' }),
				group({ productionClass: 'Sliding Door', quantity: 1 }),
				group({ productionClass: 'Skylight', quantity: 3, exteriorAccess: 'Roof Access', interiorAccess: 'Vaulted or Obstructed' }),
			],
		});
		expect(result.totals.windowUnits).toBe(16);
		// French units count 6 panes each by default; sliding doors 2.
		expect(result.totals.glassPanes).toBe(10 + 12 + 2 + 3);
		// Skylights and picture glass carry no screen; the rest do.
		expect(result.totals.screens).toBe(10 + 2 + 1);
		expect(result.hazardousAccess.sort()).toEqual(['Roof Access', 'Vaulted or Obstructed']);
	});

	it('size class scales glass and frames but never screens or tracks', () => {
		const standard = estimate({ groups: [group({ quantity: 5 })] });
		const oversized = estimate({ groups: [group({ quantity: 5, sizeClass: 'Oversized' })] });

		expect(oversized.breakdown.exteriorGlass).toBeCloseTo(standard.breakdown.exteriorGlass * 1.75, 6);
		expect(oversized.breakdown.exteriorFrames).toBeCloseTo(standard.breakdown.exteriorFrames * 1.75, 6);
		// A bigger opening does not make its screen or its track bigger.
		expect(oversized.breakdown.screens).toBe(standard.breakdown.screens);
		expect(oversized.breakdown.tracks).toBe(standard.breakdown.tracks);
	});

	it('pane count scales glass relative to what is typical for the class', () => {
		const typical = estimate({ groups: [group({ productionClass: 'French Panes', quantity: 1 })] });
		const doubled = estimate({ groups: [group({ productionClass: 'French Panes', quantity: 1, panesPerUnit: 12 })] });

		expect(doubled.breakdown.exteriorGlass).toBeCloseTo(typical.breakdown.exteriorGlass * 2, 6);
		expect(doubled.totals.glassPanes).toBe(12);
	});
});

describe('component conditions only inflate their own component', () => {
	it('5. moderate exterior glass and frames raise exterior work only', () => {
		const maintenance = estimate({ groups: [group({ quantity: 10 })] });
		const moderate = estimate({
			groups: [group({ quantity: 10 })],
			conditions: { exteriorGlass: 'Moderate Buildup', exteriorFrame: 'Moderate Buildup' },
		});

		const expected = (maintenance.breakdown.exteriorGlass + maintenance.breakdown.exteriorFrames) * 0.35;
		expect(moderate.breakdown.condition).toBeCloseTo(expected, 6);
		// The component lines themselves stay at base, so the breakdown still
		// sums to the total and the condition cost is visible on its own line.
		expect(moderate.breakdown.exteriorGlass).toBe(maintenance.breakdown.exteriorGlass);
		expect(moderate.breakdown.interiorGlass).toBe(maintenance.breakdown.interiorGlass);
	});

	it('6. heavy tracks cost more without touching glass labor', () => {
		const base = estimate({ groups: [group({ quantity: 8 })] });
		const heavyTracks = estimate({
			groups: [group({ quantity: 8 })],
			conditions: { track: 'Heavy Buildup' },
		});

		expect(heavyTracks.breakdown.condition).toBeCloseTo(base.breakdown.tracks * 0.75, 6);
		expect(heavyTracks.breakdown.exteriorGlass).toBe(base.breakdown.exteriorGlass);
		expect(heavyTracks.breakdown.interiorGlass).toBe(base.breakdown.interiorGlass);
	});

	it('interior condition never inflates exterior labor', () => {
		const exteriorOnly: LaborScope = { interior: false, exterior: true, screens: false, tracks: false, frames: true };
		const plain = estimate({ groups: [group({ quantity: 10 })], scope: exteriorOnly });
		const dirtyInside = estimate({
			groups: [group({ quantity: 10 })],
			scope: exteriorOnly,
			conditions: { interiorGlass: 'Heavy Buildup', track: 'Heavy Buildup' },
		});
		expect(dirtyInside.productiveMinutes).toBe(plain.productiveMinutes);
	});

	it('a condition on an out-of-scope component costs nothing', () => {
		const noScreens: LaborScope = { ...BOTH_SIDES, screens: false };
		const withRating = estimate({
			groups: [group({ quantity: 6 })],
			scope: noScreens,
			conditions: { screen: 'Heavy Buildup' },
		});
		expect(withRating.breakdown.condition).toBe(0);
	});
});

describe('scope', () => {
	it('7. an exterior-only job charges no interior work or interior setup', () => {
		const result = estimate({
			groups: [group({ quantity: 12, interiorAccess: 'Extension Ladder' })],
			scope: { interior: false, exterior: true, screens: true, tracks: false, frames: true },
		});
		expect(result.breakdown.interiorGlass).toBe(0);
		expect(result.breakdown.interiorAccess).toBe(0);
		expect(result.breakdown.fixedOverhead).toBe(10 + 10 + 15 + 10 + 15); // no interior setup
	});

	it('8. an interior-only job charges no exterior work, frames included or not', () => {
		const result = estimate({
			groups: [group({ quantity: 12, exteriorAccess: 'Roof Access' })],
			scope: { interior: true, exterior: false, screens: false, tracks: true, frames: true },
		});
		expect(result.breakdown.exteriorGlass).toBe(0);
		expect(result.breakdown.exteriorAccess).toBe(0);
		// Frames and sills are exterior work; the flag alone can't summon them
		// onto an interior visit.
		expect(result.breakdown.exteriorFrames).toBe(0);
		expect(result.breakdown.fixedOverhead).toBe(10 + 10 + 10 + 10 + 15); // no exterior setup
	});

	it('10. a two-day job pays setup and breakdown twice', () => {
		const oneDay = estimate({ groups: [group({ quantity: 40 })] });
		const twoDay = estimate({ groups: [group({ quantity: 40 })], scope: { ...BOTH_SIDES, twoDay: true } });

		expect(twoDay.breakdown.fixedOverhead).toBe(oneDay.breakdown.fixedOverhead * 2);
		expect(workMinutes(twoDay)).toBe(workMinutes(oneDay));
	});
});

describe('restoration and property modifiers', () => {
	it('13. restoration applies only to what it was scoped to, in owner-stated minutes', () => {
		const result = estimate({
			groups: [group({ quantity: 30 })],
			adjustments: [{ kind: 'Restoration', label: 'Razor Scraping', additionalMinutes: 45 }],
		});
		expect(result.breakdown.restoration).toBe(45);
		// Nothing about restoration scales with the 30 units it did not touch.
		const without = estimate({ groups: [group({ quantity: 30 })] });
		expect(result.productiveMinutes - without.productiveMinutes).toBe(45);
	});

	it('separates restoration from property-level modifiers', () => {
		const result = estimate({
			groups: [group()],
			adjustments: [
				{ kind: 'Restoration', label: 'Hard Water or Mineral Deposits', additionalMinutes: 60 },
				{ kind: 'Modifier', label: 'Heavy Cobweb Removal', additionalMinutes: 20 },
				{ kind: 'Modifier', label: 'Long Equipment Carry', additionalMinutes: 15 },
			],
		});
		expect(result.breakdown.restoration).toBe(60);
		expect(result.breakdown.propertyModifiers).toBe(35);
	});
});

describe('totals and manual overrides', () => {
	it('15. a manual screen total wins and scales screen labor with it', () => {
		const grouped = estimate({ groups: [group({ quantity: 20 })] });
		const overridden = estimate({ groups: [group({ quantity: 20 })], manualTotals: { screens: 44 } });

		expect(grouped.totals.screens).toBe(20);
		expect(overridden.totals.screens).toBe(44);
		expect(overridden.totals.screensManual).toBe(true);
		expect(overridden.breakdown.screens).toBeCloseTo((grouped.breakdown.screens / 20) * 44, 6);
	});

	it('15b. a manual screen total still costs labor when no group counted screens', () => {
		// Every group is picture glass, which carries no screen — but the owner
		// says there are 30. Without a fallback the override would be free.
		const result = estimate({
			groups: [group({ productionClass: 'Large Picture Window', quantity: 10 })],
			manualTotals: { screens: 30 },
		});
		expect(result.breakdown.screens).toBe(30 * 1.5);
		expect(result.totals.screensManual).toBe(true);
	});

	it('16. a manual track total behaves the same way', () => {
		const grouped = estimate({ groups: [group({ quantity: 10 })] });
		const overridden = estimate({ groups: [group({ quantity: 10 })], manualTotals: { tracks: 25 } });

		expect(overridden.totals.tracks).toBe(25);
		expect(overridden.totals.tracksManual).toBe(true);
		expect(overridden.breakdown.tracks).toBeCloseTo((grouped.breakdown.tracks / 10) * 25, 6);
	});

	it('a manual total of zero is ignored rather than treated as an override', () => {
		const result = estimate({ groups: [group({ quantity: 10 })], manualTotals: { screens: 0 } });
		expect(result.totals.screens).toBe(10);
		expect(result.totals.screensManual).toBe(false);
	});

	it('17. removing a group recalculates every total', () => {
		const before = estimate({ groups: [group({ quantity: 10 }), group({ productionClass: 'Sliding Door', quantity: 2 })] });
		const after = estimate({ groups: [group({ quantity: 10 })] });

		expect(before.totals.windowUnits).toBe(12);
		expect(after.totals.windowUnits).toBe(10);
		expect(after.totals.glassPanes).toBe(10);
		expect(after.breakdown.tracks).toBeLessThan(before.breakdown.tracks);
	});

	it('18. duplicating a group counts it twice', () => {
		const source = group({ quantity: 6, story: 'Second', exteriorAccess: 'Extended WFP' });
		const one = estimate({ groups: [source] });
		const duplicated = estimate({ groups: [source, { ...source, id: 'copy' }] });

		expect(duplicated.totals.windowUnits).toBe(12);
		// Everything per-unit doubles. Story logistics does not: it is charged
		// once per distinct story, so a second row on the same floor doesn't
		// invent a second trip upstairs.
		expect(workMinutes(duplicated)).toBeCloseTo(workMinutes(one) * 2 - MODEL.storyLogisticsMinutes.Second, 6);
	});

	it('charges story logistics once per story, however many groups sit on it', () => {
		const oneGroup = estimate({ groups: [group({ quantity: 8, story: 'Second' })] });
		const splitInTwo = estimate({
			groups: [group({ quantity: 4, story: 'Second' }), group({ quantity: 4, story: 'Second' })],
		});
		expect(splitInTwo.breakdown.storyLogistics).toBe(oneGroup.breakdown.storyLogistics);
		expect(splitInTwo.productiveMinutes).toBeCloseTo(oneGroup.productiveMinutes, 6);

		const twoStories = estimate({
			groups: [group({ quantity: 4, story: 'Second' }), group({ quantity: 4, story: 'Third' })],
		});
		expect(twoStories.breakdown.storyLogistics).toBe(
			MODEL.storyLogisticsMinutes.Second + MODEL.storyLogisticsMinutes.Third
		);
	});

	it('a group with zero quantity contributes nothing', () => {
		const result = estimate({ groups: [group({ quantity: 10 }), group({ quantity: 0, story: 'Third' })] });
		expect(result.totals.windowUnits).toBe(10);
		expect(result.breakdown.storyLogistics).toBe(0);
	});
});

describe('11. legacy walkthroughs without grouped inventory', () => {
	it('produces overhead only and never throws', () => {
		const result = estimate({ groups: [] });
		expect(result.productiveMinutes).toBe(result.breakdown.fixedOverhead);
		expect(result.totals.windowUnits).toBe(0);
		// Nothing is fabricated — no invented classes, sizes or conditions.
		expect(result.breakdown.exteriorGlass).toBe(0);
		expect(result.hazardousAccess).toEqual([]);
	});
});

describe('productive labor versus scheduled time', () => {
	it('scheduled time adds contingency on top of productive labor', () => {
		const schedule = suggestSchedule(MODEL, 300);
		expect(schedule.productiveMinutes).toBe(300);
		expect(schedule.scheduledMinutes).toBeCloseTo(336, 6);
		expect(schedule.recommendation).toBe('One-Day Job');
	});

	it('recommends a two-day job past the configured threshold', () => {
		const schedule = suggestSchedule(MODEL, 9 * 60);
		expect(schedule.scheduledMinutes / 60).toBeGreaterThanOrEqual(MODEL.twoDayThresholdHours);
		expect(schedule.recommendation).toBe('Two-Day Job');
	});

	it('recommends a crew past the crew threshold', () => {
		expect(suggestSchedule(MODEL, 14 * 60).recommendation).toBe('Crew Recommended');
	});

	it('an owner override replaces scheduled time without touching productive labor', () => {
		const schedule = suggestSchedule(MODEL, 600, { overrideMinutes: 480 });
		expect(schedule.productiveMinutes).toBe(600);
		expect(schedule.scheduledMinutes).toBe(480);
		expect(schedule.recommendation).toBe('One-Day Job');
		expect(schedule.reasons).toContain('Scheduled time was set manually');
	});

	it('surfaces dangerous access as a reason without forcing a split', () => {
		const schedule = suggestSchedule(MODEL, 240, { hazardousAccess: ['Roof Access'] });
		expect(schedule.recommendation).toBe('One-Day Job');
		expect(schedule.reasons.join(' ')).toContain('Roof Access');
	});
});

describe('pricing', () => {
	const PRICING: PricingConfig = {
		'Pricing Config ID': 'pc-1',
		'Low Hourly Production Target': '150',
		'Target Hourly Production Target': '175',
		'High Hourly Production Target': '200',
		'Minimum Job Price': '250',
	} as unknown as PricingConfig;

	it('low, target and high are three different numbers', () => {
		const band = suggestPriceBand(PRICING, 10 * 60);
		expect(band.low).toBe(1500);
		expect(band.target).toBe(1750);
		expect(band.high).toBe(2000);
		expect(band.minimumApplied).toBe(false);
	});

	it('the job minimum lifts the whole band, not just the bottom', () => {
		const band = suggestPriceBand(PRICING, 30);
		expect(band.minimumApplied).toBe(true);
		expect(band.low).toBe(250);
		expect(band.target).toBe(250);
		expect(band.high).toBe(250);
	});

	it('12. an owner price far above target is recorded, not clamped', () => {
		const band = suggestPriceBand(PRICING, 10 * 60);
		const described = describeOwnerPrice(band, 1700);
		expect(described.position).toBe('within band');
		expect(described.effectiveHourlyRate).toBeCloseTo(170, 6);

		const wayAbove = describeOwnerPrice(band, 3200);
		expect(wayAbove.position).toBe('above band');
		expect(wayAbove.differenceFromTarget).toBe(1450);
		// Nothing here caps or rewrites the number.
		expect(wayAbove.effectiveHourlyRate).toBeCloseTo(320, 6);
	});
});

describe('a real three-story property reaches a realistic estimate', () => {
	// A property shaped like 2690 6th Street: three stories, 47 grouped units,
	// 44 screens, some oversized fixed glass, third-floor work split between
	// extended pole reach and genuinely awkward ladder positioning, moderate
	// exterior glass and frames, light interior. Tracks are excluded pending
	// an interior inspection.
	const GROUPS: WindowGroup[] = [
		group({ id: 'g1', quantity: 24, story: 'First' }),
		group({ id: 'g2', quantity: 14, story: 'Second', interiorAccess: 'Step Ladder', exteriorAccess: 'Extended WFP' }),
		group({ id: 'g3', quantity: 4, story: 'Third', interiorAccess: 'Extension Ladder', exteriorAccess: 'Difficult Ladder Positioning' }),
		group({
			id: 'g4',
			productionClass: 'Large Picture Window',
			sizeClass: 'Oversized',
			quantity: 3,
			story: 'Third',
			interiorAccess: 'Vaulted or Obstructed',
			exteriorAccess: 'Extended WFP',
		}),
		group({ id: 'g5', productionClass: 'Sliding Door', quantity: 2, story: 'First' }),
	];

	const SCOPE: LaborScope = { interior: true, exterior: true, screens: true, tracks: false, frames: true };
	const CONDITIONS = {
		interiorGlass: 'Light Buildup' as const,
		exteriorGlass: 'Moderate Buildup' as const,
		exteriorFrame: 'Moderate Buildup' as const,
		screen: 'Light Buildup' as const,
	};

	const result = estimateLabor(MODEL, { groups: GROUPS, scope: SCOPE, conditions: CONDITIONS });
	const schedule = suggestSchedule(MODEL, result.productiveMinutes, { hazardousAccess: result.hazardousAccess });

	it('counts 44 screens across the grouped rows', () => {
		expect(result.totals.windowUnits).toBe(47);
		expect(result.totals.screens).toBe(44);
	});

	it('lands in a realistic full-day-plus range rather than compressing to five hours', () => {
		const scheduledHours = schedule.scheduledMinutes / 60;
		// The requirement is that the model CAN reach the real number when the
		// inventory and access justify it — the failure mode being guarded
		// against is an estimate that collapses toward ~5 hours on unit count
		// alone. The band is deliberately wider than a single expected value,
		// because the seeded minutes are calibration starting points and are
		// expected to move; a test pinned to one figure would just have to be
		// rewritten every time the owner tunes the model.
		expect(scheduledHours).toBeGreaterThanOrEqual(9);
		expect(scheduledHours).toBeLessThanOrEqual(15);
		expect(schedule.recommendation).not.toBe('One-Day Job');
	});

	it('is driven by access and condition, not by unit count alone', () => {
		// Same 47 units, same classes and sizes — but every group at ground
		// level, floor-level interior, and maintenance condition throughout.
		const easyGroups = GROUPS.map((g) => ({
			...g,
			story: 'First' as const,
			interiorAccess: 'Floor Level' as const,
			exteriorAccess: 'Ground-Level Traditional' as const,
		}));
		const easy = estimateLabor(MODEL, { groups: easyGroups, scope: SCOPE });

		expect(result.productiveMinutes).toBeGreaterThan(easy.productiveMinutes);
		// Access, story and condition together account for a substantial share
		// of the difficult version — if this ever collapses, the model has
		// silently gone back to counting windows.
		const difficultyMinutes =
			result.breakdown.interiorAccess +
			result.breakdown.exteriorAccess +
			result.breakdown.storyLogistics +
			result.breakdown.condition;
		expect(difficultyMinutes / result.productiveMinutes).toBeGreaterThan(0.15);
	});

	it('explains itself in plain language', () => {
		expect(result.explanation).toContain('44 screens');
		expect(result.explanation.toLowerCase()).toContain('ladder');
		expect(result.laborModelVersion).toBe('Residential v2');
	});
});
