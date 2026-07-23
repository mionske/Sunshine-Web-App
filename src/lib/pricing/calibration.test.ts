import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { jobConfig, type Job } from '../models/job';
import { calibrationSnapshotSchema } from '../models/calibrationSnapshot';
import {
	calibrationExclusionReasons,
	computeCalibrationStats,
	computeJobPerformance,
	computePropertyPerformance,
	confidenceLevel,
	isCalibrationEligible,
	recalculateCalibration,
	getLatestCalibrationSnapshot,
} from './calibration';

function job(overrides: Partial<Job> = {}): Job {
	return {
		'Job ID': crypto.randomUUID(),
		'Date Completed': '2026-01-01',
		'Property Address': '123 Main St',
		'Job Type': 'Residential',
		'Quoted Price ($)': '150',
		'Final Price ($)': '150',
		'Estimated Time (hrs)': '1',
		'Actual Time (hrs)': '1',
		'Window Count': '20',
		'Quote ID': '',
		'Opportunity ID': '',
		'Job Status': 'Completed',
		'Arrival Timestamp': '',
		'Start Timestamp': '',
		'Finish Timestamp': '',
		'Departure Timestamp': '',
		'Travel Time': '',
		'Setup Time': '',
		'Cleaning Time': '',
		'Pack-up Time': '',
		'Supplies Cost': '',
		Gas: '',
		'Other Expenses': '',
		'Total Job Cost': '',
		'Net Profit': '',
		'Customer Rating': '',
		'Callback Required (Y/N)': 'N',
		Photos: '',
		Version: '1',
		'Archived At': '',
		...overrides,
	} as Job;
}

describe('isCalibrationEligible', () => {
	it('accepts a Completed job with actual time, revenue, and callback info', () => {
		expect(isCalibrationEligible(job())).toBe(true);
	});

	it('rejects a job that is not Completed/Invoiced/Paid', () => {
		expect(isCalibrationEligible(job({ 'Job Status': 'Scheduled' }))).toBe(false);
	});

	it('rejects a Completed job missing actual time', () => {
		expect(isCalibrationEligible(job({ 'Actual Time (hrs)': '0' }))).toBe(false);
	});

	it('rejects a Completed job missing final revenue', () => {
		expect(isCalibrationEligible(job({ 'Final Price ($)': '0' }))).toBe(false);
	});

	it('rejects a Completed job missing callback info', () => {
		expect(isCalibrationEligible(job({ 'Callback Required (Y/N)': '' }))).toBe(false);
	});

	it('accepts Invoiced and Paid the same as Completed', () => {
		expect(isCalibrationEligible(job({ 'Job Status': 'Invoiced' }))).toBe(true);
		expect(isCalibrationEligible(job({ 'Job Status': 'Paid' }))).toBe(true);
	});
});

describe('calibrationExclusionReasons', () => {
	it('is empty for a job that qualifies', () => {
		expect(calibrationExclusionReasons(job())).toEqual([]);
	});

	it('lists every missing field, not just the first', () => {
		const reasons = calibrationExclusionReasons(
			job({ 'Actual Time (hrs)': '0', 'Final Price ($)': '0', 'Callback Required (Y/N)': '' })
		);
		expect(reasons).toHaveLength(3);
	});

	it('stays in sync with isCalibrationEligible for the same job', () => {
		const incomplete = job({ 'Callback Required (Y/N)': '' });
		expect(isCalibrationEligible(incomplete)).toBe(false);
		expect(calibrationExclusionReasons(incomplete).length).toBeGreaterThan(0);
	});
});

describe('confidenceLevel', () => {
	it('classifies by comparable job count thresholds', () => {
		expect(confidenceLevel(0)).toBe('Insufficient data');
		expect(confidenceLevel(9)).toBe('Insufficient data');
		expect(confidenceLevel(10)).toBe('Early directional data');
		expect(confidenceLevel(24)).toBe('Early directional data');
		expect(confidenceLevel(25)).toBe('Moderate confidence');
		expect(confidenceLevel(49)).toBe('Moderate confidence');
		expect(confidenceLevel(50)).toBe('Strong internal benchmark');
	});
});

describe('computeCalibrationStats', () => {
	it('excludes incomplete jobs from every statistic', () => {
		const jobs = [
			job({ 'Job Status': 'Scheduled', 'Actual Time (hrs)': '' }),
			job({ 'Job Status': 'In Progress' }),
		];
		const stats = computeCalibrationStats(jobs);
		expect(stats.comparableJobCount).toBe(0);
		expect(stats.observedRevenuePerHour).toBe(0);
	});

	it('computes observed and median revenue per hour from eligible jobs only', () => {
		const jobs = [
			job({ 'Final Price ($)': '150', 'Actual Time (hrs)': '1' }), // $150/hr
			job({ 'Final Price ($)': '100', 'Actual Time (hrs)': '2' }), // $50/hr
			job({ 'Job Status': 'Scheduled' }), // excluded
		];
		const stats = computeCalibrationStats(jobs);
		expect(stats.comparableJobCount).toBe(2);
		expect(stats.observedRevenuePerHour).toBeCloseTo((150 + 50) / 2, 5);
		expect(stats.medianRevenuePerHour).toBeCloseTo((150 + 50) / 2, 5); // 2 values, median = mean
	});

	it('computes estimate variance as (actual - estimated) / estimated', () => {
		const jobs = [job({ 'Estimated Time (hrs)': '1', 'Actual Time (hrs)': '1.5' })];
		const stats = computeCalibrationStats(jobs);
		expect(stats.averageEstimateVariance).toBeCloseTo(0.5, 5);
	});

	it('assigns the correct confidence level for the sample size', () => {
		const jobs = Array.from({ length: 12 }, () => job());
		const stats = computeCalibrationStats(jobs);
		expect(stats.comparableJobCount).toBe(12);
		expect(stats.confidenceLevel).toBe('Early directional data');
	});

	it('computes the date range across eligible jobs', () => {
		const jobs = [
			job({ 'Date Completed': '2026-03-01' }),
			job({ 'Date Completed': '2026-01-15' }),
			job({ 'Date Completed': '2026-02-10' }),
		];
		const stats = computeCalibrationStats(jobs);
		expect(stats.dateRangeStart).toBe('2026-01-15');
		expect(stats.dateRangeEnd).toBe('2026-03-01');
	});
});

describe('computePropertyPerformance', () => {
	it('returns all zeros for a property with no completed jobs', () => {
		const perf = computePropertyPerformance([job({ 'Job Status': 'Scheduled' })]);
		expect(perf.completedJobCount).toBe(0);
		expect(perf.includedCount).toBe(0);
		expect(perf.excludedCount).toBe(0);
		expect(perf.mostRecentServiceDate).toBe('');
	});

	it('separates calibration-eligible completed jobs from excluded ones', () => {
		const eligible = job({ 'Final Price ($)': '300', 'Actual Time (hrs)': '2' });
		const excluded = job({ 'Callback Required (Y/N)': '' }); // missing callback info
		const perf = computePropertyPerformance([eligible, excluded]);
		expect(perf.completedJobCount).toBe(2);
		expect(perf.includedCount).toBe(1);
		expect(perf.excludedCount).toBe(1);
	});

	it('averages on-site hours and revenue across only the eligible jobs', () => {
		const a = job({ 'Final Price ($)': '300', 'Actual Time (hrs)': '2' });
		const b = job({ 'Final Price ($)': '150', 'Actual Time (hrs)': '1' });
		const perf = computePropertyPerformance([a, b]);
		expect(perf.averageOnSiteHours).toBeCloseTo(1.5);
		expect(perf.averageFinalRevenue).toBeCloseTo(225);
		expect(perf.averageRevenuePerOnSiteHour).toBeCloseTo(150);
	});

	it('counts callbacks across all completed jobs, not just eligible ones', () => {
		const withCallback = job({ 'Callback Required (Y/N)': 'Y' });
		const perf = computePropertyPerformance([withCallback]);
		expect(perf.totalCallbacks).toBe(1);
	});

	it('reports the most recent service date among completed jobs', () => {
		const older = job({ 'Date Completed': '2026-01-01' });
		const newer = job({ 'Date Completed': '2026-03-15' });
		const perf = computePropertyPerformance([older, newer]);
		expect(perf.mostRecentServiceDate).toBe('2026-03-15');
	});
});

describe('computeJobPerformance', () => {
	it('reports variance from the target hourly rate', () => {
		const j = job({ 'Final Price ($)': '120', 'Actual Time (hrs)': '1' });
		const perf = computeJobPerformance(j, 150);
		expect(perf.actualRevenuePerLaborHour).toBe(120);
		expect(perf.varianceFromTarget).toBe(120 - 150);
	});

	it('computes time variance as actual minus estimated hours', () => {
		const j = job({ 'Estimated Time (hrs)': '1', 'Actual Time (hrs)': '1.7' });
		const perf = computeJobPerformance(j, 150);
		expect(perf.timeVarianceHours).toBeCloseTo(0.7, 5);
	});

	it('computes net contribution as revenue minus direct costs', () => {
		const j = job({
			'Final Price ($)': '200',
			'Supplies Cost': '10',
			Gas: '5',
			'Other Expenses': '5',
		});
		const perf = computeJobPerformance(j, 150);
		expect(perf.directJobCosts).toBe(20);
		expect(perf.netContribution).toBe(180);
	});
});

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];
const JOBS_HEADERS = [
	'Job ID', 'Date Completed', 'Property Address', 'Job Type', 'Lead Source',
	'Windows - Small', 'Windows - Medium', 'Windows - Large/Picture', 'Windows - French/Grid',
	'Total Panes', 'Screens', 'Hard Water Treatment (Y/N)', 'Quoted Price ($)', 'Final Price ($)',
	'Add-On Revenue ($)', 'Total Revenue ($)', 'Estimated Time (hrs)', 'Actual Time (hrs)',
	'WFP Time (hrs)', 'Time Accuracy (%)', 'Effective $/hr', 'Notes', '',
	'CALIBRATION SUMMARY (auto-updates)', '',
	'Window Count', 'Quote ID', 'Opportunity ID', 'Job Status', 'Arrival Timestamp',
	'Start Timestamp', 'Finish Timestamp', 'Departure Timestamp', 'Travel Time', 'Setup Time',
	'Cleaning Time', 'Pack-up Time', 'Supplies Cost', 'Gas', 'Other Expenses', 'Total Job Cost',
	'Net Profit', 'Customer Rating', 'Callback Required (Y/N)', 'Photos', 'Version', 'Archived At',
	'Property ID',
	'Record Classification',
	'Revenue Treatment',
	'Standard Price Equivalent',
	'Data Quality',
	'Data Quality Notes',
];

describe('recalculateCalibration (Sheets-backed)', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Jobs', [JOBS_HEADERS]);
		harness.spreadsheet.setTab('CalibrationSnapshot', [Object.keys(calibrationSnapshotSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	it('stores a new snapshot reflecting only eligible jobs currently in the sheet', async () => {
		await createRow(harness.env, jobConfig, {
			'Final Price ($)': '150',
			'Actual Time (hrs)': '1',
			'Job Status': 'Completed',
			'Callback Required (Y/N)': 'N',
		});
		await createRow(harness.env, jobConfig, {
			'Final Price ($)': '',
			'Actual Time (hrs)': '',
			'Job Status': 'Scheduled',
		});

		const snapshot = await recalculateCalibration(harness.env);
		expect(snapshot['Comparable Job Count']).toBe('1');
		expect(snapshot['Confidence Level']).toBe('Insufficient data');

		const latest = await getLatestCalibrationSnapshot(harness.env);
		expect(latest?.['Calibration Snapshot ID']).toBe(snapshot['Calibration Snapshot ID']);
	});
});
