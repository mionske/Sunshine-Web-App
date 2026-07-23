// Verifies and parses QuickBooks webhook deliveries. Explicitly non-
// critical: the manual full sync (lib/qb/sync.ts's runFullSync) remains
// authoritative regardless of anything that happens here — this is only a
// latency optimization.
import { deleteMirrorRow, mergeMirrorRow, syncSingleEntity, type QBEntityType, type QBSyncEnv } from './sync';

const SUPPORTED_ENTITIES = new Set<QBEntityType>(['Customer', 'Estimate', 'Invoice', 'Payment']);

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

/** Applies one webhook event. Unsupported/unrecognized entity types are
 * silently ignored (this app only mirrors Customer/Estimate/Invoice/
 * Payment) rather than throwing. */
export async function handleWebhookEvent(env: QBSyncEnv, event: WebhookEvent): Promise<void> {
	if (!SUPPORTED_ENTITIES.has(event.name as QBEntityType)) return;
	const entityType = event.name as QBEntityType;

	if (event.operation === 'Delete') {
		await deleteMirrorRow(env, entityType, event.id);
	} else if (event.operation === 'Merge') {
		const deletedId = event.deletedId ?? event.id;
		await mergeMirrorRow(env, entityType, deletedId, event.id);
	} else {
		// Create/Update (and anything else QB might send) — a targeted
		// re-fetch is always correct and idempotent regardless of which.
		await syncSingleEntity(env, entityType, event.id);
	}
}
