import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installFakeFetch, type FakeFetchHandle } from './testHarness';
import { _clearHeaderCacheForTests } from './rows';
import { createRelatedRows } from './relatedWrites';
import type { TabConfig } from './crud';

const quoteSchema = z.object({
	'Quote ID': z.string().min(1),
	'Final Quoted Price': z.number(),
	'Created At': z.string(),
	'Updated At': z.string(),
	'Archived At': z.string(),
});
const quoteConfig: TabConfig<z.infer<typeof quoteSchema>> = {
	tab: 'Quotes',
	idColumn: 'Quote ID',
	requiredColumns: ['Quote ID', 'Final Quoted Price', 'Created At', 'Updated At', 'Archived At'],
	schema: quoteSchema,
	entityType: 'Quote',
};

const quoteItemSchema = z.object({
	'Quote Item ID': z.string().min(1),
	'Quote ID': z.string(),
	'Service Code': z.string(),
	'Line Total': z.number(),
	'Created At': z.string(),
	'Updated At': z.string(),
	'Archived At': z.string(),
});
const quoteItemConfig: TabConfig<z.infer<typeof quoteItemSchema>> = {
	tab: 'QuoteItems',
	idColumn: 'Quote Item ID',
	requiredColumns: [
		'Quote Item ID',
		'Quote ID',
		'Service Code',
		'Line Total',
		'Created At',
		'Updated At',
		'Archived At',
	],
	schema: quoteItemSchema,
	entityType: 'QuoteItem',
};

describe('createRelatedRows', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Quotes', [
			['Quote ID', 'Final Quoted Price', 'Created At', 'Updated At', 'Archived At'],
		]);
		harness.spreadsheet.setTab('QuoteItems', [
			['Quote Item ID', 'Quote ID', 'Service Code', 'Line Total', 'Created At', 'Updated At', 'Archived At'],
		]);
		harness.spreadsheet.setTab('ActivityLog', [
			['Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes'],
		]);
	});

	afterEach(() => {
		harness.restore();
	});

	it('writes a parent row and its child rows together under one write operation ID', async () => {
		const quoteId = 'quote-1';
		const result = await createRelatedRows(harness.env, [
			{ config: quoteConfig, records: [{ id: quoteId, 'Final Quoted Price': 500 }] },
			{
				config: quoteItemConfig,
				records: [
					{ 'Quote ID': quoteId, 'Service Code': 'WINDOW_EXT_STANDARD', 'Line Total': 300 },
					{ 'Quote ID': quoteId, 'Service Code': 'SCREEN_CLEAN', 'Line Total': 200 },
				],
			},
		]);

		expect(result.writeOperationId).toBeTruthy();
		expect(harness.spreadsheet.getTab('Quotes')).toHaveLength(2); // header + 1
		expect(harness.spreadsheet.getTab('QuoteItems')).toHaveLength(3); // header + 2

		const activityRows = harness.spreadsheet.getTab('ActivityLog').slice(1);
		expect(activityRows).toHaveLength(3); // 1 quote + 2 quote items, all committed
		for (const row of activityRows) {
			expect(String(row[9])).toContain(result.writeOperationId);
			expect(String(row[9])).toContain('committed');
		}
	});

	it('rejects the whole operation if any record fails validation, writing nothing', async () => {
		await expect(
			createRelatedRows(harness.env, [
				{ config: quoteConfig, records: [{ 'Final Quoted Price': 500 }] },
				{
					config: quoteItemConfig,
					// missing required 'Line Total' — should fail validation before any write
					records: [{ 'Quote ID': 'quote-x', 'Service Code': 'SCREEN_CLEAN' } as never],
				},
			])
		).rejects.toThrow();

		expect(harness.spreadsheet.getTab('Quotes')).toHaveLength(1); // header only
		expect(harness.spreadsheet.getTab('QuoteItems')).toHaveLength(1); // header only
	});
});
