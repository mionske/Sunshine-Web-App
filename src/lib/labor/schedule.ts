import type { LaborModel } from './config';
import type { ScheduleRecommendation } from './types';

export interface ScheduleSuggestion {
	productiveMinutes: number;
	scheduledMinutes: number;
	recommendation: ScheduleRecommendation;
	/** Why this recommendation, in plain language, for the review page. */
	reasons: string[];
}

/**
 * Productive labor is the work. Scheduled time is the day.
 *
 * They are reported as two separate numbers because they answer different
 * questions — "how much work is this" prices the job, "how long will I be
 * there" books it — and collapsing them into one is how a day gets
 * overbooked. The contingency covers what happens between windows: moving
 * between floors, repositioning hoses, relocating equipment, breaks, drying,
 * and the ordinary slack a real day has in it.
 */
export function suggestSchedule(
	model: LaborModel,
	productiveMinutes: number,
	options: { hazardousAccess?: string[]; overrideMinutes?: number } = {}
): ScheduleSuggestion {
	const { hazardousAccess = [], overrideMinutes } = options;

	const contingency = Math.max(0, model.contingencyPercent) / 100;
	const computed = productiveMinutes * (1 + contingency);

	// The owner's own number wins outright and never touches the productive
	// estimate underneath — the work is the work; how long you block out for
	// it is a scheduling judgment.
	const scheduledMinutes = typeof overrideMinutes === 'number' && overrideMinutes > 0 ? overrideMinutes : computed;
	const scheduledHours = scheduledMinutes / 60;

	const reasons: string[] = [];
	let recommendation: ScheduleRecommendation = 'One-Day Job';

	if (model.crewThresholdHours > 0 && scheduledHours >= model.crewThresholdHours) {
		recommendation = 'Crew Recommended';
		reasons.push(`${scheduledHours.toFixed(1)} scheduled hours is past the ${model.crewThresholdHours}-hour crew threshold`);
	} else if (model.twoDayThresholdHours > 0 && scheduledHours >= model.twoDayThresholdHours) {
		recommendation = 'Two-Day Job';
		reasons.push(`${scheduledHours.toFixed(1)} scheduled hours is past the ${model.twoDayThresholdHours}-hour single-day threshold`);
	}

	// Surfaced but never decisive on its own. Dangerous access is a reason to
	// think about splitting the job; it is not a reason for the app to split
	// it for you.
	if (hazardousAccess.length > 0) {
		reasons.push(`${hazardousAccess.join(' and ')} adds safety and setup complexity`);
	}

	if (typeof overrideMinutes === 'number' && overrideMinutes > 0) {
		reasons.push('Scheduled time was set manually');
	}

	return { productiveMinutes, scheduledMinutes, recommendation, reasons };
}

/**
 * The suggested split for a two-day job: exterior first, interior second.
 *
 * Exterior work depends on daylight and weather and is the half that can't be
 * moved, so it goes first; screens come out with the exterior pass and go
 * back during the interior one. Offered as a default, never imposed.
 */
export const TWO_DAY_WORK_SPLIT = {
	dayOne: ['Exterior glass', 'Exterior frames and sills', 'Screens', 'Exterior inspection'],
	dayTwo: ['Interior glass', 'Tracks', 'Screen replacement', 'Final inspection'],
} as const;
