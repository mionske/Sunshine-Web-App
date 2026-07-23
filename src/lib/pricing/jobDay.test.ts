import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { jobConfig, jobSchema } from '../models/job';
import { jobTimeEntrySchema } from '../models/jobTimeEntry';
import { quoteItemSchema, type QuoteItem } from '../models/quoteItem';
import { calibrationSnapshotSchema } from '../models/calibrationSnapshot';
import {
	addManualTimeEntry,
	completeJobDay,
	computeJobChecklist,
	correctTimeEntry,
	listJobTimeEntries,
	parseChecklistState,
	pauseJobDay,
	setChecklistItemState,
	startTimeSegment,
	summarizeTimeEntries,
} from './jobDay';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

function quoteItem(overrides: Partial<QuoteItem> = {}): Partial<QuoteItem> {
	return {
		'Quote ID': 'quote-1',
		'Service Code': 'WINDOW_EXT_STANDARD',
		'Service Category': 'Window',
		Quantity: '1',
		...overrides,
	};
}

describe('Job Day mode', () => {
	let harness: FakeFetchHandle;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Jobs', [Object.keys(jobSchema.shape)]);
		harness.spreadsheet.setTab('JobTimeEntries', [Object.keys(jobTimeEntrySchema.shape)]);
		harness.spreadsheet.setTab('QuoteItems', [Object.keys(quoteItemSchema.shape)]);
		harness.spreadsheet.setTab('CalibrationSnapshot', [Object.keys(calibrationSnapshotSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function makeJob(overrides: Record<string, string> = {}) {
		return createRow(harness.env, jobConfig, { 'Job Status': 'Scheduled', ...overrides });
	}

	it('starting a segment moves the job into In Progress and records Job Day State', async () => {
		const job = await makeJob();
		const { job: updated, entry } = await startTimeSegment(harness.env, job['Job ID'], 'Setup');

		expect(updated['Job Status']).toBe('In Progress');
		expect(updated['Job Day State']).toBe('Setup');
		expect(entry['Time Category']).toBe('Setup');
		expect(entry['Started At']).toBeTruthy();
		expect(entry['Ended At']).toBe('');
	});

	it('prevents two active timer segments — starting a new one closes the previous', async () => {
		const job = await makeJob();
		await startTimeSegment(harness.env, job['Job ID'], 'Setup');
		await startTimeSegment(harness.env, job['Job ID'], 'Cleaning');

		const entries = await listJobTimeEntries(harness.env, job['Job ID']);
		expect(entries).toHaveLength(2);
		const setupEntry = entries.find((e) => e['Time Category'] === 'Setup');
		const cleaningEntry = entries.find((e) => e['Time Category'] === 'Cleaning');
		expect(setupEntry?.['Ended At']).toBeTruthy();
		expect(cleaningEntry?.['Ended At']).toBe('');
	});

	it('pausing ends the active segment and sets Job Day State to Paused', async () => {
		const job = await makeJob();
		await startTimeSegment(harness.env, job['Job ID'], 'Setup');
		const paused = await pauseJobDay(harness.env, job['Job ID']);

		expect(paused['Job Day State']).toBe('Paused');
		const entries = await listJobTimeEntries(harness.env, job['Job ID']);
		expect(entries[0]['Ended At']).toBeTruthy();
	});

	it('only Setup/Cleaning/Inspection/Pack-up count toward on-site hours', async () => {
		const job = await makeJob();
		await addManualTimeEntry(harness.env, job['Job ID'], { category: 'Setup', startedAt: '2026-01-15T08:00:00Z', endedAt: '2026-01-15T08:30:00Z' });
		await addManualTimeEntry(harness.env, job['Job ID'], { category: 'Cleaning', startedAt: '2026-01-15T08:30:00Z', endedAt: '2026-01-15T10:00:00Z' });
		await addManualTimeEntry(harness.env, job['Job ID'], { category: 'Travel', startedAt: '2026-01-15T07:00:00Z', endedAt: '2026-01-15T07:30:00Z' });
		await addManualTimeEntry(harness.env, job['Job ID'], { category: 'Off-Site Admin', startedAt: '2026-01-15T18:00:00Z', endedAt: '2026-01-15T18:15:00Z' });

		const entries = await listJobTimeEntries(harness.env, job['Job ID']);
		const summary = summarizeTimeEntries(entries);

		expect(summary.byCategoryMinutes.Setup).toBe(30);
		expect(summary.byCategoryMinutes.Cleaning).toBe(90);
		expect(summary.byCategoryMinutes.Travel).toBe(30);
		expect(summary.byCategoryMinutes['Off-Site Admin']).toBe(15);
		// Only Setup (30) + Cleaning (90) = 120 minutes = 2 hours on-site.
		expect(summary.onSiteHours).toBe(2);
	});

	it('manual correction recomputes Duration Minutes from corrected timestamps', async () => {
		const job = await makeJob();
		const entry = await addManualTimeEntry(harness.env, job['Job ID'], {
			category: 'Setup',
			startedAt: '2026-01-15T08:00:00Z',
			endedAt: '2026-01-15T08:30:00Z',
		});
		expect(entry['Duration Minutes']).toBe('30');

		const corrected = await correctTimeEntry(harness.env, entry['Job Time Entry ID'], { endedAt: '2026-01-15T09:00:00Z' });
		expect(corrected['Duration Minutes']).toBe('60');
	});

	it('generates a checklist reflecting the quoted scope', async () => {
		const items = [
			quoteItem({ 'Service Code': 'WINDOW_EXT_STANDARD' }),
			quoteItem({ 'Service Code': 'SCREEN_CLEAN' }),
		] as QuoteItem[];
		const checklist = computeJobChecklist(items);
		const keys = checklist.map((i) => i.key);

		expect(keys).toContain('exterior_complete');
		expect(keys).toContain('screens_complete');
		expect(keys).not.toContain('interior_complete');
		expect(keys).not.toContain('tracks_complete');
		expect(keys).not.toContain('specialty_glass_complete');
		// Fixed items are always present regardless of scope.
		expect(keys).toEqual(
			expect.arrayContaining(['confirm_scope', 'confirm_access', 'final_inspection', 'client_walkthrough', 'equipment_packed', 'payment_or_invoice_handled'])
		);
	});

	it('falls back to the full checklist when there is no linked quote scope', () => {
		const checklist = computeJobChecklist([]);
		const keys = checklist.map((i) => i.key);
		expect(keys).toContain('exterior_complete');
		expect(keys).toContain('interior_complete');
		expect(keys).toContain('screens_complete');
		expect(keys).toContain('tracks_complete');
		expect(keys).toContain('specialty_glass_complete');
	});

	it('toggling a checklist item persists its state on the Job row', async () => {
		const job = await makeJob();
		await setChecklistItemState(harness.env, job['Job ID'], 'confirm_scope', true);
		const rows = harness.spreadsheet.getTab('Jobs');
		const headers = rows[0];
		const row = rows.find((r) => r[headers.indexOf('Job ID')] === job['Job ID']);
		const state = parseChecklistState(row?.[headers.indexOf('Job Checklist (JSON)')] as string);
		expect(state.confirm_scope).toBe(true);
	});

	it('completing the job day computes actual on-site hours, net profit, and marks the job Completed', async () => {
		const job = await makeJob();
		await addManualTimeEntry(harness.env, job['Job ID'], { category: 'Setup', startedAt: '2026-01-15T08:00:00Z', endedAt: '2026-01-15T08:30:00Z' });
		await addManualTimeEntry(harness.env, job['Job ID'], { category: 'Cleaning', startedAt: '2026-01-15T08:30:00Z', endedAt: '2026-01-15T09:30:00Z' });

		const completed = await completeJobDay(harness.env, job['Job ID'], {
			finalPrice: '200',
			suppliesCost: '20',
			paymentStatus: 'Not Paid',
		});

		expect(completed['Actual Time (hrs)']).toBe('1.50');
		expect(completed['Setup Time']).toBe('30');
		expect(completed['Cleaning Time']).toBe('60');
		expect(completed['Total Job Cost']).toBe('20');
		expect(completed['Net Profit']).toBe('180');
		expect(completed['Job Status']).toBe('Completed');
		expect(completed['Job Day State']).toBe('Completed');
	});

	it('marks the job Paid directly when payment status is Paid in Full', async () => {
		const job = await makeJob();
		const completed = await completeJobDay(harness.env, job['Job ID'], { finalPrice: '200', paymentStatus: 'Paid in Full' });
		expect(completed['Job Status']).toBe('Paid');
	});

	it('completion recalculates the calibration snapshot (a Completed-triggering status)', async () => {
		const job = await makeJob();
		await completeJobDay(harness.env, job['Job ID'], { finalPrice: '200', paymentStatus: 'Not Paid' });
		const snapshotRows = harness.spreadsheet.getTab('CalibrationSnapshot');
		expect(snapshotRows.length).toBeGreaterThan(1);
	});
});
