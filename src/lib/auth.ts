// Password gate + signed session cookie helpers. No external session store —
// a single signed, expiring cookie is enough for one user.
//
// Two separate secrets are required (never the same value): AUTH_PASSWORD
// gates login, SESSION_SIGNING_SECRET signs the session token. Mixing them
// would mean a leaked session cookie and a leaked password compromise each
// other.

export const SESSION_COOKIE_NAME = 'sww_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export interface SessionPayload {
	iat: number;
	exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	const keyData = new TextEncoder().encode(secret);
	return crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
		'verify',
	]);
}

function base64UrlEncode(bytes: ArrayBuffer): string {
	let binary = '';
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Creates a signed, expiring session token: base64url(payload).base64url(signature) */
export async function createSessionToken(signingSecret: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload: SessionPayload = { iat: now, exp: now + SESSION_TTL_SECONDS };
	const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
	const key = await hmacKey(signingSecret);
	const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);
	return `${base64UrlEncode(payloadBytes.buffer as ArrayBuffer)}.${base64UrlEncode(signature)}`;
}

/** Verifies signature and expiry. Returns the payload if valid, otherwise null. */
export async function verifySessionToken(
	token: string | undefined | null,
	signingSecret: string
): Promise<SessionPayload | null> {
	if (!token) return null;
	const parts = token.split('.');
	if (parts.length !== 2) return null;
	const [payloadPart, signaturePart] = parts;
	try {
		const payloadBytes = base64UrlDecode(payloadPart);
		const signatureBytes = base64UrlDecode(signaturePart);
		const key = await hmacKey(signingSecret);
		const valid = await crypto.subtle.verify(
			'HMAC',
			key,
			signatureBytes as BufferSource,
			payloadBytes as BufferSource
		);
		if (!valid) return null;
		const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SessionPayload;
		if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
		return payload;
	} catch {
		return null;
	}
}

// Use with Astro's `cookies.set()`/`cookies.delete()` API (not a manually
// built Set-Cookie header appended to Astro.response.headers) — Astro only
// reliably preserves cookies set through its own Cookies API across an
// `Astro.redirect()` call, since the redirect constructs a fresh Response.
//
// `Secure` cookies are refused by browsers on a plain-http origin. Production
// (Cloudflare Pages) is always https, so this only relaxes the attribute for
// local `astro dev`/`astro preview`, never for the deployed app.
export function sessionCookieOptions() {
	return {
		path: '/',
		httpOnly: true,
		secure: import.meta.env.PROD,
		sameSite: 'strict' as const,
		maxAge: SESSION_TTL_SECONDS,
	};
}

/**
 * Constant-time-ish password check. Not perfectly constant-time (JS string
 * comparison), but this app has a single low-value shared password behind
 * rate limiting, not a target worth timing-attack hardening beyond this.
 */
export function checkPassword(submitted: string, expected: string): boolean {
	if (submitted.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < submitted.length; i++) {
		diff |= submitted.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

// --- Login rate limiting -----------------------------------------------
// In-memory per-isolate limiter. Cloudflare Workers isolates are short-lived
// and can be evicted at any time, so this is a best-effort throttle, not a
// durable guarantee — acceptable for a single-user internal tool where the
// goal is slowing down casual password guessing, not stopping a determined
// distributed attacker (which would need Durable Objects/KV to do properly).

const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 60;

export function isRateLimited(clientKey: string): boolean {
	const now = Date.now();
	const entry = attempts.get(clientKey);
	if (!entry || entry.resetAt < now) return false;
	return entry.count >= MAX_ATTEMPTS;
}

export function recordLoginAttempt(clientKey: string): void {
	const now = Date.now();
	const entry = attempts.get(clientKey);
	if (!entry || entry.resetAt < now) {
		attempts.set(clientKey, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
		return;
	}
	entry.count += 1;
}

export function clearLoginAttempts(clientKey: string): void {
	attempts.delete(clientKey);
}
