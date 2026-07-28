import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readHeaders, readRows, columnLetterAt } from '../../../lib/sheets/rows';
import { updateValues } from '../../../lib/sheets/client';
import { LEGACY_STAGE_MAP } from '../../../lib/models/pipeline';

// One-time migration for the Pipeline stage reduction (8 stages -> 6 visible
// + Lost). `Stage` is a validated enum, so any row still holding a retired
// value throws on every read of that row — this rewrites them in place.
//
// Deliberately writes only the Stage cell, and only for rows whose current
// value is a known retired one. Rows already on a current stage are left
// untouched, so the route is safe to re-run.
//
// GET returns what *would* change without writing anything; POST applies it.
async function plan(): Promise<Array<{ row: number; id: string; from: string; to: string }>> {
	const rows = await readRows(env, 'Pipeline', { idColumn: 'Opportunity ID' });
	const changes: Array<{ row: number; id: string; from: string; to: string }> = [];
	for (const row of rows) {
		const current = String(row.data.Stage ?? '');
		const next = LEGACY_STAGE_MAP[current];
		if (next) changes.push({ row: row.rowNumber, id: String(row.data['Opportunity ID'] ?? ''), from: current, to: next });
	}
	return changes;
}

export const GET: APIRoute = async () => {
	const changes = await plan();
	return new Response(JSON.stringify({ ok: true, dryRun: true, count: changes.length, changes }, null, 2), {
		headers: { 'Content-Type': 'application/json' },
	});
};

export const POST: APIRoute = async () => {
	const changes = await plan();
	const headers = await readHeaders(env, 'Pipeline');
	const stageColumn = columnLetterAt(headers.indexOf('Stage') + 1);
	for (const change of changes) {
		await updateValues(env, `Pipeline!${stageColumn}${change.row}`, [[change.to]]);
	}
	return new Response(JSON.stringify({ ok: true, migrated: changes.length, changes }, null, 2), {
		headers: { 'Content-Type': 'application/json' },
	});
};
