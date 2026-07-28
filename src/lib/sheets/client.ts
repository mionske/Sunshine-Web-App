import { getAccessToken } from './googleAuth';
import type { SheetsEnv } from './types';
import { invalidateRanges } from './rowsCache';

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries on 429 (quota exceeded) and 5xx (transient Google-side errors)
 * with short exponential backoff — these are the only response codes worth
 * retrying; anything else (4xx auth/validation errors) fails immediately.
 * Without this, a single momentary rate-limit hit surfaced as a raw 500 to
 * the user instead of the page just loading a beat slower. */
async function sheetsFetch(env: SheetsEnv, path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
	const accessToken = await getAccessToken(env);
	const response = await fetch(`${BASE_URL}/${env.SPREADSHEET_ID}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
			...init.headers,
		},
	});
	if (!response.ok) {
		if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
			await sleep(300 * 2 ** attempt);
			return sheetsFetch(env, path, init, attempt + 1);
		}
		const body = await response.text();
		throw new Error(`Sheets API error ${response.status} for ${path}: ${body}`);
	}
	return response;
}

export type CellValue = string | number | boolean | null;

/** Reads a rectangular range as raw rows (no header interpretation). */
export async function getValues(env: SheetsEnv, range: string): Promise<CellValue[][]> {
	const response = await sheetsFetch(env, `/values/${encodeURIComponent(range)}`);
	const data = (await response.json()) as { values?: CellValue[][] };
	return data.values ?? [];
}

/** Overwrites a specific range in place (used for updating one existing row). */
export async function updateValues(env: SheetsEnv, range: string, values: CellValue[][]): Promise<void> {
	invalidateRanges(env, [range]);
	await sheetsFetch(env, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
		method: 'PUT',
		body: JSON.stringify({ range, values }),
	});
}

/**
 * Reads several ranges in ONE API call.
 *
 * The Sheets API bills per request, not per range, and allows 60 reads a
 * minute. Every `readRows` needs two ranges — the header row and the data —
 * so fetching them separately doubles the cost of every read in the app.
 * Returned value arrays are in the order the ranges were given.
 */
export async function batchGetValues(env: SheetsEnv, ranges: string[]): Promise<CellValue[][][]> {
	if (ranges.length === 0) return [];
	const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
	const response = await sheetsFetch(env, `/values:batchGet?${query}`);
	const data = (await response.json()) as { valueRanges?: { values?: CellValue[][] }[] };
	return (data.valueRanges ?? []).map((v) => v.values ?? []);
}

/** Writes multiple distinct ranges in a single API call — used for multi-row
 * related creates (e.g. Quote + QuoteItems) so they land together. */
export async function batchUpdateValues(
	env: SheetsEnv,
	data: { range: string; values: CellValue[][] }[]
): Promise<void> {
	invalidateRanges(env, data.map((d) => d.range));
	await sheetsFetch(env, '/values:batchUpdate', {
		method: 'POST',
		body: JSON.stringify({ valueInputOption: 'RAW', data }),
	});
}

/** Structural changes (add a new tab, etc.) via the spreadsheets.batchUpdate endpoint. */
export async function batchUpdateSpreadsheet(env: SheetsEnv, requests: object[]): Promise<unknown> {
	const response = await sheetsFetch(env, ':batchUpdate', {
		method: 'POST',
		body: JSON.stringify({ requests }),
	});
	return response.json();
}

export async function addSheetTab(env: SheetsEnv, title: string): Promise<void> {
	await batchUpdateSpreadsheet(env, [{ addSheet: { properties: { title } } }]);
}

/** Titles of every tab currently in the spreadsheet. */
export async function listSheetTitles(env: SheetsEnv): Promise<string[]> {
	const sheets = await listSheetMeta(env);
	return sheets.map((s) => s.title);
}

export interface SheetMeta {
	sheetId: number;
	title: string;
	gridProperties?: { rowCount: number; columnCount: number };
}

export async function listSheetMeta(env: SheetsEnv): Promise<SheetMeta[]> {
	const response = await sheetsFetch(env, '?fields=sheets.properties(sheetId,title,gridProperties)');
	const data = (await response.json()) as { sheets?: { properties: SheetMeta }[] };
	return (data.sheets ?? []).map((s) => s.properties);
}

/** Grows a tab's grid to at least the given row/column counts if it isn't
 * already that large. A sheet's grid has a fixed size — Google doesn't
 * auto-expand it just because a write targets a cell past the edge, it
 * rejects the write outright — so this must run before any write that
 * might land beyond however large the tab started out. */
export async function ensureGridSize(
	env: SheetsEnv,
	tab: string,
	opts: { minRows?: number; minColumns?: number }
): Promise<void> {
	const sheets = await listSheetMeta(env);
	const sheet = sheets.find((s) => s.title === tab);
	if (!sheet) throw new Error(`ensureGridSize: no tab named "${tab}" found`);
	const currentRows = sheet.gridProperties?.rowCount ?? 1000;
	const currentColumns = sheet.gridProperties?.columnCount ?? 26;
	const targetRows = Math.max(currentRows, opts.minRows ?? 0);
	const targetColumns = Math.max(currentColumns, opts.minColumns ?? 0);
	if (targetRows === currentRows && targetColumns === currentColumns) return;

	await batchUpdateSpreadsheet(env, [
		{
			updateSheetProperties: {
				properties: { sheetId: sheet.sheetId, gridProperties: { rowCount: targetRows, columnCount: targetColumns } },
				fields: 'gridProperties.rowCount,gridProperties.columnCount',
			},
		},
	]);
}

/** Clears cell contents in a range without deleting rows/columns or
 * disturbing formulas/formatting outside that range. */
export async function clearValues(env: SheetsEnv, range: string): Promise<void> {
	await sheetsFetch(env, `/values/${encodeURIComponent(range)}:clear`, { method: 'POST' });
}

/** Hard-deletes specific 1-based rows from a tab (rows shift up). Use only
 * for actual removal (e.g. discarding test data) — normal business records
 * use the soft-delete (`Archived At`) path instead. Row numbers must belong
 * to the same tab; pass them in any order, they're sorted descending
 * internally so earlier deletes never shift the index of a later one. */
export async function deleteRows(env: SheetsEnv, tab: string, rowNumbers: number[]): Promise<void> {
	const sheets = await listSheetMeta(env);
	const sheet = sheets.find((s) => s.title === tab);
	if (!sheet) throw new Error(`deleteRows: no tab named "${tab}" found`);

	const requests = [...rowNumbers]
		.sort((a, b) => b - a)
		.map((rowNumber) => ({
			deleteDimension: {
				range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
			},
		}));

	await batchUpdateSpreadsheet(env, requests);
}

/** Hard-deletes specific 1-based columns from a tab (columns shift left) —
 * for removing a column this app added and then decided not to use after
 * all. Since every read/write in this app maps columns by header name, a
 * shift is safe. Column numbers must belong to the same tab; pass them in
 * any order, they're sorted descending internally so earlier deletes never
 * shift the index of a later one. */
export async function deleteColumns(env: SheetsEnv, tab: string, columnNumbers: number[]): Promise<void> {
	const sheets = await listSheetMeta(env);
	const sheet = sheets.find((s) => s.title === tab);
	if (!sheet) throw new Error(`deleteColumns: no tab named "${tab}" found`);

	const requests = [...columnNumbers]
		.sort((a, b) => b - a)
		.map((columnNumber) => ({
			deleteDimension: {
				range: { sheetId: sheet.sheetId, dimension: 'COLUMNS', startIndex: columnNumber - 1, endIndex: columnNumber },
			},
		}));

	await batchUpdateSpreadsheet(env, requests);
}
