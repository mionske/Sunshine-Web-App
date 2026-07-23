import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from './testHarness';
import { _clearHeaderCacheForTests, assertHeadersInclude, readHeaders, readRows } from './rows';
import { SheetsSchemaError } from './types';

describe('rows', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
	});

	afterEach(() => {
		harness.restore();
	});

	it('reads headers by name', async () => {
		harness.spreadsheet.setTab('Clients', [['Client ID', 'First Name', 'Last Name']]);
		const headers = await readHeaders(harness.env, 'Clients');
		expect(headers).toEqual(['Client ID', 'First Name', 'Last Name']);
	});

	it('maps data rows by header name regardless of column order', async () => {
		harness.spreadsheet.setTab('Clients', [
			['Last Name', 'Client ID', 'First Name'],
			['Doe', 'c-1', 'Jane'],
		]);
		const rows = await readRows(harness.env, 'Clients');
		expect(rows).toHaveLength(1);
		expect(rows[0].data).toEqual({ 'Last Name': 'Doe', 'Client ID': 'c-1', 'First Name': 'Jane' });
		expect(rows[0].rowNumber).toBe(2);
	});

	it('skips fully blank rows', async () => {
		harness.spreadsheet.setTab('Clients', [
			['Client ID', 'First Name'],
			['c-1', 'Jane'],
			['', ''],
			['c-2', 'Sam'],
		]);
		const rows = await readRows(harness.env, 'Clients');
		expect(rows.map((r) => r.data['Client ID'])).toEqual(['c-1', 'c-2']);
		// row numbers reflect actual sheet position, not the compacted index
		expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
	});

	it('throws a clear error when a required column is missing', async () => {
		harness.spreadsheet.setTab('Clients', [['Client ID', 'First Name']]);
		const headers = await readHeaders(harness.env, 'Clients');
		expect(() => assertHeadersInclude('Clients', headers, ['Client ID', 'Last Name'])).toThrow(
			SheetsSchemaError
		);
	});

	it('allows extra/unknown columns beyond the required set', async () => {
		harness.spreadsheet.setTab('Clients', [['Client ID', 'First Name', 'Some Future Column']]);
		const headers = await readHeaders(harness.env, 'Clients');
		expect(() => assertHeadersInclude('Clients', headers, ['Client ID', 'First Name'])).not.toThrow();
	});

	it('tolerates reordered columns when checking required headers', async () => {
		harness.spreadsheet.setTab('Clients', [['First Name', 'Client ID']]);
		const headers = await readHeaders(harness.env, 'Clients');
		expect(() => assertHeadersInclude('Clients', headers, ['Client ID', 'First Name'])).not.toThrow();
	});
});
