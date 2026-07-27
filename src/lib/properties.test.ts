import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from './sheets/testHarness';
import { _clearHeaderCacheForTests } from './sheets/rows';
import { propertySchema, propertyConfig } from './models/property';
import { createRow } from './sheets';
import { jobConfig } from './models/job';
import { deleteProperty, restoreProperty, duplicateProperty } from './properties';

// Mirrors the actual legacy Jobs tab (see jobLifecycle.test.ts) — only the
// columns this suite actually touches matter, but the schema's own
// requiredColumns check needs everything jobConfig declares to be present.
const JOBS_HEADERS = [
	'Job ID', 'Date Completed', 'Property Address', 'Job Type', 'Lead Source',
	'Windows - Small', 'Windows - Medium', 'Windows - Large/Picture', 'Windows - French/Grid',
	'Total Panes', 'Screens', 'Hard Water Treatment (Y/N)', 'Quoted Price ($)', 'Final Price ($)',
	'Add-On Revenue ($)', 'Total Revenue ($)', 'Estimated Time (hrs)', 'Actual Time (hrs)',
	'WFP Time (hrs)', 'Time Accuracy (%)', 'Effective $/hr', 'Notes', '',
	'CALIBRATION SUMMARY (auto-updates)', '',
	'Window Count', 'Quote ID', 'Opportunity ID', 'Job Status', 'Arrival Timestamp',
	'Start Timestamp', 'Finish Timestamp', 'Departure Timestamp', 'Travel Time', 'Setup Time',
	'Cleaning Time', 'Inspection Time', 'Pack-up Time', 'Off-Site Admin Time', 'Callback Labor Minutes', 'Callback Cost',
	'Callback Category', 'Callback Reason', 'Callback Root Cause', 'Callback Corrective Action', 'Callback Lessons Learned',
	'Supplies Cost', 'Gas', 'Other Expenses', 'Total Job Cost',
	'Net Profit', 'Customer Rating', 'Callback Required (Y/N)', 'Photos', 'Version', 'Archived At',
	'Property ID',
	'Record Classification',
	'Revenue Treatment',
	'Standard Price Equivalent',
	'Data Quality',
	'Data Quality Notes',
	'Pricing Confidence',
	'Would Price Differently Today (Y/N)',
	'Current Retail Price Estimate ($)',
	'Reason Pricing Changed',
	'Overall Job Rating',
	'Customer Satisfaction Rating',
	'Would Accept Job Again (Y/N)',
	'Would Change Process (Y/N)',
	'Process Improvements',
	'Review Requested At',
	'Review Left',
	'Next Maintenance Follow-up Date',
	'Maintenance Follow-up Status',
	'QB Invoice Link',
	'QB Invoice ID',
	'QB Match Suggestion Dismissed',
	'Scheduled Date',
	'Job Day State',
	'Job Checklist (JSON)',
	'Job Notes',
	'Scope Changes',
	'Payment Status',
];

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

describe('deleteProperty / restoreProperty / duplicateProperty', () => {
	let harness: FakeFetchHandle;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('Jobs', [JOBS_HEADERS]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function makeProperty(overrides: Record<string, string> = {}) {
		return createRow(harness.env, propertyConfig, {
			'Client ID': 'client-1',
			'Property Type': 'Residential',
			'Street Address': '123 Main St',
			City: 'Boulder',
			'Total Window Units': '20',
			...overrides,
		});
	}

	it('deleteProperty archives the property, never hard-deleting it', async () => {
		const property = await makeProperty();
		await deleteProperty(harness.env, property['Property ID']);

		const headers = harness.spreadsheet.getTab('Properties')[0];
		const idIdx = headers.indexOf('Property ID');
		const archivedAtIdx = headers.indexOf('Archived At');
		const rows = harness.spreadsheet.getTab('Properties').slice(1);
		expect(rows).toHaveLength(1); // never hard-deleted
		expect(rows[0][idIdx]).toBe(property['Property ID']);
		expect(rows[0][archivedAtIdx]).toBeTruthy();
	});

	it('refuses to delete a property with a Scheduled or In Progress Job', async () => {
		const property = await makeProperty();
		await createRow(harness.env, jobConfig, { 'Property ID': property['Property ID'], 'Job Status': 'Scheduled' });

		await expect(deleteProperty(harness.env, property['Property ID'])).rejects.toThrow(/Scheduled or In Progress/);
	});

	it('allows deleting a property whose only Job is merely Unscheduled — not real committed work yet', async () => {
		const property = await makeProperty();
		await createRow(harness.env, jobConfig, { 'Property ID': property['Property ID'], 'Job Status': 'Unscheduled' });

		await expect(deleteProperty(harness.env, property['Property ID'])).resolves.not.toThrow();
	});

	it('allows deleting a property whose Jobs are all completed/cancelled', async () => {
		const property = await makeProperty();
		await createRow(harness.env, jobConfig, { 'Property ID': property['Property ID'], 'Job Status': 'Completed' });

		await expect(deleteProperty(harness.env, property['Property ID'])).resolves.not.toThrow();
	});

	it('throws a clear error when the property does not exist', async () => {
		await expect(deleteProperty(harness.env, 'missing-property-id')).rejects.toThrow(/not found/);
	});

	it('restoreProperty undoes deleteProperty', async () => {
		const property = await makeProperty();
		await deleteProperty(harness.env, property['Property ID']);
		await restoreProperty(harness.env, property['Property ID']);

		const headers = harness.spreadsheet.getTab('Properties')[0];
		const idIdx = headers.indexOf('Property ID');
		const archivedAtIdx = headers.indexOf('Archived At');
		const row = harness.spreadsheet.getTab('Properties').slice(1).find((r) => r[idIdx] === property['Property ID']);
		expect(row?.[archivedAtIdx]).toBeFalsy();
	});

	it('restoreProperty throws for a property that is not deleted', async () => {
		const property = await makeProperty();
		await expect(restoreProperty(harness.env, property['Property ID'])).rejects.toThrow(/not deleted/);
	});

	it('duplicateProperty copies every field onto a brand new row, never reusing the source ID', async () => {
		const property = await makeProperty({ 'Unit Identifier': 'A', 'Inventory Verified At': '2026-01-01T00:00:00.000Z' });

		const duplicate = await duplicateProperty(harness.env, property['Property ID']);

		expect(duplicate['Property ID']).not.toBe(property['Property ID']);
		expect(duplicate['Client ID']).toBe('client-1');
		expect(duplicate['Street Address']).toBe('123 Main St');
		expect(duplicate['Unit Identifier']).toBe('A');
		expect(duplicate['Total Window Units']).toBe('20');
		// Inventory Verified At never carries over — the duplicate's own
		// inventory hasn't actually been verified yet.
		expect(duplicate['Inventory Verified At']).toBe('');

		const rows = harness.spreadsheet.getTab('Properties').slice(1);
		expect(rows).toHaveLength(2);
	});
});
