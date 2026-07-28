import { useEffect, useState } from 'react';
import { GLASS_CONDITION_LEVELS } from '../lib/models/walkthrough';

const ALL_AREAS = ['Front', 'Left', 'Rear', 'Right', 'Interior', 'Garage', 'Basement', 'Other'];
const ITEM_TYPES = ['Window', 'Sliding Door', 'Skylight'];
const SIZE_CLASSES = ['Standard', 'Oversized', 'French/Divided-Light'];
const CONDITION_LEVELS = ['Maintenance', 'Moderate Buildup', 'Heavy Buildup', 'Restoration Required', 'Unknown'];
const ACCESS_LEVELS = ['Easy', 'Standard', 'Difficult', 'Specialty Access', 'Unknown'];

function newId(): string {
	return crypto.randomUUID();
}

// Glass Condition (how dirty) vs. Restoration Services Required (what
// specialized technique the job needs) are two separate concepts now —
// this is the shared radio-pill control for the two Glass Condition
// fields, reusing the app's existing .segmented CSS (see Property
// Detail's Access Difficulty/Ladder Requirement controls for the same
// visual pattern elsewhere).
function GlassConditionRadios({
	label,
	name,
	value,
	onChange,
}: {
	label: string;
	name: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div>
			<p className="field-label">{label}</p>
			<div className="segmented">
				{GLASS_CONDITION_LEVELS.map((level) => (
					<label key={level}>
						<input type="radio" name={name} value={level} checked={value === level} onChange={() => onChange(level)} />
						{level}
					</label>
				))}
			</div>
		</div>
	);
}

interface ItemState {
	id: string;
	area: string;
	itemType: string;
	sizeClass: string;
	quantity: string;
	interiorIncluded: boolean;
	exteriorIncluded: boolean;
	screenIncluded: boolean;
	trackIncluded: boolean;
	condition: string;
	accessDifficulty: string;
	hardWater: boolean;
	constructionDebris: boolean;
	notes: string;
}

function emptyItem(area: string): ItemState {
	return {
		id: newId(),
		area,
		itemType: 'Window',
		sizeClass: 'Standard',
		quantity: '1',
		interiorIncluded: false,
		exteriorIncluded: true,
		screenIncluded: false,
		trackIncluded: false,
		condition: 'Maintenance',
		accessDifficulty: 'Standard',
		hardWater: false,
		constructionDebris: false,
		notes: '',
	};
}

/** One optional area in the by-area breakdown. Counts only — no window
 * types, no per-opening rows. */
interface AreaState {
	id: string;
	area: string;
	windowUnits: string;
	paneCount: string;
	screens: string;
	tracks: string;
	notes: string;
}

function emptyArea(): AreaState {
	return { id: newId(), area: '', windowUnits: '', paneCount: '', screens: '', tracks: '', notes: '' };
}

/** How the counts on this walkthrough were entered. Whole-property is the
 * default and the fastest path; the other two are opt-in. */
type CountMode = 'whole-property' | 'by-area' | 'detailed';

interface WizardState {
	step: number; // 0 = property & access, 1 = counts, 2 = condition, 3 = review & price
	walkthroughDate: string;
	conductedBy: string;
	exteriorCondition: string;
	interiorCondition: string;
	storyCountObserved: string;
	accessDifficulty: string;
	hardWaterPresent: boolean;
	constructionDebrisPresent: boolean;
	waterFedPoleSuitable: boolean;
	ladderRequired: string;
	roofAccessRequired: string;
	notes: string;
	// Data-ownership separation: temporary condition/access observations
	// that used to live on Property — captured per visit here instead,
	// since a maintenance visit can change every one of them.
	siliconeResidue: boolean;
	heavyInteriorResidue: boolean;
	oxidizedFramesOrScreens: boolean;
	conditionVariesByArea: boolean;
	conditionNotes: string;
	exteriorAccessObstructed: boolean;
	furnitureMovementRequired: boolean;
	temporaryAccessNotes: string;
	// Restoration Services Required — supplements exteriorCondition/
	// interiorCondition above, doesn't replace them. constructionDebrisPresent/
	// hardWaterPresent/siliconeResidue above already double as three of the
	// 8 restoration checkboxes.
	paintOverspray: boolean;
	razorScraping: boolean;
	steelWool: boolean;
	nonScratchPad: boolean;
	restorationNotes: string;
	// Counts. Window units and panes of glass measure different things and
	// are recorded independently — the app never derives one from the other.
	countMode: CountMode;
	totalWindowUnits: string;
	totalGlassPanes: string;
	totalScreens: string;
	totalTracks: string;
	totalSkylights: string;
	totalSlidingDoors: string;
	interiorIncluded: boolean;
	exteriorIncluded: boolean;
	areas: AreaState[];
	/** Only used in 'detailed' mode — the per-opening breakdown, kept for
	 * the rare job that genuinely needs it. */
	items: ItemState[];
}

function emptyState(): WizardState {
	return {
		step: 0,
		walkthroughDate: new Date().toISOString().slice(0, 10),
		conductedBy: '',
		exteriorCondition: 'Maintenance',
		interiorCondition: 'Maintenance',
		storyCountObserved: '1',
		accessDifficulty: 'Standard',
		hardWaterPresent: false,
		constructionDebrisPresent: false,
		waterFedPoleSuitable: false,
		ladderRequired: '',
		roofAccessRequired: '',
		notes: '',
		siliconeResidue: false,
		heavyInteriorResidue: false,
		oxidizedFramesOrScreens: false,
		conditionVariesByArea: false,
		conditionNotes: '',
		exteriorAccessObstructed: false,
		furnitureMovementRequired: false,
		temporaryAccessNotes: '',
		paintOverspray: false,
		razorScraping: false,
		steelWool: false,
		nonScratchPad: false,
		restorationNotes: '',
		countMode: 'whole-property',
		totalWindowUnits: '',
		totalGlassPanes: '',
		totalScreens: '',
		totalTracks: '',
		totalSkylights: '',
		totalSlidingDoors: '',
		interiorIncluded: false,
		exteriorIncluded: true,
		areas: [],
		items: [],
	};
}

// v2: the wizard went from 8 steps to 4 and gained whole-property counts, so
// a draft saved by the old wizard carries a step index and a shape that no
// longer mean the same thing. Bumping the key retires those drafts rather
// than restoring one into a form that can't represent it.
function draftKey(propertyId: string): string {
	return `sww-walkthrough-draft-v2-${propertyId}`;
}

interface PricingPreview {
	estimatedLaborHours: number;
	suggestedLowPrice: number;
	suggestedTargetPrice: number;
	suggestedHighPrice: number;
	pricingConfigId: string;
}

interface PropertyReference {
	totalWindowUnits: string;
	totalGlassPanes: string;
	stories: string;
	exteriorCleaningMethod: string;
	ladderRequirement: string;
	waterAccess: string;
	roofAccessRequired: boolean;
	petNotes: string;
}

export default function WalkthroughWizard({
	clientId,
	propertyId,
	opportunityId,
	propertyReference,
}: {
	clientId: string;
	propertyId: string;
	opportunityId?: string;
	propertyReference?: PropertyReference;
}) {
	const [state, setState] = useState<WizardState>(() => {
		const saved = typeof window !== 'undefined' ? window.localStorage.getItem(draftKey(propertyId)) : null;
		if (saved) {
			try {
				return JSON.parse(saved) as WizardState;
			} catch {
				/* fall through to a fresh draft */
			}
		}
		return emptyState();
	});
	const [editingItem, setEditingItem] = useState<ItemState | null>(null);
	const [pricing, setPricing] = useState<PricingPreview | null>(null);
	const [loadingPricing, setLoadingPricing] = useState(false);
	const [ownerOverridePrice, setOwnerOverridePrice] = useState('');
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saveResult, setSaveResult] = useState<Record<string, unknown> | null>(null);
	const [creatingQuote, setCreatingQuote] = useState(false);

	useEffect(() => {
		if (saveResult) return;
		window.localStorage.setItem(draftKey(propertyId), JSON.stringify(state));
	}, [state, propertyId, saveResult]);

	useEffect(() => {
		function warnOnUnload(e: BeforeUnloadEvent) {
			if (state.step > 0 && !saveResult) e.preventDefault();
		}
		window.addEventListener('beforeunload', warnOnUnload);
		return () => window.removeEventListener('beforeunload', warnOnUnload);
	}, [state.step, saveResult]);

	function update(patch: Partial<WizardState>) {
		setState((s) => ({ ...s, ...patch }));
	}

	function goTo(step: number) {
		setState((s) => ({ ...s, step }));
	}

	function saveItem(item: ItemState) {
		setState((s) => {
			const exists = s.items.some((i) => i.id === item.id);
			return { ...s, items: exists ? s.items.map((i) => (i.id === item.id ? item : i)) : [...s.items, item] };
		});
		setEditingItem(null);
	}

	function deleteItem(id: string) {
		setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
	}

	function duplicateItem(item: ItemState) {
		setState((s) => ({ ...s, items: [...s.items, { ...item, id: newId() }] }));
	}

	function updateArea(id: string, patch: Partial<AreaState>) {
		setState((s) => ({ ...s, areas: s.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
	}

	function addArea() {
		setState((s) => ({ ...s, areas: [...s.areas, emptyArea()], countMode: 'by-area' }));
	}

	function duplicateArea(area: AreaState) {
		setState((s) => ({ ...s, areas: [...s.areas, { ...area, id: newId() }] }));
	}

	function removeArea(id: string) {
		setState((s) => {
			const areas = s.areas.filter((a) => a.id !== id);
			return { ...s, areas, countMode: areas.length === 0 && s.countMode === 'by-area' ? 'whole-property' : s.countMode };
		});
	}

	const areaTotals = state.areas.reduce(
		(acc, a) => ({
			windowUnits: acc.windowUnits + (Number(a.windowUnits) || 0),
			panes: acc.panes + (Number(a.paneCount) || 0),
			screens: acc.screens + (Number(a.screens) || 0),
			tracks: acc.tracks + (Number(a.tracks) || 0),
		}),
		{ windowUnits: 0, panes: 0, screens: 0, tracks: 0 }
	);

	// What actually gets priced and saved, per entry mode. Only one mode's
	// rows are ever sent — mixing them would make the resolver pick the
	// detailed path and silently ignore the totals the operator entered.
	const usingAreas = state.countMode === 'by-area' && state.areas.length > 0;
	const usingDetailed = state.countMode === 'detailed';

	function countPayload() {
		const totals = usingAreas
			? { windowUnits: areaTotals.windowUnits, panes: areaTotals.panes, screens: areaTotals.screens, tracks: areaTotals.tracks }
			: {
					windowUnits: Number(state.totalWindowUnits) || 0,
					panes: Number(state.totalGlassPanes) || 0,
					screens: Number(state.totalScreens) || 0,
					tracks: Number(state.totalTracks) || 0,
				};
		return {
			totalWindowUnits: String(totals.windowUnits),
			totalGlassPanes: String(totals.panes),
			totalScreens: String(totals.screens),
			totalTracks: String(totals.tracks),
			totalSkylights: state.totalSkylights,
			totalSlidingDoors: state.totalSlidingDoors,
			interiorIncluded: state.interiorIncluded,
			exteriorIncluded: state.exteriorIncluded,
			countEntryMode: state.countMode,
			items: usingDetailed
				? state.items
				: usingAreas
					? state.areas.map((a) => ({
							id: a.id,
							area: a.area,
							windowUnits: a.windowUnits,
							paneCount: a.paneCount,
							itemType: '',
							quantity: '',
							sizeClass: '',
							interiorIncluded: state.interiorIncluded,
							exteriorIncluded: state.exteriorIncluded,
							screenIncluded: false,
							trackIncluded: false,
							screenCount: a.screens,
							trackCount: a.tracks,
							condition: '',
							accessDifficulty: '',
							hardWater: false,
							constructionDebris: false,
							notes: a.notes,
						}))
					: [],
		};
	}

	function startOver() {
		window.localStorage.removeItem(draftKey(propertyId));
		setState(emptyState());
		setSaveResult(null);
		setSaveError(null);
		setPricing(null);
	}

	async function loadPricingPreview() {
		setLoadingPricing(true);
		try {
			const counts = countPayload();
			const res = await fetch('/api/walkthrough', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'preview-pricing',
					propertyId,
					input: {
						storyCountObserved: state.storyCountObserved,
						exteriorCondition: state.exteriorCondition,
						hardWaterPresent: state.hardWaterPresent,
						constructionDebrisPresent: state.constructionDebrisPresent,
						accessDifficulty: state.accessDifficulty,
						siliconeResidue: state.siliconeResidue,
						paintOverspray: state.paintOverspray,
						razorScraping: state.razorScraping,
						steelWool: state.steelWool,
						nonScratchPad: state.nonScratchPad,
						// Absent in detailed mode, so the engine prices from the
						// item rows instead (see resolveWalkthroughCounts).
						totals: usingDetailed
							? undefined
							: {
									windowUnits: Number(counts.totalWindowUnits) || 0,
									panes: Number(counts.totalGlassPanes) || 0,
									screens: Number(counts.totalScreens) || 0,
									tracks: Number(counts.totalTracks) || 0,
									skylights: Number(counts.totalSkylights) || 0,
									slidingDoors: Number(counts.totalSlidingDoors) || 0,
								},
						interiorIncluded: state.interiorIncluded,
						exteriorIncluded: state.exteriorIncluded,
					},
					items: counts.items,
				}),
			});
			const body = (await res.json()) as { ok: boolean; pricing?: PricingPreview; error?: string };
			if (body.ok && body.pricing) {
				setPricing(body.pricing);
				setOwnerOverridePrice(String(body.pricing.suggestedTargetPrice));
			} else {
				setSaveError(body.error ?? 'Could not calculate pricing preview.');
			}
		} finally {
			setLoadingPricing(false);
		}
	}

	async function save() {
		setSaving(true);
		setSaveError(null);
		try {
			const res = await fetch('/api/walkthrough', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'save',
					id: newId(),
					clientId,
					propertyId,
					opportunityId,
					walkthroughDate: state.walkthroughDate,
					conductedBy: state.conductedBy,
					exteriorCondition: state.exteriorCondition,
					interiorCondition: state.interiorCondition,
					storyCountObserved: state.storyCountObserved,
					accessDifficulty: state.accessDifficulty,
					hardWaterPresent: state.hardWaterPresent,
					constructionDebrisPresent: state.constructionDebrisPresent,
					waterFedPoleSuitable: state.waterFedPoleSuitable,
					ladderRequired: state.ladderRequired,
					roofAccessRequired: state.roofAccessRequired,
					ownerOverridePrice,
					notes: state.notes,
					siliconeResidue: state.siliconeResidue,
					heavyInteriorResidue: state.heavyInteriorResidue,
					oxidizedFramesOrScreens: state.oxidizedFramesOrScreens,
					conditionVariesByArea: state.conditionVariesByArea,
					conditionNotes: state.conditionNotes,
					exteriorAccessObstructed: state.exteriorAccessObstructed,
					furnitureMovementRequired: state.furnitureMovementRequired,
					temporaryAccessNotes: state.temporaryAccessNotes,
					paintOverspray: state.paintOverspray,
					razorScraping: state.razorScraping,
					steelWool: state.steelWool,
					nonScratchPad: state.nonScratchPad,
					restorationNotes: state.restorationNotes,
					...countPayload(),
				}),
			});
			const body = (await res.json()) as { ok: boolean; error?: string; [key: string]: unknown };
			if (!body.ok) {
				setSaveError(body.error ?? 'Save failed for an unknown reason.');
				return;
			}
			setSaveResult(body);
			window.localStorage.removeItem(draftKey(propertyId));
		} catch (e) {
			setSaveError((e as Error).message || 'Network error — nothing may have been saved. Safe to retry.');
		} finally {
			setSaving(false);
		}
	}

	async function createQuote(walkthroughId: string) {
		setCreatingQuote(true);
		try {
			const res = await fetch('/api/walkthrough', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'create-quote', walkthroughId }),
			});
			const body = (await res.json()) as { ok: boolean; quote?: { 'Quote ID': string }; error?: string };
			if (body.ok && body.quote) {
				window.location.href = `/quotes/${body.quote['Quote ID']}`;
			} else {
				setSaveError(body.error ?? 'Could not create a quote from this walkthrough.');
			}
		} finally {
			setCreatingQuote(false);
		}
	}

	if (saveResult) {
		return (
			<div className="card">
				<h2>Walkthrough saved</h2>
				<p>
					Suggested price: ${String(saveResult.suggestedLowPrice)} – ${String(saveResult.suggestedHighPrice)}
					{' '}(target ${String(saveResult.suggestedTargetPrice)})
				</p>
				<p>
					<a href={`/properties/${propertyId}`}>View property</a>
				</p>
				{saveError && <p role="alert">{saveError}</p>}
				<button type="button" disabled={creatingQuote} onClick={() => createQuote(String(saveResult.walkthroughId))}>
					{creatingQuote ? 'Creating…' : 'Create quote from this walkthrough'}
				</button>{' '}
				<button type="button" onClick={startOver}>
					Start another walkthrough
				</button>
			</div>
		);
	}

	const currentAreaItems = (area: string) => state.items.filter((i) => i.area === area);
	const STEP_TITLES = ['Property & Access', 'Counts', 'Condition & Special Work', 'Review & Price'];

	return (
		<div>
			<p>
				Step {state.step + 1} of 4 — {STEP_TITLES[state.step]}
			</p>

			{state.step === 0 && (
				<section className="card">
					<h2>Property &amp; Access</h2>

					{propertyReference && (
						<div className="card" style={{ background: 'var(--color-cream)' }}>
							<p className="field-label">Property reference</p>
							<ul style={{ margin: 0 }}>
								<li>{propertyReference.totalWindowUnits || '0'} window units</li>
								<li>{propertyReference.totalGlassPanes || '0'} panes</li>
								<li>
									{propertyReference.stories || '— not set'} {propertyReference.stories === '1' ? 'story' : 'stories'}
								</li>
								{propertyReference.exteriorCleaningMethod && <li>{propertyReference.exteriorCleaningMethod} typical</li>}
								{propertyReference.ladderRequirement && <li>{propertyReference.ladderRequirement} required</li>}
								{propertyReference.waterAccess && <li>Water access: {propertyReference.waterAccess}</li>}
								{propertyReference.roofAccessRequired && <li>Roof access required</li>}
								{propertyReference.petNotes && <li>Pet notes: {propertyReference.petNotes}</li>}
							</ul>
							<span className="field-hint">
								From the property record — for reference only. This walkthrough saves its own values below and never
								changes the property.
							</span>
						</div>
					)}

					<div className="form-grid">
						<label>
							Walkthrough date
							<input type="date" value={state.walkthroughDate} onChange={(e) => update({ walkthroughDate: e.target.value })} />
						</label>
						<label>
							Conducted by
							<input type="text" value={state.conductedBy} onChange={(e) => update({ conductedBy: e.target.value })} />
						</label>
						<label>
							Stories
							<select value={state.storyCountObserved} onChange={(e) => update({ storyCountObserved: e.target.value })}>
								<option value="1">1</option>
								<option value="2">2</option>
								<option value="3">3</option>
							</select>
						</label>
						<label>
							Overall access difficulty
							<select value={state.accessDifficulty} onChange={(e) => update({ accessDifficulty: e.target.value })}>
								{ACCESS_LEVELS.map((a) => (
									<option key={a}>{a}</option>
								))}
							</select>
						</label>
						<label>
							Ladder requirement
							<input type="text" value={state.ladderRequired} onChange={(e) => update({ ladderRequired: e.target.value })} />
						</label>
					</div>

					<div className="checkbox-grid">
						<label>
							<input
								type="checkbox"
								checked={state.waterFedPoleSuitable}
								onChange={(e) => update({ waterFedPoleSuitable: e.target.checked })}
							/>{' '}
							Water-fed pole suitable
						</label>
						<label>
							<input
								type="checkbox"
								checked={state.exteriorAccessObstructed}
								onChange={(e) => update({ exteriorAccessObstructed: e.target.checked })}
							/>{' '}
							Exterior access currently obstructed
						</label>
						<label>
							<input
								type="checkbox"
								checked={state.furnitureMovementRequired}
								onChange={(e) => update({ furnitureMovementRequired: e.target.checked })}
							/>{' '}
							Furniture or belongings currently need to be moved
						</label>
					</div>

					<label>
						Temporary access notes
						<span className="field-hint">Parking, gates, safety concerns, or anything else about getting set up for this specific visit.</span>
						<textarea value={state.temporaryAccessNotes} onChange={(e) => update({ temporaryAccessNotes: e.target.value })} />
					</label>

					<button type="button" onClick={() => goTo(1)}>
						Next: Counts
					</button>
				</section>
			)}

			{state.step === 2 && (
				<section className="card">
					<h2>Condition &amp; Special Work</h2>

					<GlassConditionRadios
						label="Interior Glass Condition"
						name="interiorGlassCondition"
						value={state.interiorCondition}
						onChange={(v) => update({ interiorCondition: v })}
					/>
					<GlassConditionRadios
						label="Exterior Glass Condition"
						name="exteriorGlassCondition"
						value={state.exteriorCondition}
						onChange={(v) => update({ exteriorCondition: v })}
					/>

					<div className="card" style={{ background: 'var(--color-cream)' }}>
						<h3>Restoration Services Required</h3>
						<span className="field-hint">
							Specialized cleaning beyond a standard window cleaning — supplements the condition rating above, doesn't
							replace it.
						</span>
						<div className="checkbox-grid">
							<label>
								<input
									type="checkbox"
									checked={state.constructionDebrisPresent}
									onChange={(e) => update({ constructionDebrisPresent: e.target.checked })}
								/>{' '}
								Construction Debris
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.siliconeResidue}
									onChange={(e) => update({ siliconeResidue: e.target.checked })}
								/>{' '}
								Window Stickers / Adhesive
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.paintOverspray}
									onChange={(e) => update({ paintOverspray: e.target.checked })}
								/>{' '}
								Paint Overspray
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.hardWaterPresent}
									onChange={(e) => update({ hardWaterPresent: e.target.checked })}
								/>{' '}
								Hard Water / Mineral Deposits
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.razorScraping}
									onChange={(e) => update({ razorScraping: e.target.checked })}
								/>{' '}
								Razor Scraping Required
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.steelWool}
									onChange={(e) => update({ steelWool: e.target.checked })}
								/>{' '}
								Steel Wool Required
							</label>
							<label>
								<input
									type="checkbox"
									checked={state.nonScratchPad}
									onChange={(e) => update({ nonScratchPad: e.target.checked })}
								/>{' '}
								Non-Scratch Pad Required
							</label>
						</div>
						<label>
							Other
							<textarea value={state.restorationNotes} onChange={(e) => update({ restorationNotes: e.target.value })} />
						</label>
					</div>

					<div className="checkbox-grid">
						<label>
							<input
								type="checkbox"
								checked={state.heavyInteriorResidue}
								onChange={(e) => update({ heavyInteriorResidue: e.target.checked })}
							/>{' '}
							Heavy interior residue
						</label>
						<label>
							<input
								type="checkbox"
								checked={state.oxidizedFramesOrScreens}
								onChange={(e) => update({ oxidizedFramesOrScreens: e.target.checked })}
							/>{' '}
							Oxidized frames or screens
						</label>
						<label>
							<input
								type="checkbox"
								checked={state.conditionVariesByArea}
								onChange={(e) => update({ conditionVariesByArea: e.target.checked })}
							/>{' '}
							Condition varies by area
						</label>
					</div>

					<label>
						Condition notes
						<span className="field-hint">
							Note where special work applies — e.g. "paint overspray on 4 panes", "hard water on 6 panes", "difficult
							catwalk access on 12 units".
						</span>
						<textarea value={state.conditionNotes} onChange={(e) => update({ conditionNotes: e.target.value })} />
					</label>

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(1)}>
							Back
						</button>
						<button
							type="button"
							disabled={loadingPricing}
							onClick={async () => {
								await loadPricingPreview();
								goTo(3);
							}}
						>
							{loadingPricing ? 'Calculating…' : 'Next: Review & Price'}
						</button>
					</div>
				</section>
			)}

			{state.step === 1 && (
				<section className="card">
					<h2>Counts</h2>
					<p className="field-hint">
						Window units are your own judgment of how much work an opening represents. Panes are the number of individual
						pieces of glass. They're recorded separately and neither is calculated from the other.
					</p>

					<div className="checkbox-grid">
						<label>
							<input type="checkbox" checked={state.exteriorIncluded} onChange={(e) => update({ exteriorIncluded: e.target.checked })} />{' '}
							Exterior included
						</label>
						<label>
							<input type="checkbox" checked={state.interiorIncluded} onChange={(e) => update({ interiorIncluded: e.target.checked })} />{' '}
							Interior included
						</label>
					</div>

					{state.countMode !== 'by-area' && (
						<div className="count-grid">
							<label>
								Window units
								<input
									type="number"
									min="0"
									inputMode="numeric"
									value={state.totalWindowUnits}
									onChange={(e) => update({ totalWindowUnits: e.target.value })}
								/>
							</label>
							<label>
								Panes of glass
								<input
									type="number"
									min="0"
									inputMode="numeric"
									value={state.totalGlassPanes}
									onChange={(e) => update({ totalGlassPanes: e.target.value })}
								/>
							</label>
							<label>
								Screens
								<input type="number" min="0" inputMode="numeric" value={state.totalScreens} onChange={(e) => update({ totalScreens: e.target.value })} />
							</label>
							<label>
								Tracks
								<input type="number" min="0" inputMode="numeric" value={state.totalTracks} onChange={(e) => update({ totalTracks: e.target.value })} />
							</label>
							<label>
								Sliding doors
								<input
									type="number"
									min="0"
									inputMode="numeric"
									value={state.totalSlidingDoors}
									onChange={(e) => update({ totalSlidingDoors: e.target.value })}
								/>
							</label>
							<label>
								Skylights
								<input
									type="number"
									min="0"
									inputMode="numeric"
									value={state.totalSkylights}
									onChange={(e) => update({ totalSkylights: e.target.value })}
								/>
							</label>
						</div>
					)}

					{state.countMode === 'by-area' && (
						<>
							<p className="field-hint">Area totals add up into the property totals below. Sliding doors and skylights stay property-wide.</p>
							{state.areas.map((a) => (
								<div key={a.id} className="card" style={{ background: 'var(--color-cream)' }}>
									<label>
										Area
										<input
											type="text"
											placeholder="Upstairs, Main floor, Front…"
											value={a.area}
											onChange={(e) => updateArea(a.id, { area: e.target.value })}
										/>
									</label>
									<div className="count-grid">
										<label>
											Window units
											<input type="number" min="0" inputMode="numeric" value={a.windowUnits} onChange={(e) => updateArea(a.id, { windowUnits: e.target.value })} />
										</label>
										<label>
											Panes
											<input type="number" min="0" inputMode="numeric" value={a.paneCount} onChange={(e) => updateArea(a.id, { paneCount: e.target.value })} />
										</label>
										<label>
											Screens
											<input type="number" min="0" inputMode="numeric" value={a.screens} onChange={(e) => updateArea(a.id, { screens: e.target.value })} />
										</label>
										<label>
											Tracks
											<input type="number" min="0" inputMode="numeric" value={a.tracks} onChange={(e) => updateArea(a.id, { tracks: e.target.value })} />
										</label>
									</div>
									<label>
										Notes
										<input type="text" value={a.notes} onChange={(e) => updateArea(a.id, { notes: e.target.value })} />
									</label>
									<div className="button-row">
										<button type="button" className="btn-secondary" onClick={() => duplicateArea(a)}>
											Duplicate area
										</button>
										<button type="button" className="btn-secondary" onClick={() => removeArea(a.id)}>
											Remove area
										</button>
									</div>
								</div>
							))}
							<p>
								<strong>
									Total: {areaTotals.windowUnits} window units · {areaTotals.panes} panes · {areaTotals.screens} screens ·{' '}
									{areaTotals.tracks} tracks
								</strong>
							</p>
							<div className="count-grid">
								<label>
									Sliding doors (property-wide)
									<input type="number" min="0" inputMode="numeric" value={state.totalSlidingDoors} onChange={(e) => update({ totalSlidingDoors: e.target.value })} />
								</label>
								<label>
									Skylights (property-wide)
									<input type="number" min="0" inputMode="numeric" value={state.totalSkylights} onChange={(e) => update({ totalSkylights: e.target.value })} />
								</label>
							</div>
						</>
					)}

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={addArea}>
							+ Add area
						</button>
					</div>

					<details className="card">
						<summary>Item-level breakdown (advanced)</summary>
						<p className="field-hint">
							Rarely needed. Records one row per group of openings with a window type and size class. Using this replaces
							the counts above for pricing.
						</p>
						<div className="checkbox-grid">
							<label>
								<input
									type="checkbox"
									checked={state.countMode === 'detailed'}
									onChange={(e) => update({ countMode: e.target.checked ? 'detailed' : state.areas.length > 0 ? 'by-area' : 'whole-property' })}
								/>{' '}
								Price this walkthrough from item-level rows instead
							</label>
						</div>
						{state.countMode === 'detailed' && (
							<>
								{ALL_AREAS.map((area) => {
									const areaItems = currentAreaItems(area);
									if (areaItems.length === 0) return null;
									return (
										<p key={area}>
											<strong>{area}:</strong> {areaItems.map((i) => `${i.quantity}× ${i.itemType}`).join(', ')}
										</p>
									);
								})}
								{editingItem ? (
									<ItemForm item={editingItem} area={editingItem.area} onSave={saveItem} onCancel={() => setEditingItem(null)} />
								) : (
									<div className="button-row">
										<button type="button" onClick={() => setEditingItem(emptyItem('Front'))}>
											+ Add item
										</button>
									</div>
								)}
								{state.items.length > 0 && (
									<table>
										<thead>
											<tr><th>Area</th><th>Type</th><th>Qty</th><th>Ext</th><th>Int</th><th /></tr>
										</thead>
										<tbody>
											{state.items.map((i) => (
												<tr key={i.id}>
													<td>{i.area}</td>
													<td>{i.itemType}{i.itemType === 'Window' ? ` (${i.sizeClass})` : ''}</td>
													<td>{i.quantity}</td>
													<td>{i.exteriorIncluded ? 'Y' : ''}</td>
													<td>{i.interiorIncluded ? 'Y' : ''}</td>
													<td>
														<button type="button" className="btn-secondary" onClick={() => setEditingItem(i)}>Edit</button>{' '}
														<button type="button" className="btn-secondary" onClick={() => duplicateItem(i)}>Duplicate</button>{' '}
														<button type="button" className="btn-secondary" onClick={() => deleteItem(i.id)}>Remove</button>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
							</>
						)}
					</details>

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(0)}>
							Back
						</button>
						<button type="button" onClick={() => goTo(2)}>
							Next: Condition
						</button>
					</div>
				</section>
			)}

			{state.step === 3 && (
				<section className="card">
					<h2>Review &amp; Price</h2>

					<ul>
						<li>
							{usingAreas ? areaTotals.windowUnits : Number(state.totalWindowUnits) || 0} window units ·{' '}
							{usingAreas ? areaTotals.panes : Number(state.totalGlassPanes) || 0} panes
						</li>
						<li>
							{usingAreas ? areaTotals.screens : Number(state.totalScreens) || 0} screens ·{' '}
							{usingAreas ? areaTotals.tracks : Number(state.totalTracks) || 0} tracks
						</li>
						{(Number(state.totalSlidingDoors) || 0) > 0 && <li>{state.totalSlidingDoors} sliding doors</li>}
						{(Number(state.totalSkylights) || 0) > 0 && <li>{state.totalSkylights} skylights</li>}
						<li>
							{state.exteriorIncluded && state.interiorIncluded
								? 'Interior and exterior'
								: state.interiorIncluded
									? 'Interior only'
									: 'Exterior only'}
						</li>
						<li>
							{state.storyCountObserved} {state.storyCountObserved === '1' ? 'story' : 'stories'} · {state.accessDifficulty} access
						</li>
						<li>
							Glass condition: {state.exteriorCondition} exterior, {state.interiorCondition} interior
						</li>
						{usingDetailed && <li>{state.items.length} item-level row(s) — pricing from those instead of the totals</li>}
						{usingAreas && <li>{state.areas.length} area(s) recorded</li>}
					</ul>

					{pricing ? (
						<>
							<p>Estimated on-site labor: {pricing.estimatedLaborHours.toFixed(2)} hours</p>
							<p>
								Suggested low: ${pricing.suggestedLowPrice} — Suggested target: <strong>${pricing.suggestedTargetPrice}</strong> —
								Suggested high: ${pricing.suggestedHighPrice}
							</p>
							<label>
								Owner-selected price
								<input type="text" value={ownerOverridePrice} onChange={(e) => setOwnerOverridePrice(e.target.value)} />
							</label>
							<p className="field-hint">Active PricingConfig: {pricing.pricingConfigId}</p>
						</>
					) : (
						<p>No pricing calculated yet.</p>
					)}

					<label>
						General notes
						<textarea value={state.notes} onChange={(e) => update({ notes: e.target.value })} />
					</label>

					{saveError && <p role="alert">{saveError}</p>}
					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(1)}>
							Back to counts
						</button>
						<button type="button" className="btn-secondary" disabled={loadingPricing} onClick={loadPricingPreview}>
							{loadingPricing ? 'Calculating…' : 'Recalculate'}
						</button>
						<button type="button" disabled={saving || !pricing} onClick={save}>
							{saving ? 'Saving…' : 'Save walkthrough'}
						</button>
					</div>
				</section>
			)}
		</div>
	);
}

function ItemForm({
	item,
	area,
	onSave,
	onCancel,
}: {
	item: ItemState;
	area: string;
	onSave: (item: ItemState) => void;
	onCancel: () => void;
}) {
	const [draft, setDraft] = useState<ItemState>(item);

	return (
		<div className="card">
			<div className="form-grid">
				<label>
					Area
					<select value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })}>
						{ALL_AREAS.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</select>
				</label>
				<label>
					Item type
					<select value={draft.itemType} onChange={(e) => setDraft({ ...draft, itemType: e.target.value })}>
						{ITEM_TYPES.map((t) => (
							<option key={t}>{t}</option>
						))}
					</select>
				</label>
				{draft.itemType === 'Window' && (
					<label>
						Size class
						<select value={draft.sizeClass} onChange={(e) => setDraft({ ...draft, sizeClass: e.target.value })}>
							{SIZE_CLASSES.map((s) => (
								<option key={s}>{s}</option>
							))}
						</select>
					</label>
				)}
				<label>
					Quantity
					<input
						type="number"
						className="field-numeric"
						value={draft.quantity}
						onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
					/>
				</label>
				<label>
					Condition
					<select value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value })}>
						{CONDITION_LEVELS.map((c) => (
							<option key={c}>{c}</option>
						))}
					</select>
				</label>
				<label>
					Access difficulty
					<select value={draft.accessDifficulty} onChange={(e) => setDraft({ ...draft, accessDifficulty: e.target.value })}>
						{ACCESS_LEVELS.map((a) => (
							<option key={a}>{a}</option>
						))}
					</select>
				</label>
			</div>
			{draft.itemType === 'Sliding Door' && (
				<span className="field-hint">Count an oversized/XL slider as 2.</span>
			)}

			<div className="checkbox-grid">
				<label>
					<input
						type="checkbox"
						checked={draft.exteriorIncluded}
						onChange={(e) => setDraft({ ...draft, exteriorIncluded: e.target.checked })}
					/>{' '}
					Exterior
				</label>
				<label>
					<input
						type="checkbox"
						checked={draft.interiorIncluded}
						onChange={(e) => setDraft({ ...draft, interiorIncluded: e.target.checked })}
					/>{' '}
					Interior
				</label>
				<label>
					<input
						type="checkbox"
						checked={draft.screenIncluded}
						onChange={(e) => setDraft({ ...draft, screenIncluded: e.target.checked })}
					/>{' '}
					Screens
				</label>
				<label>
					<input
						type="checkbox"
						checked={draft.trackIncluded}
						onChange={(e) => setDraft({ ...draft, trackIncluded: e.target.checked })}
					/>{' '}
					Tracks
				</label>
				<label>
					<input type="checkbox" checked={draft.hardWater} onChange={(e) => setDraft({ ...draft, hardWater: e.target.checked })} />{' '}
					Hard water
				</label>
				<label>
					<input
						type="checkbox"
						checked={draft.constructionDebris}
						onChange={(e) => setDraft({ ...draft, constructionDebris: e.target.checked })}
					/>{' '}
					Construction debris
				</label>
			</div>

			<label>
				Notes
				<textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
			</label>
			<button type="button" onClick={() => onSave(draft)}>
				Save item
			</button>{' '}
			<button type="button" onClick={onCancel}>
				Cancel
			</button>
		</div>
	);
}
