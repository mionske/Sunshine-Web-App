import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from './sheets/testHarness';
import { _clearHeaderCacheForTests } from './sheets/rows';
import { clientSchema, clientConfig } from './models/client';
import { propertySchema, propertyConfig } from './models/property';
import { createRow } from './sheets';
import { jobConfig } from './models/job';
import { deleteClient, restoreClient, duplicateClient } from './clients';

// Mirrors the actual legacy Jobs tab (see properties.test.ts) — only the
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

describe('deleteClient / restoreClient / duplicateClient', () => {
	let harness: FakeFetchHandle;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('Jobs', [JOBS_HEADERS]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function makeClient(overrides: Record<string, string> = {}) {
		return createRow(harness.env, clientConfig, {
			'First Name': 'Jamie',
			'Last Name': 'Rivera',
			Phone: '303-555-0100',
			Email: 'jamie@example.com',
			'Referral Source': 'Referral',
			'QB Customer ID': 'qb-cust-1',
			...overrides,
		});
	}

	it('deleteClient archives the client, never hard-deleting it', async () => {
		const client = await makeClient();
		await deleteClient(harness.env, client['Client ID']);

		const headers = harness.spreadsheet.getTab('Clients')[0];
		const idIdx = headers.indexOf('Client ID');
		const archivedAtIdx = headers.indexOf('Archived At');
		const rows = harness.spreadsheet.getTab('Clients').slice(1);
		expect(rows).toHaveLength(1); // never hard-deleted
		expect(rows[0][idIdx]).toBe(client['Client ID']);
		expect(rows[0][archivedAtIdx]).toBeTruthy();
	});

	it('refuses to delete a client with a Scheduled or In Progress Job on one of their properties', async () => {
		const client = await makeClient();
		const property = await createRow(harness.env, propertyConfig, { 'Client ID': client['Client ID'], 'Property Type': 'Residential' });
		await createRow(harness.env, jobConfig, { 'Property ID': property['Property ID'], 'Job Status': 'Scheduled' });

		await expect(deleteClient(harness.env, client['Client ID'])).rejects.toThrow(/Scheduled or In Progress/);
	});

	it('allows deleting a client whose properties have only Unscheduled/Completed jobs', async () => {
		const client = await makeClient();
		const property = await createRow(harness.env, propertyConfig, { 'Client ID': client['Client ID'], 'Property Type': 'Residential' });
		await createRow(harness.env, jobConfig, { 'Property ID': property['Property ID'], 'Job Status': 'Completed' });

		await expect(deleteClient(harness.env, client['Client ID'])).resolves.not.toThrow();
	});

	it('throws a clear error when the client does not exist', async () => {
		await expect(deleteClient(harness.env, 'missing-client-id')).rejects.toThrow(/not found/);
	});

	it('restoreClient undoes deleteClient', async () => {
		const client = await makeClient();
		await deleteClient(harness.env, client['Client ID']);
		await restoreClient(harness.env, client['Client ID']);

		const headers = harness.spreadsheet.getTab('Clients')[0];
		const idIdx = headers.indexOf('Client ID');
		const archivedAtIdx = headers.indexOf('Archived At');
		const row = harness.spreadsheet.getTab('Clients').slice(1).find((r) => r[idIdx] === client['Client ID']);
		expect(row?.[archivedAtIdx]).toBeFalsy();
	});

	it('restoreClient throws for a client that is not deleted', async () => {
		const client = await makeClient();
		await expect(restoreClient(harness.env, client['Client ID'])).rejects.toThrow(/not deleted/);
	});

	it('duplicateClient copies contact fields onto a new row, never carrying over the QB Customer ID', async () => {
		const client = await makeClient();

		const duplicate = await duplicateClient(harness.env, client['Client ID']);

		expect(duplicate['Client ID']).not.toBe(client['Client ID']);
		expect(duplicate['First Name']).toBe('Jamie');
		expect(duplicate['Last Name']).toBe('Rivera');
		expect(duplicate.Phone).toBe('303-555-0100');
		expect(duplicate['QB Customer ID']).toBe('');

		const rows = harness.spreadsheet.getTab('Clients').slice(1);
		expect(rows).toHaveLength(2);
	});
});
