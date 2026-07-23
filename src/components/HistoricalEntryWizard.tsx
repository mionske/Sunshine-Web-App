import { useEffect, useState } from 'react';

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

const CONDITION_LEVELS = ['Maintenance', 'Moderate Buildup', 'Heavy Buildup', 'Restoration Required', 'Unknown'];
const ACCESS_LEVELS = ['Easy', 'Standard', 'Difficult', 'Specialty Access', 'Unknown'];
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
	callbackLaborMinutes: string;
	callbackCost: string;
	recordClassification: string;
	revenueTreatment: string;
	standardPriceEquivalent: string;
	dataQuality: string;
	dataQualityNotes: string;
}

interface WizardState {
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
			callbackLaborMinutes: '',
			callbackCost: '',
			recordClassification: '',
			revenueTreatment: '',
			standardPriceEquivalent: '',
			dataQuality: '',
			dataQualityNotes: '',
		},
	};
}

interface DuplicateCandidate {
	client?: { 'Client ID': string; 'First Name': string; 'Last Name': string };
	property?: { 'Property ID': string; 'Street Address': string; City: string };
	matchedOn: string[];
}

const DRAFT_KEY = 'sww-historical-entry-draft';

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

export default function HistoricalEntryWizard({ clientId, propertyId }: { clientId?: string; propertyId?: string }) {
	const [state, setState] = useState<WizardState>(() => {
		if (clientId || propertyId) return emptyState({ clientId, propertyId });
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
		if (saveResult) return; // don't keep persisting a draft that already saved successfully
		window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
	}, [state, saveResult]);

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
			callbackLaborMinutes: job.callbackLaborMinutes,
			callbackCost: job.callbackCost,
			recordClassification: job.recordClassification,
			revenueTreatment: job.revenueTreatment,
			standardPriceEquivalent: job.standardPriceEquivalent,
			dataQuality: job.dataQuality,
			dataQualityNotes: job.dataQualityNotes,
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
				body: JSON.stringify({ action: 'save', payload }),
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
				<h2>Saved</h2>
				<p>Historical record saved successfully.</p>
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
				<button type="button" onClick={startOver}>
					Enter another historical record
				</button>
			</div>
		);
	}

	return (
		<div>
			<p>Step {state.step} of 7</p>

			{state.step === 1 && (
				<section className="card">
					<h2>1. Record type</h2>
					<p>What kind of record is this?</p>
					{RECORD_TYPES.map((type) => (
						<label key={type} style={{ display: 'block' }}>
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
												{d.property['Street Address']}, {d.property.City}
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
							<fieldset>
								<legend>Client</legend>
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
									<input
										type="text"
										value={state.client.preferredContactMethod}
										onChange={(e) => update('client', { preferredContactMethod: e.target.value })}
									/>
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
							</fieldset>
							<button type="button" onClick={() => goTo(1)}>
								Back
							</button>{' '}
							<button type="button" disabled={checkingDuplicates} onClick={checkDuplicatesThenAdvance}>
								{checkingDuplicates ? 'Checking…' : 'Next'}
							</button>
						</>
					)}
				</section>
			)}

			{state.step === 3 && (
				<section className="card">
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
					<button type="button" onClick={() => goTo(2)}>
						Back
					</button>{' '}
					<button type="button" onClick={() => goTo(showsWalkthrough(state.recordType) ? 4 : showsQuote(state.recordType) ? 5 : 6)}>
						Next
					</button>
				</section>
			)}

			{state.step === 4 && showsWalkthrough(state.recordType) && (
				<section className="card">
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
									{CONDITION_LEVELS.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
							<label>
								Interior condition
								<select value={state.walkthrough.interiorCondition} onChange={(e) => update('walkthrough', { interiorCondition: e.target.value })}>
									<option value="" />
									{CONDITION_LEVELS.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
							<label>
								Access difficulty
								<select value={state.walkthrough.accessDifficulty} onChange={(e) => update('walkthrough', { accessDifficulty: e.target.value })}>
									<option value="" />
									{ACCESS_LEVELS.map((a) => (
										<option key={a}>{a}</option>
									))}
								</select>
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.walkthrough.hardWaterPresent === 'Y'}
									onChange={(e) => update('walkthrough', { hardWaterPresent: e.target.checked ? 'Y' : 'N' })}
								/>{' '}
								Hard water present
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.walkthrough.constructionDebrisPresent === 'Y'}
									onChange={(e) => update('walkthrough', { constructionDebrisPresent: e.target.checked ? 'Y' : 'N' })}
								/>{' '}
								Construction debris present
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
					<button type="button" onClick={() => goTo(3)}>
						Back
					</button>{' '}
					<button type="button" onClick={() => goTo(showsQuote(state.recordType) ? 5 : 6)}>
						Next
					</button>
				</section>
			)}

			{state.step === 5 && showsQuote(state.recordType) && (
				<section className="card">
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
					<button type="button" onClick={() => goTo(showsWalkthrough(state.recordType) ? 4 : 3)}>
						Back
					</button>{' '}
					<button type="button" onClick={() => goTo(showsJob(state.recordType) ? 6 : 7)} disabled={false}>
						Next
					</button>
				</section>
			)}

			{state.step === 6 && showsJob(state.recordType) && (
				<section className="card">
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
								A callback was required
							</label>
							{state.job.callbackOccurred && (
								<>
									<label>
										Callback labor minutes
										<input
											type="text"
											value={state.job.callbackLaborMinutes}
											onChange={(e) => update('job', { callbackLaborMinutes: e.target.value })}
										/>
									</label>
									<label>
										Callback cost ($)
										<input type="text" value={state.job.callbackCost} onChange={(e) => update('job', { callbackCost: e.target.value })} />
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
						</>
					)}
					<button type="button" onClick={() => goTo(showsQuote(state.recordType) ? 5 : showsWalkthrough(state.recordType) ? 4 : 3)}>
						Back
					</button>{' '}
					<button type="button" onClick={goToReview}>
						Review
					</button>
				</section>
			)}

			{state.step === 7 && (
				<section className="card">
					<h2>7. Review</h2>
					<p>This entry will create:</p>
					<ul>
						{!state.client.isExisting && <li>1 Client</li>}
						{!state.property.isExisting && <li>1 Property</li>}
						{showsWalkthrough(state.recordType) && state.walkthrough.include && <li>1 Walkthrough</li>}
						{showsQuote(state.recordType) && state.quote.include && <li>1 Quote</li>}
						{showsJob(state.recordType) && state.job.include && <li>1 Job</li>}
					</ul>
					{state.client.isExisting && <p>Reusing existing Client.</p>}
					{state.property.isExisting && <p>Reusing existing Property.</p>}

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

					<button type="button" onClick={() => goTo(showsJob(state.recordType) ? 6 : showsQuote(state.recordType) ? 5 : showsWalkthrough(state.recordType) ? 4 : 3)}>
						Back
					</button>{' '}
					<button type="button" disabled={saving} onClick={save}>
						{saving ? 'Saving…' : saveError ? 'Retry save' : 'Save'}
					</button>
				</section>
			)}
		</div>
	);
}
