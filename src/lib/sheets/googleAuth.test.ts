import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetTokenCacheForTests, getAccessToken } from './googleAuth';
import type { SheetsEnv } from './types';

function makeEnv(overrides: Partial<SheetsEnv> = {}): SheetsEnv {
	const { privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	return {
		SPREADSHEET_ID: 'fake-spreadsheet-id',
		GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
			client_email: 'fake@example.com',
			private_key: privateKey,
		}),
		...overrides,
	};
}

describe('getAccessToken', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		_resetTokenCacheForTests();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('exchanges a signed JWT for an access token', async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 })
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const token = await getAccessToken(makeEnv());
		expect(token).toBe('token-1');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toBe('https://oauth2.googleapis.com/token');
		expect(String(init?.body)).toContain('grant_type=urn');
	});

	it('caches the token and does not re-request until near expiry', async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 })
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const env = makeEnv();
		await getAccessToken(env);
		await getAccessToken(env);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('surfaces a clear error when the token endpoint rejects the request', async () => {
		globalThis.fetch = vi.fn(async () => new Response('invalid_grant', { status: 400 })) as unknown as typeof fetch;
		await expect(getAccessToken(makeEnv())).rejects.toThrow(/Google token exchange failed/);
	});

	it('throws a clear error for malformed service-account JSON', async () => {
		await expect(getAccessToken(makeEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: 'not json' }))).rejects.toThrow(
			/not valid JSON/
		);
	});
});
