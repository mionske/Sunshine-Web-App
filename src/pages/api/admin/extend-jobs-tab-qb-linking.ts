import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateValues } from '../../../lib/sheets';
import { columnLetterAt, readHeaders } from '../../../lib/sheets/rows';

// One-time, idempotent extension of the Jobs tab: adds 'QB Invoice ID' (the
// real Job<->QBInvoice link, replacing the manually-pasted 'QB Invoice
// Link') and 'QB Match Suggestion Dismissed' (see lib/qb/recordLinking.ts).
// Same pattern as extend-jobs-tab-historical-review.ts.
const NEW_JOBS_COLUMNS = ['QB Invoice ID', 'QB Match Suggestion Dismissed'];

export const POST: APIRoute = async () => {
	try {
		const headers = await readHeaders(env, 'Jobs', { fresh: true });
		if (headers.includes('QB Invoice ID')) {
			return new Response(JSON.stringify({ ok: true, alreadyExtended: true }), { status: 200 });
		}

		const startIndex = headers.length + 1;
		const endIndex = startIndex + NEW_JOBS_COLUMNS.length - 1;
		const range = `'Jobs'!${columnLetterAt(startIndex)}1:${columnLetterAt(endIndex)}1`;
		await updateValues(env, range, [NEW_JOBS_COLUMNS]);

		return new Response(JSON.stringify({ ok: true, range, columns: NEW_JOBS_COLUMNS }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
