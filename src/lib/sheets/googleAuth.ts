import { SignJWT, importPKCS8 } from 'jose';
import type { SheetsEnv } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

interface ServiceAccountCredentials {
	client_email: string;
	private_key: string;
}

interface CachedToken {
	accessToken: string;
	expiresAt: number; // epoch ms
}

// Per-isolate cache, keyed by scope — the same service account signs a
// separate JWT (and gets a separate access token) per OAuth scope it's
// asked for (Sheets, Calendar readonly, etc.), so one token can't stand in
// for another. Workers isolates are short-lived and never shared across
// requests from different customers here (single internal app), so a
// module-level cache is safe and avoids a token exchange on every request.
const cachedTokensByScope = new Map<string, CachedToken>();

function parseCredentials(json: string): ServiceAccountCredentials {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
	}
	const creds = parsed as Partial<ServiceAccountCredentials>;
	if (!creds.client_email || !creds.private_key) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
	}
	return creds as ServiceAccountCredentials;
}

async function requestAccessToken(env: SheetsEnv, scope: string): Promise<CachedToken> {
	const credentials = parseCredentials(env.GOOGLE_SERVICE_ACCOUNT_JSON);
	const privateKey = await importPKCS8(credentials.private_key, 'RS256');

	const now = Math.floor(Date.now() / 1000);
	const assertion = await new SignJWT({ scope })
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(credentials.client_email)
		.setSubject(credentials.client_email)
		.setAudience(TOKEN_URL)
		.setIssuedAt(now)
		.setExpirationTime(now + 3600)
		.sign(privateKey);

	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion,
		}),
	});

	if (!response.ok) {
		throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`);
	}

	const data = (await response.json()) as { access_token: string; expires_in: number };
	return {
		accessToken: data.access_token,
		expiresAt: Date.now() + data.expires_in * 1000,
	};
}

const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Defaults to the Sheets scope (every existing call site) — pass an
 * explicit `scope` for anything else reading via this same service account
 * (e.g. Calendar readonly). */
export async function getAccessToken(env: SheetsEnv, scope: string = SHEETS_SCOPE): Promise<string> {
	const cached = cachedTokensByScope.get(scope);
	if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
		return cached.accessToken;
	}
	const token = await requestAccessToken(env, scope);
	cachedTokensByScope.set(scope, token);
	return token.accessToken;
}

/** Test-only: force the next call to re-request a token. */
export function _resetTokenCacheForTests(): void {
	cachedTokensByScope.clear();
}
