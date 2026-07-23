// Phase 6: Job-Day Mode — a simplified mobile timer/checklist/completion
// workflow for a solo owner working a single job. Timer segments live in
// their own JobTimeEntries tab (one row per Started/Ended pair); the Job
// row itself only tracks the current "Job Day State" and the checklist's
// JSON blob. Never a workforce-management system: no crew assignment, no
// scheduling conflicts, no offline queue.
import { createRow, findById, listActiveRows, updateRow, type SheetsEnv } from '../sheets';
import {
	jobTimeEntryConfig,
	ON_SITE_TIME_CATEGORIES,
	TIME_CATEGORIES,
	type JobTimeEntry,
} from '../models/jobTimeEntry';
import { jobConfig, JOB_DAY_STATES, PAYMENT_STATUSES, type Job } from '../models/job';
import type { QuoteItem } from '../models/quoteItem';
import { updateJobStatus } from './jobLifecycle';

export { JOB_DAY_STATES, PAYMENT_STATUSES, ON_SITE_TIME_CATEGORIES, TIME_CATEGORIES };

type TimeCategory = (typeof TIME_CATEGORIES)[number];

interface Meta {
	user?: string;
	requestId?: string;
}

export async function listJobTimeEntries(env: SheetsEnv, jobId: string): Promise<JobTimeEntry[]> {
	const all = await listActiveRows(env, jobTimeEntryConfig);
	return all
		.filter((e) => e['Job ID'] === jobId)
		.sort((a, b) => (a['Started At'] || '').localeCompare(b['Started At'] || ''));
}

function minutesBetween(startedAt: string, endedAt: string): number {
	const start = new Date(startedAt).getTime();
	const end = new Date(endedAt).getTime();
	if (Number.isNaN(start) || Number.isNaN(end)) return 0;
	return Math.max(0, Math.round((end - start) / 60000));
}

/** Ends whichever time entry for this job has no Ended At yet, if any — this
 * is what "prevent two active timer segments for the same job" actually
 * means in practice: starting a new segment always closes the previous one
 * first, rather than rejecting the tap outright (a forgotten timer should
 * never block a solo owner from moving on). */
async function endActiveSegment(env: SheetsEnv, jobId: string, endedAt: string, meta: Meta = {}): Promise<JobTimeEntry | null> {
	const entries = await listJobTimeEntries(env, jobId);
	const active = entries.find((e) => !e['Ended At']);
	if (!active) return null;
	return updateRow(
		env,
		jobTimeEntryConfig,
		active['Job Time Entry ID'],
		{ 'Ended At': endedAt, 'Duration Minutes': String(minutesBetween(active['Started At'], endedAt)) },
		{ ...meta, action: 'Time segment ended' }
	);
}

export async function startTimeSegment(
	env: SheetsEnv,
	jobId: string,
	category: TimeCategory,
	meta: Meta = {}
): Promise<{ job: Job; entry: JobTimeEntry }> {
	const job = await findById(env, jobConfig, jobId);
	if (!job) throw new Error(`Job "${jobId}" not found`);

	const now = new Date().toISOString();
	await endActiveSegment(env, jobId, now, meta);
	const entry = await createRow(env, jobTimeEntryConfig, { 'Job ID': jobId, 'Time Category': category, 'Started At': now }, meta);

	const patch: Partial<Job> = { 'Job Day State': category };
	if (job['Job Status'] === 'Unscheduled' || job['Job Status'] === 'Scheduled') {
		patch['Job Status'] = 'In Progress';
	}
	const updatedJob = await updateRow(env, jobConfig, jobId, patch, { ...meta, action: `Job day: started ${category}` });
	return { job: updatedJob, entry };
}

export async function pauseJobDay(env: SheetsEnv, jobId: string, meta: Meta = {}): Promise<Job> {
	const now = new Date().toISOString();
	await endActiveSegment(env, jobId, now, meta);
	return updateRow(env, jobConfig, jobId, { 'Job Day State': 'Paused' }, { ...meta, action: 'Job day paused' });
}

/** Manual correction interface: lets the owner fix a segment's timestamps
 * (or notes) after the fact without deleting and re-creating it. Recomputes
 * Duration Minutes whenever both timestamps end up present. */
export async function correctTimeEntry(
	env: SheetsEnv,
	entryId: string,
	patch: { startedAt?: string; endedAt?: string; notes?: string },
	meta: Meta = {}
): Promise<JobTimeEntry> {
	const entry = await findById(env, jobTimeEntryConfig, entryId);
	if (!entry) throw new Error(`Job time entry "${entryId}" not found`);

	const startedAt = patch.startedAt ?? entry['Started At'];
	const endedAt = patch.endedAt ?? entry['Ended At'];
	const updatePatch: Partial<JobTimeEntry> = { 'Started At': startedAt, 'Ended At': endedAt };
	if (patch.notes !== undefined) updatePatch.Notes = patch.notes;
	if (startedAt && endedAt) updatePatch['Duration Minutes'] = String(minutesBetween(startedAt, endedAt));

	return updateRow(env, jobTimeEntryConfig, entryId, updatePatch, { ...meta, action: 'Time entry corrected' });
}

export async function addManualTimeEntry(
	env: SheetsEnv,
	jobId: string,
	input: { category: TimeCategory; startedAt: string; endedAt: string; notes?: string },
	meta: Meta = {}
): Promise<JobTimeEntry> {
	const patch: Partial<JobTimeEntry> = {
		'Job ID': jobId,
		'Time Category': input.category,
		'Started At': input.startedAt,
		'Ended At': input.endedAt,
		Notes: input.notes ?? '',
	};
	if (input.startedAt && input.endedAt) {
		patch['Duration Minutes'] = String(minutesBetween(input.startedAt, input.endedAt));
	}
	return createRow(env, jobTimeEntryConfig, patch, meta);
}

export interface TimeSummary {
	byCategoryMinutes: Record<string, number>;
	onSiteHours: number;
}

/** Only Setup/Cleaning/Inspection/Pack-up count toward on-site labor (the
 * $150/hour target's denominator) — Travel/Off-Site Admin/Callback are
 * summed for visibility but excluded here, matching the plan's target-rate
 * definition. */
export function summarizeTimeEntries(entries: JobTimeEntry[]): TimeSummary {
	const byCategoryMinutes: Record<string, number> = {};
	for (const cat of TIME_CATEGORIES) byCategoryMinutes[cat] = 0;
	for (const e of entries) {
		const minutes = Number(e['Duration Minutes']) || 0;
		byCategoryMinutes[e['Time Category']] = (byCategoryMinutes[e['Time Category']] ?? 0) + minutes;
	}
	const onSiteMinutes = ON_SITE_TIME_CATEGORIES.reduce((sum, c) => sum + (byCategoryMinutes[c] ?? 0), 0);
	return { byCategoryMinutes, onSiteHours: onSiteMinutes / 60 };
}

export interface ChecklistItem {
	key: string;
	label: string;
}

const EXTERIOR_CODES = ['WINDOW_EXT_STANDARD', 'WINDOW_EXT_OVERSIZED', 'WINDOW_EXT_FRENCH_PANE', 'SLIDING_DOOR_EXT', 'SKYLIGHT_EXT'];
const INTERIOR_CODES = ['WINDOW_INT_STANDARD', 'WINDOW_INT_OVERSIZED', 'WINDOW_INT_FRENCH_PANE', 'SLIDING_DOOR_INT', 'SKYLIGHT_INT'];
const SCREEN_CODES = ['SCREEN_CLEAN'];
const TRACK_CODES = ['TRACK_BASIC', 'TRACK_DEEP'];
const SPECIALTY_GLASS_CODES = [
	'WINDOW_EXT_OVERSIZED',
	'WINDOW_INT_OVERSIZED',
	'WINDOW_EXT_FRENCH_PANE',
	'WINDOW_INT_FRENCH_PANE',
	'SKYLIGHT_EXT',
	'SKYLIGHT_INT',
	'SLIDING_DOOR_EXT',
	'SLIDING_DOOR_INT',
];

/** Generates the Job Day checklist from the job's quoted scope (QuoteItems)
 * so it reflects what was actually sold, not a generic fixed list. When
 * there's no linked quote to read scope from (e.g. a historical-import job
 * with no Quote ID), falls back to the full checklist rather than guessing
 * which steps don't apply. */
export function computeJobChecklist(quoteItems: QuoteItem[]): ChecklistItem[] {
	const hasScope = quoteItems.some((i) => (Number(i.Quantity) || 0) > 0);
	const codes = new Set(quoteItems.filter((i) => (Number(i.Quantity) || 0) > 0).map((i) => i['Service Code']));
	const hasAny = (options: string[]) => !hasScope || options.some((code) => codes.has(code));

	const items: ChecklistItem[] = [
		{ key: 'confirm_scope', label: 'Confirm scope' },
		{ key: 'confirm_access', label: 'Confirm access' },
	];
	if (hasAny(EXTERIOR_CODES)) items.push({ key: 'exterior_complete', label: 'Exterior complete' });
	if (hasAny(INTERIOR_CODES)) items.push({ key: 'interior_complete', label: 'Interior complete' });
	if (hasAny(SCREEN_CODES)) items.push({ key: 'screens_complete', label: 'Screens complete' });
	if (hasAny(TRACK_CODES)) items.push({ key: 'tracks_complete', label: 'Tracks complete' });
	if (hasAny(SPECIALTY_GLASS_CODES)) items.push({ key: 'specialty_glass_complete', label: 'Specialty glass complete' });
	items.push(
		{ key: 'final_inspection', label: 'Final inspection' },
		{ key: 'client_walkthrough', label: 'Client walkthrough' },
		{ key: 'equipment_packed', label: 'Equipment packed' },
		{ key: 'payment_or_invoice_handled', label: 'Payment or invoice handled' }
	);
	return items;
}

export function parseChecklistState(raw: string): Record<string, boolean> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export async function setChecklistItemState(
	env: SheetsEnv,
	jobId: string,
	key: string,
	checked: boolean,
	meta: Meta = {}
): Promise<Job> {
	const job = await findById(env, jobConfig, jobId);
	if (!job) throw new Error(`Job "${jobId}" not found`);
	const state = parseChecklistState(job['Job Checklist (JSON)']);
	state[key] = checked;
	return updateRow(env, jobConfig, jobId, { 'Job Checklist (JSON)': JSON.stringify(state) }, { ...meta, action: 'Job checklist updated' });
}

export interface CompleteJobDayInput {
	completedAt?: string;
	finalPrice: string;
	suppliesCost?: string;
	gas?: string;
	otherExpenses?: string;
	callbackRequired?: string;
	callbackCost?: string;
	jobNotes?: string;
	scopeChanges?: string;
	paymentStatus: string;
}

/**
 * Closes out the job day: ends any still-running timer segment, sums the
 * recorded time entries into the job's existing per-category Time columns
 * (reusing them rather than inventing new ones) and Actual Time (hrs) —
 * on-site categories only — computes Total Job Cost/Net Profit from the
 * entered direct costs, then hands off to updateJobStatus (which already
 * pre-fills the maintenance follow-up date and recalculates calibration on
 * a transition into Completed/Invoiced/Paid — reused as-is, not duplicated
 * here). Never touches PricingConfig.
 */
export async function completeJobDay(env: SheetsEnv, jobId: string, input: CompleteJobDayInput, meta: Meta = {}): Promise<Job> {
	const now = input.completedAt || new Date().toISOString();
	await endActiveSegment(env, jobId, now, meta);

	const entries = await listJobTimeEntries(env, jobId);
	const { byCategoryMinutes, onSiteHours } = summarizeTimeEntries(entries);

	const suppliesCost = Number(input.suppliesCost) || 0;
	const gas = Number(input.gas) || 0;
	const otherExpenses = Number(input.otherExpenses) || 0;
	const totalJobCost = suppliesCost + gas + otherExpenses;
	const finalPrice = Number(input.finalPrice) || 0;

	const patch: Partial<Job> = {
		'Date Completed': now.slice(0, 10),
		'Finish Timestamp': now,
		'Final Price ($)': input.finalPrice ?? '',
		'Actual Time (hrs)': onSiteHours ? onSiteHours.toFixed(2) : '',
		'Travel Time': byCategoryMinutes.Travel ? String(byCategoryMinutes.Travel) : '',
		'Setup Time': byCategoryMinutes.Setup ? String(byCategoryMinutes.Setup) : '',
		'Cleaning Time': byCategoryMinutes.Cleaning ? String(byCategoryMinutes.Cleaning) : '',
		'Inspection Time': byCategoryMinutes.Inspection ? String(byCategoryMinutes.Inspection) : '',
		'Pack-up Time': byCategoryMinutes['Pack-up'] ? String(byCategoryMinutes['Pack-up']) : '',
		'Off-Site Admin Time': byCategoryMinutes['Off-Site Admin'] ? String(byCategoryMinutes['Off-Site Admin']) : '',
		'Callback Labor Minutes': byCategoryMinutes.Callback ? String(byCategoryMinutes.Callback) : '',
		'Supplies Cost': input.suppliesCost ?? '',
		Gas: input.gas ?? '',
		'Other Expenses': input.otherExpenses ?? '',
		'Total Job Cost': totalJobCost ? String(totalJobCost) : '',
		'Net Profit': input.finalPrice || totalJobCost ? String(finalPrice - totalJobCost) : '',
		'Callback Required (Y/N)': input.callbackRequired ?? '',
		'Callback Cost': input.callbackCost ?? '',
		'Job Notes': input.jobNotes ?? '',
		'Scope Changes': input.scopeChanges ?? '',
		'Payment Status': input.paymentStatus ?? '',
		'Job Day State': 'Completed',
	};

	const status = input.paymentStatus === 'Paid in Full' ? 'Paid' : 'Completed';
	return updateJobStatus(env, jobId, status, patch, meta);
}
