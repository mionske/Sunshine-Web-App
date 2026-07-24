import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { pricingConfigSchema } from '../models/pricingConfig';
import { quoteSchema } from '../models/quote';
import { quoteItemSchema } from '../models/quoteItem';
import { serviceSchema } from '../models/service';
import { propertyConfig, propertySchema } from '../models/property';
import { createRow } from '../sheets';
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
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);

		await seedInitialPricingConfig(harness.env);
		await seedInitialServices(harness.env);
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St' });
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

	it('leaves the access-item counts blank (never a fabricated zero) when not provided — e.g. the plain in-field quoter', async () => {
		const { quote } = await createQuote(harness.env, {
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
		});

		expect(quote['Difficult Access Item Count']).toBe('');
		expect(quote['Specialty Access Item Count']).toBe('');
	});

	it('stores the access-item counts when provided — e.g. the walkthrough-to-quote path', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			difficultAccessItemCount: 3,
			specialtyAccessItemCount: 1,
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 10 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		expect(quote['Difficult Access Item Count']).toBe('3');
		expect(quote['Specialty Access Item Count']).toBe('1');
	});

	it('requires an Adjustment Reason (Override Reason) when a Manual Adjustment is applied', async () => {
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
					manualAdjustment: 50,
				},
			})
		).rejects.toThrow(/Adjustment Reason is required/);
	});

	it('requires an Adjustment Reason when a Discount is applied', async () => {
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
					discount: 20,
				},
			})
		).rejects.toThrow(/Adjustment Reason is required/);
	});

	it('does not require an Adjustment Reason when neither Manual Adjustment nor Discount is applied', async () => {
		const { quote } = await createQuote(harness.env, {
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
		});
		expect(quote['Override Reason']).toBe('');
	});

	it('succeeds once a reason is given for a Manual Adjustment or Discount', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 10 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
				manualAdjustment: 50,
				discount: 20,
				overrideReason: 'Owner Discretion',
			},
		});
		expect(quote['Override Reason']).toBe('Owner Discretion');
		expect(Number(quote['Manual Adjustment'])).toBe(50);
		expect(Number(quote.Discount)).toBe(20);
	});

	it('persists Service Scope, Inventory Coverage, Labor Estimate, and job-condition fields when provided', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			serviceScope: 'Exterior Only',
			inventoryCoverage: 'Entire Property',
			laborEstimate: { soloHours: '3.5', crewSize: '2', confidence: 'Medium', notes: 'Steep roofline' },
			jobConditions: { highInteriorGlass: true, steepOrUnevenTerrain: false, otherConditionNotes: 'Dog on site' },
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 10 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: true,
			},
		});

		expect(quote['Service Scope']).toBe('Exterior Only');
		expect(quote['Inventory Coverage']).toBe('Entire Property');
		expect(quote['Labor Estimate Solo Hours']).toBe('3.5');
		expect(quote['Labor Estimate Crew Size']).toBe('2');
		expect(quote['Labor Estimate Confidence']).toBe('Medium');
		expect(quote['Labor Estimate Notes']).toBe('Steep roofline');
		expect(quote['Job High Interior Glass (Y/N)']).toBe('Y');
		expect(quote['Job Steep Or Uneven Terrain (Y/N)']).toBe('N');
		expect(quote['Job Other Condition Notes']).toBe('Dog on site');
	});

	it('leaves Service Scope/Inventory Coverage/Labor Estimate/job-condition fields blank when not provided', async () => {
		const { quote } = await createQuote(harness.env, {
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
		});

		expect(quote['Service Scope']).toBe('');
		expect(quote['Inventory Coverage']).toBe('');
		expect(quote['Labor Estimate Solo Hours']).toBe('');
		expect(quote['Job High Interior Glass (Y/N)']).toBe('');
	});
});
