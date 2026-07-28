import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { clientSchema } from '../models/client';
import { pipelineSchema } from '../models/pipeline';
import { qbCustomerSchema } from '../models/qbCustomer';
import { qbEstimateSchema } from '../models/qbEstimate';
import { qbInvoiceSchema } from '../models/qbInvoice';
import { qbPaymentSchema } from '../models/qbPayment';
import { getLastSyncAt, runFullSync, syncSingleEntity, type QBSyncEnv } from './sync';
import type { QBTokenStore, QBTokens } from './tokens';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

class FakeKV implements QBTokenStore {
	private store = new Map<string, string>();
	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('QB sync', () => {
	let harness: FakeFetchHandle;
	let qbFetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Response | Promise<Response>>>;
	let env: QBSyncEnv;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('QBCustomers', [Object.keys(qbCustomerSchema.shape)]);
		harness.spreadsheet.setTab('QBEstimates', [Object.keys(qbEstimateSchema.shape)]);
		harness.spreadsheet.setTab('QBInvoices', [Object.keys(qbInvoiceSchema.shape)]);
		harness.spreadsheet.setTab('QBPayments', [Object.keys(qbPaymentSchema.shape)]);
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Pipeline', [Object.keys(pipelineSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);

		// Layer a QB-API fake on top of the Sheets fake: QB-host URLs go to
		// qbFetchMock (configured per test), everything else falls through to
		// the Sheets fake installFakeFetch just installed.
		const sheetsFetch = globalThis.fetch;
		qbFetchMock = vi.fn();
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('quickbooks.api.intuit.com') || url.includes('oauth.platform.intuit.com')) {
				return qbFetchMock(url, init);
			}
			return sheetsFetch(input, init);
		}) as typeof fetch;

		const qbTokens = new FakeKV();
		const tokens: QBTokens = { accessToken: 'valid-token', refreshToken: 'r', realmId: 'realm-1', accessExpiresAt: Date.now() + 60 * 60 * 1000, refreshExpiresAt: Date.now() + 999_999_999 };
		await qbTokens.put('qb-tokens', JSON.stringify(tokens));

		env = { ...harness.env, QB_TOKENS: qbTokens, QB_CLIENT_ID: 'id', QB_CLIENT_SECRET: 'secret', QB_REDIRECT_URI: 'https://x.test/api/qb/callback' };
	});

	afterEach(() => {
		harness.restore();
	});

	it('syncs customers/estimates/invoices/payments and creates new mirror rows', async () => {
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes('FROM Customer')) return jsonResponse({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Jane Doe', MetaData: { LastUpdatedTime: '2026-01-01T00:00:00Z' } }] } });
			if (url.includes('FROM Estimate')) return jsonResponse({ QueryResponse: { Estimate: [{ Id: '10', CustomerRef: { value: '1' }, TotalAmt: 500 }] } });
			if (url.includes('FROM Invoice')) return jsonResponse({ QueryResponse: { Invoice: [{ Id: '20', CustomerRef: { value: '1' }, TotalAmt: 500, Balance: 0 }] } });
			if (url.includes('FROM Payment')) return jsonResponse({ QueryResponse: { Payment: [{ Id: '30', CustomerRef: { value: '1' }, TotalAmt: 500 }] } });
			return jsonResponse({ QueryResponse: {} });
		});

		const result = await runFullSync(env);

		expect(result.customers.created).toBe(1);
		expect(result.estimates.created).toBe(1);
		expect(result.invoices.created).toBe(1);
		expect(result.payments.created).toBe(1);

		const customerRows = harness.spreadsheet.getTab('QBCustomers');
		const headers = customerRows[0];
		const row = customerRows.find((r) => r[headers.indexOf('QB Customer ID')] === '1');
		expect(row?.[headers.indexOf('Display Name')]).toBe('Jane Doe');

		expect(await getLastSyncAt(env.QB_TOKENS)).toBeTruthy();
	});

	it('is idempotent — syncing the same customer twice updates rather than duplicates', async () => {
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes('FROM Customer')) return jsonResponse({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Jane Doe' }] } });
			return jsonResponse({ QueryResponse: {} });
		});

		await runFullSync(env);
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes('FROM Customer')) return jsonResponse({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Jane Doe Updated' }] } });
			return jsonResponse({ QueryResponse: {} });
		});
		const result = await runFullSync(env);

		expect(result.customers.created).toBe(0);
		expect(result.customers.updated).toBe(1);
		const rows = harness.spreadsheet.getTab('QBCustomers').slice(1).filter((r) => r[0] === '1');
		expect(rows).toHaveLength(1);
		const headers = harness.spreadsheet.getTab('QBCustomers')[0];
		expect(rows[0][headers.indexOf('Display Name')]).toBe('Jane Doe Updated');
	});

	it('filters by the incremental watermark on the second sync', async () => {
		qbFetchMock.mockImplementation(() => jsonResponse({ QueryResponse: {} }));
		await runFullSync(env);
		await runFullSync(env);

		// The second sync's queries should include a MetaData.LastUpdatedTime
		// filter (the watermark from the first run's start time).
		const secondRunCalls = qbFetchMock.mock.calls.slice(4); // after the first 4 entity queries
		const anyWatermarked = secondRunCalls.some((call) => decodeURIComponent(call[0]).includes('MetaData.LastUpdatedTime >'));
		expect(anyWatermarked).toBe(true);
	});

	it('does not advance the watermark or write anything when a fetch fails partway through', async () => {
		let call = 0;
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes('FROM Customer')) return jsonResponse({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Jane' }] } });
			if (url.includes('FROM Estimate')) {
				call++;
				return new Response('server error', { status: 500 });
			}
			return jsonResponse({ QueryResponse: {} });
		});

		await expect(runFullSync(env)).rejects.toThrow();
		expect(call).toBeGreaterThan(0);
		expect(await getLastSyncAt(env.QB_TOKENS)).toBeNull();

		const activityRows = harness.spreadsheet.getTab('ActivityLog').slice(1);
		expect(activityRows.some((r) => String(r[3]).includes('failed'))).toBe(true);
	});

	it('syncSingleEntity upserts just the one targeted record', async () => {
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes("Id = '99'")) return jsonResponse({ QueryResponse: { Customer: [{ Id: '99', DisplayName: 'Targeted Customer' }] } });
			return jsonResponse({ QueryResponse: {} });
		});

		await syncSingleEntity(env, 'Customer', '99');

		const rows = harness.spreadsheet.getTab('QBCustomers');
		const headers = rows[0];
		const row = rows.find((r) => r[headers.indexOf('QB Customer ID')] === '99');
		expect(row?.[headers.indexOf('Display Name')]).toBe('Targeted Customer');
	});

	// Syncing an Estimate must never touch Pipeline — QuickBooks does not
	// create or move Pipeline cards (simplification pass: all QB activity is
	// manual, and the board is entirely owner-driven).
	it('syncSingleEntity for an Estimate writes only the mirror row, never a Pipeline opportunity', async () => {
		harness.spreadsheet.setTab('Pipeline', [Object.keys(pipelineSchema.shape)]);
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes("Id = '77'")) {
				return jsonResponse({
					QueryResponse: { Estimate: [{ Id: '77', DocNumber: 'E-77', TotalAmt: 500, TxnStatus: 'Pending', CustomerRef: { value: 'cust-1' } }] },
				});
			}
			return jsonResponse({ QueryResponse: {} });
		});

		await syncSingleEntity(env, 'Estimate', '77');

		const estimates = harness.spreadsheet.getTab('QBEstimates');
		expect(estimates.slice(1).length).toBe(1);
		// The Pipeline tab still holds nothing but its header row.
		expect(harness.spreadsheet.getTab('Pipeline').slice(1)).toHaveLength(0);
	});
});
