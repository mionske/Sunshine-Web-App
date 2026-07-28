// Shared logic for the compact Historical Job Entry form (`/historical-entry`
// for new records, `/historical-entry/[jobId]` for editing one). Historical
// records exist for exactly one reason — supporting pricing calibration —
// so this form captures the four things a calibration data point needs (when,
// what it covered, what it earned, how long it took) plus a handful of
// optional size/context fields, and nothing else.
import type { HistoricalEntryPayload } from './pricing/historicalEntry';
import type { Client } from './models/client';
import type { Property } from './models/property';
import type { Job } from './models/job';

export const SCOPE_OPTIONS = ['Interior & Exterior', 'Exterior only', 'Interior only', 'Other'] as const;

export const PRICE_DIFFERENTLY_OPTIONS = ['Higher', 'Lower', 'Same'] as const;

/** A non-blank Record Classification is the only marker `/historical-records`
 * uses to find these rows (see that page's comment), so every save from this
 * form must set one. 'Historical Import' is the RECORD_CLASSIFICATIONS entry
 * that actually describes what this form does — backfilling a job that
 * predates the app — rather than guessing at Customer/Test/Practice. */
export const HISTORICAL_RECORD_CLASSIFICATION = 'Historical Import';

/** Jobs has no dedicated "scope" column beyond the free-text 'Scope Summary',
 * and inventing one for a four-value dropdown isn't worth a schema migration —
 * so the dropdown is stored as a prefix on that same column. The options are a
 * closed set, which makes the split back out on edit exact rather than a
 * guess. */
const SCOPE_SEPARATOR = ' — ';

export function joinScopeSummary(scope: string, summary: string): string {
	return [scope, summary].filter(Boolean).join(SCOPE_SEPARATOR);
}

export function splitScopeSummary(stored: string): { scope: string; summary: string } {
	for (const option of SCOPE_OPTIONS) {
		if (stored === option) return { scope: option, summary: '' };
		if (stored.startsWith(option + SCOPE_SEPARATOR)) {
			return { scope: option, summary: stored.slice(option.length + SCOPE_SEPARATOR.length) };
		}
	}
	return { scope: '', summary: stored };
}

/** Every value the form renders, as strings — one shape for both "what the
 * user just submitted" (re-rendered on validation failure) and "what's
 * currently on the record" (edit mode). */
export interface HistoricalFormValues {
	clientId: string;
	newClientName: string;
	propertyId: string;
	newStreetAddress: string;
	serviceDate: string;
	finalPrice: string;
	laborHours: string;
	scope: string;
	scopeSummary: string;
	windowUnits: string;
	glassPanes: string;
	screenCount: string;
	stories: string;
	notes: string;
	priceDifferently: string;
}

export function emptyFormValues(overrides: Partial<HistoricalFormValues> = {}): HistoricalFormValues {
	return {
		clientId: '',
		newClientName: '',
		propertyId: '',
		newStreetAddress: '',
		serviceDate: '',
		finalPrice: '',
		laborHours: '',
		scope: '',
		scopeSummary: '',
		windowUnits: '',
		glassPanes: '',
		screenCount: '',
		stories: '',
		notes: '',
		priceDifferently: '',
		...overrides,
	};
}

export function formValuesFromRequest(form: FormData): HistoricalFormValues {
	const get = (name: string) => String(form.get(name) ?? '').trim();
	return {
		clientId: get('clientId'),
		newClientName: get('newClientName'),
		propertyId: get('propertyId'),
		newStreetAddress: get('newStreetAddress'),
		serviceDate: get('serviceDate'),
		finalPrice: get('finalPrice'),
		laborHours: get('laborHours'),
		scope: get('scope'),
		scopeSummary: get('scopeSummary'),
		windowUnits: get('windowUnits'),
		glassPanes: get('glassPanes'),
		screenCount: get('screenCount'),
		stories: get('stories'),
		notes: get('notes'),
		priceDifferently: get('priceDifferently'),
	};
}

/** The form asks for decimal hours because that's how the owner thinks about
 * a past job; the payload/sheet store minutes. Converting here keeps that the
 * only place the two units meet. */
function hoursToMinutes(hours: string): string {
	const value = Number(hours);
	return Number.isFinite(value) && value > 0 ? String(Math.round(value * 60)) : '';
}

function minutesToHours(minutes: string): string {
	const value = Number(minutes);
	return Number.isFinite(value) && value > 0 ? String(Math.round((value / 60) * 100) / 100) : '';
}

/** "Would you price this differently today?" maps onto the two Pricing Review
 * columns that already exist: Higher/Lower both mean yes (with the direction
 * kept as the reason, which is the only thing the compact form knows), Same
 * means no. Blank leaves the question unanswered rather than asserting "no". */
function pricingReview(answer: string): { wouldPriceDifferentlyToday: boolean; reasonPricingChanged: string } {
	if (answer === 'Higher' || answer === 'Lower') {
		return { wouldPriceDifferentlyToday: true, reasonPricingChanged: `Would price ${answer.toLowerCase()}` };
	}
	return { wouldPriceDifferentlyToday: false, reasonPricingChanged: '' };
}

function readPricingReview(job: Job): string {
	const flag = String(job['Would Price Differently Today (Y/N)'] ?? '');
	if (flag === 'Y') return /lower/i.test(String(job['Reason Pricing Changed'] ?? '')) ? 'Lower' : 'Higher';
	if (flag === 'N') return 'Same';
	return '';
}

export function validateFormValues(values: HistoricalFormValues): string | null {
	if (!values.serviceDate) return 'Service date is required.';
	if (!values.finalPrice) return 'Final price is required.';
	if (!values.laborHours || !hoursToMinutes(values.laborHours)) {
		return 'Actual labor hours is required, and must be greater than zero.';
	}
	if (!values.scopeSummary) return 'Scope summary is required.';
	return null;
}

/** Everything the compact form never asks about, zeroed. Anything worth
 * preserving on an edit is layered back on top by payloadForUpdate(). */
function blankPayload(): HistoricalEntryPayload {
	return {
		client: {
			id: '',
			isExisting: true,
			firstName: '',
			lastName: '',
			phone: '',
			email: '',
			preferredContactMethod: '',
			referralSource: '',
		},
		property: {
			id: '',
			isExisting: true,
			propertyType: '',
			streetAddress: '',
			city: '',
			state: '',
			zip: '',
			stories: '',
			totalWindowUnits: '',
			totalGlassPanes: '',
			screenCount: '',
			accessNotes: '',
			petNotes: '',
			generalNotes: '',
			buildingComplexName: '',
			unitIdentifier: '',
		},
		walkthrough: {
			include: false,
			id: '',
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
			id: '',
			date: '',
			amount: '',
			status: '',
			discountAmount: '',
			discountReason: '',
			pricingConfigId: '',
			notes: '',
		},
		job: {
			include: true,
			id: '',
			serviceDate: '',
			status: 'Completed',
			// Deliberately left blank: the compact form records one total, not
			// a setup/cleaning/inspection/pack-up breakdown. onSiteMinutes()
			// only falls back to the total when the breakdown is empty, so
			// blanking these is what makes the entered hours authoritative.
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
			recordClassification: HISTORICAL_RECORD_CLASSIFICATION,
			revenueTreatment: '',
			standardPriceEquivalent: '',
			dataQuality: '',
			dataQualityNotes: '',
			scopeSummary: '',
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
	};
}

function applyFormValues(payload: HistoricalEntryPayload, values: HistoricalFormValues): HistoricalEntryPayload {
	payload.property.stories = values.stories;
	payload.property.totalWindowUnits = values.windowUnits;
	payload.property.totalGlassPanes = values.glassPanes;
	payload.property.screenCount = values.screenCount;

	payload.job.serviceDate = values.serviceDate;
	payload.job.finalRevenue = values.finalPrice;
	payload.job.totalOnSiteMinutesOverride = hoursToMinutes(values.laborHours);
	payload.job.scopeSummary = joinScopeSummary(values.scope, values.scopeSummary);
	payload.job.dataQualityNotes = values.notes;
	Object.assign(payload.job, pricingReview(values.priceDifferently));
	return payload;
}

/** New record. A Client and/or Property row is created only when the owner
 * actually supplied one — an existing pick reuses that row untouched, and
 * "neither" is a valid answer, since a price/hours/scope data point is
 * useful for calibration even with no idea whose house it was. */
export function payloadForCreate(values: HistoricalFormValues): HistoricalEntryPayload {
	const payload = applyFormValues(blankPayload(), values);
	payload.job.id = crypto.randomUUID();

	if (values.clientId) {
		payload.client.id = values.clientId;
	} else if (values.newClientName) {
		const [firstName, ...rest] = values.newClientName.split(/\s+/);
		payload.client.id = crypto.randomUUID();
		payload.client.isExisting = false;
		payload.client.firstName = firstName ?? '';
		payload.client.lastName = rest.join(' ');
	}

	if (values.propertyId) {
		payload.property.id = values.propertyId;
	} else if (values.newStreetAddress) {
		payload.property.id = crypto.randomUUID();
		payload.property.isExisting = false;
		payload.property.streetAddress = values.newStreetAddress;
		// Property Type is a strict enum with no default — a blank fails
		// validation and the whole save is rejected. This form is
		// residential-only by design (see the simplification pass), and the
		// owner can change it on the property itself if a backfilled job ever
		// turns out to be something else.
		payload.property.propertyType = 'Residential';
	}

	return payload;
}

/** Edit. Both write paths rewrite every column they map, so each existing
 * record is read back in first — otherwise saving this form would blank the
 * client's phone, the property's address, and the job's callback/ratings
 * detail just because the compact form doesn't display them. */
export function payloadForUpdate(
	values: HistoricalFormValues,
	records: { client: Client | null; property: Property | null; job: Job }
): HistoricalEntryPayload {
	const payload = blankPayload();
	const { client, property, job } = records;

	if (client) {
		payload.client = {
			id: client['Client ID'],
			isExisting: true,
			firstName: client['First Name'],
			lastName: client['Last Name'],
			phone: client.Phone,
			email: client.Email,
			preferredContactMethod: client['Preferred Contact Method'],
			referralSource: client['Referral Source'],
		};
	}

	if (property) {
		payload.property = {
			id: property['Property ID'],
			isExisting: true,
			propertyType: property['Property Type'],
			streetAddress: property['Street Address'],
			city: property.City,
			state: property.State,
			zip: property.Zip,
			stories: property.Stories,
			totalWindowUnits: property['Total Window Units'],
			totalGlassPanes: property['Total Glass Panes'],
			screenCount: property['Screen Count'],
			accessNotes: property['Access Notes'],
			petNotes: property['Pet Notes'],
			generalNotes: property['General Notes'],
			buildingComplexName: property['Building/Complex Name'],
			unitIdentifier: property['Unit Identifier'],
		};
	}

	payload.job = {
		...payload.job,
		id: job['Job ID'],
		status: job['Job Status'] || 'Completed',
		travelMinutes: job['Travel Time'],
		offSiteAdminMinutes: job['Off-Site Admin Time'],
		directCosts: job['Total Job Cost'],
		callbackOccurred: job['Callback Required (Y/N)'] === 'Y',
		callbackHours: minutesToHours(job['Callback Labor Minutes']),
		callbackCost: job['Callback Cost'],
		callbackCategory: job['Callback Category'],
		callbackReason: job['Callback Reason'],
		callbackRootCause: job['Callback Root Cause'],
		callbackCorrectiveAction: job['Callback Corrective Action'],
		callbackLessonsLearned: job['Callback Lessons Learned'],
		// Preserved rather than forced to 'Historical Import': a record
		// already classified as e.g. a Test Job shouldn't silently change
		// meaning just because it was edited here.
		recordClassification: job['Record Classification'] || HISTORICAL_RECORD_CLASSIFICATION,
		revenueTreatment: job['Revenue Treatment'],
		standardPriceEquivalent: job['Standard Price Equivalent'],
		dataQuality: job['Data Quality'],
		pricingConfidence: job['Pricing Confidence'],
		currentRetailPriceEstimate: job['Current Retail Price Estimate ($)'],
		overallJobRating: job['Overall Job Rating'],
		customerSatisfactionRating: job['Customer Satisfaction Rating'],
		wouldAcceptJobAgain: job['Would Accept Job Again (Y/N)'] === 'Y',
		wouldChangeProcess: job['Would Change Process (Y/N)'] === 'Y',
		processImprovements: job['Process Improvements'],
	};

	return applyFormValues(payload, values);
}

/** Edit mode's pre-fill: the same values the form would have submitted. */
export function formValuesFromRecords(records: {
	client: Client | null;
	property: Property | null;
	job: Job;
}): HistoricalFormValues {
	const { client, property, job } = records;
	const { scope, summary } = splitScopeSummary(job['Scope Summary']);
	return emptyFormValues({
		clientId: client?.['Client ID'] ?? '',
		propertyId: property?.['Property ID'] ?? '',
		serviceDate: job['Date Completed'],
		finalPrice: job['Final Price ($)'],
		laborHours: job['Actual Time (hrs)'],
		scope,
		scopeSummary: summary,
		windowUnits: property?.['Total Window Units'] ?? job['Window Count'],
		glassPanes: property?.['Total Glass Panes'] ?? '',
		screenCount: property?.['Screen Count'] ?? '',
		stories: property?.Stories ?? '',
		notes: job['Data Quality Notes'],
		priceDifferently: readPricingReview(job),
	});
}
