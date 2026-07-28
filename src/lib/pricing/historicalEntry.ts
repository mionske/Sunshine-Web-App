// The historical-entry form's save path: creates whatever subset of
// Client/Property/Walkthrough/Quote/Job the owner actually has data for,
// reusing existing Client/Property records instead of duplicating them
// when the owner chose to. One createRelatedRows() call ties every new
// record to a single Write Operation ID and makes the whole submission
// safely retryable (see relatedWrites.ts).
import { createRelatedRows, updateRow, type SheetsEnv } from '../sheets';
import type { RelatedWriteOp } from '../sheets/relatedWrites';
import type { CellValue } from '../sheets/client';
import { clientConfig } from '../models/client';
import { propertyConfig } from '../models/property';
import { walkthroughConfig } from '../models/walkthrough';
import { quoteConfig } from '../models/quote';
import { jobConfig } from '../models/job';
import { formatPhoneDigits } from '../phoneFormat';

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
		secondStoryExterior: string;
		ladderRequired: string;
		vaultedInteriorGlass: string;
		roofAccessRequired: string;
		oversizedGlass: string;
		exteriorObstructions: string;
		limitedInteriorAccess: string;
		waterFedPoleUsed: string;
		traditionalExteriorCleaningUsed: string;
		otherAccessIssue: string;
		otherAccessNotes: string;
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
		// Decimal hours — converted to minutes only when written to the
		// shared 'Callback Labor Minutes' sheet column (see saveHistoricalEntry).
		callbackHours: string;
		callbackCost: string;
		callbackCategory: string;
		callbackReason: string;
		callbackRootCause: string;
		callbackCorrectiveAction: string;
		callbackLessonsLearned: string;
		recordClassification: string;
		revenueTreatment: string;
		standardPriceEquivalent: string;
		dataQuality: string;
		dataQualityNotes: string;
		// One sentence describing what the job actually covered. A historical
		// price is only useful for calibration if you know what it bought, so
		// this is the compact form's stand-in for a full itemized walkthrough.
		scopeSummary: string;
		pricingConfidence: string;
		wouldPriceDifferentlyToday: boolean;
		currentRetailPriceEstimate: string;
		reasonPricingChanged: string;
		overallJobRating: string;
		customerSatisfactionRating: string;
		wouldAcceptJobAgain: boolean;
		wouldChangeProcess: boolean;
		processImprovements: string;
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

export interface HistoricalEntryResult {
	writeOperationId: string;
	clientId: string;
	propertyId: string;
	walkthroughId?: string;
	quoteId?: string;
	jobId?: string;
}

// Shared field mappings — used by both saveHistoricalEntry() (create, via
// createRelatedRows) and updateHistoricalEntry() (in-place edit, via
// updateRow), so the two write paths can never drift out of sync on which
// wizard field maps to which sheet column.
function buildClientRecord(payload: HistoricalEntryPayload) {
	return {
		'First Name': payload.client.firstName,
		'Last Name': payload.client.lastName,
		Phone: formatPhoneDigits(payload.client.phone),
		Email: payload.client.email,
		'Preferred Contact Method': payload.client.preferredContactMethod,
		'Referral Source': payload.client.referralSource,
	};
}

function buildPropertyRecord(payload: HistoricalEntryPayload) {
	return {
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
	};
}

function buildWalkthroughRecord(payload: HistoricalEntryPayload) {
	return {
		'Client ID': payload.client.id,
		'Property ID': payload.property.id,
		'Walkthrough Date': payload.walkthrough.date,
		// Mirrors createQuoteFromWalkthrough()'s own convention (see
		// walkthroughToQuote.ts) — a Walkthrough that produced a Quote in
		// this same submission is marked converted and linked back, so the
		// Dashboard's "needs follow-up" reminder (which keys off a blank
		// 'Quote ID') doesn't keep flagging it forever.
		Status: (payload.quote.include ? 'Converted to Quote' : payload.walkthrough.status || 'Completed') as never,
		'Quote ID': payload.quote.include ? payload.quote.id : '',
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
		'Second-Story Exterior (Y/N)': payload.walkthrough.secondStoryExterior,
		'Ladder Required (Y/N)': payload.walkthrough.ladderRequired,
		'Vaulted Interior Glass (Y/N)': payload.walkthrough.vaultedInteriorGlass,
		'Roof Access Required (Y/N)': payload.walkthrough.roofAccessRequired,
		'Oversized Glass Or Large Sliders (Y/N)': payload.walkthrough.oversizedGlass,
		'Tight Landscaping Or Obstructions (Y/N)': payload.walkthrough.exteriorObstructions,
		'Limited Interior Access (Y/N)': payload.walkthrough.limitedInteriorAccess,
		'Water-Fed Pole Used (Y/N)': payload.walkthrough.waterFedPoleUsed,
		'Traditional Exterior Cleaning Used (Y/N)': payload.walkthrough.traditionalExteriorCleaningUsed,
		'Other Access Issue (Y/N)': payload.walkthrough.otherAccessIssue,
		'Other Access Notes': payload.walkthrough.otherAccessNotes,
		'Estimated On-Site Labor Hours': payload.walkthrough.estimatedOnSiteLaborHours,
		Notes: payload.walkthrough.notes,
	};
}

function buildQuoteRecord(payload: HistoricalEntryPayload) {
	return {
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
	};
}

function buildJobRecord(payload: HistoricalEntryPayload) {
	const minutes = onSiteMinutes(payload.job);
	return {
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
		// Copied from the property section the same way jobLifecycle.ts's
		// job creation does it, so calibration's per-window metrics work even
		// when an existing Property row was reused and never re-written.
		'Window Count': payload.property.totalWindowUnits,
		'Final Price ($)': payload.job.finalRevenue,
		'Total Job Cost': payload.job.directCosts,
		'Callback Required (Y/N)': payload.job.callbackOccurred ? 'Y' : 'N',
		'Callback Labor Minutes':
			payload.job.callbackOccurred && payload.job.callbackHours
				? String(Math.round(Number(payload.job.callbackHours) * 60))
				: '',
		'Callback Cost': payload.job.callbackCost,
		'Callback Category': payload.job.callbackCategory,
		'Callback Reason': payload.job.callbackReason,
		'Callback Root Cause': payload.job.callbackRootCause,
		'Callback Corrective Action': payload.job.callbackCorrectiveAction,
		'Callback Lessons Learned': payload.job.callbackLessonsLearned,
		'Record Classification': payload.job.recordClassification,
		'Revenue Treatment': payload.job.revenueTreatment,
		'Standard Price Equivalent': payload.job.standardPriceEquivalent,
		'Data Quality': payload.job.dataQuality,
		'Data Quality Notes': payload.job.dataQualityNotes,
		'Scope Summary': payload.job.scopeSummary,
		'Pricing Confidence': payload.job.pricingConfidence,
		'Would Price Differently Today (Y/N)': payload.job.wouldPriceDifferentlyToday ? 'Y' : 'N',
		'Current Retail Price Estimate ($)': payload.job.currentRetailPriceEstimate,
		'Reason Pricing Changed': payload.job.reasonPricingChanged,
		'Overall Job Rating': payload.job.overallJobRating,
		'Customer Satisfaction Rating': payload.job.customerSatisfactionRating,
		'Would Accept Job Again (Y/N)': payload.job.wouldAcceptJobAgain ? 'Y' : 'N',
		'Would Change Process (Y/N)': payload.job.wouldChangeProcess ? 'Y' : 'N',
		'Process Improvements': payload.job.processImprovements,
		Version: '1',
	};
}

export async function saveHistoricalEntry(
	env: SheetsEnv,
	payload: HistoricalEntryPayload,
	meta: { user?: string; requestId?: string } = {}
): Promise<HistoricalEntryResult> {
	const ops: RelatedWriteOp<Record<string, CellValue>>[] = [];

	if (!payload.client.isExisting) {
		ops.push({ config: clientConfig, records: [{ id: payload.client.id, ...buildClientRecord(payload) }] });
	}

	if (!payload.property.isExisting) {
		ops.push({ config: propertyConfig, records: [{ id: payload.property.id, ...buildPropertyRecord(payload) }] });
	}

	if (payload.walkthrough.include) {
		ops.push({ config: walkthroughConfig, records: [{ id: payload.walkthrough.id, ...buildWalkthroughRecord(payload) }] });
	}

	if (payload.quote.include) {
		ops.push({ config: quoteConfig, records: [{ id: payload.quote.id, ...buildQuoteRecord(payload) }] });
	}

	if (payload.job.include) {
		ops.push({ config: jobConfig, records: [{ id: payload.job.id, ...buildJobRecord(payload) }] });
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

/** Historical Records edit mode: updates the existing Client/Property/
 * Walkthrough/Quote/Job rows in place, one updateRow() call per included
 * sub-record. Deliberately NOT built on createRelatedRows() — that
 * function's idempotent-by-ID behavior is create semantics ("ID already
 * exists → treat as already committed, never rewrite"), the opposite of
 * what an in-place edit needs. Every sub-record here is assumed to already
 * exist — this does not support adding a walkthrough/quote/job to a record
 * that never had one; that's a new record, not an edit. Client and Property
 * are skipped when their id is blank, because the compact entry form lets a
 * job be recorded with neither (price + hours + scope is enough to
 * calibrate against), and those records must still be editable afterward. */
export async function updateHistoricalEntry(
	env: SheetsEnv,
	payload: HistoricalEntryPayload,
	meta: { user?: string; requestId?: string } = {}
): Promise<HistoricalEntryResult> {
	if (payload.client.id) {
		await updateRow(env, clientConfig, payload.client.id, buildClientRecord(payload) as never, meta);
	}
	if (payload.property.id) {
		await updateRow(env, propertyConfig, payload.property.id, buildPropertyRecord(payload) as never, meta);
	}

	if (payload.walkthrough.include) {
		await updateRow(env, walkthroughConfig, payload.walkthrough.id, buildWalkthroughRecord(payload) as never, meta);
	}
	if (payload.quote.include) {
		await updateRow(env, quoteConfig, payload.quote.id, buildQuoteRecord(payload) as never, meta);
	}
	if (payload.job.include) {
		await updateRow(env, jobConfig, payload.job.id, buildJobRecord(payload) as never, meta);
	}

	return {
		writeOperationId: crypto.randomUUID(),
		clientId: payload.client.id,
		propertyId: payload.property.id,
		walkthroughId: payload.walkthrough.include ? payload.walkthrough.id : undefined,
		quoteId: payload.quote.include ? payload.quote.id : undefined,
		jobId: payload.job.include ? payload.job.id : undefined,
	};
}
