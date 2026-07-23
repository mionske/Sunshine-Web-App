// Live Sheets round-trip verification uses this dedicated SystemTest tab —
// never a production business tab — so a connectivity check can never leave
// stray created-then-deleted rows in Clients/Jobs/etc.
import { addSheetTab, ensureGridSize, getValues, listSheetTitles, updateValues } from './client';
import { nextEmptyRow, objectToRowValues, readHeaders, rowRangeFor } from './rows';
import type { SheetsEnv } from './types';

const TAB = 'SystemTest';
const HEADERS = ['Probe ID', 'Checked At'];

/** Creates the SystemTest tab with its header row if it doesn't exist yet.
 * Safe to call every time — a no-op once the tab is already there. */
export async function ensureSystemTestTab(env: SheetsEnv): Promise<void> {
	const titles = await listSheetTitles(env);
	if (titles.includes(TAB)) return;
	await addSheetTab(env, TAB);
	await updateValues(env, `'${TAB}'!A1:B1`, [HEADERS]);
}

export async function roundTripCheck(env: SheetsEnv): Promise<{ ok: true; checkedAt: string; probeId: string }> {
	await ensureSystemTestTab(env);
	const headers = await readHeaders(env, TAB, { fresh: true });
	const probeId = crypto.randomUUID();
	const checkedAt = new Date().toISOString();

	const record: Record<string, string> = { 'Probe ID': probeId, 'Checked At': checkedAt };
	const startRow = await nextEmptyRow(env, TAB);
	await ensureGridSize(env, TAB, { minRows: startRow });
	await updateValues(env, rowRangeFor(TAB, startRow, headers), [objectToRowValues(headers, record)]);

	const rows = await getValues(env, `'${TAB}'!A2:B`);
	const found = rows.some((row) => row[0] === probeId);
	if (!found) {
		throw new Error('SystemTest round-trip check failed: wrote a probe row but could not read it back');
	}

	return { ok: true, checkedAt, probeId };
}
