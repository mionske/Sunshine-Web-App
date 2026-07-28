import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installFakeFetch, type FakeFetchHandle } from './testHarness';
import { _clearHeaderCacheForTests } from './rows';
import { createRow, findById, listActiveRows, softDeleteRow, updateRow, type TabConfig } from './crud';
import { SheetsConcurrencyError, SheetsNotFoundError } from './types';

const clientSchema = z.object({
	'Client ID': z.string().min(1),
	'First Name': z.string(),
	'Last Name': z.string(),
	'Created At': z.string(),
	'Updated At': z.string(),
	'Archived At': z.string(),
});

const clientConfig: TabConfig<z.infer<typeof clientSchema>> = {
	tab: 'Clients',
	idColumn: 'Client ID',
	requiredColumns: ['Client ID', 'First Name', 'Last Name', 'Created At', 'Updated At', 'Archived At'],
	schema: clientSchema,
	entityType: 'Client',
};

const CLIENT_HEADERS = ['Client ID', 'First Name', 'Last Name', 'Created At', 'Updated At', 'Archived At'];

describe('crud', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [CLIENT_HEADERS]);
		harness.spreadsheet.setTab('ActivityLog', [
			['Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes'],
		]);
	});

	afterEach(() => {
		harness.restore();
	});

	it('creates a row and stamps timestamps', async () => {
		const created = await createRow(harness.env, clientConfig, {
			'First Name': 'Jane',
			'Last Name': 'Doe',
		});
		expect(created['First Name']).toBe('Jane');
		expect(created['Client ID']).toBeTruthy();
		expect(created['Created At']).toBeTruthy();
		expect(created['Created At']).toBe(created['Updated At']);
		expect(created['Archived At']).toBe('');

		const rows = harness.spreadsheet.getTab('Clients');
		expect(rows).toHaveLength(2); // header + 1 data row
	});

	it('is idempotent when the same ID is submitted twice (double-submit protection)', async () => {
		const id = 'client-fixed-id';
		const first = await createRow(harness.env, clientConfig, { id, 'First Name': 'Jane', 'Last Name': 'Doe' });
		const second = await createRow(harness.env, clientConfig, {
			id,
			'First Name': 'Jane',
			'Last Name': 'Doe',
		});

		expect(second).toEqual(first);
		const rows = harness.spreadsheet.getTab('Clients');
		expect(rows).toHaveLength(2); // still just header + 1 row, no duplicate
	});

	it('rejects a row that fails schema validation before writing', async () => {
		await expect(
			createRow(harness.env, clientConfig, { 'First Name': 'Jane' } as never)
		).rejects.toThrow();
		expect(harness.spreadsheet.getTab('Clients')).toHaveLength(1); // header only, nothing written
	});

	it('updates a row in place', async () => {
		const created = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe' });
		const updated = await updateRow(harness.env, clientConfig, created['Client ID'], {
			'Last Name': 'Smith',
		});
		expect(updated['Last Name']).toBe('Smith');
		expect(updated['Updated At']).not.toBe(created['Updated At']);

		const fetched = await findById(harness.env, clientConfig, created['Client ID']);
		expect(fetched?.['Last Name']).toBe('Smith');
	});

	it('throws when updating a row that does not exist', async () => {
		await expect(
			updateRow(harness.env, clientConfig, 'no-such-id', { 'Last Name': 'Smith' })
		).rejects.toThrow(SheetsNotFoundError);
	});

	it('enforces optimistic concurrency when expectedUpdatedAt is stale', async () => {
		const created = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe' });
		await updateRow(harness.env, clientConfig, created['Client ID'], { 'Last Name': 'Smith' });

		await expect(
			updateRow(
				harness.env,
				clientConfig,
				created['Client ID'],
				{ 'Last Name': 'Jones' },
				{ expectedUpdatedAt: created['Updated At'] } // stale — row already changed once
			)
		).rejects.toThrow(SheetsConcurrencyError);
	});

	it('soft-deletes by setting Archived At, and archived rows drop out of listActiveRows', async () => {
		const a = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe' });
		const b = await createRow(harness.env, clientConfig, { 'First Name': 'Sam', 'Last Name': 'Lee' });

		await softDeleteRow(harness.env, clientConfig, a['Client ID']);

		const active = await listActiveRows(harness.env, clientConfig);
		expect(active.map((r) => r['Client ID'])).toEqual([b['Client ID']]);

		// the archived row still exists and is still findable directly
		const stillThere = await findById(harness.env, clientConfig, a['Client ID']);
		expect(stillThere?.['Archived At']).toBeTruthy();
	});
});

// Appending is a read-then-write: find the first empty row, then write to
// it. Concurrent creates on one tab used to read the same state, choose the
// same row, and silently overwrite each other — a whole camera roll of photo
// uploads collapsed into one or two surviving rows, and the rest came back
// as broken thumbnails. createRow now reads the row back and retries when
// someone else took it.
describe('createRow under concurrency', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [CLIENT_HEADERS]);
		harness.spreadsheet.setTab('ActivityLog', [
			['Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes'],
		]);
	});

	afterEach(() => harness.restore());

	it('never reports success for a row that was overwritten', async () => {
		const ids = Array.from({ length: 12 }, (_, i) => `concurrent-${i}`);

		const results = await Promise.allSettled(
			ids.map((id) => createRow(harness.env, clientConfig, { id, 'First Name': id, 'Last Name': 'Race' }))
		);

		const succeeded = results
			.map((r, i) => (r.status === 'fulfilled' ? ids[i] : null))
			.filter((v): v is string => v !== null);

		const storedIds = (await listActiveRows(harness.env, clientConfig)).map((r) => r['Client ID']);

		// The invariant: every create that claimed success actually has a row.
		// A create may legitimately fail under contention — what it must never
		// do is return a record that isn't in the sheet.
		for (const id of succeeded) {
			expect(storedIds).toContain(id);
		}
		// And no row was clobbered by a later writer.
		expect(new Set(storedIds).size).toBe(storedIds.length);
		expect(storedIds).toHaveLength(succeeded.length);
	});

	it('serialized creates — the path the photo uploader now uses — all land', async () => {
		const ids = Array.from({ length: 12 }, (_, i) => `sequential-${i}`);
		for (const id of ids) {
			await createRow(harness.env, clientConfig, { id, 'First Name': id, 'Last Name': 'Ordered' });
		}
		const storedIds = (await listActiveRows(harness.env, clientConfig)).map((r) => r['Client ID']).sort();
		expect(storedIds).toEqual([...ids].sort());
	});
});
