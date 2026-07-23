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

	/** Overwrites rows at an explicit position (PUT update, or batchUpdate). */
	writeRangeValues(range: string, values: CellValue[][]): void {
		const { tab, startRow } = parseRange(range);
		if (startRow === null) throw new Error(`testHarness: writeRangeValues needs an explicit row in "${range}"`);
		const data = this.tabs.get(tab) ?? [];
		this.ensureLength(data, startRow - 1 + values.length);
		values.forEach((rowValues, i) => {
			data[startRow - 1 + i] = [...rowValues];
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
}

const FAKE_ACCESS_TOKEN = 'fake-access-token';

/** Installs a fetch mock covering: token exchange, values.get,
 * values.update (PUT), values.append (POST), values:batchUpdate (POST). */
export function installFakeFetch(): FakeFetchHandle {
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
		restore: () => {
			globalThis.fetch = originalFetch;
		},
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
