import type { CellValue } from './client';
import type { SheetsEnv } from './types';

/**
 * A very short-lived cache of raw tab values.
 *
 * One property page render reads six tabs, and every tab click is a fresh
 * server render — so without this, nine clicks costs 54 of the Sheets API's
 * 60 reads per minute, and the tenth click starts returning 500s. That is
 * exactly what production did.
 *
 * It lives in its own module, imported by both client.ts and rows.ts, so
 * that WRITES can invalidate it without rows.ts and client.ts importing each
 * other. Invalidation happens inside the write primitives rather than at
 * their call sites: caller-side invalidation is a rule someone has to
 * remember, and the first three places that forgot it were found by tests
 * rather than by discipline.
 */
const TTL_MS = 10_000;

const cache = new Map<string, { at: number; values: CellValue[][] }>();

export function rowsCacheKey(env: SheetsEnv, tab: string): string {
	return `${env.SPREADSHEET_ID}::${tab}`;
}

export function getCachedRows(key: string): CellValue[][] | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.at > TTL_MS) {
		cache.delete(key);
		return null;
	}
	return entry.values;
}

export function setCachedRows(key: string, values: CellValue[][]): void {
	cache.set(key, { at: Date.now(), values });
}

export function clearRowsCache(): void {
	cache.clear();
}

/**
 * Drops the cached rows for every tab a write touched. Ranges look like
 * `'Clients'!A2:ZZ` or `Clients!A1`, so the tab is whatever precedes the `!`,
 * with surrounding quotes stripped.
 */
export function invalidateRanges(env: SheetsEnv, ranges: string[]): void {
	for (const range of ranges) {
		const tab = range.split('!')[0]?.replace(/^'|'$/g, '');
		if (tab) cache.delete(rowsCacheKey(env, tab));
	}
}
