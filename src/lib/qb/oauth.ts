// OAuth2 Authorization Code flow against Intuit's Production endpoints —
// no Sandbox phase (see Phase 14 spec). The redirect URI is a real route
// on this app's own domain (/api/qb/callback), so unlike a native app there
// is no loopback-server workaround needed.
import { clearTokens, getStoredTokens, saveTokens, type QBTokenEnv, type QBTokens } from './tokens';

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QB_SCOPE = 'com.intuit.quickbooks.accounting';

// Refresh proactively when within this many milliseconds of expiry — never
// let a mid-batch-sync request hit an expired token.
const REFRESH_MARGIN_MS = 60_000;

export interface QBOAuthEnv extends QBTokenEnv {
	QB_CLIENT_ID: string;
	QB_CLIENT_SECRET: string;
	QB_REDIRECT_URI: string;
}

export function buildAuthorizeUrl(env: Pick<QBOAuthEnv, 'QB_CLIENT_ID' | 'QB_REDIRECT_URI'>, state: string): string {
	const params = new URLSearchParams({
		client_id: env.QB_CLIENT_ID,
		response_type: 'code',
		scope: QB_SCOPE,
		redirect_uri: env.QB_REDIRECT_URI,
		state,
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
	return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number; // seconds
	x_refresh_token_expires_in: number; // seconds
}

function tokensFromResponse(body: TokenResponse, realmId: string, now: number): QBTokens {
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		realmId,
		accessExpiresAt: now + body.expires_in * 1000,
		refreshExpiresAt: now + body.x_refresh_token_expires_in * 1000,
	};
}

/** Exchanges the authorization code from /api/qb/callback's query params
 * for the initial token pair, and persists them. */
export async function exchangeCodeForTokens(env: QBOAuthEnv, code: string, realmId: string, now = Date.now()): Promise<QBTokens> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: {
			Authorization: basicAuthHeader(env.QB_CLIENT_ID, env.QB_CLIENT_SECRET),
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: env.QB_REDIRECT_URI }),
	});
	if (!response.ok) {
		throw new Error(`QuickBooks token exchange failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as TokenResponse;
	const tokens = tokensFromResponse(body, realmId, now);
	await saveTokens(env, tokens);
	return tokens;
}

/** Intuit rotates the refresh token on every refresh call — always persist
 * the new one, never assume the old one still works. */
export async function refreshTokens(env: QBOAuthEnv, current: QBTokens, now = Date.now()): Promise<QBTokens> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: {
			Authorization: basicAuthHeader(env.QB_CLIENT_ID, env.QB_CLIENT_SECRET),
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken }),
	});
	if (!response.ok) {
		throw new Error(`QuickBooks token refresh failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as TokenResponse;
	const tokens = tokensFromResponse(body, current.realmId, now);
	await saveTokens(env, tokens);
	return tokens;
}

export class QBNotConnectedError extends Error {
	constructor() {
		super('QuickBooks is not connected — connect from the QuickBooks settings page first.');
		this.name = 'QBNotConnectedError';
	}
}

/** Returns a currently-valid access token (and realmId), refreshing
 * proactively when within 60 seconds of expiry. Every sync/query call goes
 * through this rather than reading stored tokens directly, so a mid-batch
 * expiry can never happen. */
export async function getValidAccessToken(env: QBOAuthEnv, now = Date.now()): Promise<{ accessToken: string; realmId: string }> {
	const stored = await getStoredTokens(env);
	if (!stored) throw new QBNotConnectedError();

	if (stored.refreshExpiresAt <= now) {
		await clearTokens(env);
		throw new QBNotConnectedError();
	}

	if (stored.accessExpiresAt - now > REFRESH_MARGIN_MS) {
		return { accessToken: stored.accessToken, realmId: stored.realmId };
	}

	const refreshed = await refreshTokens(env, stored, now);
	return { accessToken: refreshed.accessToken, realmId: refreshed.realmId };
}

export async function disconnectQuickBooks(env: QBTokenEnv): Promise<void> {
	await clearTokens(env);
}
