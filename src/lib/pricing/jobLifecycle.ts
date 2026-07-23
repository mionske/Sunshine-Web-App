// Quote acceptance and the Job lifecycle that follows it:
//   Lead → Quote → Accepted Quote → Scheduled Job → Completed Job →
//   Invoiced Job → Paid Job
//
// A Job created here always starts as Unscheduled/Scheduled — never
// Completed — and per the plan's calibration rule, a Job only counts toward
// calibration once its Status is Completed/Invoiced/Paid *and* actual
// labor/revenue/cost/callback fields are filled in (enforced in Phase 9's
// calibration query, not here).
import { createRow, findById, listActiveRows, logActivity, updateRow, type SheetsEnv } from '../sheets';
import { jobConfig, JOB_STATUSES, type Job } from '../models/job';
import { quoteConfig, type Quote } from '../models/quote';
import { propertyConfig } from '../models/property';
import { pipelineConfig } from '../models/pipeline';
import { recalculateCalibration } from './calibration';

const CALIBRATION_TRIGGER_STATUSES = new Set(['Completed', 'Invoiced', 'Paid']);

export async function findJobByQuoteId(env: SheetsEnv, quoteId: string): Promise<Job | undefined> {
	const jobs = await listActiveRows(env, jobConfig);
	return jobs.find((j) => j['Quote ID'] === quoteId);
}

async function createJobFromQuote(env: SheetsEnv, quote: Quote, scheduledDate?: string): Promise<Job> {
	const property = await findById(env, propertyConfig, quote['Property ID']);
	const windowCount = 0; // filled in once JobItems (Phase 8b) or manual entry populates it

	return createRow(env, jobConfig, {
		'Property Address': property ? `${property['Street Address']}, ${property.City}` : '',
		'Property ID': quote['Property ID'],
		'Quoted Price ($)': quote['Final Quoted Price'],
		'Estimated Time (hrs)': quote['Estimated Labor Hours'],
		'Window Count': String(windowCount),
		'Quote ID': quote['Quote ID'],
		'Opportunity ID': quote['Opportunity ID'],
		'Job Status': scheduledDate ? 'Scheduled' : 'Unscheduled',
		Version: '1',
	});
}

export interface AcceptQuoteResult {
	quote: Quote;
	job: Job;
}

/**
 * Accepts a quote: marks it Accepted, closes its linked Pipeline
 * opportunity (if any), and creates the Job that carries the work forward.
 * Idempotent — calling this twice for the same quote returns the
 * already-created job rather than creating a duplicate.
 */
export async function acceptQuote(
	env: SheetsEnv,
	quoteId: string,
	opts: { scheduledDate?: string; user?: string; requestId?: string } = {}
): Promise<AcceptQuoteResult> {
	const quote = await findById(env, quoteConfig, quoteId);
	if (!quote) {
		throw new Error(`Quote "${quoteId}" not found`);
	}

	const existingJob = await findJobByQuoteId(env, quoteId);
	if (existingJob) {
		return { quote, job: existingJob };
	}

	const now = new Date().toISOString();
	const updatedQuote = await updateRow(
		env,
		quoteConfig,
		quoteId,
		{ 'Quote Status': 'Accepted', 'Accepted At': now },
		{ user: opts.user, requestId: opts.requestId, action: 'Quote accepted' }
	);

	if (quote['Opportunity ID']) {
		await updateRow(
			env,
			pipelineConfig,
			quote['Opportunity ID'],
			{ Stage: 'Accepted', 'Closed At': now },
			{ user: opts.user, requestId: opts.requestId, action: 'Opportunity accepted' }
		);
	}

	const job = await createJobFromQuote(env, updatedQuote, opts.scheduledDate);

	await logActivity(env, {
		entityType: 'Job',
		entityId: job['Job ID'],
		action: 'Job created from accepted quote',
		user: opts.user,
		requestId: opts.requestId,
		notes: `Quote ID: ${quoteId}`,
	});

	return { quote: updatedQuote, job };
}

export { JOB_STATUSES };

/** Moves a Job to a new status, optionally setting other fields at the same
 * time (e.g. Actual Time/Final Price when marking Completed). Existing
 * legacy columns on the row are preserved untouched (see job.ts).
 *
 * Recalculates the calibration snapshot right after a transition into
 * Completed/Invoiced/Paid — one of the plan's documented recalculation
 * triggers, alongside the manual "Recalculate Calibration" action. */
export async function updateJobStatus(
	env: SheetsEnv,
	jobId: string,
	status: (typeof JOB_STATUSES)[number],
	patch: Partial<Job> = {},
	meta: { user?: string; requestId?: string } = {}
): Promise<Job> {
	const job = await updateRow(
		env,
		jobConfig,
		jobId,
		{ ...patch, 'Job Status': status },
		{ ...meta, action: `Job marked ${status}` }
	);

	if (CALIBRATION_TRIGGER_STATUSES.has(status)) {
		await recalculateCalibration(env, meta);
	}

	return job;
}
