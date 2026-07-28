import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow, listActiveRows } from '../sheets';
import { clientConfig, clientSchema } from '../models/client';
import { propertyConfig, propertySchema } from '../models/property';
import { walkthroughSchema, walkthroughConfig } from '../models/walkthrough';
import { walkthroughItemSchema, walkthroughItemConfig } from '../models/walkthroughItem';
import { walkthroughAdjustmentSchema, walkthroughAdjustmentConfig } from '../models/walkthroughAdjustment';
import { pricingConfigSchema, type PricingConfig } from '../models/pricingConfig';
import type { LaborConfig } from '../models/laborConfig';
import type { WindowProductionProfile } from '../models/windowProductionProfile';
import { resolveLaborModel } from './config';
import { SEED_LABOR_CONFIG, SEED_WINDOW_PRODUCTION_PROFILES } from './seed';
import { saveLaborWalkthrough, type SaveLaborWalkthroughPayload } from './walkthroughLabor';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];
const TIMESTAMPS = { 'Created At': '', 'Updated At': '', 'Archived At': '' };

const MODEL = resolveLaborModel(
	{ ...SEED_LABOR_CONFIG, ...TIMESTAMPS } as LaborConfig,
	SEED_WINDOW_PRODUCTION_PROFILES.map((p) => ({ ...p, ...TIMESTAMPS })) as WindowProductionProfile[]
);

const PRICING = {
	'Pricing Config ID': 'pc-1',
	'Low Hourly Production Target': '150',
	'Target Hourly Production Target': '175',
	'High Hourly Production Target': '200',
	'Minimum Job Price': '250',
} as unknown as PricingConfig;

describe('saveLaborWalkthrough (Sheets-backed)', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('Walkthroughs', [Object.keys(walkthroughSchema.shape)]);
		harness.spreadsheet.setTab('WalkthroughItems', [Object.keys(walkthroughItemSchema.shape)]);
		harness.spreadsheet.setTab('WalkthroughLaborAdjustments', [Object.keys(walkthroughAdjustmentSchema.shape)]);
		harness.spreadsheet.setTab('PricingConfig', [Object.keys(pricingConfigSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function seed() {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Test', 'Last Name': 'Owner' });
		const property = await createRow(harness.env, propertyConfig, {
			'Client ID': client['Client ID'],
			'Property Type': 'Residential',
			'Street Address': '2690 Test Street',
		});
		return { client, property };
	}

	function payload(overrides: Partial<SaveLaborWalkthroughPayload> = {}): SaveLaborWalkthroughPayload {
		return {
			id: 'wt-1',
			clientId: 'c-1',
			propertyId: 'p-1',
			walkthroughDate: '2026-07-28',
			conductedBy: 'Greg',
			scope: { interior: true, exterior: true, screens: true, tracks: false, frames: true },
			conditions: {
				interiorGlass: 'Light Buildup',
				exteriorGlass: 'Moderate Buildup',
				exteriorFrame: 'Moderate Buildup',
				screen: 'Light Buildup',
			},
			groups: [
				{
					id: 'g-1',
					quantity: '20',
					productionClass: 'Standard Window',
					story: 'First',
					interiorAccess: 'Floor Level',
					exteriorAccess: 'Ground-Level Traditional',
				},
				{
					id: 'g-2',
					quantity: '4',
					productionClass: 'Large Picture Window',
					sizeClass: 'Oversized',
					story: 'Third',
					interiorAccess: 'Vaulted or Obstructed',
					exteriorAccess: 'Difficult Ladder Positioning',
				},
			],
			adjustments: [
				{ id: 'a-1', kind: 'Restoration', label: 'Razor Scraping', affectedPanes: '6', additionalMinutes: '45', notes: 'Sunroom' },
				{ id: 'a-2', kind: 'Modifier', label: 'Long Equipment Carry', additionalMinutes: '15' },
			],
			ownerSelectedPrice: '1700',
			...overrides,
		};
	}

	it('writes the walkthrough, its groups and its adjustments together', async () => {
		const { client, property } = await seed();
		const result = await saveLaborWalkthrough(harness.env, MODEL, PRICING, {
			...payload(),
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
		});

		expect(result.walkthrough['Walkthrough ID']).toBe('wt-1');
		expect(result.groups).toHaveLength(2);
		expect(result.adjustments).toHaveLength(2);

		const storedGroups = (await listActiveRows(harness.env, walkthroughItemConfig)).filter(
			(g) => g['Walkthrough ID'] === 'wt-1'
		);
		expect(storedGroups.map((g) => g['Production Class'])).toEqual(['Standard Window', 'Large Picture Window']);
		expect(storedGroups[1]['Exterior Access']).toBe('Difficult Ladder Positioning');
		expect(storedGroups[1]['Size Class']).toBe('Oversized');

		const storedAdjustments = await listActiveRows(harness.env, walkthroughAdjustmentConfig);
		expect(storedAdjustments.map((a) => a.Kind)).toEqual(['Restoration', 'Modifier']);
		expect(storedAdjustments[0]['Affected Panes']).toBe('6');
	});

	it('stores the labor result, the model version and the price band', async () => {
		const { client, property } = await seed();
		const result = await saveLaborWalkthrough(harness.env, MODEL, PRICING, {
			...payload(),
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
		});

		const stored = await listActiveRows(harness.env, walkthroughConfig);
		const walkthrough = stored[0];

		expect(Number(walkthrough['Productive Labor Minutes'])).toBeCloseTo(result.estimate.productiveMinutes, 1);
		expect(Number(walkthrough['Scheduled Minutes'])).toBeGreaterThan(Number(walkthrough['Productive Labor Minutes']));
		expect(walkthrough['Labor Model Version']).toBe('Residential v2');
		expect(walkthrough['Inventory Model']).toBe('grouped-v2');
		expect(walkthrough['Schedule Recommendation']).toBe(result.schedule.recommendation);

		expect(walkthrough['Suggested Low Price']).toBe(String(result.band.low));
		expect(walkthrough['Suggested Target Price']).toBe(String(result.band.target));
		expect(walkthrough['Suggested High Price']).toBe(String(result.band.high));

		// The owner's own number is stored exactly as given, not nudged toward
		// the suggestion.
		expect(walkthrough['Owner Override Price']).toBe('1700');

		const breakdown = JSON.parse(walkthrough['Labor Breakdown (JSON)']) as { breakdown: Record<string, number> };
		const sum = Object.values(breakdown.breakdown).reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(result.estimate.productiveMinutes, 6);
	});

	it('writes the component conditions and mirrors them onto the legacy fields', async () => {
		const { client, property } = await seed();
		await saveLaborWalkthrough(harness.env, MODEL, PRICING, {
			...payload(),
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
		});

		const walkthrough = (await listActiveRows(harness.env, walkthroughConfig))[0];
		expect(walkthrough['Interior Glass Condition']).toBe('Light Buildup');
		expect(walkthrough['Exterior Glass Condition']).toBe('Moderate Buildup');
		expect(walkthrough['Exterior Frame Condition']).toBe('Moderate Buildup');
		expect(walkthrough['Screen Condition']).toBe('Light Buildup');
		// Track condition was never asked, because tracks aren't in scope.
		expect(walkthrough['Track Condition']).toBe('');

		// createQuoteFromWalkthrough, the detail page and calibration all still
		// read these two. A v2 walkthrough that left them blank would look, to
		// every one of them, like a walkthrough with no condition recorded.
		expect(walkthrough['Exterior Condition']).toBe('Moderate Buildup');
		expect(walkthrough['Interior Condition']).toBe('Light Buildup');
	});

	it('sets the restoration flag columns everything else already reads', async () => {
		const { client, property } = await seed();
		await saveLaborWalkthrough(harness.env, MODEL, PRICING, {
			...payload({
				adjustments: [
					{ id: 'a-1', kind: 'Restoration', label: 'Hard Water or Mineral Deposits', additionalMinutes: '30' },
					{ id: 'a-2', kind: 'Restoration', label: 'Construction Debris', additionalMinutes: '20' },
				],
			}),
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
		});

		const walkthrough = (await listActiveRows(harness.env, walkthroughConfig))[0];
		expect(walkthrough['Hard Water Present (Y/N)']).toBe('Y');
		expect(walkthrough['Construction Debris Present (Y/N)']).toBe('Y');
		// Nothing that wasn't selected gets flagged.
		expect(walkthrough['Paint Overspray (Y/N)']).toBe('N');
	});

	it('writes totals the existing readers depend on', async () => {
		const { client, property } = await seed();
		const result = await saveLaborWalkthrough(harness.env, MODEL, PRICING, {
			...payload(),
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
		});

		const walkthrough = (await listActiveRows(harness.env, walkthroughConfig))[0];
		expect(walkthrough['Total Window Units']).toBe('24');
		expect(walkthrough['Total Glass Panes']).toBe(String(result.estimate.totals.glassPanes));
		// Picture glass carries no screen, so only the 20 standard units do.
		expect(walkthrough['Total Screens']).toBe('20');
		// Tracks are out of scope, so the total is zero rather than invented.
		expect(walkthrough['Total Tracks']).toBe('0');
	});

	it('records a manual screen total as manual and uses it for labor', async () => {
		const { client, property } = await seed();
		const withoutOverride = await saveLaborWalkthrough(harness.env, MODEL, PRICING, {
			...payload(),
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
		});
		const withOverride = await saveLaborWalkthrough(harness.env, MODEL, PRICING, {
			...payload({ id: 'wt-2', manualScreenTotal: '44' }),
			clientId: client['Client ID'],
			propertyId: property['Property ID'],
		});

		const stored = await listActiveRows(harness.env, walkthroughConfig);
		const second = stored.find((w) => w['Walkthrough ID'] === 'wt-2')!;
		expect(second['Total Screens']).toBe('44');
		expect(second['Manual Screen Total']).toBe('44');
		expect(withOverride.estimate.productiveMinutes).toBeGreaterThan(withoutOverride.estimate.productiveMinutes);
	});
});
