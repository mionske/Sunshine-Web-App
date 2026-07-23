import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { clearValues, updateValues } from '../../../lib/sheets';
import { columnLetterAt, readHeaders } from '../../../lib/sheets/rows';

// Idempotent, additive-only extension of the existing Jobs tab. Per the
// Jobs-preservation protocol: never touches existing columns, never
// reorders anything, only appends new headers after whatever is already
// there.
//
// Hardcoded to start at column Z, not computed from the header row's
// length: the existing calibration block's second column (Y) holds real
// values on rows 2+ even though its row-1 header cell is blank, so
// "row 1's last populated column" understates what's actually in use.
// (A first version of this got that wrong and wrote into Y — this also
// repairs that mistake if found.)
const JOBS_NEW_COLUMNS_START = 'Z';
const NEW_JOBS_COLUMNS = [
	'Window Count',
	'Quote ID',
	'Opportunity ID',
	'Job Status',
	'Arrival Timestamp',
	'Start Timestamp',
	'Finish Timestamp',
	'Departure Timestamp',
	'Travel Time',
	'Setup Time',
	'Cleaning Time',
	'Pack-up Time',
	'Supplies Cost',
	'Gas',
	'Other Expenses',
	'Total Job Cost',
	'Net Profit',
	'Customer Rating',
	'Callback Required (Y/N)',
	'Photos',
	'Version',
	'Archived At',
];

function columnIndex(letter: string): number {
	let n = 0;
	for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n;
}

export const POST: APIRoute = async () => {
	try {
		const headers = await readHeaders(env, 'Jobs', { fresh: true });
		const startIndex = columnIndex(JOBS_NEW_COLUMNS_START);
		const endIndex = startIndex + NEW_JOBS_COLUMNS.length - 1;

		if (headers[startIndex - 1] === 'Window Count') {
			return new Response(JSON.stringify({ ok: true, alreadyExtended: true }), { status: 200 });
		}

		// Repair: an earlier run wrote these headers one column too early
		// (starting at Y, colliding with the calibration block). Clear that
		// before writing the corrected columns.
		if (headers[24] === 'Window Count') {
			await clearValues(env, `'Jobs'!Y1:AT1`);
		}

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
