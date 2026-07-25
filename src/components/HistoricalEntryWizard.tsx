import { useEffect, useState } from 'react';
import { googleMapsUrl } from '../lib/mapsLink';
import { PREFERRED_CONTACT_METHOD_OPTIONS, type Client } from '../lib/models/client';
import type { Property } from '../lib/models/property';
import { GLASS_CONDITION_LEVELS, type Walkthrough } from '../lib/models/walkthrough';
import { CALLBACK_PRIMARY_CATEGORIES, CALLBACK_SPECIFIC_REASONS, PRICING_CONFIDENCE_LEVELS, type Job } from '../lib/models/job';
import type { Quote } from '../lib/models/quote';

const RECORD_TYPES = [
	'Walkthrough Only',
	'Quote Created',
	'Completed Customer Job',
	'Discounted Customer Job',
	'Test Job',
	'Practice Job',
	'Owner Property',
] as const;
type RecordType = (typeof RECORD_TYPES)[number];

// Reverse of DEFAULTS_BY_RECORD_TYPE's classification mapping below — used
// only by buildEditState() to infer which Record Type radio a historical
// record's saved 'Record Classification' most likely corresponds to, since
// Record Type itself is a wizard-only concept, never persisted anywhere.
const RECORD_TYPE_BY_CLASSIFICATION: Partial<Record<string, RecordType>> = {
	'Customer Job': 'Completed Customer Job',
	'Discounted Customer Job': 'Discounted Customer Job',
	'Test Job': 'Test Job',
	'Practice Job': 'Practice Job',
	'Owner Property': 'Owner Property',
};

const PROPERTY_TYPES = ['Residential', 'Commercial', 'New Build-Construction'];
// Overall Access Difficulty — trimmed to 3 values for this wizard only.
// This is a local, UI-only list (not imported from walkthrough.ts's own
// 5-value ACCESS_LEVELS, which the live WalkthroughWizard still uses
// unchanged) — a genuinely difficult/specialty-access historical job is
// recorded as 'Difficult' plus the relevant Access & Equipment Modifier
// checkboxes below, rather than a separate 'Specialty Access' level.
const ACCESS_LEVELS = ['Easy', 'Standard', 'Difficult'];
const RATING_OPTIONS = ['1', '2', '3', '4', '5'];
const RECORD_CLASSIFICATIONS = [
	'Customer Job',
	'Discounted Customer Job',
	'Test Job',
	'Practice Job',
	'Owner Property',
	'Historical Import',
];
const REVENUE_TREATMENTS = ['Full Price', 'Discounted', 'No Charge', 'Test Price', 'Unknown'];
const DATA_QUALITY_LEVELS = ['Complete', 'Mostly Complete', 'Partial', 'Estimate Only'];

const DEFAULTS_BY_RECORD_TYPE: Partial<Record<RecordType, { classification: string; revenueTreatment: string }>> = {
	'Completed Customer Job': { classification: 'Customer Job', revenueTreatment: 'Full Price' },
	'Discounted Customer Job': { classification: 'Discounted Customer Job', revenueTreatment: 'Discounted' },
	'Test Job': { classification: 'Test Job', revenueTreatment: 'Test Price' },
	'Practice Job': { classification: 'Practice Job', revenueTreatment: 'No Charge' },
	'Owner Property': { classification: 'Owner Property', revenueTreatment: 'No Charge' },
};

function newId(): string {
	return crypto.randomUUID();
}

function RatingRadios({
	label,
	name,
	value,
	onChange,
}: {
	label: string;
	name: string;
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div>
			<p className="field-label">{label}</p>
			<div className="segmented">
				{RATING_OPTIONS.map((n) => (
					<label key={n}>
						<input type="radio" name={name} checked={value === n} onChange={() => onChange(n)} />
						{n}
					</label>
				))}
			</div>
		</div>
	);
}

interface ClientState {
	id: string;
	isExisting: boolean;
	firstName: string;
	lastName: string;
	phone: string;
	email: string;
	preferredContactMethod: string;
	referralSource: string;
}

interface PropertyState {
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
}

interface WalkthroughState {
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
	// Access & Equipment Modifiers — 'Y'/'N' strings, matching the
	// restoration checkboxes' own convention above.
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
}

interface QuoteState {
	include: boolean;
	id: string;
	date: string;
	amount: string;
	status: string;
	discountAmount: string;
	// Convenience input only, not persisted as its own field — entering a
	// percentage computes and overwrites discountAmount above (rounded to
	// the nearest cent) from the current Quoted amount, since Quote's own
	// 'Discount' column is a dollar figure. Typing directly into
	// discountAmount afterward doesn't update this back.
	discountPercentage: string;
	discountReason: string;
	pricingConfigId: string;
	pricingConfigUnknown: boolean;
	notes: string;
}

interface JobState {
	include: boolean;
	id: string;
	serviceDate: string;
	status: string;
	timeMode: 'breakdown' | 'total';
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
	// Decimal hours (e.g. '4' or '4.5') — converted to minutes only at the
	// historicalEntry.ts save boundary, since the shared 'Callback Labor
	// Minutes' sheet column is also written in minutes by the live Job Day
	// completion path (jobDay.ts).
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
	pricingConfidence: string;
	wouldPriceDifferentlyToday: boolean;
	currentRetailPriceEstimate: string;
	reasonPricingChanged: string;
	overallJobRating: string;
	customerSatisfactionRating: string;
	wouldAcceptJobAgain: boolean;
	wouldChangeProcess: boolean;
	processImprovements: string;
}

export interface WizardState {
	step: number;
	recordType: RecordType | '';
	client: ClientState;
	property: PropertyState;
	walkthrough: WalkthroughState;
	quote: QuoteState;
	job: JobState;
}

function emptyState(prefill?: { clientId?: string; propertyId?: string }): WizardState {
	return {
		step: 1,
		recordType: '',
		client: {
			id: prefill?.clientId ?? newId(),
			isExisting: Boolean(prefill?.clientId),
			firstName: '',
			lastName: '',
			phone: '',
			email: '',
			preferredContactMethod: '',
			referralSource: '',
		},
		property: {
			id: prefill?.propertyId ?? newId(),
			isExisting: Boolean(prefill?.propertyId),
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
			id: newId(),
			date: '',
			status: 'Completed',
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
			id: newId(),
			date: '',
			amount: '',
			status: 'Accepted',
			discountAmount: '',
			discountPercentage: '',
			discountReason: '',
			pricingConfigId: '',
			pricingConfigUnknown: false,
			notes: '',
		},
		job: {
			include: false,
			id: newId(),
			serviceDate: '',
			status: 'Completed',
			timeMode: 'breakdown',
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
	};
}

interface DuplicateCandidate {
	client?: { 'Client ID': string; 'First Name': string; 'Last Name': string };
	property?: { 'Property ID': string; 'Street Address': string; City: string };
	matchedOn: string[];
}

const DRAFT_KEY = 'sww-historical-entry-draft';

// Shared by both the URL-prefill path (arriving via a Property/Client
// page's "Add historical record" link) and the in-wizard "existing
// client/property" pickers below — one place that knows how to turn a
// real Client/Property row into this wizard's editable field shape.
export function clientFieldsFromRecord(c: Client): Partial<ClientState> {
	return {
		id: c['Client ID'],
		isExisting: true,
		firstName: c['First Name'],
		lastName: c['Last Name'],
		phone: c.Phone,
		email: c.Email,
		preferredContactMethod: c['Preferred Contact Method'],
		referralSource: c['Referral Source'],
	};
}

export function propertyFieldsFromRecord(p: Property): Partial<PropertyState> {
	return {
		id: p['Property ID'],
		isExisting: true,
		propertyType: p['Property Type'],
		streetAddress: p['Street Address'],
		city: p.City,
		state: p.State,
		zip: p.Zip,
		stories: p.Stories,
		totalWindowUnits: p['Total Window Units'],
		totalGlassPanes: p['Total Glass Panes'],
		screenCount: p['Screen Count'],
		accessNotes: p['Access Notes'],
		petNotes: p['Pet Notes'],
		generalNotes: p['General Notes'],
		buildingComplexName: p['Building/Complex Name'],
		unitIdentifier: p['Unit Identifier'],
	};
}

function walkthroughFieldsFromRecord(w: Walkthrough): Partial<WalkthroughState> {
	return {
		id: w['Walkthrough ID'],
		date: w['Walkthrough Date'],
		status: w.Status,
		exteriorCondition: w['Exterior Condition'],
		interiorCondition: w['Interior Condition'],
		accessDifficulty: w['Access Difficulty'],
		hardWaterPresent: w['Hard Water Present (Y/N)'],
		constructionDebrisPresent: w['Construction Debris Present (Y/N)'],
		siliconeResidue: w['Silicone Adhesive Or Sticker Residue (Y/N)'],
		paintOverspray: w['Paint Overspray (Y/N)'],
		razorScraping: w['Razor Scraping Required (Y/N)'],
		steelWool: w['Steel Wool Required (Y/N)'],
		nonScratchPad: w['Non-Scratch Pad Required (Y/N)'],
		restorationNotes: w['Restoration Notes'],
		secondStoryExterior: w['Second-Story Exterior (Y/N)'],
		ladderRequired: w['Ladder Required (Y/N)'],
		vaultedInteriorGlass: w['Vaulted Interior Glass (Y/N)'],
		roofAccessRequired: w['Roof Access Required (Y/N)'],
		oversizedGlass: w['Oversized Glass Or Large Sliders (Y/N)'],
		exteriorObstructions: w['Tight Landscaping Or Obstructions (Y/N)'],
		limitedInteriorAccess: w['Limited Interior Access (Y/N)'],
		waterFedPoleUsed: w['Water-Fed Pole Used (Y/N)'],
		traditionalExteriorCleaningUsed: w['Traditional Exterior Cleaning Used (Y/N)'],
		otherAccessIssue: w['Other Access Issue (Y/N)'],
		otherAccessNotes: w['Other Access Notes'],
		estimatedOnSiteLaborHours: w['Estimated On-Site Labor Hours'],
		notes: w.Notes,
	};
}

function quoteFieldsFromRecord(q: Quote): Partial<QuoteState> {
	return {
		id: q['Quote ID'],
		date: q['Created At'],
		amount: q['Final Quoted Price'],
		status: q['Quote Status'],
		discountAmount: q.Discount,
		discountReason: q['Override Reason'],
		pricingConfigId: q['Pricing Config ID'],
		pricingConfigUnknown: !q['Pricing Config ID'],
		notes: q.Notes,
	};
}

function jobFieldsFromRecord(j: Job): Partial<JobState> {
	const hasBreakdown = Boolean(j['Setup Time'] || j['Cleaning Time'] || j['Inspection Time'] || j['Pack-up Time']);
	const actualHours = Number(j['Actual Time (hrs)']);
	const callbackMinutes = Number(j['Callback Labor Minutes']);
	return {
		id: j['Job ID'],
		serviceDate: j['Date Completed'],
		status: j['Job Status'],
		timeMode: hasBreakdown ? 'breakdown' : 'total',
		setupMinutes: j['Setup Time'],
		cleaningMinutes: j['Cleaning Time'],
		inspectionMinutes: j['Inspection Time'],
		packUpMinutes: j['Pack-up Time'],
		totalOnSiteMinutesOverride:
			!hasBreakdown && Number.isFinite(actualHours) && actualHours > 0 ? String(Math.round(actualHours * 60)) : '',
		travelMinutes: j['Travel Time'],
		offSiteAdminMinutes: j['Off-Site Admin Time'],
		finalRevenue: j['Final Price ($)'],
		directCosts: j['Total Job Cost'],
		callbackOccurred: j['Callback Required (Y/N)'] === 'Y',
		callbackHours: Number.isFinite(callbackMinutes) && callbackMinutes > 0 ? String(callbackMinutes / 60) : '',
		callbackCost: j['Callback Cost'],
		callbackCategory: j['Callback Category'],
		callbackReason: j['Callback Reason'],
		callbackRootCause: j['Callback Root Cause'],
		callbackCorrectiveAction: j['Callback Corrective Action'],
		callbackLessonsLearned: j['Callback Lessons Learned'],
		recordClassification: j['Record Classification'],
		revenueTreatment: j['Revenue Treatment'],
		standardPriceEquivalent: j['Standard Price Equivalent'],
		dataQuality: j['Data Quality'],
		dataQualityNotes: j['Data Quality Notes'],
		pricingConfidence: j['Pricing Confidence'],
		wouldPriceDifferentlyToday: j['Would Price Differently Today (Y/N)'] === 'Y',
		currentRetailPriceEstimate: j['Current Retail Price Estimate ($)'],
		reasonPricingChanged: j['Reason Pricing Changed'],
		overallJobRating: j['Overall Job Rating'],
		customerSatisfactionRating: j['Customer Satisfaction Rating'],
		wouldAcceptJobAgain: j['Would Accept Job Again (Y/N)'] === 'Y',
		wouldChangeProcess: j['Would Change Process (Y/N)'] === 'Y',
		processImprovements: j['Process Improvements'],
	};
}

/** Builds edit-mode WizardState from real, already-saved records — used by
 * the /historical-entry/[jobId] edit route. Record Type is inferred from
 * the Job's saved Record Classification (see RECORD_TYPE_BY_CLASSIFICATION
 * above) since Record Type itself is never persisted. */
export function buildEditState(records: {
	client: Client;
	property: Property;
	walkthrough?: Walkthrough;
	quote?: Quote;
	job?: Job;
}): WizardState {
	const { client, property, walkthrough, quote, job } = records;
	const base = emptyState();
	const recordType: RecordType = job
		? (RECORD_TYPE_BY_CLASSIFICATION[job['Record Classification']] ?? 'Completed Customer Job')
		: quote
			? 'Quote Created'
			: 'Walkthrough Only';

	return {
		...base,
		step: 1,
		recordType,
		client: { ...base.client, ...clientFieldsFromRecord(client) },
		property: { ...base.property, ...propertyFieldsFromRecord(property) },
		walkthrough: walkthrough
			? { ...base.walkthrough, ...walkthroughFieldsFromRecord(walkthrough), include: true }
			: base.walkthrough,
		quote: quote ? { ...base.quote, ...quoteFieldsFromRecord(quote), include: true } : base.quote,
		job: job ? { ...base.job, ...jobFieldsFromRecord(job), include: true } : base.job,
	};
}

function showsWalkthrough(recordType: RecordType | ''): boolean {
	return recordType !== '';
}
function showsQuote(recordType: RecordType | ''): boolean {
	return recordType !== '' && recordType !== 'Walkthrough Only';
}
function showsJob(recordType: RecordType | ''): boolean {
	return (
		recordType === 'Completed Customer Job' ||
		recordType === 'Discounted Customer Job' ||
		recordType === 'Test Job' ||
		recordType === 'Practice Job' ||
		recordType === 'Owner Property'
	);
}

export default function HistoricalEntryWizard({
	clientId,
	propertyId,
	clients,
	properties,
	mode = 'create',
	initialState,
}: {
	clientId?: string;
	propertyId?: string;
	clients: Client[];
	properties: Property[];
	// Edit mode (Historical Records "view / edit"): initialState is a full
	// WizardState built by buildEditState() from real, already-saved
	// records — every sub-record is a known existing ID, so duplicate
	// detection (which already no-ops once client/property.isExisting is
	// true) and the URL-prefill/localStorage-draft paths below are all
	// skipped in favor of it. save() posts action:'update' instead of
	// 'save' — see historicalEntry.ts's updateHistoricalEntry().
	mode?: 'create' | 'edit';
	initialState?: WizardState;
}) {
	const [state, setState] = useState<WizardState>(() => {
		if (initialState) return initialState;
		if (clientId || propertyId) {
			let s = emptyState({ clientId, propertyId });
			const prefillClient = clientId && clients.find((c) => c['Client ID'] === clientId);
			if (prefillClient) s = { ...s, client: { ...s.client, ...clientFieldsFromRecord(prefillClient) } };
			const prefillProperty = propertyId && properties.find((p) => p['Property ID'] === propertyId);
			if (prefillProperty) s = { ...s, property: { ...s.property, ...propertyFieldsFromRecord(prefillProperty) } };
			return s;
		}
		const saved = typeof window !== 'undefined' ? window.localStorage.getItem(DRAFT_KEY) : null;
		if (saved) {
			try {
				return JSON.parse(saved) as WizardState;
			} catch {
				/* fall through to a fresh draft */
			}
		}
		return emptyState();
	});
	const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
	const [checkingDuplicates, setCheckingDuplicates] = useState(false);
	const [duplicatesDismissed, setDuplicatesDismissed] = useState(false);
	const [calibrationPreview, setCalibrationPreview] = useState<{ eligible: boolean; reasons: string[] } | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saveResult, setSaveResult] = useState<Record<string, unknown> | null>(null);

	useEffect(() => {
		if (saveResult || mode === 'edit') return; // don't persist an edit-mode session as if it were a new-record draft
		window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
	}, [state, saveResult, mode]);

	useEffect(() => {
		function warnOnUnload(e: BeforeUnloadEvent) {
			if (state.step > 1 && !saveResult) {
				e.preventDefault();
			}
		}
		window.addEventListener('beforeunload', warnOnUnload);
		return () => window.removeEventListener('beforeunload', warnOnUnload);
	}, [state.step, saveResult]);

	function update<K extends keyof WizardState>(key: K, patch: Partial<WizardState[K]>) {
		setState((s) => ({ ...s, [key]: { ...(s[key] as object), ...patch } }));
	}

	function goTo(step: number) {
		setState((s) => ({ ...s, step }));
	}

	// "Existing client/property" pickers — an id of '' means "— New —" was
	// chosen, which resets that section back to a fresh blank record rather
	// than leaving stale fields from a previously-selected existing one.
	function selectExistingClient(id: string) {
		if (!id) {
			setState((s) => ({ ...s, client: emptyState().client }));
			return;
		}
		const c = clients.find((c) => c['Client ID'] === id);
		if (!c) return;
		setState((s) => ({ ...s, client: { ...s.client, ...clientFieldsFromRecord(c) } }));
	}

	function selectExistingProperty(id: string) {
		if (!id) {
			setState((s) => ({ ...s, property: emptyState().property }));
			return;
		}
		const p = properties.find((p) => p['Property ID'] === id);
		if (!p) return;
		setState((s) => ({ ...s, property: { ...s.property, ...propertyFieldsFromRecord(p) } }));
	}

	function startOver() {
		window.localStorage.removeItem(DRAFT_KEY);
		setState(emptyState());
		setSaveResult(null);
		setSaveError(null);
		setDuplicates([]);
		setDuplicatesDismissed(false);
	}

	async function checkDuplicatesThenAdvance() {
		if (state.property.isExisting || duplicatesDismissed) {
			goTo(3);
			return;
		}
		setCheckingDuplicates(true);
		try {
			const res = await fetch('/api/historical-entry', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'check-duplicates',
					input: {
						firstName: state.client.firstName,
						lastName: state.client.lastName,
						phone: state.client.phone,
						email: state.client.email,
						streetAddress: state.property.streetAddress,
						zip: state.property.zip,
					},
				}),
			});
			const body = (await res.json()) as { ok: boolean; candidates: DuplicateCandidate[] };
			if (body.ok && body.candidates.length > 0) {
				setDuplicates(body.candidates);
			} else {
				goTo(3);
			}
		} finally {
			setCheckingDuplicates(false);
		}
	}

	function useDuplicate(candidate: DuplicateCandidate) {
		if (candidate.client) {
			update('client', {
				id: candidate.client['Client ID'],
				isExisting: true,
				firstName: candidate.client['First Name'],
				lastName: candidate.client['Last Name'],
			});
		}
		if (candidate.property) {
			update('property', {
				id: candidate.property['Property ID'],
				isExisting: true,
				streetAddress: candidate.property['Street Address'],
				city: candidate.property.City,
			});
		}
		setDuplicates([]);
		goTo(3);
	}

	function dismissDuplicates() {
		setDuplicatesDismissed(true);
		setDuplicates([]);
		goTo(3);
	}

	async function goToReview() {
		if (state.job.include) {
			const res = await fetch('/api/historical-entry', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'preview-calibration', job: buildJobPayload(state.job) }),
			});
			const body = (await res.json()) as { ok: boolean; eligible: boolean; reasons: string[] };
			setCalibrationPreview(body.ok ? { eligible: body.eligible, reasons: body.reasons } : null);
		} else {
			setCalibrationPreview({ eligible: false, reasons: ['No job will be created for this record'] });
		}
		goTo(7);
	}

	function buildJobPayload(job: JobState) {
		return {
			include: job.include,
			id: job.id,
			serviceDate: job.serviceDate,
			status: job.status,
			setupMinutes: job.timeMode === 'breakdown' ? job.setupMinutes : '',
			cleaningMinutes: job.timeMode === 'breakdown' ? job.cleaningMinutes : '',
			inspectionMinutes: job.timeMode === 'breakdown' ? job.inspectionMinutes : '',
			packUpMinutes: job.timeMode === 'breakdown' ? job.packUpMinutes : '',
			totalOnSiteMinutesOverride: job.timeMode === 'total' ? job.totalOnSiteMinutesOverride : '',
			travelMinutes: job.travelMinutes,
			offSiteAdminMinutes: job.offSiteAdminMinutes,
			finalRevenue: job.finalRevenue,
			directCosts: job.directCosts,
			callbackOccurred: job.callbackOccurred,
			callbackHours: job.callbackHours,
			callbackCost: job.callbackCost,
			callbackCategory: job.callbackCategory,
			callbackReason: job.callbackReason,
			callbackRootCause: job.callbackRootCause,
			callbackCorrectiveAction: job.callbackCorrectiveAction,
			callbackLessonsLearned: job.callbackLessonsLearned,
			recordClassification: job.recordClassification,
			revenueTreatment: job.revenueTreatment,
			standardPriceEquivalent: job.standardPriceEquivalent,
			dataQuality: job.dataQuality,
			dataQualityNotes: job.dataQualityNotes,
			pricingConfidence: job.pricingConfidence,
			wouldPriceDifferentlyToday: job.wouldPriceDifferentlyToday,
			currentRetailPriceEstimate: job.currentRetailPriceEstimate,
			reasonPricingChanged: job.reasonPricingChanged,
			overallJobRating: job.overallJobRating,
			customerSatisfactionRating: job.customerSatisfactionRating,
			wouldAcceptJobAgain: job.wouldAcceptJobAgain,
			wouldChangeProcess: job.wouldChangeProcess,
			processImprovements: job.processImprovements,
		};
	}

	async function save() {
		setSaving(true);
		setSaveError(null);
		const payload = {
			client: state.client,
			property: state.property,
			walkthrough: { ...state.walkthrough, include: showsWalkthrough(state.recordType) && state.walkthrough.include },
			quote: { ...state.quote, include: showsQuote(state.recordType) && state.quote.include },
			job: { ...buildJobPayload(state.job), include: showsJob(state.recordType) && state.job.include },
		};
		try {
			const res = await fetch('/api/historical-entry', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: mode === 'edit' ? 'update' : 'save', payload }),
			});
			const body = (await res.json()) as { ok: boolean; error?: string; [key: string]: unknown };
			if (!body.ok) {
				setSaveError(body.error ?? 'Save failed for an unknown reason.');
				return;
			}
			setSaveResult(body);
			window.localStorage.removeItem(DRAFT_KEY);
		} catch (e) {
			setSaveError((e as Error).message || 'Network error — nothing may have been saved. Safe to retry.');
		} finally {
			setSaving(false);
		}
	}

	if (saveResult) {
		return (
			<div className="card">
				<h2>{mode === 'edit' ? 'Updated' : 'Saved'}</h2>
				<p>Historical record {mode === 'edit' ? 'updated' : 'saved'} successfully.</p>
				<ul>
					{Boolean(saveResult.propertyId) && (
						<li>
							Property: <a href={`/properties/${saveResult.propertyId}`}>view</a>
						</li>
					)}
					{Boolean(saveResult.quoteId) && (
						<li>
							Quote: <a href={`/quotes/${saveResult.quoteId}`}>view</a>
						</li>
					)}
				</ul>
				{mode === 'edit' ? (
					<a href="/historical-records">Back to Historical Records</a>
				) : (
					<button type="button" onClick={startOver}>
						Enter another historical record
					</button>
				)}
			</div>
		);
	}

	const clientProperties = properties.filter((p) => p['Client ID'] === state.client.id);

	return (
		<div>
			<p>Step {state.step} of 7</p>

			{state.step === 1 && (
				<section className="card">
					<h2>1. Record type</h2>
					<p>What kind of record is this?</p>
					{RECORD_TYPES.map((type) => (
						<label key={type}>
							<input
								type="radio"
								name="recordType"
								checked={state.recordType === type}
								onChange={() => {
									const defaults = DEFAULTS_BY_RECORD_TYPE[type];
									setState((s) => ({
										...s,
										recordType: type,
										job: defaults
											? {
													...s.job,
													recordClassification: s.job.recordClassification || defaults.classification,
													revenueTreatment: s.job.revenueTreatment || defaults.revenueTreatment,
												}
											: s.job,
									}));
								}}
							/>{' '}
							{type}
						</label>
					))}
					<button type="button" disabled={!state.recordType} onClick={() => goTo(2)}>
						Next
					</button>
				</section>
			)}

			{state.step === 2 && (
				<section className="card">
					<h2>2. Client &amp; property</h2>
					{state.client.isExisting && <p>Using existing client/property — edit fields below only if they've changed.</p>}
					{duplicates.length > 0 ? (
						<div>
							<p>This might already exist:</p>
							{duplicates.map((d, i) => (
								<div key={i} className="card">
									<p>
										{d.client && (
											<>
												{d.client['First Name']} {d.client['Last Name']}
											</>
										)}
										{d.property && (
											<>
												{' — '}
												<a
													href={googleMapsUrl(`${d.property['Street Address']}, ${d.property.City}`)}
													target="_blank"
													rel="noopener noreferrer"
												>
													{d.property['Street Address']}, {d.property.City}
												</a>
											</>
										)}
									</p>
									<p>Matched on: {d.matchedOn.join(', ')}</p>
									<button type="button" onClick={() => useDuplicate(d)}>
										Use this record
									</button>
								</div>
							))}
							<button type="button" onClick={dismissDuplicates}>
								None of these — create new
							</button>
						</div>
					) : (
						<>
						<div className="card-grid">
							<fieldset>
								<legend>Client</legend>
								<label>
									Existing client
									<select
										value={state.client.isExisting ? state.client.id : ''}
										onChange={(e) => selectExistingClient(e.target.value)}
									>
										<option value="">— New client —</option>
										{clients.map((c) => (
											<option key={c['Client ID']} value={c['Client ID']}>
												{c['First Name']} {c['Last Name']}
											</option>
										))}
									</select>
								</label>
								<label>
									First name / label
									<input
										type="text"
										value={state.client.firstName}
										onChange={(e) => update('client', { firstName: e.target.value })}
									/>
								</label>
								<label>
									Last name
									<input
										type="text"
										value={state.client.lastName}
										onChange={(e) => update('client', { lastName: e.target.value })}
									/>
								</label>
								<label>
									Phone
									<input type="tel" value={state.client.phone} onChange={(e) => update('client', { phone: e.target.value })} />
								</label>
								<label>
									Email
									<input type="email" value={state.client.email} onChange={(e) => update('client', { email: e.target.value })} />
								</label>
								<label>
									Preferred contact method
									<select
										value={state.client.preferredContactMethod}
										onChange={(e) => update('client', { preferredContactMethod: e.target.value })}
									>
										<option value="" />
										{PREFERRED_CONTACT_METHOD_OPTIONS.map((m) => (
											<option key={m} value={m}>
												{m}
											</option>
										))}
									</select>
								</label>
								<label>
									Referral source
									<input
										type="text"
										value={state.client.referralSource}
										onChange={(e) => update('client', { referralSource: e.target.value })}
									/>
								</label>
							</fieldset>
							<fieldset>
								<legend>Property</legend>
								{clientProperties.length > 0 && (
									<label>
										Existing property for this client
										<select
											value={state.property.isExisting ? state.property.id : ''}
											onChange={(e) => selectExistingProperty(e.target.value)}
										>
											<option value="">— New property —</option>
											{clientProperties.map((p) => (
												<option key={p['Property ID']} value={p['Property ID']}>
													{p['Street Address']}, {p.City}
												</option>
											))}
										</select>
									</label>
								)}
								<label>
									Property type
									<select
										required
										value={state.property.propertyType}
										onChange={(e) => update('property', { propertyType: e.target.value })}
									>
										<option value="" />
										{PROPERTY_TYPES.map((t) => (
											<option key={t} value={t}>
												{t}
											</option>
										))}
									</select>
								</label>
								<label>
									Street address
									<input
										type="text"
										value={state.property.streetAddress}
										onChange={(e) => update('property', { streetAddress: e.target.value })}
									/>
								</label>
								<label>
									City
									<input type="text" value={state.property.city} onChange={(e) => update('property', { city: e.target.value })} />
								</label>
								<label>
									State
									<input type="text" maxLength={2} value={state.property.state} onChange={(e) => update('property', { state: e.target.value })} />
								</label>
								<label>
									Zip
									<input type="text" value={state.property.zip} onChange={(e) => update('property', { zip: e.target.value })} />
								</label>
								<label>
									Building/complex name (optional)
									<input
										type="text"
										value={state.property.buildingComplexName}
										onChange={(e) => update('property', { buildingComplexName: e.target.value })}
									/>
								</label>
								<label>
									Unit identifier (optional)
									<input
										type="text"
										value={state.property.unitIdentifier}
										onChange={(e) => update('property', { unitIdentifier: e.target.value })}
									/>
								</label>
							</fieldset>
						</div>
							<div className="button-row">
								<button type="button" className="btn-secondary" onClick={() => goTo(1)}>
									Back
								</button>
								<button
									type="button"
									disabled={checkingDuplicates || (!state.property.isExisting && !state.property.propertyType)}
									onClick={checkDuplicatesThenAdvance}
								>
									{checkingDuplicates ? 'Checking…' : 'Next'}
								</button>
							</div>
						</>
					)}
				</section>
			)}

			{state.step === 3 && (
				<section className="card form-grid">
					<h2>3. Property characteristics (optional)</h2>
					<label>
						Stories
						<input type="text" value={state.property.stories} onChange={(e) => update('property', { stories: e.target.value })} />
					</label>
					<label>
						Total window units
						<input
							type="text"
							value={state.property.totalWindowUnits}
							onChange={(e) => update('property', { totalWindowUnits: e.target.value })}
						/>
					</label>
					<label>
						Total glass panes
						<input
							type="text"
							value={state.property.totalGlassPanes}
							onChange={(e) => update('property', { totalGlassPanes: e.target.value })}
						/>
					</label>
					<label>
						Screens
						<input type="text" value={state.property.screenCount} onChange={(e) => update('property', { screenCount: e.target.value })} />
					</label>
					<label>
						Access notes
						<textarea value={state.property.accessNotes} onChange={(e) => update('property', { accessNotes: e.target.value })} />
					</label>
					<label>
						Pet notes
						<textarea value={state.property.petNotes} onChange={(e) => update('property', { petNotes: e.target.value })} />
					</label>
					<label>
						General notes
						<textarea value={state.property.generalNotes} onChange={(e) => update('property', { generalNotes: e.target.value })} />
					</label>
					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(2)}>
							Back
						</button>
						<button type="button" onClick={() => goTo(showsWalkthrough(state.recordType) ? 4 : showsQuote(state.recordType) ? 5 : 6)}>
							Next
						</button>
					</div>
				</section>
			)}

			{state.step === 4 && showsWalkthrough(state.recordType) && (
				<section className="card form-grid">
					<h2>4. Walkthrough details</h2>
					<label>
						<input type="checkbox" checked={state.walkthrough.include} onChange={(e) => update('walkthrough', { include: e.target.checked })} />{' '}
						A walkthrough happened — record it
					</label>
					{state.walkthrough.include && (
						<>
							<label>
								Date
								<input type="date" value={state.walkthrough.date} onChange={(e) => update('walkthrough', { date: e.target.value })} />
							</label>
							<label>
								Exterior condition
								<select value={state.walkthrough.exteriorCondition} onChange={(e) => update('walkthrough', { exteriorCondition: e.target.value })}>
									<option value="" />
									{GLASS_CONDITION_LEVELS.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
							<label>
								Interior condition
								<select value={state.walkthrough.interiorCondition} onChange={(e) => update('walkthrough', { interiorCondition: e.target.value })}>
									<option value="" />
									{GLASS_CONDITION_LEVELS.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
							<label>
								Overall Access Difficulty
								<select value={state.walkthrough.accessDifficulty} onChange={(e) => update('walkthrough', { accessDifficulty: e.target.value })}>
									<option value="" />
									{ACCESS_LEVELS.map((a) => (
										<option key={a}>{a}</option>
									))}
								</select>
							</label>
							<fieldset>
								<legend>Access &amp; Equipment Modifiers</legend>
								<div className="checkbox-grid">
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.secondStoryExterior === 'Y'}
											onChange={(e) => update('walkthrough', { secondStoryExterior: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Second-Story Exterior
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.ladderRequired === 'Y'}
											onChange={(e) => update('walkthrough', { ladderRequired: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Ladder Required
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.vaultedInteriorGlass === 'Y'}
											onChange={(e) => update('walkthrough', { vaultedInteriorGlass: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Vaulted Interior Glass
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.roofAccessRequired === 'Y'}
											onChange={(e) => update('walkthrough', { roofAccessRequired: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Roof Access Required
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.oversizedGlass === 'Y'}
											onChange={(e) => update('walkthrough', { oversizedGlass: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Oversized Glass / Large Sliders
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.exteriorObstructions === 'Y'}
											onChange={(e) => update('walkthrough', { exteriorObstructions: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Tight Landscaping or Obstructions
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.limitedInteriorAccess === 'Y'}
											onChange={(e) => update('walkthrough', { limitedInteriorAccess: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Limited Interior Access
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.waterFedPoleUsed === 'Y'}
											onChange={(e) => update('walkthrough', { waterFedPoleUsed: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Water-Fed Pole Used
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.traditionalExteriorCleaningUsed === 'Y'}
											onChange={(e) => update('walkthrough', { traditionalExteriorCleaningUsed: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Traditional Exterior Cleaning Used
									</label>
									<label>
										<input
											type="checkbox"
											checked={state.walkthrough.otherAccessIssue === 'Y'}
											onChange={(e) => update('walkthrough', { otherAccessIssue: e.target.checked ? 'Y' : 'N' })}
										/>{' '}
										Other Access Issue
									</label>
								</div>
								{state.walkthrough.otherAccessIssue === 'Y' && (
									<label>
										Other Access Notes
										<textarea
											value={state.walkthrough.otherAccessNotes}
											onChange={(e) => update('walkthrough', { otherAccessNotes: e.target.value })}
										/>
									</label>
								)}
							</fieldset>
							<div className="checkbox-grid">
								<label>
									<input
										type="checkbox"
										checked={state.walkthrough.constructionDebrisPresent === 'Y'}
										onChange={(e) => update('walkthrough', { constructionDebrisPresent: e.target.checked ? 'Y' : 'N' })}
									/>{' '}
									Construction Debris
								</label>
								<label>
									<input
										type="checkbox"
										checked={state.walkthrough.siliconeResidue === 'Y'}
										onChange={(e) => update('walkthrough', { siliconeResidue: e.target.checked ? 'Y' : 'N' })}
									/>{' '}
									Window Stickers / Adhesive
								</label>
								<label>
									<input
										type="checkbox"
										checked={state.walkthrough.paintOverspray === 'Y'}
										onChange={(e) => update('walkthrough', { paintOverspray: e.target.checked ? 'Y' : 'N' })}
									/>{' '}
									Paint Overspray
								</label>
								<label>
									<input
										type="checkbox"
										checked={state.walkthrough.hardWaterPresent === 'Y'}
										onChange={(e) => update('walkthrough', { hardWaterPresent: e.target.checked ? 'Y' : 'N' })}
									/>{' '}
									Hard Water / Mineral Deposits
								</label>
								<label>
									<input
										type="checkbox"
										checked={state.walkthrough.razorScraping === 'Y'}
										onChange={(e) => update('walkthrough', { razorScraping: e.target.checked ? 'Y' : 'N' })}
									/>{' '}
									Razor Scraping Required
								</label>
								<label>
									<input
										type="checkbox"
										checked={state.walkthrough.steelWool === 'Y'}
										onChange={(e) => update('walkthrough', { steelWool: e.target.checked ? 'Y' : 'N' })}
									/>{' '}
									Steel Wool Required
								</label>
								<label>
									<input
										type="checkbox"
										checked={state.walkthrough.nonScratchPad === 'Y'}
										onChange={(e) => update('walkthrough', { nonScratchPad: e.target.checked ? 'Y' : 'N' })}
									/>{' '}
									Non-Scratch Pad Required
								</label>
							</div>
							<label>
								Restoration notes (Other)
								<textarea value={state.walkthrough.restorationNotes} onChange={(e) => update('walkthrough', { restorationNotes: e.target.value })} />
							</label>
							<label>
								Estimated on-site labor hours
								<input
									type="text"
									value={state.walkthrough.estimatedOnSiteLaborHours}
									onChange={(e) => update('walkthrough', { estimatedOnSiteLaborHours: e.target.value })}
								/>
							</label>
							<label>
								Notes
								<textarea value={state.walkthrough.notes} onChange={(e) => update('walkthrough', { notes: e.target.value })} />
							</label>
						</>
					)}
					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(3)}>
							Back
						</button>
						<button type="button" onClick={() => goTo(showsQuote(state.recordType) ? 5 : 6)}>
							Next
						</button>
					</div>
				</section>
			)}

			{state.step === 5 && showsQuote(state.recordType) && (
				<section className="card form-grid">
					<h2>5. Quote details</h2>
					<label>
						<input type="checkbox" checked={state.quote.include} onChange={(e) => update('quote', { include: e.target.checked })} />{' '}
						A quote was given — record it
					</label>
					{state.quote.include && (
						<>
							<label>
								Quote date
								<input type="date" value={state.quote.date} onChange={(e) => update('quote', { date: e.target.value })} />
							</label>
							<label>
								Quoted amount ($)
								<input type="text" value={state.quote.amount} onChange={(e) => update('quote', { amount: e.target.value })} />
							</label>
							<label>
								Discount amount ($)
								<input type="text" value={state.quote.discountAmount} onChange={(e) => update('quote', { discountAmount: e.target.value })} />
							</label>
							<label>
								Discount percentage (%)
								<input
									type="text"
									value={state.quote.discountPercentage}
									onChange={(e) => {
										const percentage = e.target.value;
										const quoted = Number(state.quote.amount);
										const pct = Number(percentage);
										const computedAmount =
											percentage && Number.isFinite(quoted) && Number.isFinite(pct)
												? ((quoted * pct) / 100).toFixed(2)
												: state.quote.discountAmount;
										update('quote', { discountPercentage: percentage, discountAmount: computedAmount });
									}}
								/>
							</label>
							<label>
								Discount reason
								<input type="text" value={state.quote.discountReason} onChange={(e) => update('quote', { discountReason: e.target.value })} />
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.quote.pricingConfigUnknown}
									onChange={(e) => update('quote', { pricingConfigUnknown: e.target.checked, pricingConfigId: '' })}
								/>{' '}
								Pricing configuration unknown (predates tracking)
							</label>
							{!state.quote.pricingConfigUnknown && (
								<label>
									Pricing Config ID (if known)
									<input type="text" value={state.quote.pricingConfigId} onChange={(e) => update('quote', { pricingConfigId: e.target.value })} />
								</label>
							)}
							<label>
								Notes
								<textarea value={state.quote.notes} onChange={(e) => update('quote', { notes: e.target.value })} />
							</label>
						</>
					)}
					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(showsWalkthrough(state.recordType) ? 4 : 3)}>
							Back
						</button>
						<button type="button" onClick={() => goTo(showsJob(state.recordType) ? 6 : 7)} disabled={false}>
							Next
						</button>
					</div>
				</section>
			)}

			{state.step === 6 && showsJob(state.recordType) && (
				<section className="card form-grid">
					<h2>6. Job details</h2>
					<label>
						<input type="checkbox" checked={state.job.include} onChange={(e) => update('job', { include: e.target.checked })} />{' '}
						Work was actually performed — record a job
					</label>
					{state.job.include && (
						<>
							<label>
								Service date
								<input type="date" value={state.job.serviceDate} onChange={(e) => update('job', { serviceDate: e.target.value })} />
							</label>
							<fieldset>
								<legend>On-site time</legend>
								<label>
									<input type="radio" checked={state.job.timeMode === 'breakdown'} onChange={() => update('job', { timeMode: 'breakdown' })} /> I know
									the breakdown
								</label>
								<label>
									<input type="radio" checked={state.job.timeMode === 'total'} onChange={() => update('job', { timeMode: 'total' })} /> I only know
									the total
								</label>
								{state.job.timeMode === 'breakdown' ? (
									<>
										<label>
											Setup minutes
											<input type="text" value={state.job.setupMinutes} onChange={(e) => update('job', { setupMinutes: e.target.value })} />
										</label>
										<label>
											Cleaning minutes
											<input type="text" value={state.job.cleaningMinutes} onChange={(e) => update('job', { cleaningMinutes: e.target.value })} />
										</label>
										<label>
											Inspection minutes
											<input type="text" value={state.job.inspectionMinutes} onChange={(e) => update('job', { inspectionMinutes: e.target.value })} />
										</label>
										<label>
											Pack-up minutes
											<input type="text" value={state.job.packUpMinutes} onChange={(e) => update('job', { packUpMinutes: e.target.value })} />
										</label>
									</>
								) : (
									<label>
										Total on-site labor minutes
										<input
											type="text"
											value={state.job.totalOnSiteMinutesOverride}
											onChange={(e) => update('job', { totalOnSiteMinutesOverride: e.target.value })}
										/>
									</label>
								)}
								<label>
									Travel minutes (not counted as on-site)
									<input type="text" value={state.job.travelMinutes} onChange={(e) => update('job', { travelMinutes: e.target.value })} />
								</label>
								<label>
									Off-site admin minutes (not counted as on-site)
									<input
										type="text"
										value={state.job.offSiteAdminMinutes}
										onChange={(e) => update('job', { offSiteAdminMinutes: e.target.value })}
									/>
								</label>
							</fieldset>
							<label>
								Final revenue ($)
								<input type="text" value={state.job.finalRevenue} onChange={(e) => update('job', { finalRevenue: e.target.value })} />
							</label>
							<label>
								Direct costs ($)
								<input type="text" value={state.job.directCosts} onChange={(e) => update('job', { directCosts: e.target.value })} />
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.job.callbackOccurred}
									onChange={(e) => update('job', { callbackOccurred: e.target.checked })}
								/>{' '}
								Callback Required
							</label>
							{state.job.callbackOccurred && (
								<>
									<label>
										Callback Hours
										<input
											type="text"
											value={state.job.callbackHours}
											onChange={(e) => update('job', { callbackHours: e.target.value })}
										/>
									</label>
									<label>
										Callback cost ($)
										<input type="text" value={state.job.callbackCost} onChange={(e) => update('job', { callbackCost: e.target.value })} />
									</label>
									<label>
										Callback Category
										<select
											value={state.job.callbackCategory}
											onChange={(e) => update('job', { callbackCategory: e.target.value, callbackReason: '' })}
										>
											<option value="" />
											{CALLBACK_PRIMARY_CATEGORIES.map((c) => (
												<option key={c}>{c}</option>
											))}
										</select>
									</label>
									{state.job.callbackCategory && (
										<label>
											Specific Reason
											<select value={state.job.callbackReason} onChange={(e) => update('job', { callbackReason: e.target.value })}>
												<option value="" />
												{CALLBACK_SPECIFIC_REASONS[
													state.job.callbackCategory as (typeof CALLBACK_PRIMARY_CATEGORIES)[number]
												]?.map((r) => (
													<option key={r}>{r}</option>
												))}
											</select>
										</label>
									)}
									<label>
										Root Cause
										<textarea
											value={state.job.callbackRootCause}
											onChange={(e) => update('job', { callbackRootCause: e.target.value })}
										/>
									</label>
									<label>
										Corrective Action
										<textarea
											value={state.job.callbackCorrectiveAction}
											onChange={(e) => update('job', { callbackCorrectiveAction: e.target.value })}
										/>
									</label>
									<label>
										Lessons Learned
										<textarea
											value={state.job.callbackLessonsLearned}
											onChange={(e) => update('job', { callbackLessonsLearned: e.target.value })}
										/>
									</label>
								</>
							)}
							<fieldset>
								<legend>Classification</legend>
								<label>
									Record classification
									<select
										value={state.job.recordClassification}
										onChange={(e) => update('job', { recordClassification: e.target.value })}
									>
										<option value="" />
										{RECORD_CLASSIFICATIONS.map((c) => (
											<option key={c}>{c}</option>
										))}
									</select>
								</label>
								<label>
									Revenue treatment
									<select value={state.job.revenueTreatment} onChange={(e) => update('job', { revenueTreatment: e.target.value })}>
										<option value="" />
										{REVENUE_TREATMENTS.map((r) => (
											<option key={r}>{r}</option>
										))}
									</select>
								</label>
								{state.job.revenueTreatment && state.job.revenueTreatment !== 'Full Price' && (
									<label>
										Standard price equivalent ($)
										<input
											type="text"
											value={state.job.standardPriceEquivalent}
											onChange={(e) => update('job', { standardPriceEquivalent: e.target.value })}
											placeholder="What a standard customer price would have been"
										/>
									</label>
								)}
								<label>
									Data quality
									<select value={state.job.dataQuality} onChange={(e) => update('job', { dataQuality: e.target.value })}>
										<option value="" />
										{DATA_QUALITY_LEVELS.map((d) => (
											<option key={d}>{d}</option>
										))}
									</select>
								</label>
								<label>
									Data quality notes
									<textarea value={state.job.dataQualityNotes} onChange={(e) => update('job', { dataQualityNotes: e.target.value })} />
								</label>
							</fieldset>
							<fieldset>
								<legend>Pricing Review</legend>
								<label>
									Pricing Confidence
									<select value={state.job.pricingConfidence} onChange={(e) => update('job', { pricingConfidence: e.target.value })}>
										<option value="" />
										{PRICING_CONFIDENCE_LEVELS.map((p) => (
											<option key={p}>{p}</option>
										))}
									</select>
								</label>
								<label>
									Would you price this job differently today?
									<select
										value={state.job.wouldPriceDifferentlyToday ? 'Yes' : 'No'}
										onChange={(e) => update('job', { wouldPriceDifferentlyToday: e.target.value === 'Yes' })}
									>
										<option>No</option>
										<option>Yes</option>
									</select>
								</label>
								{state.job.wouldPriceDifferentlyToday && (
									<>
										<label>
											Current Retail Price Estimate ($)
											<input
												type="text"
												value={state.job.currentRetailPriceEstimate}
												onChange={(e) => update('job', { currentRetailPriceEstimate: e.target.value })}
											/>
										</label>
										<label>
											Reason Pricing Changed
											<textarea
												value={state.job.reasonPricingChanged}
												onChange={(e) => update('job', { reasonPricingChanged: e.target.value })}
											/>
										</label>
									</>
								)}
							</fieldset>
							<fieldset>
								<legend>Job Performance Review</legend>
								<RatingRadios
									label="Overall Job Rating"
									name="overallJobRating"
									value={state.job.overallJobRating}
									onChange={(v) => update('job', { overallJobRating: v })}
								/>
								<RatingRadios
									label="Customer Satisfaction"
									name="customerSatisfactionRating"
									value={state.job.customerSatisfactionRating}
									onChange={(v) => update('job', { customerSatisfactionRating: v })}
								/>
								<label>
									Would you accept this job again?
									<select
										value={state.job.wouldAcceptJobAgain ? 'Yes' : 'No'}
										onChange={(e) => update('job', { wouldAcceptJobAgain: e.target.value === 'Yes' })}
									>
										<option>Yes</option>
										<option>No</option>
									</select>
								</label>
								<label>
									Would you change your process?
									<select
										value={state.job.wouldChangeProcess ? 'Yes' : 'No'}
										onChange={(e) => update('job', { wouldChangeProcess: e.target.value === 'Yes' })}
									>
										<option>No</option>
										<option>Yes</option>
									</select>
								</label>
								{state.job.wouldChangeProcess && (
									<label>
										Process Improvements
										<textarea
											value={state.job.processImprovements}
											onChange={(e) => update('job', { processImprovements: e.target.value })}
										/>
									</label>
								)}
							</fieldset>
						</>
					)}
					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(showsQuote(state.recordType) ? 5 : showsWalkthrough(state.recordType) ? 4 : 3)}>
							Back
						</button>
						<button type="button" onClick={goToReview}>
							Review
						</button>
					</div>
				</section>
			)}

			{state.step === 7 && (
				<section className="card">
					<h2>7. Review</h2>
					<p>{mode === 'edit' ? 'This will update:' : 'This entry will create:'}</p>
					<ul>
						{!state.client.isExisting && <li>1 Client</li>}
						{!state.property.isExisting && <li>1 Property</li>}
						{showsWalkthrough(state.recordType) && state.walkthrough.include && (
							<li>1 Walkthrough{mode === 'edit' ? ' (existing)' : ''}</li>
						)}
						{showsQuote(state.recordType) && state.quote.include && <li>1 Quote{mode === 'edit' ? ' (existing)' : ''}</li>}
						{showsJob(state.recordType) && state.job.include && <li>1 Job{mode === 'edit' ? ' (existing)' : ''}</li>}
					</ul>
					{state.client.isExisting && mode !== 'edit' && <p>Reusing existing Client.</p>}
					{state.property.isExisting && mode !== 'edit' && <p>Reusing existing Property.</p>}

					{showsJob(state.recordType) && state.job.include && calibrationPreview && (
						<p>
							Calibration status: <strong>{calibrationPreview.eligible ? 'Included' : 'Excluded'}</strong>
							{!calibrationPreview.eligible && (
								<>
									<br />
									Reason(s): {calibrationPreview.reasons.join('; ')}
								</>
							)}
						</p>
					)}
					<p>Active pricing: No changes — this never edits or activates a PricingConfig.</p>

					{saveError && (
						<p role="alert">
							{saveError} — safe to retry.
						</p>
					)}

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(showsJob(state.recordType) ? 6 : showsQuote(state.recordType) ? 5 : showsWalkthrough(state.recordType) ? 4 : 3)}>
							Back
						</button>
						<button type="button" disabled={saving} onClick={save}>
							{saving
								? mode === 'edit'
									? 'Updating…'
									: 'Saving…'
								: saveError
									? mode === 'edit'
										? 'Retry update'
										: 'Retry save'
									: mode === 'edit'
										? 'Update'
										: 'Save'}
						</button>
					</div>
				</section>
			)}
		</div>
	);
}
