import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { clientConfig, clientSchema } from '../models/client';
import { propertyConfig, propertySchema } from '../models/property';
import { walkthroughSchema } from '../models/walkthrough';
import { quoteSchema } from '../models/quote';
import { jobSchema } from '../models/job';
import { previewCalibrationEligibility, saveHistoricalEntry, type HistoricalEntryPayload } from './historicalEntry';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

function basePayload(overrides: Partial<HistoricalEntryPayload> = {}): HistoricalEntryPayload {
	return {
		client: {
			id: 'client-1',
			isExisting: false,
			firstName: 'Test',
			lastName: 'Owner',
			phone: '303-555-1234',
			email: 'test@example.com',
			preferredContactMethod: 'Text',
			referralSource: 'Word of mouth',
		},
		property: {
			id: 'property-1',
			isExisting: false,
			streetAddress: '100 Historical Ln',
			city: 'Boulder',
			state: 'CO',
			zip: '80301',
			stories: '2',
			totalWindowUnits: '20',
			totalGlassPanes: '40',
			screenCount: '10',
			accessNotes: '',
			petNotes: '',
			generalNotes: '',
		},
		walkthrough: {
			include: false,
			id: 'walkthrough-1',
			date: '',
			status: '',
			exteriorCondition: '',
			interiorCondition: '',
			accessDifficulty: '',
			hardWaterPresent: '',
			constructionDebrisPresent: '',
			estimatedOnSiteLaborHours: '',
			notes: '',
		},
		quote: {
			include: false,
			id: 'quote-1',
			date: '',
			amount: '',
			status: '',
			discountAmount: '',
			discountReason: '',
			pricingConfigId: '',
			notes: '',
		},
		job: {
			include: false,
			id: 'job-1',
			serviceDate: '',
			status: '',
			setupMinutes: '',
			cleaningMinutes: '',
			inspectionMinutes: '',
			packUpMinutes: '',
			totalOnSiteMinutesOverride: '',
			travelMinutes: '',
			offSiteAdminMinutes: '',
			finalRevenue: '',
			directCosts: '',
			callbackOccurred: false,
			callbackLaborMinutes: '',
			callbackCost: '',
			recordClassification: '',
			revenueTreatment: '',
			standardPriceEquivalent: '',
			dataQuality: '',
			dataQualityNotes: '',
		},
		...overrides,
	};
}

describe('saveHistoricalEntry', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('Walkthroughs', [Object.keys(walkthroughSchema.shape)]);
		harness.spreadsheet.setTab('Quotes', [Object.keys(quoteSchema.shape)]);
		harness.spreadsheet.setTab('Jobs', [Object.keys(jobSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
	});

	afterEach(() => {
		harness.restore();
	});

	it('creates a walkthrough-only record without ever creating a Job', async () => {
		const payload = basePayload({
			walkthrough: {
				include: true,
				id: 'walkthrough-1',
				date: '2026-01-10',
				status: 'Completed',
				exteriorCondition: 'Moderate Buildup',
				interiorCondition: 'Maintenance',
				accessDifficulty: 'Standard',
				hardWaterPresent: 'N',
				constructionDebrisPresent: 'N',
				estimatedOnSiteLaborHours: '2',
				notes: 'First visit',
			},
		});

		const result = await saveHistoricalEntry(harness.env, payload);

		expect(result.clientId).toBe('client-1');
		expect(result.propertyId).toBe('property-1');
		expect(result.walkthroughId).toBe('walkthrough-1');
		expect(result.jobId).toBeUndefined();
		expect(harness.spreadsheet.getTab('Walkthroughs')).toHaveLength(2); // header + 1
		expect(harness.spreadsheet.getTab('Jobs')).toHaveLength(1); // header only
	});

	it('reuses an existing client and property instead of duplicating them', async () => {
		const existingClient = await createRow(harness.env, clientConfig, { 'First Name': 'Stevie', 'Last Name': 'Damboise' });
		const existingProperty = await createRow(harness.env, propertyConfig, {
			'Client ID': existingClient['Client ID'],
			'Street Address': '1285 Georgetown Road',
		});

		const payload = basePayload({
			client: { ...basePayload().client, id: existingClient['Client ID'], isExisting: true },
			property: { ...basePayload().property, id: existingProperty['Property ID'], isExisting: true },
		});

		await saveHistoricalEntry(harness.env, payload);

		expect(harness.spreadsheet.getTab('Clients')).toHaveLength(2); // header + the one pre-existing row, no duplicate
		expect(harness.spreadsheet.getTab('Properties')).toHaveLength(2);
	});

	it('links quote to job and stores the walkthrough link on the quote', async () => {
		const payload = basePayload({
			walkthrough: { ...basePayload().walkthrough, include: true },
			quote: { ...basePayload().quote, include: true, amount: '400', status: 'Accepted' },
			job: {
				...basePayload().job,
				include: true,
				serviceDate: '2026-01-15',
				status: 'Completed',
				setupMinutes: '15',
				cleaningMinutes: '90',
				inspectionMinutes: '10',
				packUpMinutes: '10',
				finalRevenue: '400',
				callbackOccurred: false,
				recordClassification: 'Customer Job',
				revenueTreatment: 'Full Price',
				dataQuality: 'Complete',
			},
		});

		const result = await saveHistoricalEntry(harness.env, payload);

		const quoteRows = harness.spreadsheet.getTab('Quotes');
		const quoteHeaders = quoteRows[0];
		const quoteRow = quoteRows[1];
		expect(quoteRow[quoteHeaders.indexOf('Walkthrough ID')]).toBe('walkthrough-1');

		const jobRows = harness.spreadsheet.getTab('Jobs');
		const jobHeaders = jobRows[0];
		const jobRow = jobRows[1];
		expect(jobRow[jobHeaders.indexOf('Quote ID')]).toBe(result.quoteId);
		// 15+90+10+10 = 125 minutes = ~2.08 hours
		expect(Number(jobRow[jobHeaders.indexOf('Actual Time (hrs)')])).toBeCloseTo(125 / 60, 2);
	});

	it('uses the direct total when no breakdown minutes are given', async () => {
		const payload = basePayload({
			job: {
				...basePayload().job,
				include: true,
				totalOnSiteMinutesOverride: '90',
				finalRevenue: '200',
				recordClassification: 'Test Job',
			},
		});

		await saveHistoricalEntry(harness.env, payload);

		const jobRows = harness.spreadsheet.getTab('Jobs');
		const jobHeaders = jobRows[0];
		const jobRow = jobRows[1];
		expect(Number(jobRow[jobHeaders.indexOf('Actual Time (hrs)')])).toBeCloseTo(1.5, 2);
	});

	it('is idempotent — resubmitting the same payload does not create duplicate rows', async () => {
		const payload = basePayload({
			job: { ...basePayload().job, include: true, finalRevenue: '300', totalOnSiteMinutesOverride: '60' },
		});

		await saveHistoricalEntry(harness.env, payload);
		await saveHistoricalEntry(harness.env, payload);

		expect(harness.spreadsheet.getTab('Clients')).toHaveLength(2);
		expect(harness.spreadsheet.getTab('Properties')).toHaveLength(2);
		expect(harness.spreadsheet.getTab('Jobs')).toHaveLength(2);
	});
});

describe('previewCalibrationEligibility', () => {
	it('reports no job for a walkthrough-only entry', () => {
		const { eligible, reasons } = previewCalibrationEligibility(basePayload().job);
		expect(eligible).toBe(false);
		expect(reasons).toEqual(['No job will be created for this record']);
	});

	it('qualifies a complete job', () => {
		const { eligible, reasons } = previewCalibrationEligibility({
			...basePayload().job,
			include: true,
			status: 'Completed',
			totalOnSiteMinutesOverride: '90',
			finalRevenue: '300',
			callbackOccurred: false,
		});
		expect(eligible).toBe(true);
		expect(reasons).toEqual([]);
	});

	it('explains exactly what is missing for an incomplete job', () => {
		const { eligible, reasons } = previewCalibrationEligibility({
			...basePayload().job,
			include: true,
			status: 'Completed',
			finalRevenue: '',
		});
		expect(eligible).toBe(false);
		expect(reasons.length).toBeGreaterThan(0);
	});
});
