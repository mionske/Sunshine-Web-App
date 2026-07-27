import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from './sheets/testHarness';
import { _clearHeaderCacheForTests } from './sheets/rows';
import { leadSchema, leadConfig } from './models/lead';
import { clientSchema } from './models/client';
import { propertySchema } from './models/property';
import { createRow } from './sheets';
import { deleteLead, restoreLead, markLeadLost, convertLeadToClient, duplicateLead } from './leads';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

describe('deleteLead / restoreLead / markLeadLost / convertLeadToClient', () => {
	let harness: FakeFetchHandle;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Leads', [Object.keys(leadSchema.shape)]);
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function makeLead(overrides: Record<string, string> = {}) {
		return createRow(harness.env, leadConfig, {
			'First Name': 'Jamie',
			'Last Name': 'Rivera',
			Phone: '303-555-0100',
			Email: 'jamie@example.com',
			'Street Address': '99 Canyon Blvd',
			City: 'Boulder',
			State: 'CO',
			Zip: '80302',
			Source: 'Referral',
			...overrides,
		});
	}

	it('deleteLead archives the lead without setting an Outcome', async () => {
		const lead = await makeLead();
		await deleteLead(harness.env, lead['Lead ID']);

		const headers = harness.spreadsheet.getTab('Leads')[0];
		const idIdx = headers.indexOf('Lead ID');
		const archivedAtIdx = headers.indexOf('Archived At');
		const outcomeIdx = headers.indexOf('Outcome');
		const rows = harness.spreadsheet.getTab('Leads').slice(1);
		expect(rows).toHaveLength(1); // never hard-deleted
		expect(rows[0][idIdx]).toBe(lead['Lead ID']);
		expect(rows[0][archivedAtIdx]).toBeTruthy();
		expect(rows[0][outcomeIdx]).toBeFalsy();
	});

	it('throws a clear error when the lead does not exist', async () => {
		await expect(deleteLead(harness.env, 'missing-lead-id')).rejects.toThrow(/not found/);
	});

	it('restoreLead undoes deleteLead', async () => {
		const lead = await makeLead();
		await deleteLead(harness.env, lead['Lead ID']);
		await restoreLead(harness.env, lead['Lead ID']);

		const headers = harness.spreadsheet.getTab('Leads')[0];
		const idIdx = headers.indexOf('Lead ID');
		const archivedAtIdx = headers.indexOf('Archived At');
		const row = harness.spreadsheet.getTab('Leads').slice(1).find((r) => r[idIdx] === lead['Lead ID']);
		expect(row?.[archivedAtIdx]).toBeFalsy();
	});

	it('restoreLead throws for a lead that is not deleted', async () => {
		const lead = await makeLead();
		await expect(restoreLead(harness.env, lead['Lead ID'])).rejects.toThrow(/not deleted/);
	});

	it('markLeadLost sets Stage/Outcome to Lost and archives it, retained for reporting', async () => {
		const lead = await makeLead();
		const updated = await markLeadLost(harness.env, lead['Lead ID'], 'Went with another company');

		expect(updated.Stage).toBe('Lost');
		expect(updated.Outcome).toBe('Lost');
		expect(updated['Closed At']).toBeTruthy();
		expect(updated['Archived At']).toBeTruthy();
		expect(updated.Notes).toContain('Went with another company');
	});

	it('convertLeadToClient refuses a lead not yet at Quoted/Won', async () => {
		const lead = await makeLead({ Stage: 'Contacted' });
		await expect(convertLeadToClient(harness.env, lead['Lead ID'])).rejects.toThrow(/Quoted.*Won/);
	});

	it('convertLeadToClient creates a Client + Property carrying the Lead\'s data forward, and archives the Lead as Won', async () => {
		const lead = await makeLead({ Stage: 'Quoted' });

		const result = await convertLeadToClient(harness.env, lead['Lead ID']);

		expect(result.client['First Name']).toBe('Jamie');
		expect(result.client['Last Name']).toBe('Rivera');
		expect(result.client.Phone).toBe('303-555-0100');
		expect(result.client.Email).toBe('jamie@example.com');

		expect(result.property['Client ID']).toBe(result.client['Client ID']);
		expect(result.property['Street Address']).toBe('99 Canyon Blvd');
		expect(result.property.City).toBe('Boulder');
		// Property-specific fields not knowable from a Lead stay blank for the
		// operator to fill in after the walkthrough.
		expect(result.property['Total Window Units']).toBe('');

		expect(result.lead.Stage).toBe('Won');
		expect(result.lead.Outcome).toBe('Won');
		expect(result.lead['Converted Client ID']).toBe(result.client['Client ID']);
		expect(result.lead['Converted Property ID']).toBe(result.property['Property ID']);
		expect(result.lead['Archived At']).toBeTruthy();

		const clientRows = harness.spreadsheet.getTab('Clients').slice(1);
		const propertyRows = harness.spreadsheet.getTab('Properties').slice(1);
		expect(clientRows).toHaveLength(1);
		expect(propertyRows).toHaveLength(1);
	});

	it('convertLeadToClient refuses a lead that was already converted', async () => {
		const lead = await makeLead({ Stage: 'Quoted' });
		await convertLeadToClient(harness.env, lead['Lead ID']);

		await expect(convertLeadToClient(harness.env, lead['Lead ID'])).rejects.toThrow(/already been converted/);
	});

	it('duplicateLead copies contact/address/source/notes onto a fresh, unconverted lead', async () => {
		const lead = await makeLead({
			Stage: 'Won',
			Outcome: 'Won',
			'Next Follow-up Date': '2026-01-01',
			'Converted Client ID': 'client-1',
			'Converted Property ID': 'property-1',
			Notes: 'Some notes',
		});

		const duplicate = await duplicateLead(harness.env, lead['Lead ID']);

		expect(duplicate['Lead ID']).not.toBe(lead['Lead ID']);
		expect(duplicate['First Name']).toBe('Jamie');
		expect(duplicate['Street Address']).toBe('99 Canyon Blvd');
		expect(duplicate.Notes).toBe('Some notes');
		// Fresh, unconverted lead — funnel progress never carries over.
		expect(duplicate.Stage).toBe('New Lead');
		expect(duplicate.Outcome).toBe('');
		expect(duplicate['Next Follow-up Date']).toBe('');
		expect(duplicate['Converted Client ID']).toBe('');
		expect(duplicate['Converted Property ID']).toBe('');
		expect(duplicate['Archived At']).toBe('');

		const rows = harness.spreadsheet.getTab('Leads').slice(1);
		expect(rows).toHaveLength(2);
	});
});
