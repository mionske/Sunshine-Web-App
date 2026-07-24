import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { SESSION_COOKIE_NAME, verifySessionToken } from './lib/auth';

// Explicit allowlist of routes reachable without a session. Everything else
// — every internal page and every internal API route — requires auth.
// Prefix-matched so /estimate/anything and /api/estimate/anything also stay
// public without needing an entry per sub-route.
//
// /api/qb/webhook is here because Intuit calls it directly, server-to-
// server, with no session cookie at all — its security comes from the
// intuit-signature HMAC check inside the route itself, not from this
// middleware. /api/qb/callback is here for a different reason: it's
// reached via a cross-site top-level redirect *from* appcenter.intuit.com,
// and a SameSite=Strict cookie (this app's session cookie) is dropped on
// exactly that kind of request — so by the time the browser lands back on
// this route, the session cookie the owner had a moment earlier is simply
// not present, and this middleware would otherwise 401 a legitimate
// connect attempt. The route's own CSRF protection (a one-time state value
// checked against a SameSite=Lax cookie set right before the redirect to
// Intuit) is what actually secures it, not session auth.
const PUBLIC_PATH_PREFIXES = ['/estimate', '/api/estimate', '/login', '/api/qb/webhook', '/api/qb/callback'];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;

	if (isPublicPath(pathname)) {
		return next();
	}

	const signingSecret = env.SESSION_SIGNING_SECRET;
	if (!signingSecret) {
		// Misconfiguration (missing secret) must fail closed, not open.
		return new Response('Server misconfigured', { status: 500 });
	}

	const cookieToken = context.cookies.get(SESSION_COOKIE_NAME)?.value;
	const session = await verifySessionToken(cookieToken, signingSecret);

	if (!session) {
		if (pathname.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		return context.redirect(`/login?next=${encodeURIComponent(pathname)}`);
	}

	return next();
});
