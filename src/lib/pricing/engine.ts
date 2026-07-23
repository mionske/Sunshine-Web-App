// The shared pricing engine. Pure functions only — no Sheets I/O here, so
// this is trivially unit-testable. Both the in-field quoter and the public
// ballpark estimator call into this same module (see quotes.ts/estimate.ts
// for the orchestration layer that loads PricingConfig/Services and calls
// through to these functions) — one calculation path, never two.
import type { PricingConfig } from '../models/pricingConfig';
import type { Service } from '../models/service';
import type { CalculatedLineItem, Condition, EstimateRange, QuoteCounts, QuoteInput, QuoteCalculationResult } from './types';

const ROUNDING_STEP = 5;
export const CALCULATOR_VERSION = '1';
const CURRENCY = 'USD';
const ROUNDING_POLICY = `NEAREST_${ROUNDING_STEP}`;

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function round(amount: number): number {
	return Math.round(amount / ROUNDING_STEP) * ROUNDING_STEP;
}

function serviceMap(services: Service[]): Map<string, Service> {
	return new Map(services.map((s) => [s['Service Code'], s]));
}

/** Maps a QuoteCounts key to its Service Code and the PricingConfig column
 * that holds its flat unit price (undefined for the two labor-hour-priced
 * standard window services, which have no flat per-unit price). */
const COUNT_FIELDS: {
	key: keyof QuoteCounts;
	serviceCode: string;
	configColumn?: keyof PricingConfig;
}[] = [
	{ key: 'windowExtStandard', serviceCode: 'WINDOW_EXT_STANDARD' },
	{ key: 'windowIntStandard', serviceCode: 'WINDOW_INT_STANDARD' },
	{ key: 'windowExtOversized', serviceCode: 'WINDOW_EXT_OVERSIZED', configColumn: 'Oversized Glass Unit Price' },
	{ key: 'windowIntOversized', serviceCode: 'WINDOW_INT_OVERSIZED', configColumn: 'Oversized Glass Unit Price' },
	{ key: 'windowExtFrenchPane', serviceCode: 'WINDOW_EXT_FRENCH_PANE', configColumn: 'French Pane Unit Price' },
	{ key: 'windowIntFrenchPane', serviceCode: 'WINDOW_INT_FRENCH_PANE', configColumn: 'French Pane Unit Price' },
	{ key: 'slidingDoorExt', serviceCode: 'SLIDING_DOOR_EXT', configColumn: 'Sliding Door Unit Price' },
	{ key: 'slidingDoorInt', serviceCode: 'SLIDING_DOOR_INT', configColumn: 'Sliding Door Unit Price' },
	{ key: 'screenClean', serviceCode: 'SCREEN_CLEAN', configColumn: 'Screen Unit Price' },
	{ key: 'trackBasic', serviceCode: 'TRACK_BASIC', configColumn: 'Track Unit Price' },
	{ key: 'trackDeep', serviceCode: 'TRACK_DEEP', configColumn: 'Deep Track Unit Price' },
	{ key: 'skylightExt', serviceCode: 'SKYLIGHT_EXT', configColumn: 'Skylight Unit Price' },
	{ key: 'skylightInt', serviceCode: 'SKYLIGHT_INT', configColumn: 'Skylight Unit Price' },
];

function conditionFactor(config: PricingConfig, condition: Condition): { code: string; factor: number } | null {
	switch (condition) {
		case 'moderate':
			return { code: 'Moderate Condition Factor', factor: num(config['Moderate Condition Factor']) };
		case 'heavy':
			return { code: 'Heavy Condition Factor', factor: num(config['Heavy Condition Factor']) };
		case 'firstTime':
			return { code: 'First-Time Cleaning Factor', factor: num(config['First-Time Cleaning Factor']) };
		case 'light':
		default:
			return null;
	}
}

export function calculateQuote(
	config: PricingConfig,
	services: Service[],
	input: QuoteInput
): QuoteCalculationResult {
	const svc = serviceMap(services);
	const targetHourlyRate = num(config['Target Hourly Rate']);
	const lineItems: CalculatedLineItem[] = [];

	let calculatedBaseAmount = 0;
	let calculatedAddOns = 0;
	let totalLaborMinutes = 0;

	for (const field of COUNT_FIELDS) {
		const quantity = input.counts[field.key];
		if (!quantity) continue;
		const service = svc.get(field.serviceCode);
		const laborMinutesPerUnit = service ? num(service['Default Labor Minutes']) : 0;
		const estimatedLaborMinutes = laborMinutesPerUnit * quantity;
		totalLaborMinutes += estimatedLaborMinutes;

		if (field.configColumn) {
			// Flat unit-priced add-on — priced from PricingConfig, not from labor time.
			const unitPrice = num(config[field.configColumn]);
			const lineTotal = unitPrice * quantity;
			calculatedAddOns += lineTotal;
			lineItems.push({
				serviceCode: field.serviceCode,
				description: service?.['Service Name'] ?? field.serviceCode,
				quantity,
				unit: service?.['Default Unit'] ?? 'unit',
				unitPrice,
				estimatedLaborMinutes,
				lineTotal,
			});
		} else {
			// Labor-hour-priced (the standard window services) — priced from
			// time × target rate, which is exactly what sums to the base amount.
			const lineTotal = (estimatedLaborMinutes / 60) * targetHourlyRate;
			calculatedBaseAmount += lineTotal;
			lineItems.push({
				serviceCode: field.serviceCode,
				description: service?.['Service Name'] ?? field.serviceCode,
				quantity,
				unit: service?.['Default Unit'] ?? 'unit',
				unitPrice: quantity > 0 ? lineTotal / quantity : 0,
				estimatedLaborMinutes,
				lineTotal,
			});
		}
	}

	let calculatedSurcharges = 0;

	const storyFactor = input.stories === 2
		? num(config['Second Story Factor'])
		: input.stories === 3
			? num(config['Third Story Factor'])
			: 0;
	if (storyFactor) {
		const amount = calculatedBaseAmount * storyFactor;
		calculatedSurcharges += amount;
		lineItems.push({
			serviceCode: 'ACCESS_SURCHARGE',
			description: `${input.stories}-story access factor`,
			quantity: 1,
			unit: 'job',
			unitPrice: amount,
			estimatedLaborMinutes: 0,
			lineTotal: amount,
		});
	}

	const cond = conditionFactor(config, input.condition);
	if (cond && cond.factor) {
		const amount = calculatedBaseAmount * cond.factor;
		calculatedSurcharges += amount;
		lineItems.push({
			serviceCode: 'FIRST_TIME_CLEAN',
			description: cond.code,
			quantity: 1,
			unit: 'job',
			unitPrice: amount,
			estimatedLaborMinutes: 0,
			lineTotal: amount,
		});
	}

	if (input.hardWater) {
		const minimum = num(config['Hard Water Minimum']);
		calculatedSurcharges += minimum;
		lineItems.push({
			serviceCode: 'HARD_WATER_REMOVAL',
			description: 'Hard water mineral removal',
			quantity: 1,
			unit: 'job',
			unitPrice: minimum,
			estimatedLaborMinutes: 0,
			lineTotal: minimum,
		});
	}

	if (input.constructionDebris) {
		const minimum = num(config['Construction Debris Minimum']);
		calculatedSurcharges += minimum;
		lineItems.push({
			serviceCode: 'CONSTRUCTION_DEBRIS',
			description: 'Construction debris cleanup',
			quantity: 1,
			unit: 'job',
			unitPrice: minimum,
			estimatedLaborMinutes: 0,
			lineTotal: minimum,
		});
	}

	if (input.difficultAccess) {
		const minimum = num(config['Access Surcharge Minimum']);
		calculatedSurcharges += minimum;
		lineItems.push({
			serviceCode: 'ACCESS_SURCHARGE',
			description: 'Difficult access surcharge',
			quantity: 1,
			unit: 'job',
			unitPrice: minimum,
			estimatedLaborMinutes: 0,
			lineTotal: minimum,
		});
	}

	const targetPriceBeforeAdjustments = calculatedBaseAmount + calculatedAddOns + calculatedSurcharges;

	const minimumJobPrice = num(config['Minimum Job Price']);
	let priceAfterMinimum = targetPriceBeforeAdjustments;
	let minimumJobPriceApplied = false;
	if (minimumJobPrice > 0 && targetPriceBeforeAdjustments < minimumJobPrice) {
		const delta = minimumJobPrice - targetPriceBeforeAdjustments;
		priceAfterMinimum = minimumJobPrice;
		minimumJobPriceApplied = true;
		lineItems.push({
			serviceCode: 'MINIMUM_JOB_ADJUSTMENT',
			description: 'Minimum job price adjustment',
			quantity: 1,
			unit: 'job',
			unitPrice: delta,
			estimatedLaborMinutes: 0,
			lineTotal: delta,
		});
	}

	const manualAdjustment = input.manualAdjustment ?? 0;
	if (manualAdjustment) {
		lineItems.push({
			serviceCode: 'MANUAL_ADJUSTMENT',
			description: input.overrideReason ?? 'Manual adjustment',
			quantity: 1,
			unit: 'job',
			unitPrice: manualAdjustment,
			estimatedLaborMinutes: 0,
			lineTotal: manualAdjustment,
		});
	}

	const discount = input.discount ?? 0;
	if (discount) {
		lineItems.push({
			serviceCode: 'DISCOUNT',
			description: 'Discount',
			quantity: 1,
			unit: 'job',
			unitPrice: -discount,
			estimatedLaborMinutes: 0,
			lineTotal: -discount,
		});
	}

	const finalQuotedPrice = round(priceAfterMinimum + manualAdjustment - discount);
	const estimatedLaborHours = totalLaborMinutes / 60;
	const expectedRevenuePerLaborHour = estimatedLaborHours > 0 ? finalQuotedPrice / estimatedLaborHours : 0;

	return {
		lineItems,
		estimatedLaborHours,
		targetHourlyRate,
		calculatedBaseAmount,
		calculatedAddOns,
		calculatedSurcharges,
		targetPriceBeforeAdjustments,
		minimumJobPriceApplied,
		manualAdjustment,
		discount,
		finalQuotedPrice,
		expectedRevenuePerLaborHour,
		pricingConfigId: config['Pricing Config ID'],
		calculatorVersion: CALCULATOR_VERSION,
		roundingPolicy: ROUNDING_POLICY,
		currency: CURRENCY,
	};
}

/**
 * Ballpark estimate for the public estimator: a rough window count in, a
 * price range out. Uses a flat minutes-per-window placeholder until Phase 9
 * calibration exists to inform it from real completed jobs — this constant
 * is exactly the kind of number calibration is meant to eventually replace,
 * never hand-tuned to make a specific estimate "look right".
 */
const PLACEHOLDER_MINUTES_PER_WINDOW = 5;

export function calculateEstimate(
	config: PricingConfig,
	input: { approxWindowCount: number; stories: 1 | 2 | 3 }
): EstimateRange {
	const targetHourlyRate = num(config['Target Hourly Rate']);
	const estimatedHours = (Math.max(0, input.approxWindowCount) * PLACEHOLDER_MINUTES_PER_WINDOW) / 60;
	let target = estimatedHours * targetHourlyRate;

	const storyFactor = input.stories === 2
		? num(config['Second Story Factor'])
		: input.stories === 3
			? num(config['Third Story Factor'])
			: 0;
	target += target * storyFactor;

	const minimumJobPrice = num(config['Minimum Job Price']);
	let minimumApplied = false;
	if (minimumJobPrice > 0 && target < minimumJobPrice) {
		target = minimumJobPrice;
		minimumApplied = true;
	}

	const lowVariance = num(config['Estimate Low Variance']);
	const highVariance = num(config['Estimate High Variance']);

	return {
		low: round(target * (1 - lowVariance)),
		high: round(target * (1 + highVariance)),
		minimumApplied,
	};
}
