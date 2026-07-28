import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from './testHarness';
import { _clearHeaderCacheForTests } from './rows';
import { createRow, listActiveRows } from './crud';
import { clientConfig, clientSchema } from '../models/client';
import { propertyConfig, propertySchema } from '../models/property';

/**
 * The Google Sheets API allows 60 READ REQUESTS per minute, counted per
 * request rather than per range or per row. That budget is the real
 * constraint on this app, and it is easy to blow through without noticing:
 * the property page renders nine tabs, each tab click is a fresh server
 * render, and every render reads several tabs.
 *
 * That is exactly what happened in production — the page worked for seven or
 * eight tab clicks and then started returning 500s, while local development
 * looked fine because a single long-lived dev process kept its header cache
 * warm and Cloudflare recycles isolates constantly.
 *
 * These tests pin the request count, not the behaviour, because the
 * behaviour was never wrong.
 */
describe('Sheets read volume', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [
			['Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes'],
		]);
	});

	afterEach(() => harness.restore());

	function reads(): string[] {
		return harness.sheetsRequests.filter((p) => p.includes('/values'));
	}

	it('reads a tab in ONE request on a cold cache, not two', async () => {
		await listActiveRows(harness.env, clientConfig);

		// Headers and data arrive together via batchGet. Before this, a cold
		// isolate paid one request for row 1 and another for the data — which
		// doubled the cost of every read in the app.
		expect(reads()).toHaveLength(1);
		expect(reads()[0]).toContain('batchGet');
	});

	it('costs nothing to read the same tab again within the cache window', async () => {
		await listActiveRows(harness.env, clientConfig);
		const afterFirst = reads().length;

		await listActiveRows(harness.env, clientConfig);
		expect(reads().length - afterFirst).toBe(0);
	});

	it('goes back to the API after a write, so a save is never read back stale', async () => {
		await listActiveRows(harness.env, clientConfig);
		const afterFirst = reads().length;

		await createRow(harness.env, clientConfig, { 'First Name': 'New', 'Last Name': 'Person' });
		await listActiveRows(harness.env, clientConfig);

		expect(reads().length).toBeGreaterThan(afterFirst);
		const names = (await listActiveRows(harness.env, clientConfig)).map((c) => c['First Name']);
		expect(names).toContain('New');
	});

	it('costs one request per distinct tab', async () => {
		await listActiveRows(harness.env, clientConfig);
		await listActiveRows(harness.env, propertyConfig);

		expect(reads()).toHaveLength(2);
	});

	it('keeps a nine-tab property tour inside the per-minute budget', async () => {
		// A property page render now reads six tabs: Properties, Clients,
		// Quotes, Jobs, Pipeline, Walkthroughs. ActivityLog and PropertyPhotos
		// are read only on their own tabs. Nine clicks is one full tour of the
		// workspace — an entirely ordinary thing to do, which must not exhaust
		// the quota.
		const TABS_PER_RENDER = 6;
		const CLICKS = 9;
		const QUOTA_PER_MINUTE = 60;

		for (let click = 0; click < CLICKS; click++) {
			for (let tab = 0; tab < TABS_PER_RENDER; tab++) {
				if (tab % 2 === 0) await listActiveRows(harness.env, clientConfig);
				else await listActiveRows(harness.env, propertyConfig);
			}
		}

		// Nine clicks used to cost 54 requests and the tenth fell over. The
		// rows cache means the whole tour costs one request per distinct tab.
		expect(reads().length).toBeLessThan(QUOTA_PER_MINUTE);
		expect(reads().length).toBeLessThanOrEqual(TABS_PER_RENDER);
	});
});
