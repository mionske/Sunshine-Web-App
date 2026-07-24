import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { clientConfig, clientSchema, type Client } from '../models/client';
import { propertyConfig, propertySchema } from '../models/property';
import { qbEstimateSchema } from '../models/qbEstimate';
import { qbInvoiceSchema } from '../models/qbInvoice';
import { qbPaymentSchema } from '../models/qbPayment';
import type { QBCustomer } from '../models/qbCustomer';
import {
	confidenceTier,
	confirmQBLink,
	findMatchCandidates,
	nameSimilarity,
	parseFlatAddress,
	qboEstimateWebUrl,
	QBRelinkConfirmationRequiredError,
	scoreMatch,
	splitDisplayName,
	suggestQBLinksForClient,
} from './matching';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

function customer(overrides: Partial<QBCustomer> = {}): QBCustomer {
	// Default Display Name is deliberately dissimilar from the default
	// client() name below, so isolated single-signal tests don't
	// accidentally also pick up the name-similarity weight.
	return { 'QB Customer ID': 'qb-1', 'Display Name': 'Unrelated Qbcustomer Name', Email: '', Phone: '', Address: '', 'QB Last Updated': '', 'Created At': '', 'Updated At': '', 'Archived At': '', ...overrides };
}

describe('nameSimilarity', () => {
	it('is 1 for identical names, case/whitespace-insensitive', () => {
		expect(nameSimilarity('Jane Doe', ' jane doe ')).toBe(1);
	});
	it('is lower for dissimilar names', () => {
		expect(nameSimilarity('Jane Doe', 'Bob Smith')).toBeLessThan(0.5);
	});
	it('is 0 when either side is blank', () => {
		expect(nameSimilarity('', 'Jane Doe')).toBe(0);
	});
});

describe('confidenceTier', () => {
	it('groups scores into likely/possible/low-confidence/no signal — every score gets a label, none are hidden', () => {
		expect(confidenceTier(0.9)).toBe('likely');
		expect(confidenceTier(0.85)).toBe('likely');
		expect(confidenceTier(0.6)).toBe('possible');
		expect(confidenceTier(0.5)).toBe('possible');
		expect(confidenceTier(0.35)).toBe('low-confidence');
		expect(confidenceTier(0.3)).toBe('low-confidence');
		expect(confidenceTier(0.29)).toBe('no signal');
		expect(confidenceTier(0)).toBe('no signal');
	});
});

describe('scoreMatch', () => {
	function client(overrides: Partial<Client> = {}): Client {
		return {
			'Client ID': 'c-1', 'First Name': 'Jane', 'Last Name': 'Doe', Phone: '', Email: '', Address: '', 'Referral Source': '',
			'First Contact Date': '', 'Customer Since': '', 'Preferred Contact Method': '',
			'Desired Maintenance Frequency': '', 'Preferred Service Season': '',
			Notes: '', 'QB Customer ID': '',
			'Created At': '', 'Updated At': '', 'Archived At': '', ...overrides,
		};
	}

	it('scores an exact email match at 0.6', () => {
		const result = scoreMatch(customer({ Email: 'Jane@Example.com' }), client({ Email: 'jane@example.com' }));
		expect(result.emailMatch).toBe(true);
		expect(result.score).toBeCloseTo(0.6, 5);
	});

	it('scores an exact phone match (last 10 digits) at 0.3', () => {
		const result = scoreMatch(customer({ Phone: '+1 (303) 555-1234' }), client({ Phone: '303-555-1234' }));
		expect(result.phoneMatch).toBe(true);
		expect(result.score).toBeCloseTo(0.3, 5);
	});

	it('only counts name similarity when it meets the 0.6 threshold', () => {
		const closeMatch = scoreMatch(customer({ 'Display Name': 'Jane Doe' }), client({ 'First Name': 'Jane', 'Last Name': 'Doe' }));
		expect(closeMatch.score).toBeCloseTo(0.3, 5); // identical name -> full 0.3 weight

		const farMatch = scoreMatch(customer({ 'Display Name': 'Zzz Qqq' }), client({ 'First Name': 'Jane', 'Last Name': 'Doe' }));
		expect(farMatch.score).toBe(0);
	});

	it('scores an address match (zip + leading street number) at 0.2', () => {
		const property = { ...propertyStub(), 'Street Address': '123 Main St', Zip: '80301' };
		const result = scoreMatch(customer({ Address: '123 Main St, Boulder, CO, 80301' }), client(), property);
		expect(result.addressMatch).toBe(true);
		expect(result.score).toBeCloseTo(0.2, 5);
	});

	it('does not credit an address match when the street number differs', () => {
		const property = { ...propertyStub(), 'Street Address': '999 Main St', Zip: '80301' };
		const result = scoreMatch(customer({ Address: '123 Main St, Boulder, CO, 80301' }), client(), property);
		expect(result.addressMatch).toBe(false);
	});

	it('combines multiple signals, capped at 1', () => {
		const property = { ...propertyStub(), 'Street Address': '123 Main St', Zip: '80301' };
		const result = scoreMatch(
			customer({ Email: 'jane@example.com', Phone: '303-555-1234', 'Display Name': 'Jane Doe', Address: '123 Main St, Boulder, CO, 80301' }),
			client({ Email: 'jane@example.com', Phone: '303-555-1234' }),
			property
		);
		expect(result.score).toBe(1); // 0.6+0.3+0.3+0.2 = 1.4, capped
	});

	function propertyStub() {
		return {
			'Property ID': 'p-1', 'Client ID': 'c-1', 'Property Type': 'Residential', 'Street Address': '', City: '', State: '', Zip: '',
			'Year Built': '', 'Square Footage': '', Stories: '',
			'Interior Access Difficulty': '', 'Exterior Access Difficulty': '', 'Roof Access Required (Y/N)': '', 'Water Source': '', 'Exterior Cleaning Method': '',
			'High Interior Glass (Y/N)': '', 'Steep Or Uneven Terrain (Y/N)': '', 'Exterior Access Obstructed (Y/N)': '',
			'Furniture Or Belongings Movement Required (Y/N)': '', 'Restricted Work Or Setup Area (Y/N)': '',
			'Water Access Method': '', 'Water Supply': '', 'Parking And Setup Difficulty': '', 'Easy Parking And Setup (Y/N)': '', 'Limited Parking Or Setup Space (Y/N)': '',
			'Gate Or Entry Restriction (Y/N)': '', 'Long Hose Run (Y/N)': '', 'Water Source Far From Work Area (Y/N)': '', 'Site Access Notes': '',
			'Roof Access Difficulty': '', 'Overall Access Difficulty': '', 'Water Access': '',
			'Equipment Suitability': '', 'Hard Water History (Y/N)': '', 'Construction Debris (Y/N)': '', 'Window Condition': '',
			'Silicone Adhesive Or Sticker Residue (Y/N)': '', 'Heavy Interior Residue (Y/N)': '', 'Oxidized Frames Or Screens (Y/N)': '',
			'Condition Varies By Area (Y/N)': '', 'Condition Notes': '',
			'Total Window Units': '', 'Total Glass Panes': '', 'Count - Standard': '', 'Inventory Verified At': '',
			'Count - Double Hung': '', 'Count - Casement': '', 'Count - Picture': '', 'Count - Sliding': '', 'Count - French': '',
			'Count - Awning': '', 'Count - Skylights': '', 'Count - Solar Panels': '', 'Screen Count': '', 'Track Count': '', 'Desired Maintenance Frequency': '',
			'Preferred Service Season': '', 'Next Recommended Service Date': '', 'Maintenance Notes': '', 'Next Scheduled Visit': '', 'Last Review Requested Date': '',
			'Last Review Received Date': '', 'Sliding Glass Door Pane Count': '', 'Water-Fed Pole Suitable (Y/N)': '', 'Ladder Requirement': '', 'Access Notes': '',
			'Pet Notes': '', 'General Notes': '', 'Building/Complex Name': '', 'Unit Identifier': '', 'Created At': '', 'Updated At': '', 'Archived At': '',
		} as const;
	}
});

describe('findMatchCandidates / confirmQBLink / suggestQBLinksForClient (Sheets-backed)', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('QBEstimates', [Object.keys(qbEstimateSchema.shape)]);
		harness.spreadsheet.setTab('QBInvoices', [Object.keys(qbInvoiceSchema.shape)]);
		harness.spreadsheet.setTab('QBPayments', [Object.keys(qbPaymentSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => harness.restore());

	it('ranks all clients best-first, without hiding weak-scoring ones — linking is always a manual confirmation, never automatic', async () => {
		await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe', Email: 'jane@example.com' });
		await createRow(harness.env, clientConfig, { 'First Name': 'Bob', 'Last Name': 'Smith', Email: 'bob@example.com' });

		const candidates = await findMatchCandidates(harness.env, customer({ Email: 'jane@example.com', 'Display Name': 'Jane Doe' }));

		expect(candidates).toHaveLength(2);
		expect(candidates[0].client['First Name']).toBe('Jane');
		expect(candidates[0].confidence).toBe('likely');
		expect(candidates[1].client['First Name']).toBe('Bob');
		expect(candidates[1].confidence).toBe('no signal');
	});

	it('confirmQBLink sets Clients.QB Customer ID and logs activity', async () => {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe' });
		const updated = await confirmQBLink(harness.env, client['Client ID'], 'qb-99');
		expect(updated['QB Customer ID']).toBe('qb-99');

		const activityRows = harness.spreadsheet.getTab('ActivityLog').slice(1);
		expect(activityRows.some((r) => String(r[3]).includes('QB Customer linked'))).toBe(true);
	});

	it('requires explicit confirmation before overwriting an existing different link', async () => {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe', 'QB Customer ID': 'qb-old' });

		await expect(confirmQBLink(harness.env, client['Client ID'], 'qb-new')).rejects.toBeInstanceOf(QBRelinkConfirmationRequiredError);

		const updated = await confirmQBLink(harness.env, client['Client ID'], 'qb-new', { confirmRelink: true });
		expect(updated['QB Customer ID']).toBe('qb-new');
	});

	it('re-confirming the same QB Customer ID is a no-op, not a re-link', async () => {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe', 'QB Customer ID': 'qb-1' });
		const updated = await confirmQBLink(harness.env, client['Client ID'], 'qb-1');
		expect(updated['QB Customer ID']).toBe('qb-1');
	});

	it('suggestQBLinksForClient returns everything sharing that QB Customer ID once linked', async () => {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe', 'QB Customer ID': 'qb-1' });
		await createRow(harness.env, { tab: 'QBEstimates', idColumn: 'QB Estimate ID', requiredColumns: Object.keys(qbEstimateSchema.shape), schema: qbEstimateSchema, entityType: 'QBEstimate' }, { 'QB Customer ID': 'qb-1' });
		await createRow(harness.env, { tab: 'QBInvoices', idColumn: 'QB Invoice ID', requiredColumns: Object.keys(qbInvoiceSchema.shape), schema: qbInvoiceSchema, entityType: 'QBInvoice' }, { 'QB Customer ID': 'qb-1' });

		const linked = await suggestQBLinksForClient(harness.env, client['Client ID']);
		expect(linked.estimates).toHaveLength(1);
		expect(linked.invoices).toHaveLength(1);
		expect(linked.payments).toHaveLength(0);
	});

	it('suggestQBLinksForClient returns empty arrays for an unlinked client', async () => {
		const client = await createRow(harness.env, clientConfig, { 'First Name': 'Jane', 'Last Name': 'Doe' });
		const linked = await suggestQBLinksForClient(harness.env, client['Client ID']);
		expect(linked).toEqual({ estimates: [], invoices: [], payments: [] });
	});
});

describe('QBO web URL helpers', () => {
	it('build deep links to the QBO web UI', () => {
		expect(qboEstimateWebUrl('123')).toBe('https://qbo.intuit.com/app/estimate?txnId=123');
	});
});

describe('splitDisplayName', () => {
	it('splits a simple "First Last" name', () => {
		expect(splitDisplayName('Perry Towle')).toEqual({ firstName: 'Perry', lastName: 'Towle' });
	});

	it('splits on the last whitespace run for a multi-part name', () => {
		expect(splitDisplayName('Mary Jane Smith')).toEqual({ firstName: 'Mary Jane', lastName: 'Smith' });
	});

	it('puts the whole name as first name when there is no whitespace, rather than guessing', () => {
		expect(splitDisplayName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
	});
});

describe('parseFlatAddress', () => {
	it('splits a fully-formed flattened address into its 4 parts', () => {
		expect(parseFlatAddress('601 Canyon Blvd, Boulder, Colorado, 80302')).toEqual({
			street: '601 Canyon Blvd',
			city: 'Boulder',
			state: 'Colorado',
			zip: '80302',
		});
	});

	it('keeps the whole string as street when it does not have exactly 4 parts, rather than mis-assigning', () => {
		expect(parseFlatAddress('601 Canyon Blvd, Boulder')).toEqual({
			street: '601 Canyon Blvd, Boulder',
			city: '',
			state: '',
			zip: '',
		});
	});
});
