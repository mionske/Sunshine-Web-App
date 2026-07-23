import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBTokenStore, QBTokens } from './tokens';
import { getStoredTokens } from './tokens';
import { buildAuthorizeUrl, disconnectQuickBooks, exchangeCodeForTokens, getValidAccessToken, QBNotConnectedError, refreshTokens, type QBOAuthEnv } from './oauth';

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

function makeEnv(): QBOAuthEnv {
	return {
		QB_TOKENS: new FakeKV(),
		QB_CLIENT_ID: 'client-id-123',
		QB_CLIENT_SECRET: 'client-secret-456',
		QB_REDIRECT_URI: 'https://example.com/api/qb/callback',
	};
}

describe('buildAuthorizeUrl', () => {
	it('includes the accounting scope, redirect URI, and state', () => {
		const url = buildAuthorizeUrl({ QB_CLIENT_ID: 'abc', QB_REDIRECT_URI: 'https://x.test/api/qb/callback' }, 'state-xyz');
		expect(url).toContain('https://appcenter.intuit.com/connect/oauth2?');
		expect(url).toContain('client_id=abc');
		expect(url).toContain('scope=com.intuit.quickbooks.accounting');
		expect(url).toContain(encodeURIComponent('https://x.test/api/qb/callback'));
		expect(url).toContain('state=state-xyz');
	});
});

describe('token exchange and refresh', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('exchanges an authorization code for tokens and persists them', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, x_refresh_token_expires_in: 8726400 }), { status: 200 })
		);
		const env = makeEnv();
		const tokens = await exchangeCodeForTokens(env, 'auth-code', 'realm-1', 1_000_000);

		expect(tokens.accessToken).toBe('access-1');
		expect(tokens.refreshToken).toBe('refresh-1');
		expect(tokens.realmId).toBe('realm-1');
		expect(tokens.accessExpiresAt).toBe(1_000_000 + 3600 * 1000);

		const stored = await getStoredTokens(env);
		expect(stored?.accessToken).toBe('access-1');

		const [, init] = fetchMock.mock.calls[0];
		expect(init.headers.Authorization).toMatch(/^Basic /);
	});

	it('always persists the rotated refresh token from a refresh call', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2-rotated', expires_in: 3600, x_refresh_token_expires_in: 8726400 }), { status: 200 })
		);
		const env = makeEnv();
		const current: QBTokens = { accessToken: 'access-1', refreshToken: 'refresh-1', realmId: 'realm-1', accessExpiresAt: 0, refreshExpiresAt: 999_999_999_999 };

		const refreshed = await refreshTokens(env, current, 2_000_000);

		expect(refreshed.refreshToken).toBe('refresh-2-rotated');
		const stored = await getStoredTokens(env);
		expect(stored?.refreshToken).toBe('refresh-2-rotated');
	});

	it('throws a clear error when the token endpoint rejects the exchange', async () => {
		fetchMock.mockResolvedValue(new Response('invalid_grant', { status: 400 }));
		const env = makeEnv();
		await expect(exchangeCodeForTokens(env, 'bad-code', 'realm-1')).rejects.toThrow(/token exchange failed/);
	});
});

describe('getValidAccessToken', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('throws QBNotConnectedError when never connected', async () => {
		const env = makeEnv();
		await expect(getValidAccessToken(env)).rejects.toBeInstanceOf(QBNotConnectedError);
	});

	it('returns the stored token without refreshing when comfortably valid', async () => {
		const env = makeEnv();
		const now = 1_000_000;
		await env.QB_TOKENS.put(
			'qb-tokens',
			JSON.stringify({ accessToken: 'still-good', refreshToken: 'r', realmId: 'realm-1', accessExpiresAt: now + 10 * 60 * 1000, refreshExpiresAt: now + 999_999_999 } satisfies QBTokens)
		);

		const result = await getValidAccessToken(env, now);
		expect(result.accessToken).toBe('still-good');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refreshes proactively when within 60 seconds of expiry', async () => {
		const env = makeEnv();
		const now = 1_000_000;
		await env.QB_TOKENS.put(
			'qb-tokens',
			JSON.stringify({ accessToken: 'about-to-expire', refreshToken: 'r', realmId: 'realm-1', accessExpiresAt: now + 30_000, refreshExpiresAt: now + 999_999_999 } satisfies QBTokens)
		);
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600, x_refresh_token_expires_in: 8726400 }), { status: 200 }));

		const result = await getValidAccessToken(env, now);
		expect(result.accessToken).toBe('fresh');
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('clears tokens and throws when the refresh token itself has expired', async () => {
		const env = makeEnv();
		const now = 1_000_000;
		await env.QB_TOKENS.put(
			'qb-tokens',
			JSON.stringify({ accessToken: 'expired', refreshToken: 'r', realmId: 'realm-1', accessExpiresAt: now - 1000, refreshExpiresAt: now - 1000 } satisfies QBTokens)
		);

		await expect(getValidAccessToken(env, now)).rejects.toBeInstanceOf(QBNotConnectedError);
		expect(await getStoredTokens(env)).toBeNull();
	});
});

describe('disconnectQuickBooks', () => {
	it('clears stored tokens', async () => {
		const env = makeEnv();
		await env.QB_TOKENS.put('qb-tokens', JSON.stringify({ accessToken: 'a', refreshToken: 'b', realmId: 'r', accessExpiresAt: 1, refreshExpiresAt: 1 }));
		await disconnectQuickBooks(env);
		expect(await getStoredTokens(env)).toBeNull();
	});
});
