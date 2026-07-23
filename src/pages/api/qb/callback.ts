import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { exchangeCodeForTokens } from '../../../lib/qb/oauth';

// Reached by the user's own browser after they authorize this app in
// QuickBooks — stays behind this app's normal session auth (the browser
// still carries the session cookie from before it navigated to Intuit),
// unlike the webhook route which has no session at all.
const STATE_COOKIE_NAME = 'qb_oauth_state';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const realmId = url.searchParams.get('realmId');
	const error = url.searchParams.get('error');

	const expectedState = cookies.get(STATE_COOKIE_NAME)?.value;
	cookies.delete(STATE_COOKIE_NAME, { path: '/' });

	if (error) {
		return redirect(`/qb-settings?error=${encodeURIComponent(error)}`);
	}
	if (!code || !realmId) {
		return redirect(`/qb-settings?error=${encodeURIComponent('Missing code or realmId from QuickBooks')}`);
	}
	if (!state || !expectedState || state !== expectedState) {
		return redirect(`/qb-settings?error=${encodeURIComponent('OAuth state mismatch — please try connecting again')}`);
	}

	try {
		await exchangeCodeForTokens(env, code, realmId);
		return redirect('/qb-settings?connected=1');
	} catch (e) {
		return redirect(`/qb-settings?error=${encodeURIComponent((e as Error).message)}`);
	}
};
