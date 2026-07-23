import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBTokenStore, QBTokens } from './tokens';
import { queryAllPages, queryById, runQuery } from './client';
import type { QBOAuthEnv } from './oauth';

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

async function makeConnectedEnv(): Promise<QBOAuthEnv> {
	const env: QBOAuthEnv = { QB_TOKENS: new FakeKV(), QB_CLIENT_ID: 'id', QB_CLIENT_SECRET: 'secret', QB_REDIRECT_URI: 'https://x.test/api/qb/callback' };
	const tokens: QBTokens = { accessToken: 'valid-token', refreshToken: 'r', realmId: 'realm-1', accessExpiresAt: Date.now() + 60 * 60 * 1000, refreshExpiresAt: Date.now() + 999_999_999 };
	await env.QB_TOKENS.put('qb-tokens', JSON.stringify(tokens));
	return env;
}

describe('runQuery', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('returns the array under the entity key', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ QueryResponse: { Customer: [{ Id: '1' }, { Id: '2' }] } }), { status: 200 }));
		const env = await makeConnectedEnv();
		const rows = await runQuery(env, 'Customer', "SELECT * FROM Customer");
		expect(rows).toEqual([{ Id: '1' }, { Id: '2' }]);
	});

	it('returns an empty array when the entity key is absent (no results)', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 }));
		const env = await makeConnectedEnv();
		expect(await runQuery(env, 'Customer', 'SELECT * FROM Customer')).toEqual([]);
	});

	it('sends a bearer token and the realmId in the URL', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 }));
		const env = await makeConnectedEnv();
		await runQuery(env, 'Customer', 'SELECT * FROM Customer');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/v3/company/realm-1/query');
		expect(init.headers.Authorization).toBe('Bearer valid-token');
	});

	it('throws with status and body on a non-ok response', async () => {
		fetchMock.mockResolvedValue(new Response('bad request', { status: 400 }));
		const env = await makeConnectedEnv();
		await expect(runQuery(env, 'Customer', 'SELECT * FROM Customer')).rejects.toThrow(/QuickBooks query failed: 400/);
	});
});

describe('queryAllPages', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('pages until a page comes back short of MAXRESULTS', async () => {
		const fullPage = Array.from({ length: 1000 }, (_, i) => ({ Id: String(i) }));
		const shortPage = [{ Id: '1000' }, { Id: '1001' }];
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: { Customer: fullPage } }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: { Customer: shortPage } }), { status: 200 }));

		const env = await makeConnectedEnv();
		const results = await queryAllPages(env, 'Customer', '');

		expect(results).toHaveLength(1002);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const secondUrl = decodeURIComponent(fetchMock.mock.calls[1][0]);
		expect(secondUrl).toContain('STARTPOSITION 1001');
	});

	it('stops after a single short page', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: { Customer: [{ Id: '1' }] } }), { status: 200 }));
		const env = await makeConnectedEnv();
		const results = await queryAllPages(env, 'Customer', '');
		expect(results).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('includes the watermark WHERE clause when provided', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 }));
		const env = await makeConnectedEnv();
		await queryAllPages(env, 'Customer', "MetaData.LastUpdatedTime > '2026-01-01T00:00:00Z'");
		const url = decodeURIComponent(fetchMock.mock.calls[0][0]);
		expect(url).toContain("WHERE MetaData.LastUpdatedTime > '2026-01-01T00:00:00Z'");
	});
});

describe('queryById', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('fetches a single record by numeric id', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: { Customer: [{ Id: '42' }] } }), { status: 200 }));
		const env = await makeConnectedEnv();
		const result = await queryById(env, 'Customer', '42');
		expect(result).toEqual({ Id: '42' });
	});

	it('returns null when nothing matches', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 }));
		const env = await makeConnectedEnv();
		expect(await queryById(env, 'Customer', '999')).toBeNull();
	});

	it('rejects a non-numeric id without making a request', async () => {
		const env = await makeConnectedEnv();
		await expect(queryById(env, 'Customer', "1' OR '1'='1")).rejects.toThrow(/Invalid QuickBooks ID/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('retry/backoff', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('retries on 429 honoring Retry-After, then succeeds', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: { Customer: [{ Id: '1' }] } }), { status: 200 }));

		const env = await makeConnectedEnv();
		const promise = runQuery(env, 'Customer', 'SELECT * FROM Customer');
		await vi.advanceTimersByTimeAsync(1000);
		const result = await promise;

		expect(result).toEqual([{ Id: '1' }]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('gives up and returns the final error response after 5 retries', async () => {
		fetchMock.mockResolvedValue(new Response('still limited', { status: 429 }));
		const env = await makeConnectedEnv();
		const promise = runQuery(env, 'Customer', 'SELECT * FROM Customer').catch((e: Error) => e);
		await vi.advanceTimersByTimeAsync(120_000);
		const result = await promise;

		expect(result).toBeInstanceOf(Error);
		expect(fetchMock).toHaveBeenCalledTimes(6); // initial + 5 retries
	});
});
