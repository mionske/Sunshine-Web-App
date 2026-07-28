import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { logActivity } from '../../../lib/sheets';
import { parseWebhookEvents, verifyWebhookSignature } from '../../../lib/qb/webhook';

// No session — Intuit calls this directly, server-to-server. Security
// comes from the intuit-signature HMAC check below, not a cookie (see the
// middleware's public-path allowlist and its comment on why that's safe).
//
// DELIBERATELY INERT. All QuickBooks activity in this app is manual: the
// only thing that may read from or write to QuickBooks is an explicit
// button press by the owner. This route therefore no longer applies
// webhook events — it does not call handleWebhookEvent, makes no QuickBooks
// API call, and mutates no app data. It exists only so Intuit's deliveries
// get a valid signed 200 instead of piling up as failed retries, and so the
// owner can see in Sync health that QuickBooks-side changes have happened
// and a manual sync is worth running.
export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();
	const signature = request.headers.get('intuit-signature') ?? '';

	const valid = await verifyWebhookSignature(rawBody, signature, env.QB_WEBHOOK_VERIFIER_TOKEN);
	if (!valid) {
		return new Response('Invalid signature', { status: 401 });
	}

	// Log receipt only — never act on it. A failure to even record the
	// notification is swallowed for the same reason it always was: Intuit
	// would only retry and fail identically.
	try {
		const events = parseWebhookEvents(JSON.parse(rawBody));
		if (events.length > 0) {
			const summary = events.map((e) => `${e.name} ${e.operation}`).join(', ');
			await logActivity(env, {
				entityType: 'QBSync',
				entityId: 'webhook',
				action: 'QuickBooks change notified (no action taken)',
				notes: `${events.length} change(s) in QuickBooks: ${summary}. Run a manual sync to pull them in.`,
			});
		}
	} catch (error) {
		await logActivity(env, {
			entityType: 'QBSync',
			entityId: 'webhook',
			action: 'QuickBooks webhook payload unreadable',
			notes: (error as Error).message,
		});
	}

	return new Response('OK', { status: 200 });
};
