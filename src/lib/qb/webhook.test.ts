import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { qbCustomerSchema } from '../models/qbCustomer';
import { qbInvoiceSchema } from '../models/qbInvoice';
import { handleWebhookEvent, parseWebhookEvents, verifyWebhookSignature } from './webhook';
import type { QBSyncEnv } from './sync';
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

async function sign(body: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

describe('verifyWebhookSignature', () => {
	const secret = 'verifier-token-123';
	const body = JSON.stringify({ eventNotifications: [] });

	it('accepts a correctly signed body', async () => {
		const signature = await sign(body, secret);
		expect(await verifyWebhookSignature(body, signature, secret)).toBe(true);
	});

	it('rejects a tampered body', async () => {
		const signature = await sign(body, secret);
		expect(await verifyWebhookSignature(body + 'tampered', signature, secret)).toBe(false);
	});

	it('rejects a signature computed with the wrong secret', async () => {
		const signature = await sign(body, 'wrong-secret');
		expect(await verifyWebhookSignature(body, signature, secret)).toBe(false);
	});

	it('rejects a missing signature header or verifier token', async () => {
		expect(await verifyWebhookSignature(body, '', secret)).toBe(false);
		expect(await verifyWebhookSignature(body, await sign(body, secret), '')).toBe(false);
	});

	it('rejects a non-base64 signature header without throwing', async () => {
		expect(await verifyWebhookSignature(body, 'not valid base64!!!', secret)).toBe(false);
	});
});

describe('parseWebhookEvents', () => {
	it('flattens eventNotifications into a flat event list', () => {
		const events = parseWebhookEvents({
			eventNotifications: [
				{
					realmId: 'realm-1',
					dataChangeEvent: {
						entities: [
							{ name: 'Customer', id: '1', operation: 'Update' },
							{ name: 'Invoice', id: '5', operation: 'Merge', deletedId: '6' },
						],
					},
				},
			],
		});
		expect(events).toEqual([
			{ realmId: 'realm-1', name: 'Customer', id: '1', operation: 'Update', deletedId: undefined },
			{ realmId: 'realm-1', name: 'Invoice', id: '5', operation: 'Merge', deletedId: '6' },
		]);
	});

	it('ignores malformed entries missing required fields', () => {
		const events = parseWebhookEvents({ eventNotifications: [{ dataChangeEvent: { entities: [{ name: 'Customer' }] } }] });
		expect(events).toEqual([]);
	});

	it('handles a payload with no eventNotifications at all', () => {
		expect(parseWebhookEvents({})).toEqual([]);
	});
});

describe('handleWebhookEvent (Sheets-backed)', () => {
	let harness: FakeFetchHandle;
	let qbFetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Response | Promise<Response>>>;
	let env: QBSyncEnv;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('QBCustomers', [Object.keys(qbCustomerSchema.shape)]);
		harness.spreadsheet.setTab('QBInvoices', [Object.keys(qbInvoiceSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);

		const sheetsFetch = globalThis.fetch;
		qbFetchMock = vi.fn();
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('quickbooks.api.intuit.com')) return qbFetchMock(url, init);
			return sheetsFetch(input, init);
		}) as typeof fetch;

		const qbTokens = new FakeKV();
		const tokens: QBTokens = { accessToken: 'valid', refreshToken: 'r', realmId: 'realm-1', accessExpiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 999_999_999 };
		await qbTokens.put('qb-tokens', JSON.stringify(tokens));
		env = { ...harness.env, QB_TOKENS: qbTokens, QB_CLIENT_ID: 'id', QB_CLIENT_SECRET: 'secret', QB_REDIRECT_URI: 'https://x.test/api/qb/callback' };
	});

	afterEach(() => harness.restore());

	function jsonResponse(body: unknown): Response {
		return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
	}

	it('Create/Update triggers a targeted sync of that entity', async () => {
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes("Id = '1'")) return jsonResponse({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Webhook Synced' }] } });
			return jsonResponse({ QueryResponse: {} });
		});

		await handleWebhookEvent(env, { realmId: 'realm-1', name: 'Customer', id: '1', operation: 'Update' });

		const rows = harness.spreadsheet.getTab('QBCustomers');
		const headers = rows[0];
		const row = rows.find((r) => r[headers.indexOf('QB Customer ID')] === '1');
		expect(row?.[headers.indexOf('Display Name')]).toBe('Webhook Synced');
	});

	it('Delete soft-deletes the mirror row for that id', async () => {
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes("Id = '1'")) return jsonResponse({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'To Delete' }] } });
			return jsonResponse({ QueryResponse: {} });
		});
		await handleWebhookEvent(env, { realmId: 'realm-1', name: 'Customer', id: '1', operation: 'Update' });

		await handleWebhookEvent(env, { realmId: 'realm-1', name: 'Customer', id: '1', operation: 'Delete' });

		const rows = harness.spreadsheet.getTab('QBCustomers');
		const headers = rows[0];
		const row = rows.find((r) => r[headers.indexOf('QB Customer ID')] === '1');
		expect(row?.[headers.indexOf('Archived At')]).toBeTruthy();
	});

	it('Merge deletes the losing id and re-fetches the surviving one', async () => {
		qbFetchMock.mockImplementation((rawUrl: string) => {
			const url = decodeURIComponent(rawUrl);
			if (url.includes("Id = '10'")) return jsonResponse({ QueryResponse: { Invoice: [{ Id: '10', TotalAmt: 100 }] } });
			if (url.includes("Id = '11'")) return jsonResponse({ QueryResponse: { Invoice: [{ Id: '11', TotalAmt: 250 }] } });
			return jsonResponse({ QueryResponse: {} });
		});
		await handleWebhookEvent(env, { realmId: 'realm-1', name: 'Invoice', id: '10', operation: 'Update' });

		await handleWebhookEvent(env, { realmId: 'realm-1', name: 'Invoice', id: '11', operation: 'Merge', deletedId: '10' });

		const rows = harness.spreadsheet.getTab('QBInvoices');
		const headers = rows[0];
		const oldRow = rows.find((r) => r[headers.indexOf('QB Invoice ID')] === '10');
		const newRow = rows.find((r) => r[headers.indexOf('QB Invoice ID')] === '11');
		expect(oldRow?.[headers.indexOf('Archived At')]).toBeTruthy();
		expect(newRow?.[headers.indexOf('Total')]).toBe('250');
	});

	it('silently ignores an unsupported entity type', async () => {
		await expect(handleWebhookEvent(env, { realmId: 'realm-1', name: 'Bill', id: '1', operation: 'Update' })).resolves.toBeUndefined();
		expect(qbFetchMock).not.toHaveBeenCalled();
	});
});
