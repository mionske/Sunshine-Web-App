import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { quoteSchema } from '../models/quote';
import { pipelineSchema } from '../models/pipeline';
import { propertySchema } from '../models/property';
import { clientSchema } from '../models/client';
import { calibrationSnapshotSchema } from '../models/calibrationSnapshot';
import { createRow } from '../sheets';
import { quoteConfig } from '../models/quote';
import { pipelineConfig } from '../models/pipeline';
import { propertyConfig } from '../models/property';
import { clientConfig } from '../models/client';
import { jobConfig } from '../models/job';
import { acceptQuote, computeNextMaintenanceFollowUpDate, findJobByQuoteId, updateJobStatus } from './jobLifecycle';

// Mirrors the actual legacy Jobs tab: existing columns this app's schema
// doesn't declare, plus the 22 columns appended in Phase 8.
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
	'Callback Reason', 'Callback Root Cause', 'Callback Corrective Action', 'Callback Lessons Learned',
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

describe('quote acceptance and job lifecycle', () => {
	let harness: FakeFetchHandle;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Jobs', [JOBS_HEADERS]);
		harness.spreadsheet.setTab('Quotes', [Object.keys(quoteSchema.shape)]);
		harness.spreadsheet.setTab('Pipeline', [Object.keys(pipelineSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('CalibrationSnapshot', [Object.keys(calibrationSnapshotSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function makeQuote(overrides: Record<string, string> = {}) {
		return createRow(harness.env, quoteConfig, {
			'Client ID': 'client-1',
			'Property ID': 'property-1',
			'Final Quoted Price': '250',
			'Estimated Labor Hours': '1.75',
			'Quote Status': 'Sent',
			...overrides,
		});
	}

	it('creates a Job linked to the quote and marks the quote Accepted', async () => {
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St', City: 'Boulder' });
		const quote = await makeQuote();

		const { quote: updatedQuote, job } = await acceptQuote(harness.env, quote['Quote ID']);

		expect(updatedQuote['Quote Status']).toBe('Accepted');
		expect(updatedQuote['Accepted At']).toBeTruthy();
		expect(job['Quote ID']).toBe(quote['Quote ID']);
		expect(job['Job Status']).toBe('Unscheduled');
		expect(job['Property Address']).toBe('123 Main St, Boulder');
		expect(job['Quoted Price ($)']).toBe('250');
	});

	it('derives Window Count from the property\'s known window count, never a fake 0', async () => {
		await createRow(harness.env, propertyConfig, {
			id: 'property-1',
			'Property Type': 'Residential',
			'Street Address': '123 Main St',
			City: 'Boulder',
			'Total Window Units': '18',
		});
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);
		expect(job['Window Count']).toBe('18');
	});

	it('leaves Window Count blank when the property has no known window count', async () => {
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St', City: 'Boulder' });
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);
		expect(job['Window Count']).toBe('');
	});

	it('creates the job as Scheduled when a scheduled date is provided', async () => {
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St', City: 'Boulder' });
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID'], { scheduledDate: '2026-08-01' });
		expect(job['Job Status']).toBe('Scheduled');
	});

	it('closes the linked Pipeline opportunity when the quote is accepted', async () => {
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St', City: 'Boulder' });
		const opportunity = await createRow(harness.env, pipelineConfig, {
			'Client ID': 'client-1',
			'Property ID': 'property-1',
			Stage: 'Quote Sent',
		});
		const quote = await makeQuote({ 'Opportunity ID': opportunity['Opportunity ID'] });

		await acceptQuote(harness.env, quote['Quote ID']);

		const rows = harness.spreadsheet.getTab('Pipeline');
		const headers = rows[0];
		const stageCol = headers.indexOf('Stage');
		const closedAtCol = headers.indexOf('Closed At');
		const opportunityRow = rows.find((r) => r[headers.indexOf('Opportunity ID')] === opportunity['Opportunity ID']);
		expect(opportunityRow?.[stageCol]).toBe('Accepted');
		expect(opportunityRow?.[closedAtCol]).toBeTruthy();
	});

	it('is idempotent — accepting the same quote twice does not create a second Job', async () => {
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St', City: 'Boulder' });
		const quote = await makeQuote();

		const first = await acceptQuote(harness.env, quote['Quote ID']);
		const second = await acceptQuote(harness.env, quote['Quote ID']);

		expect(second.job['Job ID']).toBe(first.job['Job ID']);
		const jobRows = harness.spreadsheet.getTab('Jobs').slice(1);
		expect(jobRows).toHaveLength(1);
	});

	it('findJobByQuoteId finds the job created for a quote', async () => {
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St', City: 'Boulder' });
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);
		const found = await findJobByQuoteId(harness.env, quote['Quote ID']);
		expect(found?.['Job ID']).toBe(job['Job ID']);
	});

	it('updateJobStatus preserves pre-existing legacy columns not declared in the Job schema', async () => {
		await createRow(harness.env, propertyConfig, { id: 'property-1', 'Property Type': 'Residential', 'Street Address': '123 Main St', City: 'Boulder' });
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);

		// Simulate a legacy column already holding real, hand-entered data —
		// exactly what this test guards against silently wiping.
		const rows = harness.spreadsheet.getTab('Jobs');
		const headers = rows[0];
		const rowIndex = rows.findIndex((r) => r[headers.indexOf('Job ID')] === job['Job ID']);
		rows[rowIndex][headers.indexOf('Windows - Small')] = '8';
		rows[rowIndex][headers.indexOf('Lead Source')] = 'Referral';

		await updateJobStatus(harness.env, job['Job ID'], 'Scheduled');

		const updatedRows = harness.spreadsheet.getTab('Jobs');
		const updatedRow = updatedRows.find((r) => r[headers.indexOf('Job ID')] === job['Job ID']);
		expect(updatedRow?.[headers.indexOf('Windows - Small')]).toBe('8');
		expect(updatedRow?.[headers.indexOf('Lead Source')]).toBe('Referral');
		expect(updatedRow?.[headers.indexOf('Job Status')]).toBe('Scheduled');
	});

	it('pre-fills Next Maintenance Follow-up Date from the property frequency on completion', async () => {
		await createRow(harness.env, propertyConfig, {
			id: 'property-1',
			'Property Type': 'Residential',
			'Street Address': '123 Main St',
			City: 'Boulder',
			'Desired Maintenance Frequency': 'Quarterly',
		});
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);

		const updated = await updateJobStatus(harness.env, job['Job ID'], 'Completed', { 'Date Completed': '2026-01-15' });

		expect(updated['Next Maintenance Follow-up Date']).toBe('2026-04-15');
		expect(updated['Maintenance Follow-up Status']).toBe('Not yet due');
	});

	it('does not overwrite a manually-supplied follow-up date', async () => {
		await createRow(harness.env, propertyConfig, {
			id: 'property-1',
			'Property Type': 'Residential',
			'Street Address': '123 Main St',
			City: 'Boulder',
			'Desired Maintenance Frequency': 'Quarterly',
		});
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);

		const updated = await updateJobStatus(harness.env, job['Job ID'], 'Completed', {
			'Date Completed': '2026-01-15',
			'Next Maintenance Follow-up Date': '2026-06-01',
		});

		expect(updated['Next Maintenance Follow-up Date']).toBe('2026-06-01');
	});

	it('leaves the follow-up date blank when the property has no defined-interval frequency', async () => {
		await createRow(harness.env, propertyConfig, {
			id: 'property-1',
			'Property Type': 'Residential',
			'Street Address': '123 Main St',
			City: 'Boulder',
			'Desired Maintenance Frequency': 'As needed',
		});
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);

		const updated = await updateJobStatus(harness.env, job['Job ID'], 'Completed', { 'Date Completed': '2026-01-15' });

		expect(updated['Next Maintenance Follow-up Date']).toBe('');
	});

	// Data-ownership separation: Desired Maintenance Frequency moved from
	// Property to Client — the Client's value must win when both are set,
	// since the Property's is now just a legacy fallback for un-migrated
	// clients.
	it('prefers the linked Client\'s Desired Maintenance Frequency over the property\'s legacy value', async () => {
		await createRow(harness.env, clientConfig, {
			id: 'client-1',
			'First Name': 'Jane',
			'Last Name': 'Doe',
			'Desired Maintenance Frequency': 'Yearly',
		});
		await createRow(harness.env, propertyConfig, {
			id: 'property-1',
			'Client ID': 'client-1',
			'Property Type': 'Residential',
			'Street Address': '123 Main St',
			City: 'Boulder',
			'Desired Maintenance Frequency': 'Quarterly',
		});
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);

		const updated = await updateJobStatus(harness.env, job['Job ID'], 'Completed', { 'Date Completed': '2026-01-15' });

		expect(updated['Next Maintenance Follow-up Date']).toBe('2027-01-15'); // Yearly, not Quarterly
	});

	it('falls back to the property\'s legacy frequency when the linked Client has none set', async () => {
		await createRow(harness.env, clientConfig, { id: 'client-1', 'First Name': 'Jane', 'Last Name': 'Doe' });
		await createRow(harness.env, propertyConfig, {
			id: 'property-1',
			'Client ID': 'client-1',
			'Property Type': 'Residential',
			'Street Address': '123 Main St',
			City: 'Boulder',
			'Desired Maintenance Frequency': 'Quarterly',
		});
		const quote = await makeQuote();
		const { job } = await acceptQuote(harness.env, quote['Quote ID']);

		const updated = await updateJobStatus(harness.env, job['Job ID'], 'Completed', { 'Date Completed': '2026-01-15' });

		expect(updated['Next Maintenance Follow-up Date']).toBe('2026-04-15'); // Quarterly, from the property fallback
	});
});

describe('computeNextMaintenanceFollowUpDate', () => {
	it('adds the interval for a recognized frequency', () => {
		expect(computeNextMaintenanceFollowUpDate('2026-01-15', 'Quarterly')).toBe('2026-04-15');
		expect(computeNextMaintenanceFollowUpDate('2026-01-15', 'Twice Yearly')).toBe('2026-07-15');
		expect(computeNextMaintenanceFollowUpDate('2026-01-15', 'Yearly')).toBe('2027-01-15');
	});

	it('returns blank for an unrecognized or missing frequency', () => {
		expect(computeNextMaintenanceFollowUpDate('2026-01-15', 'One Time')).toBe('');
		expect(computeNextMaintenanceFollowUpDate('2026-01-15', '')).toBe('');
		expect(computeNextMaintenanceFollowUpDate('2026-01-15', 'Unknown')).toBe('');
	});

	it('returns blank for a missing or invalid completion date', () => {
		expect(computeNextMaintenanceFollowUpDate('', 'Quarterly')).toBe('');
		expect(computeNextMaintenanceFollowUpDate('not-a-date', 'Quarterly')).toBe('');
	});
});
