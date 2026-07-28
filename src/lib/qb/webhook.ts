// Verifies and parses QuickBooks webhook deliveries — nothing more.
//
// All QuickBooks activity in this app is manual (button press only), so
// webhook deliveries are deliberately NOT applied. The route that consumes
// this module (src/pages/api/qb/webhook.ts) verifies the signature, records
// that a change happened in QuickBooks, and stops there; pulling those
// changes in is the owner's explicit "Sync now" action. The event-applying
// function that used to live here (handleWebhookEvent → deleteMirrorRow /
// mergeMirrorRow / syncSingleEntity) was removed rather than left dormant,
// so there is no path back to automatic syncing without a deliberate
// rewrite.

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** HMAC-SHA256 of the raw request body using the Webhook Verifier Token,
 * compared timing-safely against the `intuit-signature` header (base64). */
export async function verifyWebhookSignature(rawBody: string, signatureHeader: string, verifierToken: string): Promise<boolean> {
	if (!signatureHeader || !verifierToken) return false;

	let expectedBytes: Uint8Array;
	try {
		expectedBytes = base64ToBytes(signatureHeader);
	} catch {
		return false;
	}

	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(verifierToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));

	return timingSafeEqual(new Uint8Array(signature), expectedBytes);
}

export interface WebhookEvent {
	realmId: string;
	name: string;
	id: string;
	operation: string;
	deletedId?: string;
}

interface RawWebhookPayload {
	eventNotifications?: Array<{
		realmId?: string;
		dataChangeEvent?: {
			entities?: Array<{ name?: string; id?: string; operation?: string; deletedId?: string }>;
		};
	}>;
}

export function parseWebhookEvents(body: unknown): WebhookEvent[] {
	const payload = body as RawWebhookPayload;
	const events: WebhookEvent[] = [];
	for (const notification of payload.eventNotifications ?? []) {
		for (const entity of notification.dataChangeEvent?.entities ?? []) {
			if (!entity.name || !entity.id || !entity.operation) continue;
			events.push({ realmId: notification.realmId ?? '', name: entity.name, id: entity.id, operation: entity.operation, deletedId: entity.deletedId });
		}
	}
	return events;
}
