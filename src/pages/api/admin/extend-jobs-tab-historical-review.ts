import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateValues } from '../../../lib/sheets';
import { columnLetterAt, readHeaders } from '../../../lib/sheets/rows';

// One-time, idempotent extension of the Jobs tab for the Historical Job
// Entry overhaul (Callback & Quality detail, Pricing Review, Job
// Performance Review). Per the Jobs-preservation protocol used by
// extend-jobs-tab.ts: never touches existing columns, always appends
// after whatever the live sheet's header row already has — computed
// fresh each run rather than hardcoded, since several phases' worth of
// columns have been appended to this tab since extend-jobs-tab.ts's
// original 22-column extension.
const NEW_JOBS_COLUMNS = [
	'Callback Reason',
	'Callback Root Cause',
	'Callback Corrective Action',
	'Callback Lessons Learned',
	'Pricing Confidence',
	'Would Price Differently Today (Y/N)',
	'Current Retail Price Estimate ($)',
	'Reason Pricing Changed',
	'Overall Job Rating',
	'Customer Satisfaction Rating',
	'Would Accept Job Again (Y/N)',
	'Would Change Process (Y/N)',
	'Process Improvements',
];

export const POST: APIRoute = async () => {
	try {
		const headers = await readHeaders(env, 'Jobs', { fresh: true });
		if (headers.includes('Callback Reason')) {
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
