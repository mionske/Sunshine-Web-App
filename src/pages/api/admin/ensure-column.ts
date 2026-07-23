import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ensureColumn } from '../../../lib/sheets';

// Internal-only, idempotent. Appends a single new header column to an
// app-owned tab (never Jobs — see extend-jobs-tab.ts for that tab's own
// careful process).
export const POST: APIRoute = async ({ url }) => {
	const tab = url.searchParams.get('tab');
	const column = url.searchParams.get('column');
	if (!tab || !column) {
		return new Response(JSON.stringify({ ok: false, error: 'tab and column required' }), { status: 400 });
	}
	try {
		const added = await ensureColumn(env, tab, column);
		return new Response(JSON.stringify({ ok: true, added }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
