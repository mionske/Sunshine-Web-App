// Completed-job calibration: measures actual performance against the
// $150/on-site-hour target, purely for reporting and recommendations —
// it never writes back into PricingConfig (see the plan's core rule).
import { createRow, listActiveRows, logActivity, type SheetsEnv } from '../sheets';
import { jobConfig, type Job } from '../models/job';
import { calibrationSnapshotConfig, CONFIDENCE_LEVELS, type CalibrationSnapshot } from '../models/calibrationSnapshot';
import type { Quote } from '../models/quote';
import type { QuoteInput } from './types';
import { CALCULATOR_VERSION } from './engine';

const COMPLETED_JOB_STATUSES = new Set(['Completed', 'Invoiced', 'Paid']);

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Every reason a job currently fails to qualify for calibration — empty
 * when it qualifies. A job only counts toward calibration once it's
 * Completed/Invoiced/Paid *and* has actual labor time, final revenue, and
 * callback info entered — never while still Unscheduled/Scheduled/In
 * Progress. Direct costs are checked "where applicable" in the plan's
 * wording (inherently fuzzy), so they're not a hard gate here.
 *
 * `isCalibrationEligible` is defined in terms of this list (not the other
 * way around) so the two can never drift out of sync — the eligibility
 * check and the human-readable explanation always agree.
 */
export function calibrationExclusionReasons(job: Job): string[] {
	const reasons: string[] = [];
	if (!COMPLETED_JOB_STATUSES.has(job['Job Status'])) reasons.push('Job is not yet Completed/Invoiced/Paid');
	if (num(job['Actual Time (hrs)']) <= 0) reasons.push('Actual on-site labor time is missing');
	const finalRevenue = job['Final Price ($)'] || (job as Record<string, string>)['Total Revenue ($)'];
	if (num(finalRevenue) <= 0) reasons.push('Final revenue is missing');
	if (!job['Callback Required (Y/N)']) reasons.push('Callback status is missing');
	return reasons;
}

export function isCalibrationEligible(job: Job): boolean {
	return calibrationExclusionReasons(job).length === 0;
}

export function confidenceLevel(comparableJobCount: number): (typeof CONFIDENCE_LEVELS)[number] {
	if (comparableJobCount >= 50) return 'Strong internal benchmark';
	if (comparableJobCount >= 25) return 'Moderate confidence';
	if (comparableJobCount >= 10) return 'Early directional data';
	return 'Insufficient data';
}

export function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function legacyWindowCount(job: Job): number {
	const j = job as Record<string, string>;
	const explicit = num(job['Window Count']);
	if (explicit > 0) return explicit;
	return (
		num(j['Windows - Small']) +
		num(j['Windows - Medium']) +
		num(j['Windows - Large/Picture']) +
		num(j['Windows - French/Grid'])
	);
}

function legacyPaneCount(job: Job): number {
	return num((job as Record<string, string>)['Total Panes']);
}

function legacyEstimatedHours(job: Job): number {
	return num(job['Estimated Time (hrs)'] || (job as Record<string, string>)['Estimated Time (hrs)']);
}

// --- Job segmentation for calibration filters (Phase 7) --------------------
// "Do not claim jobs are comparable merely because they are completed" — a
// completed Job row itself doesn't carry story count/condition/access
// difficulty/scope, so these are read from the linked Quote's own Input
// Snapshot (the exact inputs that quote's price was calculated from) rather
// than guessed or re-derived. A job with no linked Quote (e.g. a historical-
// import row) segments as 'Unknown' in every dimension except window-count
// band, which falls back to the Job's own Window Count/legacy columns.

export function windowCountBand(count: number): string {
	if (count <= 0) return 'Unknown';
	if (count <= 10) return '1-10';
	if (count <= 20) return '11-20';
	if (count <= 30) return '21-30';
	return '31+';
}

export interface JobSegmentation {
	storyCount: string;
	condition: string;
	accessDifficulty: string;
	scope: string;
	windowCountBand: string;
	pricingConfigId: string;
}

const UNKNOWN_SEGMENT = 'Unknown';

export function deriveJobSegmentation(job: Job, quote: Quote | undefined): JobSegmentation {
	const band = windowCountBand(legacyWindowCount(job));
	const pricingConfigId = quote?.['Pricing Config ID'] ?? '';

	if (!quote?.['Input Snapshot']) {
		return { storyCount: UNKNOWN_SEGMENT, condition: UNKNOWN_SEGMENT, accessDifficulty: UNKNOWN_SEGMENT, scope: UNKNOWN_SEGMENT, windowCountBand: band, pricingConfigId };
	}

	try {
		const input = JSON.parse(quote['Input Snapshot']) as Partial<QuoteInput>;
		const counts = input.counts;
		let scope = UNKNOWN_SEGMENT;
		if (counts) {
			const extTotal =
				(counts.windowExtStandard ?? 0) + (counts.windowExtOversized ?? 0) + (counts.windowExtFrenchPane ?? 0) + (counts.slidingDoorExt ?? 0) + (counts.skylightExt ?? 0);
			const intTotal =
				(counts.windowIntStandard ?? 0) + (counts.windowIntOversized ?? 0) + (counts.windowIntFrenchPane ?? 0) + (counts.slidingDoorInt ?? 0) + (counts.skylightInt ?? 0);
			if (extTotal > 0 && intTotal > 0) scope = 'Interior + Exterior';
			else if (extTotal > 0) scope = 'Exterior only';
			else if (intTotal > 0) scope = 'Interior only';
		}

		return {
			storyCount: input.stories ? String(input.stories) : UNKNOWN_SEGMENT,
			condition: input.condition ?? UNKNOWN_SEGMENT,
			accessDifficulty: input.difficultAccess === undefined ? UNKNOWN_SEGMENT : input.difficultAccess ? 'Difficult access' : 'Standard access',
			scope,
			windowCountBand: band,
			pricingConfigId,
		};
	} catch {
		return { storyCount: UNKNOWN_SEGMENT, condition: UNKNOWN_SEGMENT, accessDifficulty: UNKNOWN_SEGMENT, scope: UNKNOWN_SEGMENT, windowCountBand: band, pricingConfigId };
	}
}

export interface CalibrationStats {
	completedJobCount: number;
	comparableJobCount: number;
	observedRevenuePerHour: number;
	medianRevenuePerHour: number;
	averageEstimateVariance: number;
	medianEstimateVariance: number;
	averageMinutesPerPane: number;
	averageMinutesPerWindow: number;
	averageWindowsToPanesRatio: number;
	confidenceLevel: (typeof CONFIDENCE_LEVELS)[number];
	dateRangeStart: string;
	dateRangeEnd: string;
}

export function computeCalibrationStats(jobs: Job[]): CalibrationStats {
	const eligible = jobs.filter(isCalibrationEligible);

	const revenuePerHour: number[] = [];
	const estimateVariance: number[] = [];
	const minutesPerPane: number[] = [];
	const minutesPerWindow: number[] = [];
	const windowsToPanes: number[] = [];
	const dates: string[] = [];

	for (const job of eligible) {
		const actualHours = num(job['Actual Time (hrs)']);
		const finalRevenue = num(job['Final Price ($)'] || (job as Record<string, string>)['Total Revenue ($)']);
		if (actualHours > 0) revenuePerHour.push(finalRevenue / actualHours);

		const estimatedHours = legacyEstimatedHours(job);
		if (estimatedHours > 0) estimateVariance.push((actualHours - estimatedHours) / estimatedHours);

		const panes = legacyPaneCount(job);
		const windows = legacyWindowCount(job);
		if (panes > 0) minutesPerPane.push((actualHours * 60) / panes);
		if (windows > 0) minutesPerWindow.push((actualHours * 60) / windows);
		if (windows > 0 && panes > 0) windowsToPanes.push(panes / windows);

		const date = job['Date Completed'] || (job as Record<string, string>)['Date Completed'];
		if (date) dates.push(date);
	}

	dates.sort();

	return {
		completedJobCount: jobs.filter((j) => COMPLETED_JOB_STATUSES.has(j['Job Status'])).length,
		comparableJobCount: eligible.length,
		observedRevenuePerHour: mean(revenuePerHour),
		medianRevenuePerHour: median(revenuePerHour),
		averageEstimateVariance: mean(estimateVariance),
		medianEstimateVariance: median(estimateVariance),
		averageMinutesPerPane: mean(minutesPerPane),
		averageMinutesPerWindow: mean(minutesPerWindow),
		averageWindowsToPanesRatio: mean(windowsToPanes),
		confidenceLevel: confidenceLevel(eligible.length),
		dateRangeStart: dates[0] ?? '',
		dateRangeEnd: dates[dates.length - 1] ?? '',
	};
}

/** Recomputes calibration from every Job currently in the sheet and stores
 * the result as a new CalibrationSnapshot row. Triggered explicitly (a
 * "Recalculate" action) or right after a Job transitions into a completed
 * status — never runs automatically on a schedule in this version. */
export async function recalculateCalibration(
	env: SheetsEnv,
	meta: { user?: string; requestId?: string } = {}
): Promise<CalibrationSnapshot> {
	const jobs = await listActiveRows(env, jobConfig);
	const stats = computeCalibrationStats(jobs);

	const snapshot = await createRow(env, calibrationSnapshotConfig, {
		'Generated At': new Date().toISOString(),
		'Calculator Version': CALCULATOR_VERSION,
		'Completed Job Count': String(stats.completedJobCount),
		'Comparable Job Count': String(stats.comparableJobCount),
		'Observed Revenue Per Hour': stats.observedRevenuePerHour.toFixed(2),
		'Median Revenue Per Hour': stats.medianRevenuePerHour.toFixed(2),
		'Average Estimate Variance': stats.averageEstimateVariance.toFixed(4),
		'Median Estimate Variance': stats.medianEstimateVariance.toFixed(4),
		'Average Minutes Per Pane': stats.averageMinutesPerPane.toFixed(2),
		'Average Minutes Per Window': stats.averageMinutesPerWindow.toFixed(2),
		'Average Windows-to-Panes Ratio': stats.averageWindowsToPanesRatio.toFixed(3),
		'Confidence Level': stats.confidenceLevel,
		'Date Range Start': stats.dateRangeStart,
		'Date Range End': stats.dateRangeEnd,
	});

	await logActivity(env, {
		entityType: 'CalibrationSnapshot',
		entityId: snapshot['Calibration Snapshot ID'],
		action: 'Calibration recalculated',
		user: meta.user,
		requestId: meta.requestId,
		notes: `${stats.comparableJobCount} comparable jobs — ${stats.confidenceLevel}`,
	});

	return snapshot;
}

export async function getLatestCalibrationSnapshot(env: SheetsEnv): Promise<CalibrationSnapshot | null> {
	const snapshots = await listActiveRows(env, calibrationSnapshotConfig);
	if (snapshots.length === 0) return null;
	return snapshots.reduce((latest, s) => (s['Generated At'] > latest['Generated At'] ? s : latest));
}

// --- Historical Property Performance --------------------------------------
// A property-scoped view of the same underlying eligibility rule used for
// the app-wide calibration snapshot. Purely informational/directional —
// never feeds back into PricingConfig — see the Property detail page.

export interface PropertyPerformance {
	completedJobCount: number;
	includedCount: number;
	excludedCount: number;
	averageOnSiteHours: number;
	averageFinalRevenue: number;
	averageRevenuePerOnSiteHour: number;
	totalCallbacks: number;
	mostRecentServiceDate: string;
}

export function computePropertyPerformance(jobs: Job[]): PropertyPerformance {
	const completed = jobs.filter((j) => COMPLETED_JOB_STATUSES.has(j['Job Status']));
	const eligible = completed.filter(isCalibrationEligible);

	const hours: number[] = [];
	const revenues: number[] = [];
	const perHour: number[] = [];
	for (const job of eligible) {
		const actualHours = num(job['Actual Time (hrs)']);
		const finalRevenue = num(job['Final Price ($)'] || (job as Record<string, string>)['Total Revenue ($)']);
		if (actualHours > 0) {
			hours.push(actualHours);
			perHour.push(finalRevenue / actualHours);
		}
		revenues.push(finalRevenue);
	}

	const callbacks = completed.filter((j) => j['Callback Required (Y/N)']?.toUpperCase() === 'Y').length;
	const dates = completed.map((j) => j['Date Completed']).filter(Boolean).sort();

	return {
		completedJobCount: completed.length,
		includedCount: eligible.length,
		excludedCount: completed.length - eligible.length,
		averageOnSiteHours: mean(hours),
		averageFinalRevenue: mean(revenues),
		averageRevenuePerOnSiteHour: mean(perHour),
		totalCallbacks: callbacks,
		mostRecentServiceDate: dates[dates.length - 1] ?? '',
	};
}

// --- Target-vs-actual, per completed job ---------------------------------

export interface JobPerformance {
	quotedRevenuePerEstimatedHour: number;
	actualRevenuePerLaborHour: number;
	varianceFromTarget: number;
	estimatedHours: number;
	actualHours: number;
	timeVarianceHours: number;
	quotedRevenue: number;
	finalRevenue: number;
	directJobCosts: number;
	netContribution: number;
	callbackCost: number;
	adjustedRevenuePerHour: number;
}

/** Compares one completed Job against the active target hourly rate. Pure
 * display/reporting computation — never written back anywhere. */
export function computeJobPerformance(job: Job, targetHourlyRate: number): JobPerformance {
	const j = job as Record<string, string>;
	const estimatedHours = legacyEstimatedHours(job);
	const actualHours = num(job['Actual Time (hrs)']);
	const quotedRevenue = num(job['Quoted Price ($)']);
	const finalRevenue = num(job['Final Price ($)'] || j['Total Revenue ($)']);
	const directJobCosts =
		num(job['Supplies Cost']) + num(job.Gas) + num(job['Other Expenses']) || num(job['Total Job Cost']);
	const callbackCost = job['Callback Required (Y/N)']?.toUpperCase() === 'Y' ? num(j['Callback Cost']) : 0;

	const actualRevenuePerLaborHour = actualHours > 0 ? finalRevenue / actualHours : 0;
	const netContribution = finalRevenue - directJobCosts - callbackCost;

	return {
		quotedRevenuePerEstimatedHour: estimatedHours > 0 ? quotedRevenue / estimatedHours : 0,
		actualRevenuePerLaborHour,
		varianceFromTarget: actualRevenuePerLaborHour - targetHourlyRate,
		estimatedHours,
		actualHours,
		timeVarianceHours: actualHours - estimatedHours,
		quotedRevenue,
		finalRevenue,
		directJobCosts,
		netContribution,
		callbackCost,
		adjustedRevenuePerHour: actualHours > 0 ? netContribution / actualHours : 0,
	};
}
