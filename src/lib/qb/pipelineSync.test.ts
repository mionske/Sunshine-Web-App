import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { clientConfig, clientSchema } from '../models/client';
import { pipelineConfig, pipelineSchema } from '../models/pipeline';
import { qbEstimateConfig, qbEstimateSchema } from '../models/qbEstimate';
import { estimateStageMapping, syncPipelineFromEstimates } from './pipelineSync';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

describe('estimateStageMapping', () => {
	it('maps Pending to Quote Sent — an Estimate existing is the strongest automatic signal a quote went out', () => {
		expect(estimateStageMapping('Pending')).toEqual({ stage: 'Quote Sent' });
	});

	it('maps Accepted and Closed both to Accepted', () => {
		expect(estimateStageMapping('Accepted')).toEqual({ stage: 'Accepted' });
		expect(estimateStageMapping('Closed')).toEqual({ stage: 'Accepted' });
	});

	it('maps Rejected to Lost with a real (non-fabricated) Lost Reason', () => {
		expect(estimateStageMapping('Rejected')).toEqual({ stage: 'Lost', lostReason: 'QuickBooks Estimate rejected' });
	});

	it('falls back to Quote Sent for an unrecognized or blank status', () => {
		expect(estimateStageMapping('')).toEqual({ stage: 'Quote Sent' });
		expect(estimateStageMapping('SomethingNew')).toEqual({ stage: 'Quote Sent' });
	});
});

describe('syncPipelineFromEstimates (Sheets-backed)', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Pipeline', [Object.keys(pipelineSchema.shape)]);
		harness.spreadsheet.setTab('QBEstimates', [Object.keys(qbEstimateSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => harness.restore());

	it('creates a Pipeline opportunity for a linked client, stage from the Estimate status', async () => {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Perry', 'Last Name': 'Towle', 'QB Customer ID': 'qb-1' });
		await createRow(harness.env, qbEstimateConfig, { id: 'est-1', 'QB Customer ID': 'qb-1', Status: 'Pending', Total: '500' });

		const result = await syncPipelineFromEstimates(harness.env);

		expect(result.created).toBe(1);
		expect(result.skippedUnlinked).toBe(0);

		const rows = harness.spreadsheet.getTab('Pipeline');
		const headers = rows[0];
		const row = rows.find((r) => r[headers.indexOf('QB Estimate ID')] === 'est-1');
		expect(row?.[headers.indexOf('Client ID')]).toBe(client['Client ID']);
		expect(row?.[headers.indexOf('Stage')]).toBe('Quote Sent');
		expect(row?.[headers.indexOf('Estimated Value')]).toBe('500');
	});

	it('skips Estimates for a QB Customer with no linked Client', async () => {
		await createRow(harness.env, qbEstimateConfig, { id: 'est-1', 'QB Customer ID': 'qb-unlinked', Status: 'Pending', Total: '500' });

		const result = await syncPipelineFromEstimates(harness.env);

		expect(result.created).toBe(0);
		expect(result.skippedUnlinked).toBe(1);
		expect(harness.spreadsheet.getTab('Pipeline')).toHaveLength(1); // header only
	});

	it('updates the Stage of its own opportunity as the Estimate status changes, without creating a duplicate', async () => {
		await createRow(harness.env, clientConfig, { 'First Name': 'Perry', 'Last Name': 'Towle', 'QB Customer ID': 'qb-1' });
		await createRow(harness.env, qbEstimateConfig, { id: 'est-1', 'QB Customer ID': 'qb-1', Status: 'Pending', Total: '500' });
		await syncPipelineFromEstimates(harness.env);

		const estimateRows = harness.spreadsheet.getTab('QBEstimates');
		const estHeaders = estimateRows[0];
		const estRowIndex = estimateRows.findIndex((r) => r[estHeaders.indexOf('QB Estimate ID')] === 'est-1');
		estimateRows[estRowIndex][estHeaders.indexOf('Status')] = 'Accepted';

		const result = await syncPipelineFromEstimates(harness.env);

		expect(result.created).toBe(0);
		expect(result.updated).toBe(1);
		const pipelineRows = harness.spreadsheet.getTab('Pipeline').slice(1);
		expect(pipelineRows).toHaveLength(1);
		const headers = harness.spreadsheet.getTab('Pipeline')[0];
		expect(pipelineRows[0][headers.indexOf('Stage')]).toBe('Accepted');
	});

	it('never touches an opportunity with no QB Estimate ID — i.e. one the owner created by hand', async () => {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Perry', 'Last Name': 'Towle', 'QB Customer ID': 'qb-1' });
		const manualOpportunity = await createRow(harness.env, pipelineConfig, { 'Client ID': client['Client ID'], Stage: 'New Lead' });
		await createRow(harness.env, qbEstimateConfig, { id: 'est-1', 'QB Customer ID': 'qb-1', Status: 'Pending', Total: '500' });

		await syncPipelineFromEstimates(harness.env);

		const rows = harness.spreadsheet.getTab('Pipeline');
		const headers = rows[0];
		const manualRow = rows.find((r) => r[headers.indexOf('Opportunity ID')] === manualOpportunity['Opportunity ID']);
		expect(manualRow?.[headers.indexOf('Stage')]).toBe('New Lead'); // untouched
		expect(rows).toHaveLength(3); // header + manual + the one created from the Estimate
	});
});
