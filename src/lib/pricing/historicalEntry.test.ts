import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { clientConfig, clientSchema } from '../models/client';
import { propertyConfig, propertySchema } from '../models/property';
import { walkthroughSchema } from '../models/walkthrough';
import { quoteSchema } from '../models/quote';
import { jobSchema } from '../models/job';
import {
	previewCalibrationEligibility,
	saveHistoricalEntry,
	updateHistoricalEntry,
	type HistoricalEntryPayload,
} from './historicalEntry';

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
			propertyType: 'Residential',
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
			buildingComplexName: '',
			unitIdentifier: '',
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
			siliconeResidue: '',
			paintOverspray: '',
			razorScraping: '',
			steelWool: '',
			nonScratchPad: '',
			restorationNotes: '',
			secondStoryExterior: '',
			ladderRequired: '',
			vaultedInteriorGlass: '',
			roofAccessRequired: '',
			oversizedGlass: '',
			exteriorObstructions: '',
			limitedInteriorAccess: '',
			waterFedPoleUsed: '',
			traditionalExteriorCleaningUsed: '',
			otherAccessIssue: '',
			otherAccessNotes: '',
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
			callbackHours: '',
			callbackCost: '',
			callbackCategory: '',
			callbackReason: '',
			callbackRootCause: '',
			callbackCorrectiveAction: '',
			callbackLessonsLearned: '',
			recordClassification: '',
			revenueTreatment: '',
			standardPriceEquivalent: '',
			dataQuality: '',
			dataQualityNotes: '',
			pricingConfidence: '',
			wouldPriceDifferentlyToday: false,
			currentRetailPriceEstimate: '',
			reasonPricingChanged: '',
			overallJobRating: '',
			customerSatisfactionRating: '',
			wouldAcceptJobAgain: false,
			wouldChangeProcess: false,
			processImprovements: '',
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
				siliconeResidue: '',
				paintOverspray: '',
				razorScraping: '',
				steelWool: '',
				nonScratchPad: '',
				restorationNotes: '',
				secondStoryExterior: '',
				ladderRequired: '',
				vaultedInteriorGlass: '',
				roofAccessRequired: '',
				oversizedGlass: '',
				exteriorObstructions: '',
				limitedInteriorAccess: '',
				waterFedPoleUsed: '',
				traditionalExteriorCleaningUsed: '',
				otherAccessIssue: '',
				otherAccessNotes: '',
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
			'Property Type': 'Residential',
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

	it('links the walkthrough back to its quote (never a false-positive Dashboard follow-up reminder)', async () => {
		const payload = basePayload({
			walkthrough: { ...basePayload().walkthrough, include: true },
			quote: { ...basePayload().quote, include: true, amount: '400', status: 'Accepted' },
		});

		await saveHistoricalEntry(harness.env, payload);

		const rows = harness.spreadsheet.getTab('Walkthroughs');
		const headers = rows[0];
		const row = rows[1];
		expect(row[headers.indexOf('Quote ID')]).toBe('quote-1');
		expect(row[headers.indexOf('Status')]).toBe('Converted to Quote');
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

	it('writes Access & Equipment Modifiers onto the Walkthrough row', async () => {
		const payload = basePayload({
			walkthrough: {
				...basePayload().walkthrough,
				include: true,
				secondStoryExterior: 'Y',
				ladderRequired: 'Y',
				vaultedInteriorGlass: 'N',
				roofAccessRequired: 'N',
				oversizedGlass: 'Y',
				exteriorObstructions: 'N',
				limitedInteriorAccess: 'N',
				waterFedPoleUsed: 'Y',
				traditionalExteriorCleaningUsed: 'N',
				otherAccessIssue: 'Y',
				otherAccessNotes: 'Locked side gate, needed a key from the tenant.',
			},
		});

		await saveHistoricalEntry(harness.env, payload);

		const rows = harness.spreadsheet.getTab('Walkthroughs');
		const headers = rows[0];
		const row = rows[1];
		expect(row[headers.indexOf('Second-Story Exterior (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Ladder Required (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Oversized Glass Or Large Sliders (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Water-Fed Pole Used (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Other Access Issue (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Other Access Notes')]).toBe('Locked side gate, needed a key from the tenant.');
		expect(row[headers.indexOf('Vaulted Interior Glass (Y/N)')]).toBe('N');
	});

	it('converts Callback Hours to Callback Labor Minutes', async () => {
		const payload = basePayload({
			job: {
				...basePayload().job,
				include: true,
				finalRevenue: '500',
				totalOnSiteMinutesOverride: '480',
				callbackOccurred: true,
				callbackHours: '4',
				callbackCost: '150',
			},
		});

		await saveHistoricalEntry(harness.env, payload);

		const rows = harness.spreadsheet.getTab('Jobs');
		const headers = rows[0];
		const row = rows[1];
		expect(row[headers.indexOf('Callback Labor Minutes')]).toBe('240');
		expect(row[headers.indexOf('Callback Required (Y/N)')]).toBe('Y');
	});

	it('writes Callback Reason/Root Cause/Corrective Action/Lessons Learned', async () => {
		const payload = basePayload({
			job: {
				...basePayload().job,
				include: true,
				finalRevenue: '500',
				totalOnSiteMinutesOverride: '480',
				callbackOccurred: true,
				callbackHours: '2',
				callbackCategory: 'Quality',
				callbackReason: 'Streaking',
				callbackRootCause: 'Hard water spots not fully removed on first pass.',
				callbackCorrectiveAction: 'Re-cleaned with a squeegee pass and vinegar solution.',
				callbackLessonsLearned: 'Budget extra time for hard-water properties.',
			},
		});

		await saveHistoricalEntry(harness.env, payload);

		const rows = harness.spreadsheet.getTab('Jobs');
		const headers = rows[0];
		const row = rows[1];
		expect(row[headers.indexOf('Callback Category')]).toBe('Quality');
		expect(row[headers.indexOf('Callback Reason')]).toBe('Streaking');
		expect(row[headers.indexOf('Callback Root Cause')]).toBe('Hard water spots not fully removed on first pass.');
		expect(row[headers.indexOf('Callback Corrective Action')]).toBe('Re-cleaned with a squeegee pass and vinegar solution.');
		expect(row[headers.indexOf('Callback Lessons Learned')]).toBe('Budget extra time for hard-water properties.');
	});

	it('writes Pricing Review fields', async () => {
		const payload = basePayload({
			job: {
				...basePayload().job,
				include: true,
				finalRevenue: '500',
				totalOnSiteMinutesOverride: '480',
				pricingConfidence: 'Medium',
				wouldPriceDifferentlyToday: true,
				currentRetailPriceEstimate: '650',
				reasonPricingChanged: 'Underestimated the access complexity.',
			},
		});

		await saveHistoricalEntry(harness.env, payload);

		const rows = harness.spreadsheet.getTab('Jobs');
		const headers = rows[0];
		const row = rows[1];
		expect(row[headers.indexOf('Pricing Confidence')]).toBe('Medium');
		expect(row[headers.indexOf('Would Price Differently Today (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Current Retail Price Estimate ($)')]).toBe('650');
		expect(row[headers.indexOf('Reason Pricing Changed')]).toBe('Underestimated the access complexity.');
	});

	it('writes Job Performance Review fields', async () => {
		const payload = basePayload({
			job: {
				...basePayload().job,
				include: true,
				finalRevenue: '500',
				totalOnSiteMinutesOverride: '480',
				overallJobRating: '4',
				customerSatisfactionRating: '5',
				wouldAcceptJobAgain: true,
				wouldChangeProcess: true,
				processImprovements: 'Bring the water-fed pole as a default, not an afterthought.',
			},
		});

		await saveHistoricalEntry(harness.env, payload);

		const rows = harness.spreadsheet.getTab('Jobs');
		const headers = rows[0];
		const row = rows[1];
		expect(row[headers.indexOf('Overall Job Rating')]).toBe('4');
		expect(row[headers.indexOf('Customer Satisfaction Rating')]).toBe('5');
		expect(row[headers.indexOf('Would Accept Job Again (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Would Change Process (Y/N)')]).toBe('Y');
		expect(row[headers.indexOf('Process Improvements')]).toBe('Bring the water-fed pole as a default, not an afterthought.');
	});
});

describe('updateHistoricalEntry', () => {
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

	it('updates the existing rows in place instead of creating new ones', async () => {
		const created = await saveHistoricalEntry(
			harness.env,
			basePayload({
				job: {
					...basePayload().job,
					include: true,
					finalRevenue: '400',
					totalOnSiteMinutesOverride: '120',
					recordClassification: 'Customer Job',
					overallJobRating: '3',
				},
			})
		);

		const editedPayload = basePayload({
			client: { ...basePayload().client, id: created.clientId, isExisting: true },
			property: { ...basePayload().property, id: created.propertyId, isExisting: true },
			job: {
				...basePayload().job,
				id: created.jobId!,
				include: true,
				finalRevenue: '450',
				totalOnSiteMinutesOverride: '120',
				recordClassification: 'Customer Job',
				overallJobRating: '5',
			},
		});

		await updateHistoricalEntry(harness.env, editedPayload);

		expect(harness.spreadsheet.getTab('Clients')).toHaveLength(2); // no duplicate created
		expect(harness.spreadsheet.getTab('Jobs')).toHaveLength(2); // no duplicate created

		const rows = harness.spreadsheet.getTab('Jobs');
		const headers = rows[0];
		const row = rows[1];
		expect(row[headers.indexOf('Final Price ($)')]).toBe('450');
		expect(row[headers.indexOf('Overall Job Rating')]).toBe('5');
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
