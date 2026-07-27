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
import { createQuote, updateQuote, deleteQuote } from './quotes';
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

describe('updateQuote', () => {
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

	it('recalculates in place — same Quote ID, updated price, replaced QuoteItems', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 10, windowIntStandard: 10 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});
		const originalPrice = Number(quote['Final Quoted Price']);
		const originalItemCount = harness.spreadsheet.getTab('QuoteItems').length - 1;

		const { quote: updated, items } = await updateQuote(harness.env, quote['Quote ID'], {
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 30, windowIntStandard: 30 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		expect(updated['Quote ID']).toBe(quote['Quote ID']);
		expect(Number(updated['Final Quoted Price'])).toBeGreaterThan(originalPrice);
		expect(items.every((i) => i['Quote ID'] === quote['Quote ID'])).toBe(true);

		// Old QuoteItems soft-deleted (Archived At set), never hard-deleted.
		const quoteRows = harness.spreadsheet.getTab('Quotes');
		expect(quoteRows).toHaveLength(2); // still just header + the one Quote row, updated not duplicated

		const itemHeaders = harness.spreadsheet.getTab('QuoteItems')[0];
		const archivedAtIdx = itemHeaders.indexOf('Archived At');
		const quoteIdIdx = itemHeaders.indexOf('Quote ID');
		const allItemRows = harness.spreadsheet.getTab('QuoteItems').slice(1);
		const archivedForThisQuote = allItemRows.filter((r) => r[quoteIdIdx] === quote['Quote ID'] && r[archivedAtIdx]);
		const activeForThisQuote = allItemRows.filter((r) => r[quoteIdIdx] === quote['Quote ID'] && !r[archivedAtIdx]);
		expect(archivedForThisQuote).toHaveLength(originalItemCount);
		expect(activeForThisQuote).toHaveLength(items.length);
	});

	it('never overwrites Client ID/Property ID/Quote Status', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 5 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		const { quote: updated } = await updateQuote(harness.env, quote['Quote ID'], {
			input: {
				stories: 2,
				condition: 'moderate',
				counts: { ...ZERO_COUNTS, windowExtStandard: 12 },
				hardWater: true,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		expect(updated['Client ID']).toBe('client-1');
		expect(updated['Property ID']).toBe('property-1');
		expect(updated['Quote Status']).toBe('Draft');
	});

	it('throws a clear error when the Quote does not exist', async () => {
		await expect(
			updateQuote(harness.env, 'missing-quote-id', {
				input: {
					stories: 1,
					condition: 'light',
					counts: { ...ZERO_COUNTS, windowExtStandard: 5 },
					hardWater: false,
					constructionDebris: false,
					difficultAccess: false,
				},
			})
		).rejects.toThrow(/not found/);
	});

	it('requires an Adjustment Reason when a Manual Adjustment or Discount is applied', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 5 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		await expect(
			updateQuote(harness.env, quote['Quote ID'], {
				input: {
					stories: 1,
					condition: 'light',
					counts: { ...ZERO_COUNTS, windowExtStandard: 5 },
					hardWater: false,
					constructionDebris: false,
					difficultAccess: false,
					manualAdjustment: 50,
				},
			})
		).rejects.toThrow(/Adjustment Reason is required/);
	});
});

describe('deleteQuote', () => {
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

	it('archives the Quote and all of its QuoteItems, never hard-deleting either', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 10, windowIntStandard: 10 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		await deleteQuote(harness.env, quote['Quote ID']);

		const quoteHeaders = harness.spreadsheet.getTab('Quotes')[0];
		const quoteIdIdx = quoteHeaders.indexOf('Quote ID');
		const archivedAtIdx = quoteHeaders.indexOf('Archived At');
		const quoteRows = harness.spreadsheet.getTab('Quotes').slice(1);
		expect(quoteRows).toHaveLength(1); // still just the one row — never hard-deleted
		expect(quoteRows[0][archivedAtIdx]).toBeTruthy();
		expect(quoteRows[0][quoteIdIdx]).toBe(quote['Quote ID']);

		const itemHeaders = harness.spreadsheet.getTab('QuoteItems')[0];
		const itemQuoteIdIdx = itemHeaders.indexOf('Quote ID');
		const itemArchivedAtIdx = itemHeaders.indexOf('Archived At');
		const itemRows = harness.spreadsheet.getTab('QuoteItems').slice(1).filter((r) => r[itemQuoteIdIdx] === quote['Quote ID']);
		expect(itemRows.length).toBeGreaterThan(0);
		expect(itemRows.every((r) => r[itemArchivedAtIdx])).toBe(true);
	});

	it("does not affect another Quote's QuoteItems", async () => {
		const { quote: quoteA } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 5 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});
		const { quote: quoteB } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 7 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});

		await deleteQuote(harness.env, quoteA['Quote ID']);

		const itemHeaders = harness.spreadsheet.getTab('QuoteItems')[0];
		const itemQuoteIdIdx = itemHeaders.indexOf('Quote ID');
		const itemArchivedAtIdx = itemHeaders.indexOf('Archived At');
		const itemRowsForB = harness.spreadsheet
			.getTab('QuoteItems')
			.slice(1)
			.filter((r) => r[itemQuoteIdIdx] === quoteB['Quote ID']);
		expect(itemRowsForB.length).toBeGreaterThan(0);
		expect(itemRowsForB.every((r) => !r[itemArchivedAtIdx])).toBe(true);
	});

	it('refuses to delete an Accepted quote', async () => {
		const { quote } = await createQuote(harness.env, {
			clientId: 'client-1',
			propertyId: 'property-1',
			input: {
				stories: 1,
				condition: 'light',
				counts: { ...ZERO_COUNTS, windowExtStandard: 5 },
				hardWater: false,
				constructionDebris: false,
				difficultAccess: false,
			},
		});
		const quoteHeaders = harness.spreadsheet.getTab('Quotes')[0];
		const quoteIdIdx = quoteHeaders.indexOf('Quote ID');
		const statusIdx = quoteHeaders.indexOf('Quote Status');
		const rows = harness.spreadsheet.getTab('Quotes');
		const rowIndex = rows.findIndex((r, i) => i > 0 && r[quoteIdIdx] === quote['Quote ID']);
		rows[rowIndex][statusIdx] = 'Accepted';
		harness.spreadsheet.setTab('Quotes', rows);

		await expect(deleteQuote(harness.env, quote['Quote ID'])).rejects.toThrow(/Accepted/);
	});

	it('throws a clear error when the Quote does not exist', async () => {
		await expect(deleteQuote(harness.env, 'missing-quote-id')).rejects.toThrow(/not found/);
	});
});
