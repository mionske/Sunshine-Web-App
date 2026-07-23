import { describe, expect, it } from 'vitest';
import { calculateEstimate, calculateQuote } from './engine';
import type { PricingConfig } from '../models/pricingConfig';
import type { Service } from '../models/service';
import type { QuoteCounts, QuoteInput } from './types';

function config(overrides: Partial<PricingConfig> = {}): PricingConfig {
	return {
		'Pricing Config ID': 'pc-1',
		'Config Name': 'Test config',
		'Effective Date': '2026-01-01',
		'End Date': '',
		Status: 'Active',
		'Calculator Version': '1',
		'Target Hourly Rate': '150',
		'Minimum Job Price': '150',
		'Exterior Labor Weight': '',
		'Interior Labor Weight': '',
		'Screen Unit Price': '4',
		'Track Unit Price': '1',
		'Deep Track Unit Price': '2',
		'Skylight Unit Price': '20',
		'Sliding Door Unit Price': '15',
		'French Pane Unit Price': '18',
		'Oversized Glass Unit Price': '20',
		'Second Story Factor': '0.1',
		'Third Story Factor': '0.2',
		'Moderate Condition Factor': '0.15',
		'Heavy Condition Factor': '0.3',
		'First-Time Cleaning Factor': '0.25',
		'Hard Water Minimum': '30',
		'Construction Debris Minimum': '50',
		'Access Surcharge Minimum': '25',
		'Estimate Low Variance': '0.15',
		'Estimate High Variance': '0.2',
		'Created At': '',
		'Updated At': '',
		'Archived At': '',
		Notes: '',
		...overrides,
	};
}

function service(overrides: Partial<Service>): Service {
	return {
		'Service Code': '',
		'Service Name': '',
		'Service Category': '',
		'Default Unit': 'unit',
		'Default Labor Minutes': '0',
		'Pricing Method': 'LABOR_HOURS',
		'Publicly Available': 'Y',
		'Internally Available': 'Y',
		Active: 'Y',
		'Sort Order': '0',
		'Created At': '',
		'Updated At': '',
		'Archived At': '',
		Notes: '',
		...overrides,
	};
}

const SERVICES: Service[] = [
	service({ 'Service Code': 'WINDOW_EXT_STANDARD', 'Default Labor Minutes': '2.5', 'Pricing Method': 'LABOR_HOURS' }),
	service({ 'Service Code': 'WINDOW_INT_STANDARD', 'Default Labor Minutes': '2.5', 'Pricing Method': 'LABOR_HOURS' }),
	service({ 'Service Code': 'WINDOW_EXT_OVERSIZED', 'Default Labor Minutes': '5', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'WINDOW_INT_OVERSIZED', 'Default Labor Minutes': '5', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'WINDOW_EXT_FRENCH_PANE', 'Default Labor Minutes': '5', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'WINDOW_INT_FRENCH_PANE', 'Default Labor Minutes': '5', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'SLIDING_DOOR_EXT', 'Default Labor Minutes': '8', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'SLIDING_DOOR_INT', 'Default Labor Minutes': '8', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'SCREEN_CLEAN', 'Default Labor Minutes': '1', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'TRACK_BASIC', 'Default Labor Minutes': '0.5', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'TRACK_DEEP', 'Default Labor Minutes': '1', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'SKYLIGHT_EXT', 'Default Labor Minutes': '8', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
	service({ 'Service Code': 'SKYLIGHT_INT', 'Default Labor Minutes': '8', 'Pricing Method': 'FLAT_UNIT_PRICE' }),
];

const ZERO_COUNTS: QuoteCounts = {
	windowExtStandard: 0,
	windowIntStandard: 0,
	windowExtOversized: 0,
	windowIntOversized: 0,
	windowExtFrenchPane: 0,
	windowIntFrenchPane: 0,
	slidingDoorExt: 0,
	slidingDoorInt: 0,
	screenClean: 0,
	trackBasic: 0,
	trackDeep: 0,
	skylightExt: 0,
	skylightInt: 0,
};

function baseInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
	return {
		stories: 1,
		condition: 'light',
		counts: { ...ZERO_COUNTS },
		hardWater: false,
		constructionDebris: false,
		difficultAccess: false,
		...overrides,
	};
}

describe('calculateQuote', () => {
	it('prices standard windows at estimated labor hours × target hourly rate', () => {
		// 20 ext + 20 int standard windows @ 2.5 min each = 100 min = 1.6667hr
		const result = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 20, windowIntStandard: 20 },
		}));
		expect(result.estimatedLaborHours).toBeCloseTo(100 / 60, 5);
		expect(result.calculatedBaseAmount).toBeCloseTo((100 / 60) * 150, 5);
		expect(result.calculatedAddOns).toBe(0);
	});

	it('prices flat-unit add-ons from PricingConfig, not from labor time', () => {
		const result = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 20, screenClean: 6, trackBasic: 6 },
		}));
		// 6 screens @ $4 + 6 tracks @ $1 = $30
		expect(result.calculatedAddOns).toBeCloseTo(30, 5);
		// but labor time still counts screens/tracks toward estimated hours
		const standardMinutes = 20 * 2.5;
		const screenMinutes = 6 * 1;
		const trackMinutes = 6 * 0.5;
		expect(result.estimatedLaborHours).toBeCloseTo((standardMinutes + screenMinutes + trackMinutes) / 60, 5);
	});

	it('applies the second-story factor as a percentage of the base amount', () => {
		const oneStory = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 40 },
			stories: 1,
		}));
		const twoStory = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 40 },
			stories: 2,
		}));
		expect(twoStory.calculatedSurcharges).toBeCloseTo(oneStory.calculatedBaseAmount * 0.1, 5);
	});

	it('applies condition factors as a percentage of the base amount', () => {
		const light = calculateQuote(config(), SERVICES, baseInput({ counts: { ...ZERO_COUNTS, windowExtStandard: 40 } }));
		const heavy = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 40 },
			condition: 'heavy',
		}));
		expect(heavy.calculatedSurcharges).toBeCloseTo(light.calculatedBaseAmount * 0.3, 5);
	});

	it('charges at least the configured minimum for hard water/debris/access', () => {
		const result = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 4 }, // tiny job
			hardWater: true,
			constructionDebris: true,
			difficultAccess: true,
		}));
		expect(result.calculatedSurcharges).toBeCloseTo(30 + 50 + 25, 5);
	});

	it('enforces the minimum job price and records the adjustment line item', () => {
		const result = calculateQuote(config({ 'Minimum Job Price': '150' }), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 2 }, // trivially small job
		}));
		expect(result.minimumJobPriceApplied).toBe(true);
		expect(result.finalQuotedPrice).toBe(150);
		expect(result.lineItems.some((i) => i.serviceCode === 'MINIMUM_JOB_ADJUSTMENT')).toBe(true);
	});

	it('does not apply the minimum when the calculated price already exceeds it', () => {
		const result = calculateQuote(config({ 'Minimum Job Price': '150' }), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 100, windowIntStandard: 100 },
		}));
		expect(result.minimumJobPriceApplied).toBe(false);
	});

	it('applies manual adjustments and discounts on top of the calculated price', () => {
		const result = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 40, windowIntStandard: 40 },
			manualAdjustment: 20,
			discount: 10,
			overrideReason: 'Loyal customer',
		}));
		const withoutAdjustments = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 40, windowIntStandard: 40 },
		}));
		expect(result.finalQuotedPrice).toBe(withoutAdjustments.finalQuotedPrice + 20 - 10);
		expect(result.lineItems.find((i) => i.serviceCode === 'MANUAL_ADJUSTMENT')?.description).toBe('Loyal customer');
	});

	it('rounds the final price to the nearest $5', () => {
		const result = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 33 },
		}));
		expect(result.finalQuotedPrice % 5).toBe(0);
	});

	it('is deterministic — identical input and config always produce the identical result', () => {
		const input = baseInput({ counts: { ...ZERO_COUNTS, windowExtStandard: 17, screenClean: 3 }, stories: 2 });
		const a = calculateQuote(config(), SERVICES, input);
		const b = calculateQuote(config(), SERVICES, input);
		expect(a).toEqual(b);
	});

	it('computes expected revenue per labor hour from the final price and estimated hours', () => {
		const result = calculateQuote(config(), SERVICES, baseInput({
			counts: { ...ZERO_COUNTS, windowExtStandard: 40, windowIntStandard: 40 },
		}));
		expect(result.expectedRevenuePerLaborHour).toBeCloseTo(
			result.finalQuotedPrice / result.estimatedLaborHours,
			5
		);
	});
});

describe('calculateEstimate', () => {
	it('returns a low/high range around the target price', () => {
		const result = calculateEstimate(config(), { approxWindowCount: 20, stories: 1 });
		expect(result.low).toBeLessThan(result.high);
		expect(result.low).toBeGreaterThan(0);
	});

	it('applies the minimum job price and flags it when the ballpark is below it', () => {
		const result = calculateEstimate(config({ 'Minimum Job Price': '500' }), { approxWindowCount: 2, stories: 1 });
		expect(result.minimumApplied).toBe(true);
	});

	it('produces a wider range for a 2-story property than 1-story, same window count', () => {
		const oneStory = calculateEstimate(config(), { approxWindowCount: 20, stories: 1 });
		const twoStory = calculateEstimate(config(), { approxWindowCount: 20, stories: 2 });
		expect(twoStory.low).toBeGreaterThan(oneStory.low);
	});
});
