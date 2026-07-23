import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { pricingConfigSchema } from '../models/pricingConfig';
import {
	activatePricingConfig,
	createPricingConfig,
	getActivePricingConfig,
	listPricingConfigs,
	seedInitialPricingConfig,
} from './config';

const PRICING_CONFIG_HEADERS = Object.keys(pricingConfigSchema.shape);
const ACTIVITY_LOG_HEADERS = [
	'Activity ID',
	'Entity Type',
	'Entity ID',
	'Action',
	'Previous Value',
	'New Value',
	'User',
	'Timestamp',
	'Request ID',
	'Notes',
];

describe('PricingConfig', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('PricingConfig', [PRICING_CONFIG_HEADERS]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	it('seeds the initial $150 active config when the tab is empty', async () => {
		const seeded = await seedInitialPricingConfig(harness.env);
		expect(seeded).not.toBeNull();
		expect(seeded!['Target Hourly Rate']).toBe('150');
		expect(seeded!.Status).toBe('Active');
		expect(seeded!['Effective Date']).toBeTruthy();

		const active = await getActivePricingConfig(harness.env);
		expect(active?.['Pricing Config ID']).toBe(seeded!['Pricing Config ID']);
	});

	it('does not reseed if a config already exists', async () => {
		await seedInitialPricingConfig(harness.env);
		const secondSeed = await seedInitialPricingConfig(harness.env);
		expect(secondSeed).toBeNull();

		const all = await listPricingConfigs(harness.env);
		expect(all).toHaveLength(1);
	});

	it('getActivePricingConfig returns null when nothing is active', async () => {
		await createPricingConfig(harness.env, { 'Config Name': 'Draft only', 'Target Hourly Rate': '160' });
		const active = await getActivePricingConfig(harness.env);
		expect(active).toBeNull();
	});

	it('activating a new config supersedes the previously active one — exactly one Active at a time', async () => {
		const first = await seedInitialPricingConfig(harness.env);
		const second = await createPricingConfig(harness.env, {
			'Config Name': 'Rate increase',
			'Target Hourly Rate': '165',
		});

		await activatePricingConfig(harness.env, second['Pricing Config ID']);

		const all = await listPricingConfigs(harness.env);
		const activeRows = all.filter((r) => r.Status === 'Active');
		expect(activeRows).toHaveLength(1);
		expect(activeRows[0]['Pricing Config ID']).toBe(second['Pricing Config ID']);

		const oldOne = all.find((r) => r['Pricing Config ID'] === first!['Pricing Config ID']);
		expect(oldOne?.Status).toBe('Superseded');
		expect(oldOne?.['End Date']).toBeTruthy();
	});
});
