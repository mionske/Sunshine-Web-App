// The historical-entry wizard's save path: creates whatever subset of
// Client/Property/Walkthrough/Quote/Job the owner actually has data for,
// reusing existing Client/Property records instead of duplicating them
// when the owner chose to. One createRelatedRows() call ties every new
// record to a single Write Operation ID and makes the whole submission
// safely retryable (see relatedWrites.ts).
import { createRelatedRows, type SheetsEnv } from '../sheets';
import type { RelatedWriteOp } from '../sheets/relatedWrites';
import type { CellValue } from '../sheets/client';
import { clientConfig } from '../models/client';
import { propertyConfig } from '../models/property';
import { walkthroughConfig } from '../models/walkthrough';
import { quoteConfig } from '../models/quote';
import { jobConfig, type Job } from '../models/job';
import { formatPhoneDigits } from '../phoneFormat';
import { calibrationExclusionReasons } from './calibration';

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

export interface HistoricalEntryPayload {
	client: {
		id: string;
		isExisting: boolean;
		firstName: string;
		lastName: string;
		phone: string;
		email: string;
		preferredContactMethod: string;
		referralSource: string;
	};
	property: {
		id: string;
		isExisting: boolean;
		propertyType: string;
		streetAddress: string;
		city: string;
		state: string;
		zip: string;
		stories: string;
		totalWindowUnits: string;
		totalGlassPanes: string;
		screenCount: string;
		accessNotes: string;
		petNotes: string;
		generalNotes: string;
		buildingComplexName: string;
		unitIdentifier: string;
	};
	walkthrough: {
		include: boolean;
		id: string;
		date: string;
		status: string;
		exteriorCondition: string;
		interiorCondition: string;
		accessDifficulty: string;
		hardWaterPresent: string;
		constructionDebrisPresent: string;
		// Restoration Services Required — supplements exteriorCondition/
		// interiorCondition above, doesn't replace them. hardWaterPresent/
		// constructionDebrisPresent above already double as two of the 8
		// restoration checkboxes.
		siliconeResidue: string;
		paintOverspray: string;
		razorScraping: string;
		steelWool: string;
		nonScratchPad: string;
		restorationNotes: string;
		estimatedOnSiteLaborHours: string;
		notes: string;
	};
	quote: {
		include: boolean;
		id: string;
		date: string;
		amount: string;
		status: string;
		discountAmount: string;
		discountReason: string;
		pricingConfigId: string;
		notes: string;
	};
	job: {
		include: boolean;
		id: string;
		serviceDate: string;
		status: string;
		setupMinutes: string;
		cleaningMinutes: string;
		inspectionMinutes: string;
		packUpMinutes: string;
		totalOnSiteMinutesOverride: string;
		travelMinutes: string;
		offSiteAdminMinutes: string;
		finalRevenue: string;
		directCosts: string;
		callbackOccurred: boolean;
		callbackLaborMinutes: string;
		callbackCost: string;
		recordClassification: string;
		revenueTreatment: string;
		standardPriceEquivalent: string;
		dataQuality: string;
		dataQualityNotes: string;
	};
}

/** The on-site minutes actually used for "Actual Time (hrs)": the sum of
 * Setup+Cleaning+Inspection+Pack-up when any of those were entered,
 * otherwise the directly-entered total — never both, so there's no
 * mismatch to reconcile. Travel and off-site admin never count. */
function onSiteMinutes(job: HistoricalEntryPayload['job']): number {
	const breakdown = num(job.setupMinutes) + num(job.cleaningMinutes) + num(job.inspectionMinutes) + num(job.packUpMinutes);
	return breakdown > 0 ? breakdown : num(job.totalOnSiteMinutesOverride);
}

function buildDraftJob(job: HistoricalEntryPayload['job']): Job {
	const minutes = onSiteMinutes(job);
	return {
		'Job ID': job.id || 'draft',
		'Job Status': (job.status || 'Completed') as Job['Job Status'],
		'Actual Time (hrs)': minutes > 0 ? String(minutes / 60) : '',
		'Final Price ($)': job.finalRevenue,
		'Callback Required (Y/N)': job.callbackOccurred ? 'Y' : 'N',
	} as Job;
}

/** Lets the wizard's Review step show calibration inclusion/exclusion
 * before anything is saved, using the exact same rule the live app uses
 * afterward — never a separate, looser preview rule. */
export function previewCalibrationEligibility(job: HistoricalEntryPayload['job']): { eligible: boolean; reasons: string[] } {
	if (!job.include) return { eligible: false, reasons: ['No job will be created for this record'] };
	const reasons = calibrationExclusionReasons(buildDraftJob(job));
	return { eligible: reasons.length === 0, reasons };
}

export interface HistoricalEntryResult {
	writeOperationId: string;
	clientId: string;
	propertyId: string;
	walkthroughId?: string;
	quoteId?: string;
	jobId?: string;
}

export async function saveHistoricalEntry(
	env: SheetsEnv,
	payload: HistoricalEntryPayload,
	meta: { user?: string; requestId?: string } = {}
): Promise<HistoricalEntryResult> {
	const ops: RelatedWriteOp<Record<string, CellValue>>[] = [];

	if (!payload.client.isExisting) {
		ops.push({
			config: clientConfig,
			records: [
				{
					id: payload.client.id,
					'First Name': payload.client.firstName,
					'Last Name': payload.client.lastName,
					Phone: formatPhoneDigits(payload.client.phone),
					Email: payload.client.email,
					'Preferred Contact Method': payload.client.preferredContactMethod,
					'Referral Source': payload.client.referralSource,
				},
			],
		});
	}

	if (!payload.property.isExisting) {
		ops.push({
			config: propertyConfig,
			records: [
				{
					id: payload.property.id,
					'Client ID': payload.client.id,
					'Property Type': payload.property.propertyType as never,
					'Street Address': payload.property.streetAddress,
					City: payload.property.city,
					State: payload.property.state,
					Zip: payload.property.zip,
					Stories: payload.property.stories,
					'Total Window Units': payload.property.totalWindowUnits,
					'Total Glass Panes': payload.property.totalGlassPanes,
					'Screen Count': payload.property.screenCount,
					'Access Notes': payload.property.accessNotes,
					'Pet Notes': payload.property.petNotes,
					'General Notes': payload.property.generalNotes,
					'Building/Complex Name': payload.property.buildingComplexName,
					'Unit Identifier': payload.property.unitIdentifier,
				},
			],
		});
	}

	if (payload.walkthrough.include) {
		ops.push({
			config: walkthroughConfig,
			records: [
				{
					id: payload.walkthrough.id,
					'Client ID': payload.client.id,
					'Property ID': payload.property.id,
					'Walkthrough Date': payload.walkthrough.date,
					Status: (payload.walkthrough.status || 'Completed') as never,
					'Exterior Condition': payload.walkthrough.exteriorCondition,
					'Interior Condition': payload.walkthrough.interiorCondition,
					'Access Difficulty': payload.walkthrough.accessDifficulty,
					'Hard Water Present (Y/N)': payload.walkthrough.hardWaterPresent,
					'Construction Debris Present (Y/N)': payload.walkthrough.constructionDebrisPresent,
					'Silicone Adhesive Or Sticker Residue (Y/N)': payload.walkthrough.siliconeResidue,
					'Paint Overspray (Y/N)': payload.walkthrough.paintOverspray,
					'Razor Scraping Required (Y/N)': payload.walkthrough.razorScraping,
					'Steel Wool Required (Y/N)': payload.walkthrough.steelWool,
					'Non-Scratch Pad Required (Y/N)': payload.walkthrough.nonScratchPad,
					'Restoration Notes': payload.walkthrough.restorationNotes,
					'Estimated On-Site Labor Hours': payload.walkthrough.estimatedOnSiteLaborHours,
					Notes: payload.walkthrough.notes,
				},
			],
		});
	}

	if (payload.quote.include) {
		ops.push({
			config: quoteConfig,
			records: [
				{
					id: payload.quote.id,
					'Client ID': payload.client.id,
					'Property ID': payload.property.id,
					'Walkthrough ID': payload.walkthrough.include ? payload.walkthrough.id : '',
					'Quote Type': 'in-field',
					'Final Quoted Price': payload.quote.amount,
					Discount: payload.quote.discountAmount,
					'Quote Status': (payload.quote.status || 'Accepted') as never,
					'Pricing Config ID': payload.quote.pricingConfigId,
					'Override Reason': payload.quote.discountReason,
					Notes: payload.quote.notes,
					'Created By': 'historical-entry',
				},
			],
		});
	}

	if (payload.job.include) {
		const minutes = onSiteMinutes(payload.job);
		ops.push({
			config: jobConfig,
			records: [
				{
					id: payload.job.id,
					'Property ID': payload.property.id,
					'Quote ID': payload.quote.include ? payload.quote.id : '',
					'Date Completed': payload.job.serviceDate,
					'Job Status': (payload.job.status || 'Completed') as never,
					'Setup Time': payload.job.setupMinutes,
					'Cleaning Time': payload.job.cleaningMinutes,
					'Inspection Time': payload.job.inspectionMinutes,
					'Pack-up Time': payload.job.packUpMinutes,
					'Travel Time': payload.job.travelMinutes,
					'Off-Site Admin Time': payload.job.offSiteAdminMinutes,
					'Actual Time (hrs)': minutes > 0 ? (minutes / 60).toFixed(2) : '',
					'Final Price ($)': payload.job.finalRevenue,
					'Total Job Cost': payload.job.directCosts,
					'Callback Required (Y/N)': payload.job.callbackOccurred ? 'Y' : 'N',
					'Callback Labor Minutes': payload.job.callbackLaborMinutes,
					'Callback Cost': payload.job.callbackCost,
					'Record Classification': payload.job.recordClassification,
					'Revenue Treatment': payload.job.revenueTreatment,
					'Standard Price Equivalent': payload.job.standardPriceEquivalent,
					'Data Quality': payload.job.dataQuality,
					'Data Quality Notes': payload.job.dataQualityNotes,
					Version: '1',
				},
			],
		});
	}

	const { writeOperationId } = await createRelatedRows(env, ops, meta);

	return {
		writeOperationId,
		clientId: payload.client.id,
		propertyId: payload.property.id,
		walkthroughId: payload.walkthrough.include ? payload.walkthrough.id : undefined,
		quoteId: payload.quote.include ? payload.quote.id : undefined,
		jobId: payload.job.include ? payload.job.id : undefined,
	};
}
