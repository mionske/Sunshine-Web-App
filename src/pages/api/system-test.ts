import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { roundTripCheck, listSheetTitles, getValues } from '../../lib/sheets';
import { readHeaders } from '../../lib/sheets/rows';

// Internal-only (gated by middleware — not in the public allowlist). Lets us
// confirm the Sheets connection is actually live without touching any
// production business tab. ?list=1 lists tab titles, ?tab=<name> reads that
// tab's header row, ?tab=<name>&raw=1 dumps its first few rows — all
// read-only, useful when diagnosing the live spreadsheet's actual shape.
export const GET: APIRoute = async ({ url }) => {
	const tab = url.searchParams.get('tab');
	try {
		if (url.searchParams.has('list')) {
			const titles = await listSheetTitles(env);
			return new Response(JSON.stringify({ ok: true, titles }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		if (tab && url.searchParams.has('raw')) {
			const range = url.searchParams.get('range') ?? `'${tab}'!A1:AB10`;
			const values = await getValues(env, range);
			return new Response(JSON.stringify({ ok: true, tab, values }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		if (tab) {
			const headers = await readHeaders(env, tab, { fresh: true });
			return new Response(JSON.stringify({ ok: true, tab, headers }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		const result = await roundTripCheck(env);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
