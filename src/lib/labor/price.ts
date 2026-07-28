import type { PricingConfig } from '../models/pricingConfig';

const ROUNDING_STEP = 5;

export interface PriceBand {
	low: number;
	target: number;
	high: number;
	minimumApplied: boolean;
	/** Revenue per productive hour each figure was built from. */
	rates: { low: number; target: number; high: number };
	pricingConfigId: string;
}

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function round(amount: number): number {
	return Math.round(amount / ROUNDING_STEP) * ROUNDING_STEP;
}

/**
 * Productive hours times the configured revenue-per-hour targets.
 *
 * Three genuinely different numbers, not one number with decoration: low is
 * the floor worth taking the job at, target is the recommendation, high is
 * what the work is worth when access or condition make it unpleasant. The
 * job minimum lifts all three, since a minimum that only applied to the
 * bottom of the band would invert it on a small job.
 *
 * Restoration minutes are already inside the productive total and so are
 * already priced here at the hourly rate. There is deliberately no separate
 * restoration charge line: no restoration rate is configured anywhere, and
 * the app already has one hard lesson about line items that quietly price at
 * zero because their config column was never filled in. A restoration
 * premium belongs in the owner's own adjustment, where it is visible.
 */
export function suggestPriceBand(config: PricingConfig, productiveMinutes: number): PriceBand {
	const productiveHours = Math.max(0, productiveMinutes) / 60;

	const rates = {
		low: num(config['Low Hourly Production Target']),
		target: num(config['Target Hourly Production Target']),
		high: num(config['High Hourly Production Target']),
	};

	const minimum = num(config['Minimum Job Price']);
	const raw = {
		low: productiveHours * rates.low,
		target: productiveHours * rates.target,
		high: productiveHours * rates.high,
	};

	const minimumApplied = minimum > 0 && raw.low < minimum;

	return {
		low: round(Math.max(raw.low, minimum)),
		target: round(Math.max(raw.target, minimum)),
		high: round(Math.max(raw.high, minimum)),
		minimumApplied,
		rates,
		pricingConfigId: config['Pricing Config ID'],
	};
}

/**
 * How an owner's chosen price sits against the suggestion — for the review
 * page's own display and, later, for calibration.
 *
 * Never a gate. The owner pricing a ten-hour job at $1,700 when the band
 * tops out lower is a legitimate business decision, and the app's job is to
 * record it accurately, not to argue the number down.
 */
export function describeOwnerPrice(band: PriceBand, ownerPrice: number): {
	position: 'below band' | 'at low' | 'within band' | 'at high' | 'above band';
	differenceFromTarget: number;
	effectiveHourlyRate: number | null;
	productiveHours: number;
} {
	const productiveHours = band.rates.target > 0 ? band.target / band.rates.target : 0;

	const position =
		ownerPrice < band.low
			? 'below band'
			: ownerPrice === band.low
				? 'at low'
				: ownerPrice > band.high
					? 'above band'
					: ownerPrice === band.high
						? 'at high'
						: 'within band';

	return {
		position,
		differenceFromTarget: ownerPrice - band.target,
		effectiveHourlyRate: productiveHours > 0 ? ownerPrice / productiveHours : null,
		productiveHours,
	};
}
