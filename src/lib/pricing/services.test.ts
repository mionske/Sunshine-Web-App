import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { serviceSchema } from '../models/service';
import { getService, listServices, seedInitialServices } from './services';

const SERVICE_HEADERS = Object.keys(serviceSchema.shape);

describe('services seeding', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Services', [SERVICE_HEADERS]);
		harness.spreadsheet.setTab('ActivityLog', [
			['Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes'],
		]);
	});

	afterEach(() => {
		harness.restore();
	});

	it('seeds every initial service code exactly once', async () => {
		const { created } = await seedInitialServices(harness.env);
		expect(created).toContain('WINDOW_EXT_STANDARD');
		expect(created).toContain('SCREEN_CLEAN');
		expect(created).toContain('DISCOUNT');

		const all = await listServices(harness.env);
		expect(all.length).toBe(created.length);

		const codes = all.map((s) => s['Service Code']);
		expect(new Set(codes).size).toBe(codes.length);
	});

	it('does not duplicate on a second seed call', async () => {
		await seedInitialServices(harness.env);
		const second = await seedInitialServices(harness.env);
		expect(second.created).toHaveLength(0);

		const all = await listServices(harness.env);
		const standardWindows = all.filter((s) => s['Service Code'] === 'WINDOW_EXT_STANDARD');
		expect(standardWindows).toHaveLength(1);
	});

	it('getService finds a seeded service by code', async () => {
		await seedInitialServices(harness.env);
		const service = await getService(harness.env, 'SCREEN_CLEAN');
		expect(service?.['Pricing Method']).toBe('FLAT_UNIT_PRICE');
	});
});
