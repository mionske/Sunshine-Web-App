import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { logActivity } from '../../../lib/sheets';
import { handleWebhookEvent, parseWebhookEvents, verifyWebhookSignature } from '../../../lib/qb/webhook';

// No session — Intuit calls this directly, server-to-server. Security
// comes from the intuit-signature HMAC check below, not a cookie (see the
// middleware's public-path allowlist and its comment on why that's safe).
export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();
	const signature = request.headers.get('intuit-signature') ?? '';

	const valid = await verifyWebhookSignature(rawBody, signature, env.QB_WEBHOOK_VERIFIER_TOKEN);
	if (!valid) {
		return new Response('Invalid signature', { status: 401 });
	}

	// Everything past this point is explicitly non-critical: the manual
	// full sync remains authoritative regardless, so any failure here is
	// logged and swallowed rather than surfaced to Intuit (which would
	// just retry and fail again identically).
	try {
		const events = parseWebhookEvents(JSON.parse(rawBody));
		for (const event of events) {
			try {
				await handleWebhookEvent(env, event);
			} catch (error) {
				await logActivity(env, {
					entityType: 'QBSync',
					entityId: `webhook:${event.name}:${event.id}`,
					action: 'QuickBooks webhook event failed',
					notes: (error as Error).message,
				});
			}
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
