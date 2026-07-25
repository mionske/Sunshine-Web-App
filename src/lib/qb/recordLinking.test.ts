import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { clientConfig, clientSchema } from '../models/client';
import { quoteConfig, quoteSchema } from '../models/quote';
import { jobConfig, jobSchema } from '../models/job';
import { qbEstimateConfig, qbEstimateSchema } from '../models/qbEstimate';
import { qbInvoiceConfig, qbInvoiceSchema } from '../models/qbInvoice';
import { qbPaymentConfig, qbPaymentSchema } from '../models/qbPayment';
import { qbCustomerConfig, qbCustomerSchema } from '../models/qbCustomer';
import { QBRelinkConfirmationRequiredError } from './matching';
import {
	confirmQBEstimateLink,
	confirmQBInvoiceLink,
	findPaymentsForInvoice,
	findQBEstimateCandidates,
	findQBInvoiceCandidates,
	findStrongJobMatchSuggestion,
	findStrongQuoteMatchSuggestion,
	getLinkedQBEstimate,
	getLinkedQBInvoice,
} from './recordLinking';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

describe('recordLinking', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Quotes', [Object.keys(quoteSchema.shape)]);
		harness.spreadsheet.setTab('Jobs', [Object.keys(jobSchema.shape)]);
		harness.spreadsheet.setTab('QBCustomers', [Object.keys(qbCustomerSchema.shape)]);
		harness.spreadsheet.setTab('QBEstimates', [Object.keys(qbEstimateSchema.shape)]);
		harness.spreadsheet.setTab('QBInvoices', [Object.keys(qbInvoiceSchema.shape)]);
		harness.spreadsheet.setTab('QBPayments', [Object.keys(qbPaymentSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => harness.restore());

	describe('confirmQBEstimateLink / confirmQBInvoiceLink', () => {
		it('links a Quote to a QBEstimate and logs activity', async () => {
			const quote = await createRow(harness.env, quoteConfig, { 'Final Quoted Price': '1400' });
			const updated = await confirmQBEstimateLink(harness.env, quote['Quote ID'], 'qbe-1');
			expect(updated['QB Estimate ID']).toBe('qbe-1');

			const activityRows = harness.spreadsheet.getTab('ActivityLog').slice(1);
			expect(activityRows.some((r) => String(r[3]).includes('QB Estimate linked'))).toBe(true);
		});

		it('requires explicit confirmation before overwriting an existing different Estimate link', async () => {
			const quote = await createRow(harness.env, quoteConfig, { 'QB Estimate ID': 'qbe-old' });
			await expect(confirmQBEstimateLink(harness.env, quote['Quote ID'], 'qbe-new')).rejects.toBeInstanceOf(
				QBRelinkConfirmationRequiredError
			);
			const updated = await confirmQBEstimateLink(harness.env, quote['Quote ID'], 'qbe-new', { confirmRelink: true });
			expect(updated['QB Estimate ID']).toBe('qbe-new');
		});

		it('links a Job to a QBInvoice and logs activity', async () => {
			const job = await createRow(harness.env, jobConfig, { 'Final Price ($)': '840' });
			const updated = await confirmQBInvoiceLink(harness.env, job['Job ID'], 'qbi-1');
			expect(updated['QB Invoice ID']).toBe('qbi-1');

			const activityRows = harness.spreadsheet.getTab('ActivityLog').slice(1);
			expect(activityRows.some((r) => String(r[3]).includes('QB Invoice linked'))).toBe(true);
		});

		it('requires explicit confirmation before overwriting an existing different Invoice link', async () => {
			const job = await createRow(harness.env, jobConfig, { 'QB Invoice ID': 'qbi-old' });
			await expect(confirmQBInvoiceLink(harness.env, job['Job ID'], 'qbi-new')).rejects.toBeInstanceOf(
				QBRelinkConfirmationRequiredError
			);
			const updated = await confirmQBInvoiceLink(harness.env, job['Job ID'], 'qbi-new', { confirmRelink: true });
			expect(updated['QB Invoice ID']).toBe('qbi-new');
		});
	});

	describe('getLinkedQBEstimate / getLinkedQBInvoice', () => {
		it('returns null when unlinked', async () => {
			const quote = await createRow(harness.env, quoteConfig, {});
			expect(await getLinkedQBEstimate(harness.env, quote)).toBeNull();
		});

		it('returns null when linked but the mirror row is gone (object missing)', async () => {
			const quote = await createRow(harness.env, quoteConfig, { 'QB Estimate ID': 'qbe-ghost' });
			expect(await getLinkedQBEstimate(harness.env, quote)).toBeNull();
		});

		it('returns the linked row when present', async () => {
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-1', Total: '1400' });
			const quote = await createRow(harness.env, quoteConfig, { 'QB Estimate ID': 'qbe-1' });
			const linked = await getLinkedQBEstimate(harness.env, quote);
			expect(linked?.Total).toBe('1400');
		});

		it('same behavior for Job/QBInvoice', async () => {
			await createRow(harness.env, qbInvoiceConfig, { id: 'qbi-1', Total: '840' });
			const job = await createRow(harness.env, jobConfig, { 'QB Invoice ID': 'qbi-1' });
			const linked = await getLinkedQBInvoice(harness.env, job);
			expect(linked?.Total).toBe('840');
		});
	});

	describe('findQBEstimateCandidates / findQBInvoiceCandidates', () => {
		it('scopes to one QB Customer by default, widens with searchAll', async () => {
			await createRow(harness.env, qbCustomerConfig, { id: 'qbc-1', 'Display Name': 'Alec Slocum' });
			await createRow(harness.env, qbCustomerConfig, { id: 'qbc-2', 'Display Name': 'Stevie Damboise' });
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-1', 'QB Customer ID': 'qbc-1', 'Doc Number': '1023' });
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-2', 'QB Customer ID': 'qbc-2', 'Doc Number': '1099' });

			const scoped = await findQBEstimateCandidates(harness.env, { qbCustomerId: 'qbc-1' });
			expect(scoped.map((c) => c.estimate['QB Estimate ID'])).toEqual(['qbe-1']);

			const all = await findQBEstimateCandidates(harness.env, { qbCustomerId: 'qbc-1', searchAll: true });
			expect(all).toHaveLength(2);
		});

		it('filters by query against Doc Number, Total, Txn Date, and joined Customer Display Name', async () => {
			await createRow(harness.env, qbCustomerConfig, { id: 'qbc-1', 'Display Name': 'Alec Slocum' });
			await createRow(harness.env, qbInvoiceConfig, { id: 'qbi-1', 'QB Customer ID': 'qbc-1', 'Doc Number': '1087', Total: '840' });

			const byName = await findQBInvoiceCandidates(harness.env, { searchAll: true, query: 'slocum' });
			expect(byName).toHaveLength(1);

			const byNumber = await findQBInvoiceCandidates(harness.env, { searchAll: true, query: '1087' });
			expect(byNumber).toHaveLength(1);

			const noMatch = await findQBInvoiceCandidates(harness.env, { searchAll: true, query: 'nobody' });
			expect(noMatch).toHaveLength(0);
		});
	});

	describe('findPaymentsForInvoice', () => {
		it('finds payments whose Linked Invoice IDs includes this invoice', async () => {
			await createRow(harness.env, qbPaymentConfig, { id: 'qbp-1', 'Linked Invoice IDs': 'qbi-1,qbi-2', 'Payment Date': '2026-06-20' });
			await createRow(harness.env, qbPaymentConfig, { id: 'qbp-2', 'Linked Invoice IDs': 'qbi-3' });

			const payments = await findPaymentsForInvoice(harness.env, 'qbi-1');
			expect(payments.map((p) => p['QB Payment ID'])).toEqual(['qbp-1']);
		});
	});

	describe('findStrongQuoteMatchSuggestion / findStrongJobMatchSuggestion', () => {
		// Quote's 'Created At' is always stamped to the real current time by
		// createRow() (it force-overwrites that field, unlike plain fields) —
		// so date-tolerance tests override it on the in-memory object after
		// creation rather than fighting that, since findStrongQuoteMatchSuggestion
		// takes the Quote object directly and never re-reads it from Sheets.
		it('suggests the one unlinked Estimate within total/date tolerance for an already QB-linked client', async () => {
			const client = await createRow(harness.env, clientConfig, { 'QB Customer ID': 'qbc-1' });
			const created = await createRow(harness.env, quoteConfig, {
				'Client ID': client['Client ID'],
				'Final Quoted Price': '1400',
			});
			const quote = { ...created, 'Created At': '2026-06-01T00:00:00.000Z' };
			await createRow(harness.env, qbEstimateConfig, {
				id: 'qbe-1',
				'QB Customer ID': 'qbc-1',
				Total: '1400',
				'Txn Date': '2026-06-01',
			});

			const suggestion = await findStrongQuoteMatchSuggestion(harness.env, quote, client);
			expect(suggestion?.['QB Estimate ID']).toBe('qbe-1');
		});

		it('does not suggest when multiple candidates match (ambiguous)', async () => {
			const client = await createRow(harness.env, clientConfig, { 'QB Customer ID': 'qbc-1' });
			const created = await createRow(harness.env, quoteConfig, {
				'Client ID': client['Client ID'],
				'Final Quoted Price': '1400',
			});
			const quote = { ...created, 'Created At': '2026-06-01T00:00:00.000Z' };
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-1', 'QB Customer ID': 'qbc-1', Total: '1400', 'Txn Date': '2026-06-01' });
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-2', 'QB Customer ID': 'qbc-1', Total: '1401', 'Txn Date': '2026-06-02' });

			expect(await findStrongQuoteMatchSuggestion(harness.env, quote, client)).toBeNull();
		});

		it('does not suggest when the total is outside tolerance', async () => {
			const client = await createRow(harness.env, clientConfig, { 'QB Customer ID': 'qbc-1' });
			const quote = await createRow(harness.env, quoteConfig, { 'Client ID': client['Client ID'], 'Final Quoted Price': '1400' });
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-1', 'QB Customer ID': 'qbc-1', Total: '2000' });

			expect(await findStrongQuoteMatchSuggestion(harness.env, quote, client)).toBeNull();
		});

		it('respects a dismissed suggestion — the same Estimate never resurfaces', async () => {
			const client = await createRow(harness.env, clientConfig, { 'QB Customer ID': 'qbc-1' });
			const quote = await createRow(harness.env, quoteConfig, {
				'Client ID': client['Client ID'],
				'Final Quoted Price': '1400',
				'QB Match Suggestion Dismissed': 'qbe-1',
			});
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-1', 'QB Customer ID': 'qbc-1', Total: '1400' });

			expect(await findStrongQuoteMatchSuggestion(harness.env, quote, client)).toBeNull();
		});

		it('never suggests when the client has no QB Customer ID', async () => {
			const client = await createRow(harness.env, clientConfig, {});
			const quote = await createRow(harness.env, quoteConfig, { 'Client ID': client['Client ID'], 'Final Quoted Price': '1400' });
			await createRow(harness.env, qbEstimateConfig, { id: 'qbe-1', 'QB Customer ID': 'qbc-1', Total: '1400' });

			expect(await findStrongQuoteMatchSuggestion(harness.env, quote, client)).toBeNull();
		});

		it('suggests the one unlinked Invoice within tolerance for a Job the same way', async () => {
			const client = await createRow(harness.env, clientConfig, { 'QB Customer ID': 'qbc-1' });
			const job = await createRow(harness.env, jobConfig, { 'Final Price ($)': '840', 'Date Completed': '2026-06-18' });
			await createRow(harness.env, qbInvoiceConfig, { id: 'qbi-1', 'QB Customer ID': 'qbc-1', Total: '840', 'Txn Date': '2026-06-18' });

			const suggestion = await findStrongJobMatchSuggestion(harness.env, job, client);
			expect(suggestion?.['QB Invoice ID']).toBe('qbi-1');
		});
	});
});
