import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ensureColumns } from '../../../lib/sheets';

// Internal-only, idempotent. Appends header columns to an app-owned tab
// (never Jobs — see extend-jobs-tab.ts for that tab's own careful process).
//
// Takes either ?column=One or ?columns=One,Two,Three. The batch form is one
// read and one write no matter how many columns, which matters because the
// Sheets API allows 60 reads a minute and a schema change can easily want
// thirty columns across a few tabs.
export const POST: APIRoute = async ({ url }) => {
	const tab = url.searchParams.get('tab');
	const single = url.searchParams.get('column');
	const batch = url.searchParams.get('columns');
	const requested = (batch ? batch.split(',') : single ? [single] : []).map((c) => c.trim()).filter(Boolean);

	if (!tab || requested.length === 0) {
		return new Response(JSON.stringify({ ok: false, error: 'tab and column (or columns) required' }), { status: 400 });
	}
	try {
		const added = await ensureColumns(env, tab, requested);
		return new Response(JSON.stringify({ ok: true, added, alreadyPresent: requested.length - added.length }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
