import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { pricingConfigSchema } from '../models/pricingConfig';
import { quoteSchema } from '../models/quote';
import { quoteItemSchema } from '../models/quoteItem';
import { serviceSchema } from '../models/service';
import { seedInitialPricingConfig } from './config';
import { seedInitialServices } from './services';
import { createQuote } from './quotes';
import type { QuoteCounts } from './types';

const ZERO_COUNTS: QuoteCounts = {
	windowExtStandard: 0,
	windowIntStandard: 0,
	windowExtOversized: 0,
	windowIntOversized: 0,
	windowExtFrenchPane: 0,
	windowIntFrenchPane: 0,
	slidingDoorExt: 0,
	slidingDoorInt: 0,
	screenClean: 0,
	trackBasic: 0,
	trackDeep: 0,
	skylightExt: 0,
	skylightInt: 0,
};

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

describe('createQuote', () => {
	let harness: FakeFetchHandle;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('PricingConfig', [Object.keys(pricingConfigSchema.shape)]);
		harness.spreadsheet.setTab('Services', [Object.keys(serviceSchema.shape)]);
		harness.spreadsheet.setTab('Quotes', [Object.keys(quoteSchema.shape)]);
		harness.spreadsheet.setTab('QuoteItems', [Object.keys(quoteItemSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);

		await seedInitialPricingConfig(harness.env);
		await seedInitialServices(harness.env);
	});

	afterEach(() => {
		harness.restore();
	});

	it('persists a Quote and its QuoteItems together, tagged to the active PricingConfig', async () => {
		const { quote, items } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 20, windowIntStandard: 20, screenClean: 4 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		expect(quote['Client ID']).toBe('client-1');
		expect(quote['Property ID']).toBe('property-1');
		expect(Number(quote['Final Quoted Price'])).toBeGreaterThan(0);
		expect(quote['Pricing Config ID']).toBeTruthy();
		expect(quote['Quote Status']).toBe('Draft');

		expect(items.length).toBeGreaterThan(0);
		expect(items.every((i) => i['Quote ID'] === quote['Quote ID'])).toBe(true);

		// stored in the sheet, not just returned
		const quoteRows = harness.spreadsheet.getTab('Quotes');
		expect(quoteRows).toHaveLength(2); // header + 1
		const itemRows = harness.spreadsheet.getTab('QuoteItems');
		expect(itemRows.length).toBe(1 + items.length); // header + N
	});

	it('throws a clear error when there is no active PricingConfig', async () => {
		// wipe the seeded config's Active status by superseding via a fresh tab
		harness.spreadsheet.setTab('PricingConfig', [Object.keys(pricingConfigSchema.shape)]);

		await expect(
			createQuote(harness.env, {
				clientId: 'client-1',
				propertyId: 'property-1',
				input: {
					stories: 1,
					condition: 'light',
					counts: { ...ZERO_COUNTS, windowExtStandard: 10 },
					hardWater: false,
					constructionDebris: false,
					difficultAccess: false,
				},
			})
		).rejects.toThrow(/No active PricingConfig/);
	});

	it('stores an Input Snapshot and Calculation Result Snapshot for reproducibility', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 2,
				condition: 'moderate',
				counts: { ...ZERO_COUNTS, windowExtStandard: 15 },
				hardWater: true,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		const inputSnapshot = JSON.parse(quote['Input Snapshot']);
		expect(inputSnapshot.stories).toBe(2);
		expect(inputSnapshot.hardWater).toBe(true);

		const resultSnapshot = JSON.parse(quote['Calculation Result Snapshot']);
		expect(resultSnapshot.finalQuotedPrice).toBe(Number(quote['Final Quoted Price']));
	});
});
