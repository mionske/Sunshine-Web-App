import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ensureColumn } from '../../../lib/sheets';

// One-off, additive-only: appends the "Property ID" column to the end of
// the existing Jobs tab (a reliable join to Properties, replacing fragile
// address-substring matching). Per the Jobs-preservation protocol, this
// only appends after whatever is already there — never reorders, deletes,
// or overwrites existing columns. Idempotent.
export const POST: APIRoute = async () => {
	try {
		const added = await ensureColumn(env, 'Jobs', 'Property ID');
		return new Response(JSON.stringify({ ok: true, added }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
