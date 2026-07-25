// Quote↔QBEstimate and Job↔QBInvoice linking — the same "read-only mirror,
// human confirms every link, never auto-linked" philosophy as
// lib/qb/matching.ts's Client↔QBCustomer linking, applied one level down.
// Nothing here writes back to QuickBooks; it only ever writes the chosen
// QB Estimate/Invoice ID onto the app's own Quote/Job row.
import { findById, listActiveRows, updateRow, type SheetsEnv } from '../sheets';
import { quoteConfig, type Quote } from '../models/quote';
import { jobConfig, type Job } from '../models/job';
import { qbEstimateConfig, type QBEstimate } from '../models/qbEstimate';
import { qbInvoiceConfig, type QBInvoice } from '../models/qbInvoice';
import { qbPaymentConfig, type QBPayment } from '../models/qbPayment';
import { qbCustomerConfig, type QBCustomer } from '../models/qbCustomer';
import { QBRelinkConfirmationRequiredError } from './matching';
import type { Client } from '../models/client';

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function normalizeQuery(value: string): string {
	return value.trim().toLowerCase();
}

export interface QBEstimateCandidate {
	estimate: QBEstimate;
	customer?: QBCustomer;
}

export interface QBInvoiceCandidate {
	invoice: QBInvoice;
	customer?: QBCustomer;
}

/** Searches the QBEstimates mirror, either scoped to one QB Customer
 * (`qbCustomerId`, the safe default whenever the Quote's Client is already
 * QB-linked) or across the whole mirror (`searchAll` — the only option
 * when the Client isn't linked yet, and an explicit opt-out otherwise).
 * `query` matches against Doc Number, the joined Customer's Display Name,
 * Txn Date, and Total — plain substring/equality checks, no fuzzy scoring,
 * since the mirror tables are small enough that a simple filter is all
 * that's needed. */
export async function findQBEstimateCandidates(
	env: SheetsEnv,
	opts: { qbCustomerId?: string; searchAll?: boolean; query?: string }
): Promise<QBEstimateCandidate[]> {
	const [estimates, customers] = await Promise.all([
		listActiveRows(env, qbEstimateConfig),
		listActiveRows(env, qbCustomerConfig),
	]);
	const customerById = new Map(customers.map((c) => [c['QB Customer ID'], c]));

	let scoped = estimates;
	if (opts.qbCustomerId && !opts.searchAll) {
		scoped = scoped.filter((e) => e['QB Customer ID'] === opts.qbCustomerId);
	}

	const q = opts.query ? normalizeQuery(opts.query) : '';
	if (q) {
		scoped = scoped.filter((e) => {
			const customer = customerById.get(e['QB Customer ID']);
			return (
				e['Doc Number'].toLowerCase().includes(q) ||
				e['Txn Date'].toLowerCase().includes(q) ||
				e.Total.toLowerCase().includes(q) ||
				(customer?.['Display Name'] ?? '').toLowerCase().includes(q)
			);
		});
	}

	return scoped.map((estimate) => ({ estimate, customer: customerById.get(estimate['QB Customer ID']) }));
}

/** Same shape as findQBEstimateCandidates, for QBInvoices. */
export async function findQBInvoiceCandidates(
	env: SheetsEnv,
	opts: { qbCustomerId?: string; searchAll?: boolean; query?: string }
): Promise<QBInvoiceCandidate[]> {
	const [invoices, customers] = await Promise.all([
		listActiveRows(env, qbInvoiceConfig),
		listActiveRows(env, qbCustomerConfig),
	]);
	const customerById = new Map(customers.map((c) => [c['QB Customer ID'], c]));

	let scoped = invoices;
	if (opts.qbCustomerId && !opts.searchAll) {
		scoped = scoped.filter((i) => i['QB Customer ID'] === opts.qbCustomerId);
	}

	const q = opts.query ? normalizeQuery(opts.query) : '';
	if (q) {
		scoped = scoped.filter((i) => {
			const customer = customerById.get(i['QB Customer ID']);
			return (
				i['Doc Number'].toLowerCase().includes(q) ||
				i['Txn Date'].toLowerCase().includes(q) ||
				i.Total.toLowerCase().includes(q) ||
				(customer?.['Display Name'] ?? '').toLowerCase().includes(q)
			);
		});
	}

	return scoped.map((invoice) => ({ invoice, customer: customerById.get(invoice['QB Customer ID']) }));
}

/** Links a Quote to a QBEstimate — always an explicit human confirmation,
 * mirroring confirmQBLink's re-link guard exactly (same shared error
 * class, just a different entity label). */
export async function confirmQBEstimateLink(
	env: SheetsEnv,
	quoteId: string,
	qbEstimateId: string,
	opts: { confirmRelink?: boolean; user?: string; requestId?: string } = {}
): Promise<Quote> {
	const quote = await findById(env, quoteConfig, quoteId);
	if (!quote) throw new Error(`Quote "${quoteId}" not found`);

	const previous = quote['QB Estimate ID'];
	if (previous && previous !== qbEstimateId && !opts.confirmRelink) {
		throw new QBRelinkConfirmationRequiredError(previous, 'QB Estimate');
	}

	return updateRow(env, quoteConfig, quoteId, { 'QB Estimate ID': qbEstimateId }, { ...opts, action: 'QB Estimate linked' });
}

/** Links a Job to a QBInvoice — same pattern as confirmQBEstimateLink. */
export async function confirmQBInvoiceLink(
	env: SheetsEnv,
	jobId: string,
	qbInvoiceId: string,
	opts: { confirmRelink?: boolean; user?: string; requestId?: string } = {}
): Promise<Job> {
	const job = await findById(env, jobConfig, jobId);
	if (!job) throw new Error(`Job "${jobId}" not found`);

	const previous = job['QB Invoice ID'];
	if (previous && previous !== qbInvoiceId && !opts.confirmRelink) {
		throw new QBRelinkConfirmationRequiredError(previous, 'QB Invoice');
	}

	return updateRow(env, jobConfig, jobId, { 'QB Invoice ID': qbInvoiceId }, { ...opts, action: 'QB Invoice linked' });
}

/** Reads the QBEstimate a Quote is linked to. Returns null both when
 * unlinked and when the ID is set but the mirror row is gone (deleted/
 * merged in QuickBooks and removed by the webhook) — callers distinguish
 * "not linked" from "object missing" using quote['QB Estimate ID'] itself. */
export async function getLinkedQBEstimate(env: SheetsEnv, quote: Quote): Promise<QBEstimate | null> {
	if (!quote['QB Estimate ID']) return null;
	return findById(env, qbEstimateConfig, quote['QB Estimate ID']);
}

export async function getLinkedQBInvoice(env: SheetsEnv, job: Job): Promise<QBInvoice | null> {
	if (!job['QB Invoice ID']) return null;
	return findById(env, qbInvoiceConfig, job['QB Invoice ID']);
}

/** Every QBPayment whose 'Linked Invoice IDs' (a comma-joined string)
 * includes this invoice's ID — used for the Invoice summary card's
 * "Amount Paid"/"Payment Date" (QBInvoice itself carries Total/Balance but
 * not a payment date; that only exists on the Payment side). */
export async function findPaymentsForInvoice(env: SheetsEnv, qbInvoiceId: string): Promise<QBPayment[]> {
	const payments = await listActiveRows(env, qbPaymentConfig);
	return payments.filter((p) =>
		p['Linked Invoice IDs']
			.split(',')
			.map((id) => id.trim())
			.includes(qbInvoiceId)
	);
}

const TOTAL_TOLERANCE_FLAT = 5;
const TOTAL_TOLERANCE_PCT = 0.02;
const DATE_TOLERANCE_DAYS = 45;

function withinTotalTolerance(a: number, b: number): boolean {
	const tolerance = Math.max(TOTAL_TOLERANCE_FLAT, Math.abs(a) * TOTAL_TOLERANCE_PCT);
	return Math.abs(a - b) <= tolerance;
}

function withinDateTolerance(isoOrDate: string, txnDate: string): boolean {
	if (!isoOrDate || !txnDate) return true; // no date to compare against — don't let a missing date rule out an otherwise-strong match
	const a = new Date(isoOrDate).getTime();
	const b = new Date(txnDate).getTime();
	if (Number.isNaN(a) || Number.isNaN(b)) return true;
	return Math.abs(a - b) <= DATE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
}

/** "Potential QuickBooks Match Found" — only ever suggested when the
 * Quote's Client is already QB-linked, the Quote itself isn't yet linked,
 * and exactly one of that customer's not-already-linked QBEstimates falls
 * within total/date tolerance of this Quote's own Final Quoted Price/date.
 * Zero or multiple candidates both return null — ambiguity always falls
 * back to the manual search UI, never a guess. "Matching property" from
 * the original brief has no signal to check here: QBEstimate only ever
 * carries a Customer, never a Property, so the Client-level match is the
 * practical ceiling on that criterion in this codebase. */
export async function findStrongQuoteMatchSuggestion(env: SheetsEnv, quote: Quote, client: Client): Promise<QBEstimate | null> {
	const qbCustomerId = client['QB Customer ID'];
	if (!qbCustomerId || quote['QB Estimate ID']) return null;

	const [estimates, allQuotes] = await Promise.all([listActiveRows(env, qbEstimateConfig), listActiveRows(env, quoteConfig)]);
	const alreadyLinkedIds = new Set(allQuotes.map((q) => q['QB Estimate ID']).filter(Boolean));

	const quoteTotal = num(quote['Final Quoted Price']);
	const quoteDate = quote['Accepted At'] || quote['Created At'];

	const candidates = estimates.filter(
		(e) =>
			e['QB Customer ID'] === qbCustomerId &&
			!alreadyLinkedIds.has(e['QB Estimate ID']) &&
			e['QB Estimate ID'] !== quote['QB Match Suggestion Dismissed'] &&
			withinTotalTolerance(quoteTotal, num(e.Total)) &&
			withinDateTolerance(quoteDate, e['Txn Date'])
	);

	return candidates.length === 1 ? candidates[0] : null;
}

/** Same as findStrongQuoteMatchSuggestion, for Job↔QBInvoice. */
export async function findStrongJobMatchSuggestion(env: SheetsEnv, job: Job, client: Client): Promise<QBInvoice | null> {
	const qbCustomerId = client['QB Customer ID'];
	if (!qbCustomerId || job['QB Invoice ID']) return null;

	const [invoices, allJobs] = await Promise.all([listActiveRows(env, qbInvoiceConfig), listActiveRows(env, jobConfig)]);
	const alreadyLinkedIds = new Set(allJobs.map((j) => j['QB Invoice ID']).filter(Boolean));

	const jobTotal = num(job['Final Price ($)']);
	const jobDate = job['Date Completed'] || job['Scheduled Date'];

	const candidates = invoices.filter(
		(i) =>
			i['QB Customer ID'] === qbCustomerId &&
			!alreadyLinkedIds.has(i['QB Invoice ID']) &&
			i['QB Invoice ID'] !== job['QB Match Suggestion Dismissed'] &&
			withinTotalTolerance(jobTotal, num(i.Total)) &&
			withinDateTolerance(jobDate, i['Txn Date'])
	);

	return candidates.length === 1 ? candidates[0] : null;
}

export { qboEstimateWebUrl, qboInvoiceWebUrl } from './matching';
