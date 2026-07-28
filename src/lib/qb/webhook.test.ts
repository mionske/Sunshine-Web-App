import { describe, expect, it } from 'vitest';
import * as webhookModule from './webhook';
import { parseWebhookEvents, verifyWebhookSignature } from './webhook';

async function sign(body: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

describe('verifyWebhookSignature', () => {
	const secret = 'verifier-token-123';
	const body = JSON.stringify({ eventNotifications: [] });

	it('accepts a correctly signed body', async () => {
		const signature = await sign(body, secret);
		expect(await verifyWebhookSignature(body, signature, secret)).toBe(true);
	});

	it('rejects a tampered body', async () => {
		const signature = await sign(body, secret);
		expect(await verifyWebhookSignature(body + 'tampered', signature, secret)).toBe(false);
	});

	it('rejects a signature computed with the wrong secret', async () => {
		const signature = await sign(body, 'wrong-secret');
		expect(await verifyWebhookSignature(body, signature, secret)).toBe(false);
	});

	it('rejects a missing signature header or verifier token', async () => {
		expect(await verifyWebhookSignature(body, '', secret)).toBe(false);
		expect(await verifyWebhookSignature(body, await sign(body, secret), '')).toBe(false);
	});

	it('rejects a non-base64 signature header without throwing', async () => {
		expect(await verifyWebhookSignature(body, 'not valid base64!!!', secret)).toBe(false);
	});
});

describe('parseWebhookEvents', () => {
	it('flattens eventNotifications into a flat event list', () => {
		const events = parseWebhookEvents({
			eventNotifications: [
				{
					realmId: 'realm-1',
					dataChangeEvent: {
						entities: [
							{ name: 'Customer', id: '1', operation: 'Update' },
							{ name: 'Invoice', id: '5', operation: 'Merge', deletedId: '6' },
						],
					},
				},
			],
		});
		expect(events).toEqual([
			{ realmId: 'realm-1', name: 'Customer', id: '1', operation: 'Update', deletedId: undefined },
			{ realmId: 'realm-1', name: 'Invoice', id: '5', operation: 'Merge', deletedId: '6' },
		]);
	});

	it('ignores malformed entries missing required fields', () => {
		const events = parseWebhookEvents({ eventNotifications: [{ dataChangeEvent: { entities: [{ name: 'Customer' }] } }] });
		expect(events).toEqual([]);
	});

	it('handles a payload with no eventNotifications at all', () => {
		expect(parseWebhookEvents({})).toEqual([]);
	});
});

// Guardrail for the simplification pass: all QuickBooks activity is manual.
// This module must only verify and parse — it must never regain the ability
// to apply a webhook event (which previously pulled from QuickBooks, wrote
// mirror rows, soft-deleted records, and created Pipeline cards with no
// human involvement).
describe('webhook module surface (no automatic sync)', () => {
	it('exports only signature verification and parsing — no event applier', () => {
		expect(Object.keys(webhookModule).sort()).toEqual(['parseWebhookEvents', 'verifyWebhookSignature']);
	});

	it('does not depend on the sync module at all', async () => {
		const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('./webhook.ts', import.meta.url), 'utf8'));
		expect(source).not.toMatch(/^\s*import .* from '\.\/sync'/m);
	});
});
