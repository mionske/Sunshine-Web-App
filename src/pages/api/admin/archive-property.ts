import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { softDeleteRow } from '../../../lib/sheets';
import { propertyConfig } from '../../../lib/models/property';

// Internal-only. Soft-deletes (Archived At, never hard-deleted) a Property
// row — for cleaning up a mistaken duplicate created via "Add property".
export const POST: APIRoute = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) {
		return new Response(JSON.stringify({ ok: false, error: 'id required' }), { status: 400 });
	}
	try {
		const archived = await softDeleteRow(env, propertyConfig, id);
		return new Response(JSON.stringify({ ok: true, archived }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
