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
	conditionForEngine,
	countAccessDifficultyItems,
	createQuoteFromWalkthrough,
	itemsToQuoteCounts,
	resolveWalkthroughCounts,
	saveWalkthrough,
	sumAreaRows,
	totalsToQuoteCounts,
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
		'Window Units': '',
		'Pane Count': '',
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

describe('countAccessDifficultyItems', () => {
	it('sums Quantity (not row count) for Difficult and Specialty Access items separately', () => {
		const counts = countAccessDifficultyItems([
			item({ Quantity: '3', 'Access Difficulty': 'Difficult' }),
			item({ Quantity: '2', 'Access Difficulty': 'Difficult' }),
			item({ Quantity: '1', 'Access Difficulty': 'Specialty Access' }),
			item({ Quantity: '5', 'Access Difficulty': 'Standard' }),
		]);
		expect(counts.difficultAccessItemCount).toBe(5);
		expect(counts.specialtyAccessItemCount).toBe(1);
	});

	it('ignores items with zero or blank quantity', () => {
		const counts = countAccessDifficultyItems([
			item({ Quantity: '0', 'Access Difficulty': 'Difficult' }),
			item({ Quantity: '', 'Access Difficulty': 'Specialty Access' }),
		]);
		expect(counts.difficultAccessItemCount).toBe(0);
		expect(counts.specialtyAccessItemCount).toBe(0);
	});

	it('reports zero for an item set with no Difficult/Specialty Access items', () => {
		const counts = countAccessDifficultyItems([item({ Quantity: '4', 'Access Difficulty': 'Easy' })]);
		expect(counts.difficultAccessItemCount).toBe(0);
		expect(counts.specialtyAccessItemCount).toBe(0);
	});
});

describe('conditionForEngine', () => {
	it('maps each Glass Condition level to its engine tier', () => {
		expect(conditionForEngine('Maintenance', false)).toBe('light');
		expect(conditionForEngine('Light Buildup', false)).toBe('light');
		expect(conditionForEngine('Moderate Buildup', false)).toBe('moderate');
		expect(conditionForEngine('Heavy Buildup', false)).toBe('heavy');
	});

	it('defaults an unrecognized/blank level to light', () => {
		expect(conditionForEngine('', false)).toBe('light');
		expect(conditionForEngine('Restoration Required', false)).toBe('light');
	});

	// Restoration Services Required checkboxes supplement the Glass
	// Condition rating rather than replacing it — but for pricing, any
	// restoration flag still overrides the level entirely, preserving the
	// exact surcharge the old "Restoration Required" condition level used
	// to trigger (the First-Time Cleaning Factor), just via a more accurate
	// trigger condition.
	it('forces the firstTime tier when a restoration flag is set, regardless of the Glass Condition level', () => {
		expect(conditionForEngine('Maintenance', true)).toBe('firstTime');
		expect(conditionForEngine('Heavy Buildup', true)).toBe('firstTime');
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

	it('applies the firstTime factor when a restoration flag is set even at the Maintenance level', () => {
		const items = [item({ Quantity: '20', 'Exterior Included': 'Y' })];
		const maintenance = computeWalkthroughPricing(config(), SERVICES, items, {
			storyCountObserved: '1',
			exteriorCondition: 'Maintenance',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			accessDifficulty: 'Standard',
		});
		const maintenanceWithRestoration = computeWalkthroughPricing(config(), SERVICES, items, {
			storyCountObserved: '1',
			exteriorCondition: 'Maintenance',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			accessDifficulty: 'Standard',
			razorScraping: true,
		});
		expect(maintenanceWithRestoration.suggestedTargetPrice).toBeGreaterThan(maintenance.suggestedTargetPrice);
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

	// Data-ownership separation: these condition/access fields moved from
	// Property to Walkthrough (reporting-only, never read by calculateQuote).
	it('saves the temporary condition and access fields moved from Property', async () => {
		const { client, property } = await seedClientAndProperty();
		await seedActiveConfigAndServices();

		const walkthroughId = crypto.randomUUID();
		const result = await saveWalkthrough(harness.env, config(), SERVICES, {
			id: walkthroughId,
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
			walkthroughDate: '2026-07-24',
			exteriorCondition: 'Heavy Buildup',
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
			siliconeResidue: true,
			heavyInteriorResidue: true,
			oxidizedFramesOrScreens: false,
			conditionVariesByArea: true,
			conditionNotes: 'Worse on the north side.',
			exteriorAccessObstructed: true,
			furnitureMovementRequired: false,
			temporaryAccessNotes: 'Dog in the backyard today.',
			items: [],
		});

		expect(result.walkthrough['Exterior Condition']).toBe('Heavy Buildup');
		expect(result.walkthrough['Silicone Adhesive Or Sticker Residue (Y/N)']).toBe('Y');
		expect(result.walkthrough['Heavy Interior Residue (Y/N)']).toBe('Y');
		expect(result.walkthrough['Oxidized Frames Or Screens (Y/N)']).toBe('N');
		expect(result.walkthrough['Condition Varies By Area (Y/N)']).toBe('Y');
		expect(result.walkthrough['Condition Notes']).toBe('Worse on the north side.');
		expect(result.walkthrough['Exterior Access Obstructed (Y/N)']).toBe('Y');
		expect(result.walkthrough['Furniture Or Belongings Movement Required (Y/N)']).toBe('N');
		expect(result.walkthrough['Temporary Access Notes']).toBe('Dog in the backyard today.');
	});

	// Restoration Services Required — supplements exteriorCondition/
	// interiorCondition, doesn't replace them.
	it('saves the Restoration Services Required fields', async () => {
		const { client, property } = await seedClientAndProperty();
		await seedActiveConfigAndServices();

		const walkthroughId = crypto.randomUUID();
		const result = await saveWalkthrough(harness.env, config(), SERVICES, {
			id: walkthroughId,
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
			walkthroughDate: '2026-07-24',
			exteriorCondition: 'Light Buildup',
			interiorCondition: 'Light Buildup',
			storyCountObserved: '1',
			accessDifficulty: 'Standard',
			hardWaterPresent: false,
			constructionDebrisPresent: true,
			waterFedPoleSuitable: true,
			ladderRequired: '',
			roofAccessRequired: '',
			ownerOverridePrice: '',
			notes: '',
			paintOverspray: true,
			razorScraping: true,
			steelWool: false,
			nonScratchPad: true,
			restorationNotes: 'Overspray on the west-facing windows only.',
			items: [],
		});

		expect(result.walkthrough['Exterior Condition']).toBe('Light Buildup');
		expect(result.walkthrough['Construction Debris Present (Y/N)']).toBe('Y');
		expect(result.walkthrough['Paint Overspray (Y/N)']).toBe('Y');
		expect(result.walkthrough['Razor Scraping Required (Y/N)']).toBe('Y');
		expect(result.walkthrough['Steel Wool Required (Y/N)']).toBe('N');
		expect(result.walkthrough['Non-Scratch Pad Required (Y/N)']).toBe('Y');
		expect(result.walkthrough['Restoration Notes']).toBe('Overspray on the west-facing windows only.');
	});

	it('leaves the new temporary condition/access fields blank (never fabricated) when not provided', async () => {
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
			waterFedPoleSuitable: false,
			ladderRequired: '',
			roofAccessRequired: '',
			ownerOverridePrice: '',
			notes: '',
			items: [],
		});

		expect(result.walkthrough['Silicone Adhesive Or Sticker Residue (Y/N)']).toBe('N');
		expect(result.walkthrough['Condition Notes']).toBe('');
		expect(result.walkthrough['Temporary Access Notes']).toBe('');
		expect(result.walkthrough['Paint Overspray (Y/N)']).toBe('N');
		expect(result.walkthrough['Razor Scraping Required (Y/N)']).toBe('N');
		expect(result.walkthrough['Steel Wool Required (Y/N)']).toBe('N');
		expect(result.walkthrough['Non-Scratch Pad Required (Y/N)']).toBe('N');
		expect(result.walkthrough['Restoration Notes']).toBe('');
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
					accessDifficulty: 'Difficult',
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
		expect(quote['Difficult Access Item Count']).toBe('10');
		expect(quote['Specialty Access Item Count']).toBe('0');
		expect(items.length).toBeGreaterThan(0);

		const walkthroughRows = harness.spreadsheet.getTab('Walkthroughs');
		const headers = walkthroughRows[0];
		const row = walkthroughRows.find((r) => r[headers.indexOf('Walkthrough ID')] === walkthroughId);
		expect(row?.[headers.indexOf('Quote ID')]).toBe(quote['Quote ID']);
		expect(row?.[headers.indexOf('Status')]).toBe('Converted to Quote');
	});

	it('carries Restoration Services Required flags into the Quote\'s Input Snapshot, and applies the firstTime factor', async () => {
		const { client, property } = await seedClientAndProperty();
		await seedActiveConfigAndServices();

		const walkthroughId = crypto.randomUUID();
		await saveWalkthrough(harness.env, config(), SERVICES, {
			id: walkthroughId,
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
			walkthroughDate: '2026-07-24',
			exteriorCondition: 'Maintenance',
			interiorCondition: 'Light Buildup',
			storyCountObserved: '1',
			accessDifficulty: 'Standard',
			hardWaterPresent: false,
			constructionDebrisPresent: false,
			waterFedPoleSuitable: false,
			ladderRequired: '',
			roofAccessRequired: '',
			ownerOverridePrice: '',
			notes: '',
			siliconeResidue: true,
			razorScraping: true,
			steelWool: true,
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

		const { quote } = await createQuoteFromWalkthrough(harness.env, walkthroughId);
		const snapshot = JSON.parse(quote['Input Snapshot']);

		// Even though the Glass Condition level is 'Maintenance' (light), the
		// restoration flags force the firstTime engine tier — same behavior
		// the old "Restoration Required" condition level used to trigger.
		expect(snapshot.condition).toBe('firstTime');
		expect(snapshot.siliconeResidue).toBe(true);
		expect(snapshot.razorScraping).toBe(true);
		expect(snapshot.steelWool).toBe(true);
		expect(snapshot.paintOverspray).toBe(false);
		expect(snapshot.nonScratchPad).toBe(false);
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

// The simplification pass's core inventory rule: a walkthrough is recorded
// as window units + panes of glass, with no window-type classification, and
// the two counts are never derived from one another.
function walkthroughRow(overrides: Partial<Walkthrough> = {}): Walkthrough {
	return walkthroughSchema.parse({ 'Walkthrough ID': 'walkthrough-1', ...overrides });
}

function areaRow(area: string, windowUnits: string, paneCount: string, extra: Partial<WalkthroughItem> = {}): WalkthroughItem {
	return walkthroughItemSchema.parse({
		'Walkthrough Item ID': crypto.randomUUID(),
		'Walkthrough ID': 'walkthrough-1',
		Area: area,
		'Window Units': windowUnits,
		'Pane Count': paneCount,
		...extra,
	});
}

describe('whole-property counts (units + panes)', () => {
	it('prices window units as standard windows, exterior only by default', () => {
		const counts = totalsToQuoteCounts(
			{ windowUnits: 77, panes: 135, screens: 44, tracks: 0, skylights: 0, slidingDoors: 0 },
			{ interior: false, exterior: true }
		);
		expect(counts.windowExtStandard).toBe(77);
		expect(counts.windowIntStandard).toBe(0);
		expect(counts.screenClean).toBe(44);
		// No window-type classification is ever inferred.
		expect(counts.windowExtOversized).toBe(0);
		expect(counts.windowExtFrenchPane).toBe(0);
	});

	it('counts both sides when the visit covers interior and exterior', () => {
		const counts = totalsToQuoteCounts(
			{ windowUnits: 10, panes: 30, screens: 0, tracks: 0, skylights: 2, slidingDoors: 1 },
			{ interior: true, exterior: true }
		);
		expect(counts.windowExtStandard).toBe(10);
		expect(counts.windowIntStandard).toBe(10);
		expect(counts.skylightExt).toBe(2);
		expect(counts.skylightInt).toBe(2);
		expect(counts.slidingDoorExt).toBe(1);
		expect(counts.slidingDoorInt).toBe(1);
	});

	it('never converts pane count into window units or vice versa', () => {
		const a = totalsToQuoteCounts({ windowUnits: 12, panes: 0, screens: 0, tracks: 0, skylights: 0, slidingDoors: 0 }, { interior: false, exterior: true });
		const b = totalsToQuoteCounts({ windowUnits: 12, panes: 999, screens: 0, tracks: 0, skylights: 0, slidingDoors: 0 }, { interior: false, exterior: true });
		expect(a).toEqual(b);
	});

	it('resolves from the walkthrough totals when there are no item rows at all', () => {
		const counts = resolveWalkthroughCounts(
			walkthroughRow({ 'Total Window Units': '77', 'Total Glass Panes': '135', 'Total Screens': '44', 'Exterior Included (Y/N)': 'Y' }),
			[]
		);
		expect(counts.windowExtStandard).toBe(77);
		expect(counts.screenClean).toBe(44);
	});

	it('sums optional area rows, and those win over the property totals', () => {
		const areas = [areaRow('Upstairs', '20', '40'), areaRow('Main floor', '30', '75'), areaRow('Basement', '7', '20')];
		expect(sumAreaRows(areas)).toMatchObject({ windowUnits: 57, panes: 135 });

		const counts = resolveWalkthroughCounts(
			walkthroughRow({ 'Total Window Units': '999', 'Exterior Included (Y/N)': 'Y' }),
			areas
		);
		expect(counts.windowExtStandard).toBe(57);
	});

	it('leaves walkthroughs that used detailed item rows priced exactly as before', () => {
		const items = [item({ 'Size Class': 'Oversized', Quantity: '4' }), item({ 'Size Class': 'Standard', Quantity: '6' })];
		// A walkthrough predating this change has no totals recorded at all.
		expect(resolveWalkthroughCounts(walkthroughRow(), items)).toEqual(itemsToQuoteCounts(items));
	});

	it('defaults to exterior-only when neither side was recorded', () => {
		const counts = resolveWalkthroughCounts(walkthroughRow({ 'Total Window Units': '10' }), []);
		expect(counts.windowExtStandard).toBe(10);
		expect(counts.windowIntStandard).toBe(0);
	});
});
