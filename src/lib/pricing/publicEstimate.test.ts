import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { clientSchema } from '../models/client';
import { propertySchema } from '../models/property';
import { pipelineSchema } from '../models/pipeline';
import { quoteSchema } from '../models/quote';
import { pricingConfigSchema } from '../models/pricingConfig';
import { createRow } from '../sheets';
import { pricingConfigConfig } from '../models/pricingConfig';
import { activatePricingConfig, seedInitialPricingConfig } from './config';
import { createPublicEstimate } from './publicEstimate';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

describe('createPublicEstimate', () => {
	let harness: FakeFetchHandle;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('Pipeline', [Object.keys(pipelineSchema.shape)]);
		harness.spreadsheet.setTab('Quotes', [Object.keys(quoteSchema.shape)]);
		harness.spreadsheet.setTab('PricingConfig', [Object.keys(pricingConfigSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
		await seedInitialPricingConfig(harness.env);
		// The bare $150 seed leaves Estimate Low/High Variance blank (0%),
		// which would make low === high — set realistic variance so the range
		// tests actually exercise a range.
		const config = await createRow(harness.env, pricingConfigConfig, {
			'Config Name': 'Test config with variance',
			'Target Hourly Rate': '150',
			'Estimate Low Variance': '0.15',
			'Estimate High Variance': '0.2',
		});
		await activatePricingConfig(harness.env, config['Pricing Config ID']);
	});

	afterEach(() => {
		harness.restore();
	});

	it('returns only a low/high/minimumApplied range', async () => {
		const range = await createPublicEstimate(harness.env, {
			approxWindowCount: 20,
			stories: 1,
			streetAddress: '55 Public Estimator Way',
			firstName: 'Lead',
			lastName: 'Person',
		});
		expect(Object.keys(range).sort()).toEqual(['high', 'low', 'minimumApplied']);
		expect(range.low).toBeLessThan(range.high);
	});

	it('creates a Client, Property, Pipeline (New Lead), and a ballpark Quote, all linked together', async () => {
		await createPublicEstimate(harness.env, {
			approxWindowCount: 15,
			stories: 2,
			streetAddress: '55 Public Estimator Way',
			city: 'Boulder',
			firstName: 'Lead',
			lastName: 'Person',
			email: 'lead@example.com',
		});

		const clientRows = harness.spreadsheet.getTab('Clients').slice(1);
		const propertyRows = harness.spreadsheet.getTab('Properties').slice(1);
		const pipelineRows = harness.spreadsheet.getTab('Pipeline').slice(1);
		const quoteRows = harness.spreadsheet.getTab('Quotes').slice(1);

		expect(clientRows).toHaveLength(1);
		expect(propertyRows).toHaveLength(1);
		expect(pipelineRows).toHaveLength(1);
		expect(quoteRows).toHaveLength(1);

		const clientHeaders = harness.spreadsheet.getTab('Clients')[0];
		const clientId = clientRows[0][clientHeaders.indexOf('Client ID')];

		const propertyHeaders = harness.spreadsheet.getTab('Properties')[0];
		expect(propertyRows[0][propertyHeaders.indexOf('Client ID')]).toBe(clientId);
		expect(propertyRows[0][propertyHeaders.indexOf('Total Window Units')]).toBe('15');

		const pipelineHeaders = harness.spreadsheet.getTab('Pipeline')[0];
		expect(pipelineRows[0][pipelineHeaders.indexOf('Client ID')]).toBe(clientId);
		expect(pipelineRows[0][pipelineHeaders.indexOf('Stage')]).toBe('New Lead');

		const quoteHeaders = harness.spreadsheet.getTab('Quotes')[0];
		expect(quoteRows[0][quoteHeaders.indexOf('Client ID')]).toBe(clientId);
		expect(quoteRows[0][quoteHeaders.indexOf('Quote Type')]).toBe('ballpark');
	});

	it('throws a clear error when there is no active PricingConfig', async () => {
		harness.spreadsheet.setTab('PricingConfig', [Object.keys(pricingConfigSchema.shape)]);
		await expect(
			createPublicEstimate(harness.env, {
				approxWindowCount: 10,
				stories: 1,
				streetAddress: '1 Nowhere',
				firstName: 'A',
				lastName: 'B',
			})
		).rejects.toThrow(/No active PricingConfig/);
	});
});
