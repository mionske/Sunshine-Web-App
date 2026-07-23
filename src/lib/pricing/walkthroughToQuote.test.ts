import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { clientConfig, clientSchema } from '../models/client';
import { propertyConfig, propertySchema } from '../models/property';
import { walkthroughSchema, type Walkthrough } from '../models/walkthrough';
import { walkthroughItemSchema, type WalkthroughItem } from '../models/walkthroughItem';
import { quoteSchema } from '../models/quote';
import { quoteItemSchema } from '../models/quoteItem';
import { pricingConfigConfig, pricingConfigSchema, type PricingConfig } from '../models/pricingConfig';
import { serviceConfig, serviceSchema, type Service } from '../models/service';
import {
	computeWalkthroughPricing,
	createQuoteFromWalkthrough,
	itemsToQuoteCounts,
	saveWalkthrough,
} from './walkthroughToQuote';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

function config(overrides: Partial<PricingConfig> = {}): PricingConfig {
	return {
		'Pricing Config ID': 'pc-1',
		'Config Name': 'Test config',
		'Effective Date': '2026-01-01',
		'End Date': '',
		Status: 'Active',
		'Property Type': 'Residential',
		'Calculator Version': '1',
		'Target Hourly Rate': '150',
		'Minimum Job Price': '150',
		'Exterior Labor Weight': '',
		'Interior Labor Weight': '',
		'Screen Unit Price': '4',
		'Track Unit Price': '1',
		'Deep Track Unit Price': '2',
		'Skylight Unit Price': '20',
		'Sliding Door Unit Price': '15',
		'French Pane Unit Price': '18',
		'Oversized Glass Unit Price': '20',
		'Second Story Factor': '0.1',
		'Third Story Factor': '0.2',
		'Moderate Condition Factor': '0.15',
		'Heavy Condition Factor': '0.3',
		'First-Time Cleaning Factor': '0.25',
		'Hard Water Minimum': '30',
		'Construction Debris Minimum': '50',
		'Access Surcharge Minimum': '25',
		'Estimate Low Variance': '0.15',
		'Estimate High Variance': '0.2',
		'Created At': '',
		'Updated At': '',
		'Archived At': '',
		Notes: '',
		...overrides,
	};
}

function service(overrides: Partial<Service>): Service {
	return {
		'Service Code': '',
		'Service Name': '',
		'Service Category': '',
		'Default Unit': 'unit',
		'Default Labor Minutes': '0',
		'Pricing Method': 'LABOR_HOURS',
		'Publicly Available': 'Y',
		'Internally Available': 'Y',
		Active: 'Y',
		'Sort Order': '0',
		'Created At': '',
		'Updated At': '',
		'Archived At': '',
		Notes: '',
		...overrides,
	};
}

const SERVICES: Service[] = [
	service({ 'Service Code': 'WINDOW_EXT_STANDARD', 'Default Labor Minutes': '2.5' }),
	service({ 'Service Code': 'WINDOW_INT_STANDARD', 'Default Labor Minutes': '2.5' }),
	service({ 'Service Code': 'WINDOW_EXT_OVERSIZED', 'Default Labor Minutes': '5' }),
	service({ 'Service Code': 'WINDOW_INT_OVERSIZED', 'Default Labor Minutes': '5' }),
	service({ 'Service Code': 'WINDOW_EXT_FRENCH_PANE', 'Default Labor Minutes': '5' }),
	service({ 'Service Code': 'WINDOW_INT_FRENCH_PANE', 'Default Labor Minutes': '5' }),
	service({ 'Service Code': 'SLIDING_DOOR_EXT', 'Default Labor Minutes': '8' }),
	service({ 'Service Code': 'SLIDING_DOOR_INT', 'Default Labor Minutes': '8' }),
	service({ 'Service Code': 'SCREEN_CLEAN', 'Default Labor Minutes': '1' }),
	service({ 'Service Code': 'TRACK_BASIC', 'Default Labor Minutes': '0.5' }),
	service({ 'Service Code': 'TRACK_DEEP', 'Default Labor Minutes': '1' }),
	service({ 'Service Code': 'SKYLIGHT_EXT', 'Default Labor Minutes': '8' }),
	service({ 'Service Code': 'SKYLIGHT_INT', 'Default Labor Minutes': '8' }),
];

function item(overrides: Partial<WalkthroughItem> = {}): WalkthroughItem {
	return {
		'Walkthrough Item ID': crypto.randomUUID(),
		'Walkthrough ID': 'walkthrough-1',
		Area: 'Front',
		'Item Type': 'Window',
		Quantity: '1',
		'Size Class': 'Standard',
		'Interior Included': 'N',
		'Exterior Included': 'Y',
		'Screen Included': 'N',
		'Track Included': 'N',
		Condition: 'Maintenance',
		'Access Difficulty': 'Standard',
		'Hard Water': 'N',
		'Construction Debris': 'N',
		'Estimated Labor Minutes': '',
		Notes: '',
		'Sort Order': '0',
		'Created At': '',
		'Updated At': '',
		'Archived At': '',
		...overrides,
	};
}

describe('itemsToQuoteCounts', () => {
	it('maps a standard window with both sides cleaned', () => {
		const counts = itemsToQuoteCounts([item({ Quantity: '5', 'Interior Included': 'Y', 'Exterior Included': 'Y' })]);
		expect(counts.windowExtStandard).toBe(5);
		expect(counts.windowIntStandard).toBe(5);
	});

	it('maps size classes to their distinct service counts', () => {
		const counts = itemsToQuoteCounts([
			item({ Quantity: '2', 'Size Class': 'Oversized', 'Exterior Included': 'Y' }),
			item({ Quantity: '3', 'Size Class': 'French/Divided-Light', 'Exterior Included': 'Y' }),
		]);
		expect(counts.windowExtOversized).toBe(2);
		expect(counts.windowExtFrenchPane).toBe(3);
		expect(counts.windowExtStandard).toBe(0);
	});

	it('maps Sliding Door and Skylight item types', () => {
		const counts = itemsToQuoteCounts([
			item({ 'Item Type': 'Sliding Door', Quantity: '1', 'Exterior Included': 'Y', 'Interior Included': 'Y' }),
			item({ 'Item Type': 'Skylight', Quantity: '2', 'Exterior Included': 'Y' }),
		]);
		expect(counts.slidingDoorExt).toBe(1);
		expect(counts.slidingDoorInt).toBe(1);
		expect(counts.skylightExt).toBe(2);
	});

	it('adds screen/track counts independently of the window count', () => {
		const counts = itemsToQuoteCounts([
			item({ Quantity: '4', 'Exterior Included': 'Y', 'Screen Included': 'Y', 'Track Included': 'Y' }),
		]);
		expect(counts.windowExtStandard).toBe(4);
		expect(counts.screenClean).toBe(4);
		expect(counts.trackBasic).toBe(4);
	});

	it('ignores items with zero or blank quantity', () => {
		const counts = itemsToQuoteCounts([item({ Quantity: '0' }), item({ Quantity: '' })]);
		expect(Object.values(counts).every((v) => v === 0)).toBe(true);
	});

	it('does not double count when neither side is included', () => {
		const counts = itemsToQuoteCounts([item({ Quantity: '5', 'Interior Included': 'N', 'Exterior Included': 'N' })]);
		expect(Object.values(counts).every((v) => v === 0)).toBe(true);
	});
});

describe('computeWalkthroughPricing', () => {
	it('derives suggested low/target/high from the PricingConfig variance', () => {
		const items = [item({ Quantity: '20', 'Exterior Included': 'Y', 'Interior Included': 'Y' })];
		const suggestion = computeWalkthroughPricing(config(), SERVICES, items, {
			storyCountObserved: '1',
			exteriorCondition: 'Maintenance',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			accessDifficulty: 'Standard',
		});
		expect(suggestion.suggestedTargetPrice).toBeGreaterThan(0);
		expect(suggestion.suggestedLowPrice).toBeLessThan(suggestion.suggestedTargetPrice);
		expect(suggestion.suggestedHighPrice).toBeGreaterThan(suggestion.suggestedTargetPrice);
		expect(suggestion.pricingConfigId).toBe('pc-1');
	});

	it('maps exterior condition to the engine condition and applies its factor', () => {
		const items = [item({ Quantity: '20', 'Exterior Included': 'Y' })];
		const light = computeWalkthroughPricing(config(), SERVICES, items, {
			storyCountObserved: '1',
			exteriorCondition: 'Maintenance',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			accessDifficulty: 'Standard',
		});
		const heavy = computeWalkthroughPricing(config(), SERVICES, items, {
			storyCountObserved: '1',
			exteriorCondition: 'Heavy Buildup',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			accessDifficulty: 'Standard',
		});
		expect(heavy.suggestedTargetPrice).toBeGreaterThan(light.suggestedTargetPrice);
	});
});

describe('saveWalkthrough / createQuoteFromWalkthrough (Sheets-backed)', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('Walkthroughs', [Object.keys(walkthroughSchema.shape)]);
		harness.spreadsheet.setTab('WalkthroughItems', [Object.keys(walkthroughItemSchema.shape)]);
		harness.spreadsheet.setTab('Quotes', [Object.keys(quoteSchema.shape)]);
		harness.spreadsheet.setTab('QuoteItems', [Object.keys(quoteItemSchema.shape)]);
		harness.spreadsheet.setTab('PricingConfig', [Object.keys(pricingConfigSchema.shape)]);
		harness.spreadsheet.setTab('Services', [Object.keys(serviceSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function seedClientAndProperty() {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Test', 'Last Name': 'Owner' });
		const property = await createRow(harness.env, propertyConfig, {
			'Client ID': client['Client ID'],
			'Property Type': 'Residential',
			'Street Address': '100 Walkthrough Ln',
		});
		return { client, property };
	}

	async function seedActiveConfigAndServices() {
		// id: 'pc-1' explicitly — matches the fixture's hardcoded 'Pricing
		// Config ID' so the row actually stored has the same ID saveWalkthrough
		// records, letting createQuoteFromWalkthrough's findById(pc-1) resolve
		// to this row instead of falling back to getActivePricingConfig.
		const activeConfig = await createRow(harness.env, pricingConfigConfig, { id: 'pc-1', ...config() });
		for (const s of SERVICES) await createRow(harness.env, serviceConfig, { id: s['Service Code'], ...s } as never);
		return activeConfig;
	}

	it('saves a Walkthrough + its items and stores the computed pricing suggestion', async () => {
		const { client, property } = await seedClientAndProperty();
		await seedActiveConfigAndServices();

		const walkthroughId = crypto.randomUUID();
		const result = await saveWalkthrough(harness.env, config(), SERVICES, {
			id: walkthroughId,
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
			walkthroughDate: '2026-07-24',
			exteriorCondition: 'Maintenance',
			interiorCondition: 'Maintenance',
			storyCountObserved: '1',
			accessDifficulty: 'Standard',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			waterFedPoleSuitable: true,
			ladderRequired: '',
			roofAccessRequired: '',
			ownerOverridePrice: '',
			notes: '',
			items: [
				{
					id: crypto.randomUUID(),
					area: 'Front',
					itemType: 'Window',
					quantity: '10',
					sizeClass: 'Standard',
					interiorIncluded: true,
					exteriorIncluded: true,
					screenIncluded: false,
					trackIncluded: false,
					condition: 'Maintenance',
					accessDifficulty: 'Standard',
					hardWater: false,
					constructionDebris: false,
					notes: '',
				},
			],
		});

		expect(result.walkthrough.Status).toBe('Completed');
		expect(Number(result.walkthrough['Suggested Target Price'])).toBeGreaterThan(0);
		expect(result.walkthrough['Pricing Config ID']).toBe('pc-1');
		expect(result.items).toHaveLength(1);

		const walkthroughRows = harness.spreadsheet.getTab('Walkthroughs');
		expect(walkthroughRows).toHaveLength(2); // header + 1
		const itemRows = harness.spreadsheet.getTab('WalkthroughItems');
		expect(itemRows).toHaveLength(2); // header + 1
	});

	it('creates a Quote from a completed walkthrough using its stored PricingConfig', async () => {
		const { client, property } = await seedClientAndProperty();
		await seedActiveConfigAndServices();

		const walkthroughId = crypto.randomUUID();
		await saveWalkthrough(harness.env, config(), SERVICES, {
			id: walkthroughId,
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
			walkthroughDate: '2026-07-24',
			exteriorCondition: 'Maintenance',
			interiorCondition: 'Maintenance',
			storyCountObserved: '1',
			accessDifficulty: 'Standard',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			waterFedPoleSuitable: false,
			ladderRequired: '',
			roofAccessRequired: '',
			ownerOverridePrice: '',
			notes: '',
			items: [
				{
					id: crypto.randomUUID(),
					area: 'Front',
					itemType: 'Window',
					quantity: '10',
					sizeClass: 'Standard',
					interiorIncluded: true,
					exteriorIncluded: true,
					screenIncluded: false,
					trackIncluded: false,
					condition: 'Maintenance',
					accessDifficulty: 'Standard',
					hardWater: false,
					constructionDebris: false,
					notes: '',
				},
			],
		});

		const { quote, items } = await createQuoteFromWalkthrough(harness.env, walkthroughId);

		expect(quote['Client ID']).toBe(client['Client ID']);
		expect(quote['Property ID']).toBe(property['Property ID']);
		expect(quote['Walkthrough ID']).toBe(walkthroughId);
		expect(quote['Pricing Config ID']).toBe('pc-1');
		expect(items.length).toBeGreaterThan(0);

		const walkthroughRows = harness.spreadsheet.getTab('Walkthroughs');
		const headers = walkthroughRows[0];
		const row = walkthroughRows.find((r) => r[headers.indexOf('Walkthrough ID')] === walkthroughId);
		expect(row?.[headers.indexOf('Quote ID')]).toBe(quote['Quote ID']);
		expect(row?.[headers.indexOf('Status')]).toBe('Converted to Quote');
	});

	it('is idempotent — converting the same walkthrough twice does not create a second quote', async () => {
		const { client, property } = await seedClientAndProperty();
		await seedActiveConfigAndServices();

		const walkthroughId = crypto.randomUUID();
		await saveWalkthrough(harness.env, config(), SERVICES, {
			id: walkthroughId,
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
			walkthroughDate: '2026-07-24',
			exteriorCondition: 'Maintenance',
			interiorCondition: 'Maintenance',
			storyCountObserved: '1',
			accessDifficulty: 'Standard',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			waterFedPoleSuitable: false,
			ladderRequired: '',
			roofAccessRequired: '',
			ownerOverridePrice: '',
			notes: '',
			items: [
				{
					id: crypto.randomUUID(),
					area: 'Front',
					itemType: 'Window',
					quantity: '10',
					sizeClass: 'Standard',
					interiorIncluded: true,
					exteriorIncluded: true,
					screenIncluded: false,
					trackIncluded: false,
					condition: 'Maintenance',
					accessDifficulty: 'Standard',
					hardWater: false,
					constructionDebris: false,
					notes: '',
				},
			],
		});

		const first = await createQuoteFromWalkthrough(harness.env, walkthroughId);
		const second = await createQuoteFromWalkthrough(harness.env, walkthroughId);

		expect(second.quote['Quote ID']).toBe(first.quote['Quote ID']);
		const quoteRows = harness.spreadsheet.getTab('Quotes').slice(1);
		expect(quoteRows).toHaveLength(1);
	});
});
