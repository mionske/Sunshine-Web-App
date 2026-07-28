// Test-only in-memory fake of the bits of the Google Sheets REST API this
// app actually calls. Not exported from the package barrel — import
// directly from this file in tests.
import { generateKeyPairSync } from 'node:crypto';
import { vi } from 'vitest';
import type { CellValue } from './client';
import type { SheetsEnv } from './types';

type RangeSpec = {
	tab: string;
	startCol: string;
	startRow: number | null;
	endCol: string;
	endRow: number | null;
};

function parseRange(range: string): RangeSpec {
	const match = range.match(/^'(.+)'!([A-Z]*)(\d*):([A-Z]*)(\d*)$/);
	if (!match) throw new Error(`testHarness: cannot parse range "${range}"`);
	const [, tab, startCol, startRow, endCol, endRow] = match;
	return {
		tab,
		startCol,
		startRow: startRow ? Number(startRow) : null,
		endCol,
		endRow: endRow ? Number(endRow) : null,
	};
}

/** 'A' -> 0, 'B' -> 1, ... matching the real Sheets API's column ordering. */
function columnLetterToIndex(letter: string): number {
	let index = 0;
	for (const char of letter) index = index * 26 + (char.charCodeAt(0) - 64);
	return index - 1;
}

export class FakeSpreadsheet {
	tabs = new Map<string, CellValue[][]>();
	private sheetIds = new Map<string, number>();
	private nextSheetId = 1;

	setTab(tab: string, rows: CellValue[][]): void {
		this.tabs.set(tab, rows.map((r) => [...r]));
		if (!this.sheetIds.has(tab)) this.sheetIds.set(tab, this.nextSheetId++);
	}

	sheetIdFor(tab: string): number {
		if (!this.sheetIds.has(tab)) this.sheetIds.set(tab, this.nextSheetId++);
		return this.sheetIds.get(tab)!;
	}

	getTab(tab: string): CellValue[][] {
		return this.tabs.get(tab) ?? [];
	}

	getValuesFor(range: string): CellValue[][] {
		const { tab, startRow, endRow } = parseRange(range);
		const data = this.getTab(tab);
		const start = startRow ? startRow - 1 : 0;
		const end = endRow ? endRow : data.length;
		return data.slice(start, end).map((r) => [...r]);
	}

	private ensureLength(data: CellValue[][], length: number): void {
		while (data.length < length) data.push([]);
	}

	/** Overwrites rows at an explicit position (PUT update, or batchUpdate).
	 * Only the columns actually covered by the range are touched — matching
	 * the real Sheets API, which never clobbers cells outside the given
	 * range (e.g. a single-column patch like 'Tab'!O2:O2 must not wipe out
	 * the rest of row 2). Falls back to a full-row overwrite when no start
	 * column is given (the plain A1:Z1-style ranges every other call site
	 * already uses). */
	writeRangeValues(range: string, values: CellValue[][]): void {
		const { tab, startCol, startRow } = parseRange(range);
		if (startRow === null) throw new Error(`testHarness: writeRangeValues needs an explicit row in "${range}"`);
		const data = this.tabs.get(tab) ?? [];
		this.ensureLength(data, startRow - 1 + values.length);
		const startColIndex = startCol ? columnLetterToIndex(startCol) : 0;
		values.forEach((rowValues, i) => {
			const rowIndex = startRow - 1 + i;
			if (!startCol || startColIndex === 0) {
				data[rowIndex] = [...rowValues];
				return;
			}
			const existingRow = data[rowIndex] ? [...data[rowIndex]] : [];
			while (existingRow.length < startColIndex) existingRow.push(null);
			rowValues.forEach((cell, colOffset) => {
				existingRow[startColIndex + colOffset] = cell;
			});
			data[rowIndex] = existingRow;
		});
		this.tabs.set(tab, data);
	}

	/** Appends after the current last row (POST :append semantics). */
	appendRangeValues(range: string, values: CellValue[][]): { updatedRange: string; updatedRows: number } {
		const { tab } = parseRange(range);
		const data = this.tabs.get(tab) ?? [];
		const startIndex = data.length;
		values.forEach((rowValues) => data.push([...rowValues]));
		this.tabs.set(tab, data);
		return { updatedRange: `'${tab}'!A${startIndex + 1}`, updatedRows: values.length };
	}
}

export interface FakeFetchHandle {
	spreadsheet: FakeSpreadsheet;
	env: SheetsEnv;
	restore: () => void;
	/** Every Sheets API path requested, in order. The Sheets quota counts
	 * REQUESTS, not ranges or rows, so this is what a test asserts on when
	 * the thing being protected is read volume. */
	sheetsRequests: string[];
}

const FAKE_ACCESS_TOKEN = 'fake-access-token';

/** Installs a fetch mock covering: token exchange, values.get,
 * values.update (PUT), values.append (POST), values:batchGet (GET),
 * values:batchUpdate (POST). */
export function installFakeFetch(): FakeFetchHandle {
	const sheetsRequests: string[] = [];
	const spreadsheet = new FakeSpreadsheet();
	// A real (test-only) RSA key so googleAuth's actual JWT-signing path runs
	// end-to-end — only the network call to Google's token endpoint is faked
	// below, matching what production code actually exercises.
	const { privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	const env: SheetsEnv = {
		SPREADSHEET_ID: 'fake-spreadsheet-id',
		GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
			client_email: 'fake@example.com',
			private_key: privateKey,
		}),
	};

	const originalFetch = globalThis.fetch;

	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input.toString();

		if (url.includes('oauth2.googleapis.com/token')) {
			return jsonResponse({ access_token: FAKE_ACCESS_TOKEN, expires_in: 3600 });
		}

		const spreadsheetPrefix = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}`;
		if (!url.startsWith(spreadsheetPrefix)) {
			throw new Error(`testHarness: unexpected fetch to ${url}`);
		}
		const path = url.slice(spreadsheetPrefix.length);

		sheetsRequests.push(path);

		if (path.startsWith('?fields=sheets.properties')) {
			// Generous defaults so ensureGridSize never needs to actually
			// resize anything in tests — real production grid-size quirks are
			// exercised live, not through this fake.
			const sheets = [...spreadsheet.tabs.keys()].map((title) => ({
				properties: {
					sheetId: spreadsheet.sheetIdFor(title),
					title,
					gridProperties: { rowCount: 1000, columnCount: 100 },
				},
			}));
			return jsonResponse({ sheets });
		}

		// batchGet: several ranges, one request — the shape readRows uses to
		// avoid paying two API calls for headers plus data.
		if (path.startsWith('/values:batchGet')) {
			const ranges = [...new URL(`https://x${path}`).searchParams.getAll('ranges')];
			return jsonResponse({ valueRanges: ranges.map((range) => ({ range, values: spreadsheet.getValuesFor(range) })) });
		}

		if (path.startsWith('/values:batchUpdate')) {
			const body = JSON.parse(String(init?.body)) as { data: { range: string; values: CellValue[][] }[] };
			for (const entry of body.data) spreadsheet.writeRangeValues(entry.range, entry.values);
			return jsonResponse({});
		}

		const appendMatch = path.match(/^\/values\/([^?]+):append/);
		if (appendMatch) {
			const range = decodeURIComponent(appendMatch[1]);
			const body = JSON.parse(String(init?.body)) as { values: CellValue[][] };
			const updates = spreadsheet.appendRangeValues(range, body.values);
			return jsonResponse({ updates });
		}

		const valuesMatch = path.match(/^\/values\/([^?]+)/);
		if (valuesMatch) {
			const range = decodeURIComponent(valuesMatch[1]);
			if (init?.method === 'PUT') {
				const body = JSON.parse(String(init.body)) as { values: CellValue[][] };
				spreadsheet.writeRangeValues(range, body.values);
				return jsonResponse({});
			}
			return jsonResponse({ values: spreadsheet.getValuesFor(range) });
		}

		if (path.startsWith(':batchUpdate')) {
			return jsonResponse({});
		}

		throw new Error(`testHarness: unhandled Sheets API path "${path}"`);
	}) as typeof fetch;

	return {
		spreadsheet,
		env,
		sheetsRequests,
		restore: () => {
			globalThis.fetch = originalFetch;
		},
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
