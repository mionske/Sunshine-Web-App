import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { deleteRows } from '../../../lib/sheets';
import { readRows } from '../../../lib/sheets/rows';

// Internal-only. Hard-deletes rows matching an exact column value — for
// discarding test/verification data created while exercising a feature
// live. Never used for real business records (those go through the
// soft-delete path in apiCrud.ts instead).
export const POST: APIRoute = async ({ url }) => {
	const tab = url.searchParams.get('tab');
	const matchColumn = url.searchParams.get('matchColumn');
	const matchValue = url.searchParams.get('matchValue');
	const rowsParam = url.searchParams.get('rows');
	try {
		if (!tab) {
			return new Response(JSON.stringify({ ok: false, error: 'tab required' }), { status: 400 });
		}
		if (rowsParam) {
			// Explicit row numbers — for corrupted/misaligned rows that have
			// no reliable column value left to match against.
			const rowNumbers = rowsParam.split(',').map(Number).filter(Number.isFinite);
			await deleteRows(env, tab, rowNumbers);
			return new Response(JSON.stringify({ ok: true, deleted: rowNumbers.length }), { status: 200 });
		}
		if (!matchColumn || !matchValue) {
			return new Response(
				JSON.stringify({ ok: false, error: 'either rows, or matchColumn+matchValue, required' }),
				{ status: 400 }
			);
		}
		const rows = await readRows(env, tab);
		const rowNumbers = rows.filter((r) => r.data[matchColumn] === matchValue).map((r) => r.rowNumber);
		if (rowNumbers.length === 0) {
			return new Response(JSON.stringify({ ok: true, deleted: 0 }), { status: 200 });
		}
		await deleteRows(env, tab, rowNumbers);
		return new Response(JSON.stringify({ ok: true, deleted: rowNumbers.length }), { status: 200 });
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
