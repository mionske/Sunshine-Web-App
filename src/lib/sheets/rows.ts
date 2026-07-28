import { batchGetValues, getValues, type CellValue } from './client';
import { clearRowsCache, getCachedRows, rowsCacheKey, setCachedRows } from './rowsCache';
import { SheetsSchemaError } from './types';
import type { SheetsEnv } from './types';

// Far enough right to comfortably cover any tab's column count without
// fetching the entire (mostly empty) sheet grid.
const DATA_END_COLUMN = 'ZZ';

const headerCache = new Map<string, string[]>();


/**
 * Fetches several tabs' headers and data in ONE API call and primes the
 * caches, so the individual reads that follow cost nothing. Best-effort: a
 * failure here is swallowed, because every caller can still read normally.
 */
export async function primeTabs(env: SheetsEnv, tabs: string[]): Promise<void> {
	const cold = tabs.filter((tab) => !getCachedRows(rowsCacheKey(env, tab)));
	if (cold.length === 0) return;

	const ranges = cold.flatMap((tab) => [`'${tab}'!1:1`, `'${tab}'!A2:${DATA_END_COLUMN}`]);
	try {
		const results = await batchGetValues(env, ranges);
		cold.forEach((tab, index) => {
			const headerRows = results[index * 2] ?? [];
			const data = results[index * 2 + 1] ?? [];
			primeHeaders(env, tab, (headerRows[0] ?? []).map((cell) => String(cell ?? '').trim()));
			setCachedRows(rowsCacheKey(env, tab), data);
		});
	} catch {
		// Priming is an optimisation, never a correctness requirement.
	}
}

function cacheKey(env: SheetsEnv, tab: string): string {
	return `${env.SPREADSHEET_ID}::${tab}`;
}

export async function readHeaders(env: SheetsEnv, tab: string, opts: { fresh?: boolean } = {}): Promise<string[]> {
	const key = rowsCacheKey(env, tab);
	if (!opts.fresh && headerCache.has(key)) return headerCache.get(key)!;

	const rows = await getValues(env, `'${tab}'!1:1`);
	const headers = (rows[0] ?? []).map((cell) => String(cell ?? '').trim());
	headerCache.set(key, headers);
	return headers;
}

export function _clearHeaderCacheForTests(): void {
	headerCache.clear();
	clearRowsCache();
}

/** The cached headers for a tab, or null. Lets readRows decide between one
 * batched request and a cheaper single data read. */
function peekHeaders(env: SheetsEnv, tab: string): string[] | null {
	return headerCache.get(cacheKey(env, tab)) ?? null;
}

function primeHeaders(env: SheetsEnv, tab: string, headers: string[]): void {
	headerCache.set(cacheKey(env, tab), headers);
}

/** Throws SheetsSchemaError if any expected column is missing. Extra/unknown
 * columns are allowed — required for safely extending the existing Jobs tab
 * without needing to enumerate its full pre-existing column set here. */
export function assertHeadersInclude(tab: string, headers: string[], expectedColumns: string[]): void {
	const present = new Set(headers);
	const missing = expectedColumns.filter((col) => !present.has(col));
	if (missing.length > 0) {
		throw new SheetsSchemaError(tab, missing, headers);
	}
}

export interface SheetRow {
	rowNumber: number; // 1-based physical row, internal use only
	data: Record<string, CellValue>;
}

function isBlankRow(values: CellValue[]): boolean {
	return values.every((cell) => cell === null || cell === undefined || String(cell).trim() === '');
}

/** Reads all data rows (below the header row) for a tab, mapped by header
 * name. Fully blank rows are always skipped. When `idColumn` is given, rows
 * missing that column's value are skipped too — legacy sheets (Jobs) can
 * have stray formula cells scattered down many rows with no real record
 * behind them at all; a row lacking its own primary ID is never a genuine
 * business record for our purposes, regardless of what else is in it. */
/** Headers and rows from one batched read — the shape crud.ts needs, since
 * it wants both and asking for them separately costs two requests. */
export async function readTab(
	env: SheetsEnv,
	tab: string,
	opts: { idColumn?: string } = {}
): Promise<{ headers: string[]; rows: SheetRow[] }> {
	const key = rowsCacheKey(env, tab);
	const cachedHeaders = peekHeaders(env, tab);
	const warmRows = cachedHeaders ? getCachedRows(key) : null;
	if (cachedHeaders && warmRows) {
		return { headers: cachedHeaders, rows: toRows(cachedHeaders, warmRows, opts) };
	}
	if (cachedHeaders) {
		const raw = await getValues(env, `'${tab}'!A2:${DATA_END_COLUMN}`);
		setCachedRows(key, raw);
		return { headers: cachedHeaders, rows: toRows(cachedHeaders, raw, opts) };
	}

	const [headerRows, raw] = await batchGetValues(env, [`'${tab}'!1:1`, `'${tab}'!A2:${DATA_END_COLUMN}`]);
	const headers = (headerRows[0] ?? []).map((cell) => String(cell ?? '').trim());
	primeHeaders(env, tab, headers);
	setCachedRows(key, raw);
	return { headers, rows: toRows(headers, raw, opts) };
}

export async function readRows(env: SheetsEnv, tab: string, opts: { idColumn?: string } = {}): Promise<SheetRow[]> {
	// Headers and data in ONE request when the header cache is cold. That
	// cache lives per isolate, and Cloudflare recycles isolates constantly —
	// so in production most reads were paying for two API calls where the
	// quota counts requests, not ranges. This is what made a nine-tab
	// property page exhaust 60 reads a minute after seven or eight clicks.
	return (await readTab(env, tab, opts)).rows;
}

function toRows(headers: string[], raw: CellValue[][], opts: { idColumn?: string }): SheetRow[] {
	const idColumnIndex = opts.idColumn ? headers.indexOf(opts.idColumn) : -1;

	const rows: SheetRow[] = [];
	raw.forEach((values, index) => {
		if (isBlankRow(values)) return;
		if (idColumnIndex >= 0 && !String(values[idColumnIndex] ?? '').trim()) return;
		const data: Record<string, CellValue> = {};
		headers.forEach((header, colIndex) => {
			if (!header) return;
			data[header] = values[colIndex] ?? '';
		});
		rows.push({ rowNumber: index + 2, data }); // +2: 1-based, plus header row
	});
	return rows;
}

/** The next row number after the last non-blank row in a tab (2 if the tab
 * has no data rows yet, i.e. right after the header). Used to target
 * explicit row writes instead of relying on the Sheets API's `:append`
 * "smart" placement, which has proven unreliable on sparse sheets with
 * stray formula cells scattered far down unrelated columns (see Jobs). */
export async function nextEmptyRow(env: SheetsEnv, tab: string): Promise<number> {
	const rows = await readRows(env, tab);
	if (rows.length === 0) return 2;
	return Math.max(...rows.map((r) => r.rowNumber)) + 1;
}

/** Converts an object keyed by header name into a values array in the
 * sheet's actual header order (never assumes a fixed column order). */
export function objectToRowValues(headers: string[], record: Record<string, CellValue>): CellValue[] {
	return headers.map((header) => (header in record ? record[header] : ''));
}

export function rowRangeFor(tab: string, rowNumber: number, headers: string[]): string {
	const endColumn = columnLetterAt(headers.length);
	return `'${tab}'!A${rowNumber}:${endColumn}${rowNumber}`;
}

export function columnLetterAt(oneBasedIndex: number): string {
	let n = oneBasedIndex;
	let letters = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		letters = String.fromCharCode(65 + rem) + letters;
		n = Math.floor((n - 1) / 26);
	}
	return letters || 'A';
}
