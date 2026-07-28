import { useEffect, useState } from 'react';
import {
	COMPONENT_CONDITIONS,
	EXTERIOR_ACCESS_LEVELS,
	INTERIOR_ACCESS_LEVELS,
	PRODUCTION_CLASSES,
	PRODUCTION_CLASS_HINTS,
	PROPERTY_MODIFIERS,
	RESTORATION_SERVICES,
	SCHEDULE_RECOMMENDATIONS,
	SIZE_CLASSES,
	STORIES,
} from '../lib/labor/types';

function newId(): string {
	return crypto.randomUUID();
}

function hours(minutes: number): string {
	return (minutes / 60).toFixed(1);
}

/** Radio pills, reusing the app's existing .segmented CSS. Used for every
 * short single-choice field in the wizard — one tap in the field beats a
 * select that opens a native picker sheet. */
function Segmented({
	label,
	name,
	value,
	options,
	onChange,
	hint,
	allowBlank,
}: {
	label: string;
	name: string;
	value: string;
	options: readonly string[];
	onChange: (value: string) => void;
	hint?: string;
	allowBlank?: boolean;
}) {
	return (
		<div>
			<p className="field-label">{label}</p>
			{hint && <span className="field-hint">{hint}</span>}
			<div className="segmented">
				{allowBlank && (
					<label>
						<input type="radio" name={name} value="" checked={value === ''} onChange={() => onChange('')} />
						Not set
					</label>
				)}
				{options.map((option) => (
					<label key={option}>
						<input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
						{option}
					</label>
				))}
			</div>
		</div>
	);
}

/** One grouped inventory row: a set of similar windows with a quantity.
 * Never one row per physical window. */
interface GroupState {
	id: string;
	quantity: string;
	productionClass: string;
	sizeClass: string;
	story: string;
	interiorAccess: string;
	exteriorAccess: string;
	panesPerUnit: string;
	screensPerUnit: string;
	tracksPerUnit: string;
	specialtyDescription: string;
	notes: string;
}

function emptyGroup(): GroupState {
	return {
		id: newId(),
		quantity: '1',
		productionClass: 'Standard Window',
		sizeClass: '',
		story: 'First',
		interiorAccess: 'Floor Level',
		exteriorAccess: 'Ground-Level Traditional',
		panesPerUnit: '',
		screensPerUnit: '',
		tracksPerUnit: '',
		specialtyDescription: '',
		notes: '',
	};
}

/** A restoration service or property-level modifier the operator selected,
 * with its own scope and its own minutes. */
interface AdjustmentState {
	id: string;
	kind: 'Restoration' | 'Modifier';
	label: string;
	affectedUnits: string;
	affectedPanes: string;
	additionalMinutes: string;
	notes: string;
}

function emptyAdjustment(kind: 'Restoration' | 'Modifier', label: string): AdjustmentState {
	return { id: newId(), kind, label, affectedUnits: '', affectedPanes: '', additionalMinutes: '', notes: '' };
}

interface WizardState {
	step: number; // 0 scope & property, 1 inventory, 2 condition, 3 review
	walkthroughDate: string;
	conductedBy: string;
	notes: string;

	// Scope — every component can be excluded independently.
	interiorIncluded: boolean;
	exteriorIncluded: boolean;
	screensIncluded: boolean;
	tracksIncluded: boolean;
	framesIncluded: boolean;

	// Permanent-ish reference the operator can confirm for this visit.
	storyCountObserved: string;
	ladderRequired: string;
	roofAccessRequired: string;
	waterFedPoleSuitable: boolean;
	exteriorAccessObstructed: boolean;
	furnitureMovementRequired: boolean;
	temporaryAccessNotes: string;

	groups: GroupState[];
	manualScreenTotal: string;
	manualTrackTotal: string;

	// One rating per component. Blank is legitimate — a component that isn't
	// in scope is never rated.
	interiorGlassCondition: string;
	trackCondition: string;
	exteriorGlassCondition: string;
	exteriorFrameCondition: string;
	screenCondition: string;
	conditionNotes: string;

	adjustments: AdjustmentState[];
	restorationNotes: string;

	scheduledHoursOverride: string;
	scheduleRecommendationOverride: string;
	ownerSelectedPrice: string;
	ownerOverrideReason: string;
}

function emptyState(): WizardState {
	return {
		step: 0,
		walkthroughDate: new Date().toISOString().slice(0, 10),
		conductedBy: '',
		notes: '',
		interiorIncluded: false,
		exteriorIncluded: true,
		screensIncluded: true,
		tracksIncluded: false,
		framesIncluded: true,
		storyCountObserved: '1',
		ladderRequired: '',
		roofAccessRequired: '',
		waterFedPoleSuitable: false,
		exteriorAccessObstructed: false,
		furnitureMovementRequired: false,
		temporaryAccessNotes: '',
		groups: [emptyGroup()],
		manualScreenTotal: '',
		manualTrackTotal: '',
		interiorGlassCondition: '',
		trackCondition: '',
		exteriorGlassCondition: 'Maintenance',
		exteriorFrameCondition: '',
		screenCondition: '',
		conditionNotes: '',
		adjustments: [],
		restorationNotes: '',
		scheduledHoursOverride: '',
		scheduleRecommendationOverride: '',
		ownerSelectedPrice: '',
		ownerOverrideReason: '',
	};
}

// v3: labor is now estimated from grouped window rows rather than
// whole-property counts, so a v2 draft carries a shape this form can't
// represent. Bumping the key retires those drafts instead of restoring one
// into a form that would silently drop most of it.
function draftKey(propertyId: string): string {
	return `sww-walkthrough-draft-v3-${propertyId}`;
}

interface LaborBreakdown {
	fixedOverhead: number;
	interiorGlass: number;
	exteriorGlass: number;
	exteriorFrames: number;
	screens: number;
	tracks: number;
	interiorAccess: number;
	exteriorAccess: number;
	storyLogistics: number;
	condition: number;
	restoration: number;
	propertyModifiers: number;
}

interface LaborPreview {
	estimate: {
		breakdown: LaborBreakdown;
		productiveMinutes: number;
		totals: { windowUnits: number; glassPanes: number; screens: number; tracks: number; screensManual: boolean; tracksManual: boolean };
		laborModelVersion: string;
		explanation: string;
		hazardousAccess: string[];
	};
	schedule: { scheduledMinutes: number; recommendation: string; reasons: string[] };
	band: { low: number; target: number; high: number; minimumApplied: boolean };
}

/** The order the breakdown reads in — overhead first, then the work, then
 * what made the work harder. */
const BREAKDOWN_ROWS: { key: keyof LaborBreakdown; label: string }[] = [
	{ key: 'fixedOverhead', label: 'Fixed job overhead' },
	{ key: 'interiorGlass', label: 'Interior glass' },
	{ key: 'exteriorGlass', label: 'Exterior glass' },
	{ key: 'exteriorFrames', label: 'Exterior frames and sills' },
	{ key: 'screens', label: 'Screens' },
	{ key: 'tracks', label: 'Tracks' },
	{ key: 'interiorAccess', label: 'Interior access' },
	{ key: 'exteriorAccess', label: 'Exterior access' },
	{ key: 'storyLogistics', label: 'Story logistics' },
	{ key: 'condition', label: 'Component condition' },
	{ key: 'restoration', label: 'Restoration' },
	{ key: 'propertyModifiers', label: 'Property modifiers' },
];

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
	const [preview, setPreview] = useState<LaborPreview | null>(null);
	const [loadingPreview, setLoadingPreview] = useState(false);
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

	function updateGroup(id: string, patch: Partial<GroupState>) {
		setState((s) => ({ ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
	}

	function addGroup() {
		setState((s) => ({ ...s, groups: [...s.groups, emptyGroup()] }));
	}

	/** Duplicate gets a fresh id — two rows that shared one would collide on
	 * save, and the second would overwrite the first. */
	function duplicateGroup(group: GroupState) {
		setState((s) => ({ ...s, groups: [...s.groups, { ...group, id: newId() }] }));
	}

	function removeGroup(id: string) {
		setState((s) => ({ ...s, groups: s.groups.filter((g) => g.id !== id) }));
	}

	function toggleAdjustment(kind: 'Restoration' | 'Modifier', label: string) {
		setState((s) => {
			const existing = s.adjustments.find((a) => a.kind === kind && a.label === label);
			return {
				...s,
				adjustments: existing
					? s.adjustments.filter((a) => a !== existing)
					: [...s.adjustments, emptyAdjustment(kind, label)],
			};
		});
	}

	function updateAdjustment(id: string, patch: Partial<AdjustmentState>) {
		setState((s) => ({ ...s, adjustments: s.adjustments.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
	}

	const scope = {
		interior: state.interiorIncluded,
		exterior: state.exteriorIncluded,
		screens: state.screensIncluded,
		tracks: state.tracksIncluded,
		frames: state.framesIncluded,
	};

	const conditions = {
		interiorGlass: state.interiorGlassCondition,
		track: state.trackCondition,
		exteriorGlass: state.exteriorGlassCondition,
		exteriorFrame: state.exteriorFrameCondition,
		screen: state.screenCondition,
	};

	function laborPayload() {
		return {
			propertyId,
			groups: state.groups,
			adjustments: state.adjustments,
			scope,
			conditions,
			manualScreenTotal: state.manualScreenTotal,
			manualTrackTotal: state.manualTrackTotal,
			scheduledMinutesOverride: state.scheduledHoursOverride
				? String(Number(state.scheduledHoursOverride) * 60)
				: '',
		};
	}

	// Fetched on demand rather than on every keystroke: each preview reads the
	// labor config, its profiles and the pricing config, and the Sheets API
	// allows 60 reads a minute.
	async function loadPreview(): Promise<LaborPreview | null> {
		setLoadingPreview(true);
		setSaveError(null);
		try {
			const res = await fetch('/api/walkthrough', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'preview-labor', ...laborPayload() }),
			});
			const body = (await res.json()) as { ok: boolean; error?: string } & LaborPreview;
			if (!body.ok) {
				setSaveError(body.error ?? 'Could not calculate the labor estimate.');
				return null;
			}
			const next: LaborPreview = { estimate: body.estimate, schedule: body.schedule, band: body.band };
			setPreview(next);
			// Seeded once, from the target. Never re-seeded on a later
			// recalculation — that would quietly discard a price the owner had
			// already decided on.
			setState((s) => (s.ownerSelectedPrice ? s : { ...s, ownerSelectedPrice: String(next.band.target) }));
			return next;
		} catch (e) {
			setSaveError((e as Error).message || 'Network error while calculating.');
			return null;
		} finally {
			setLoadingPreview(false);
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
					action: 'save-labor',
					id: newId(),
					clientId,
					opportunityId,
					walkthroughDate: state.walkthroughDate,
					conductedBy: state.conductedBy,
					notes: state.notes,
					conditionNotes: state.conditionNotes,
					restorationNotes: state.restorationNotes,
					temporaryAccessNotes: state.temporaryAccessNotes,
					storyCountObserved: state.storyCountObserved,
					ladderRequired: state.ladderRequired,
					roofAccessRequired: state.roofAccessRequired,
					waterFedPoleSuitable: state.waterFedPoleSuitable,
					exteriorAccessObstructed: state.exteriorAccessObstructed,
					furnitureMovementRequired: state.furnitureMovementRequired,
					ownerSelectedPrice: state.ownerSelectedPrice,
					ownerOverrideReason: state.ownerOverrideReason,
					scheduleRecommendationOverride: state.scheduleRecommendationOverride,
					...laborPayload(),
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

	function startOver() {
		window.localStorage.removeItem(draftKey(propertyId));
		setState(emptyState());
		setSaveResult(null);
		setSaveError(null);
		setPreview(null);
	}

	if (saveResult) {
		const band = saveResult.band as { low: number; target: number; high: number } | undefined;
		return (
			<div className="card">
				<h2>Walkthrough saved</h2>
				<p>
					{hours(Number(saveResult.productiveMinutes))} productive hours ·{' '}
					{hours(Number(saveResult.scheduledMinutes))} scheduled · {String(saveResult.scheduleRecommendation)}
				</p>
				{band && (
					<p>
						Suggested ${band.low} – ${band.high} (target <strong>${band.target}</strong>)
						{state.ownerSelectedPrice && ` · your price $${state.ownerSelectedPrice}`}
					</p>
				)}
				<p>
					<a href={`/properties/${propertyId}`}>View property</a>
				</p>
				{saveError && <p role="alert">{saveError}</p>}
				<div className="button-row">
					<button type="button" disabled={creatingQuote} onClick={() => createQuote(String(saveResult.walkthroughId))}>
						{creatingQuote ? 'Creating…' : 'Create quote from this walkthrough'}
					</button>
					<button type="button" className="btn-secondary" onClick={startOver}>
						Start another walkthrough
					</button>
				</div>
			</div>
		);
	}

	const groupedUnits = state.groups.reduce((sum, g) => sum + (Number(g.quantity) || 0), 0);
	const specialtyMissingDescription = state.groups.some(
		(g) => g.productionClass === 'Specialty Shape' && !g.specialtyDescription.trim()
	);
	const inventoryValid = state.groups.length > 0 && groupedUnits > 0 && !specialtyMissingDescription;

	const STEP_TITLES = ['Scope & Property', 'Window Inventory', 'Condition & Special Work', 'Review, Labor & Price'];

	return (
		<div>
			<p>
				Step {state.step + 1} of 4 — {STEP_TITLES[state.step]}
			</p>

			{state.step === 0 && (
				<section className="card">
					<h2>Scope &amp; Property</h2>

					{propertyReference && (
						<div className="card" style={{ background: 'var(--color-cream)' }}>
							<p className="field-label">Property reference</p>
							<ul style={{ margin: 0 }}>
								<li>{propertyReference.totalWindowUnits || '0'} window units on record</li>
								<li>{propertyReference.totalGlassPanes || '0'} panes on record</li>
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
								From the property record — reference only. This walkthrough records its own counts and never changes the
								property.
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
					</div>

					<p className="field-label">What&apos;s included</p>
					<span className="field-hint">
						Only what&apos;s checked is estimated or asked about later. Excluded components are never rated and never
						charged.
					</span>
					<div className="checkbox-grid">
						<label>
							<input type="checkbox" checked={state.exteriorIncluded} onChange={(e) => update({ exteriorIncluded: e.target.checked })} />{' '}
							Exterior glass
						</label>
						<label>
							<input type="checkbox" checked={state.interiorIncluded} onChange={(e) => update({ interiorIncluded: e.target.checked })} />{' '}
							Interior glass
						</label>
						<label>
							<input type="checkbox" checked={state.framesIncluded} onChange={(e) => update({ framesIncluded: e.target.checked })} />{' '}
							Exterior frames and sills
						</label>
						<label>
							<input type="checkbox" checked={state.screensIncluded} onChange={(e) => update({ screensIncluded: e.target.checked })} />{' '}
							Screens
						</label>
						<label>
							<input type="checkbox" checked={state.tracksIncluded} onChange={(e) => update({ tracksIncluded: e.target.checked })} />{' '}
							Tracks
						</label>
					</div>

					<div className="form-grid">
						<label>
							Stories observed
							<input
								type="number"
								min="1"
								value={state.storyCountObserved}
								onChange={(e) => update({ storyCountObserved: e.target.value })}
							/>
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
							Furniture or belongings need moving
						</label>
					</div>

					<label>
						Temporary access notes
						<span className="field-hint">Parking, gates, safety concerns — anything about getting set up for this visit.</span>
						<textarea value={state.temporaryAccessNotes} onChange={(e) => update({ temporaryAccessNotes: e.target.value })} />
					</label>

					<button type="button" onClick={() => goTo(1)}>
						Next: Window Inventory
					</button>
				</section>
			)}

			{state.step === 1 && (
				<section className="card">
					<div className="card-header-row">
						<h2>Window Inventory</h2>
						<span className="field-hint">{groupedUnits} units in {state.groups.length} group(s)</span>
					</div>
					<p className="field-hint">
						Group similar windows together and give each group a quantity — eight standard casements upstairs is one row,
						not eight. Access is chosen per group, because that&apos;s what actually changes how long the work takes.
					</p>

					{state.groups.map((group, index) => (
						<div key={group.id} className="card">
							<div className="card-header-row">
								<h3>Group {index + 1}</h3>
								<div className="button-row">
									<button type="button" className="btn-secondary" onClick={() => duplicateGroup(group)}>
										Duplicate
									</button>
									<button
										type="button"
										className="btn-secondary"
										onClick={() => removeGroup(group.id)}
										disabled={state.groups.length === 1}
									>
										Remove
									</button>
								</div>
							</div>

							<div className="form-grid">
								<label>
									Quantity
									<input
										type="number"
										min="1"
										value={group.quantity}
										onChange={(e) => updateGroup(group.id, { quantity: e.target.value })}
									/>
								</label>
								<label>
									Production class
									<select
										value={group.productionClass}
										onChange={(e) => updateGroup(group.id, { productionClass: e.target.value })}
									>
										{PRODUCTION_CLASSES.map((c) => (
											<option key={c}>{c}</option>
										))}
									</select>
									<span className="field-hint">
										{PRODUCTION_CLASS_HINTS[group.productionClass as keyof typeof PRODUCTION_CLASS_HINTS]}
									</span>
								</label>
								<label>
									Story
									<select value={group.story} onChange={(e) => updateGroup(group.id, { story: e.target.value })}>
										{STORIES.map((s) => (
											<option key={s}>{s}</option>
										))}
									</select>
								</label>
							</div>

							<Segmented
								label="Size"
								name={`size-${group.id}`}
								value={group.sizeClass}
								options={SIZE_CLASSES}
								allowBlank
								hint="Leave unset unless this group is meaningfully bigger or smaller than typical for its class."
								onChange={(v) => updateGroup(group.id, { sizeClass: v })}
							/>

							{state.interiorIncluded && (
								<Segmented
									label="Interior access"
									name={`int-access-${group.id}`}
									value={group.interiorAccess}
									options={INTERIOR_ACCESS_LEVELS}
									onChange={(v) => updateGroup(group.id, { interiorAccess: v })}
								/>
							)}
							{state.exteriorIncluded && (
								<Segmented
									label="Exterior access"
									name={`ext-access-${group.id}`}
									value={group.exteriorAccess}
									options={EXTERIOR_ACCESS_LEVELS}
									onChange={(v) => updateGroup(group.id, { exteriorAccess: v })}
								/>
							)}

							{group.productionClass === 'Specialty Shape' && (
								<label>
									Specialty description
									<span className="field-hint">Required — describe the shape so this doesn&apos;t become a new category.</span>
									<input
										type="text"
										value={group.specialtyDescription}
										onChange={(e) => updateGroup(group.id, { specialtyDescription: e.target.value })}
									/>
								</label>
							)}

							<details>
								<summary>Per-unit counts and notes</summary>
								<span className="field-hint">
									All optional. Blank means the typical amount for this class — never a zero.
								</span>
								<div className="count-grid">
									<label>
										Panes per unit
										<input
											type="number"
											min="0"
											value={group.panesPerUnit}
											onChange={(e) => updateGroup(group.id, { panesPerUnit: e.target.value })}
										/>
									</label>
									<label>
										Screens per unit
										<input
											type="number"
											min="0"
											value={group.screensPerUnit}
											onChange={(e) => updateGroup(group.id, { screensPerUnit: e.target.value })}
										/>
									</label>
									<label>
										Tracks per unit
										<input
											type="number"
											min="0"
											value={group.tracksPerUnit}
											onChange={(e) => updateGroup(group.id, { tracksPerUnit: e.target.value })}
										/>
									</label>
								</div>
								<label>
									Notes
									<input type="text" value={group.notes} onChange={(e) => updateGroup(group.id, { notes: e.target.value })} />
								</label>
							</details>
						</div>
					))}

					<button type="button" className="btn-secondary" onClick={addGroup}>
						+ Add window group
					</button>

					<h3>Totals</h3>
					{preview ? (
						<div className="stats-grid">
							<div>
								<strong>{preview.estimate.totals.windowUnits}</strong>
								<span className="field-hint">window units</span>
							</div>
							<div>
								<strong>{preview.estimate.totals.glassPanes}</strong>
								<span className="field-hint">glass panes</span>
							</div>
							<div>
								<strong>{preview.estimate.totals.screens}</strong>
								<span className="field-hint">
									screens{preview.estimate.totals.screensManual ? ' — manual' : ' — calculated'}
								</span>
							</div>
							<div>
								<strong>{preview.estimate.totals.tracks}</strong>
								<span className="field-hint">
									tracks{preview.estimate.totals.tracksManual ? ' — manual' : ' — calculated'}
								</span>
							</div>
						</div>
					) : (
						<p className="field-hint">
							{groupedUnits} window units entered. Panes, screens and tracks are calculated from the groups — update
							totals to see them.
						</p>
					)}

					<details>
						<summary>Override screen or track totals</summary>
						<span className="field-hint">
							Use when the grouped totals don&apos;t match reality. A value here wins over the calculation and is labelled
							as manual — it&apos;s never silently merged.
						</span>
						<div className="pane-grid">
							<label>
								Total screens (manual)
								<input
									type="number"
									min="0"
									value={state.manualScreenTotal}
									onChange={(e) => update({ manualScreenTotal: e.target.value })}
								/>
							</label>
							<label>
								Total tracks (manual)
								<input
									type="number"
									min="0"
									value={state.manualTrackTotal}
									onChange={(e) => update({ manualTrackTotal: e.target.value })}
								/>
							</label>
						</div>
					</details>

					{specialtyMissingDescription && (
						<p role="alert" className="field-hint">
							Every Specialty Shape group needs a description before you can continue.
						</p>
					)}
					{saveError && <p role="alert">{saveError}</p>}

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(0)}>
							Back
						</button>
						<button type="button" className="btn-secondary" disabled={loadingPreview || !inventoryValid} onClick={loadPreview}>
							{loadingPreview ? 'Calculating…' : 'Update totals'}
						</button>
						<button type="button" disabled={!inventoryValid} onClick={() => goTo(2)}>
							Next: Condition
						</button>
					</div>
				</section>
			)}

			{state.step === 2 && (
				<section className="card">
					<h2>Condition &amp; Special Work</h2>
					<p className="field-hint">
						Rate each component separately. A rating only affects its own labor — moderate frames cost frame time, they
						don&apos;t make the glass take longer.
					</p>

					{state.interiorIncluded && (
						<Segmented
							label="Interior glass"
							name="interiorGlassCondition"
							value={state.interiorGlassCondition}
							options={COMPONENT_CONDITIONS}
							allowBlank
							onChange={(v) => update({ interiorGlassCondition: v })}
						/>
					)}
					{state.tracksIncluded && (
						<Segmented
							label="Tracks"
							name="trackCondition"
							value={state.trackCondition}
							options={COMPONENT_CONDITIONS}
							allowBlank
							onChange={(v) => update({ trackCondition: v })}
						/>
					)}
					{state.exteriorIncluded && (
						<Segmented
							label="Exterior glass"
							name="exteriorGlassCondition"
							value={state.exteriorGlassCondition}
							options={COMPONENT_CONDITIONS}
							allowBlank
							onChange={(v) => update({ exteriorGlassCondition: v })}
						/>
					)}
					{state.exteriorIncluded && state.framesIncluded && (
						<Segmented
							label="Frames and exterior sills"
							name="exteriorFrameCondition"
							value={state.exteriorFrameCondition}
							options={COMPONENT_CONDITIONS}
							allowBlank
							onChange={(v) => update({ exteriorFrameCondition: v })}
						/>
					)}
					{state.screensIncluded && (
						<Segmented
							label="Screens"
							name="screenCondition"
							value={state.screenCondition}
							options={COMPONENT_CONDITIONS}
							allowBlank
							onChange={(v) => update({ screenCondition: v })}
						/>
					)}

					<label>
						Condition notes
						<textarea value={state.conditionNotes} onChange={(e) => update({ conditionNotes: e.target.value })} />
					</label>

					<AdjustmentPicker
						title="Restoration services required"
						hint="Specialized work beyond a standard window cleaning. Restoration labor is calculated separately and does not replace the component condition ratings above."
						kind="Restoration"
						options={RESTORATION_SERVICES}
						adjustments={state.adjustments}
						onToggle={toggleAdjustment}
						onUpdate={updateAdjustment}
					/>
					<label>
						Restoration notes
						<textarea value={state.restorationNotes} onChange={(e) => update({ restorationNotes: e.target.value })} />
					</label>

					<AdjustmentPicker
						title="Property-level factors"
						hint="Whole-property labor that isn't attributable to any one window group. Don't add anything here that's already covered by ordinary setup and breakdown."
						kind="Modifier"
						options={PROPERTY_MODIFIERS}
						adjustments={state.adjustments}
						onToggle={toggleAdjustment}
						onUpdate={updateAdjustment}
					/>

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(1)}>
							Back
						</button>
						<button
							type="button"
							disabled={loadingPreview}
							onClick={async () => {
								await loadPreview();
								goTo(3);
							}}
						>
							{loadingPreview ? 'Calculating…' : 'Next: Review & Price'}
						</button>
					</div>
				</section>
			)}

			{state.step === 3 && (
				<section className="card">
					<h2>Review, Labor &amp; Price</h2>

					{!preview ? (
						<p>No estimate calculated yet.</p>
					) : (
						<>
							<div className="stats-grid">
								<div>
									<strong>{hours(preview.estimate.productiveMinutes)} h</strong>
									<span className="field-hint">estimated productive labor</span>
								</div>
								<div>
									<strong>{hours(preview.schedule.scheduledMinutes)} h</strong>
									<span className="field-hint">suggested scheduled time</span>
								</div>
								<div>
									<strong>{preview.schedule.recommendation}</strong>
									<span className="field-hint">schedule recommendation</span>
								</div>
							</div>

							<p>{preview.estimate.explanation}</p>

							<details open>
								<summary>Labor breakdown</summary>
								<table>
									<tbody>
										{BREAKDOWN_ROWS.filter((row) => preview.estimate.breakdown[row.key] > 0).map((row) => (
											<tr key={row.key}>
												<td>{row.label}</td>
												<td>{hours(preview.estimate.breakdown[row.key])} h</td>
											</tr>
										))}
										<tr>
											<td>
												<strong>Total productive labor</strong>
											</td>
											<td>
												<strong>{hours(preview.estimate.productiveMinutes)} h</strong>
											</td>
										</tr>
										<tr>
											<td>Suggested scheduled time</td>
											<td>{hours(preview.schedule.scheduledMinutes)} h</td>
										</tr>
									</tbody>
								</table>
								{preview.schedule.reasons.length > 0 && (
									<ul>
										{preview.schedule.reasons.map((reason) => (
											<li key={reason} className="field-hint">
												{reason}
											</li>
										))}
									</ul>
								)}
							</details>

							<div className="pane-grid">
								<label>
									Scheduled hours (override)
									<span className="field-hint">Changes the time you block out. Never changes the estimate above.</span>
									<input
										type="number"
										min="0"
										step="0.25"
										value={state.scheduledHoursOverride}
										onChange={(e) => update({ scheduledHoursOverride: e.target.value })}
									/>
								</label>
								<label>
									Schedule
									<select
										value={state.scheduleRecommendationOverride}
										onChange={(e) => update({ scheduleRecommendationOverride: e.target.value })}
									>
										<option value="">Use recommendation ({preview.schedule.recommendation})</option>
										{SCHEDULE_RECOMMENDATIONS.map((r) => (
											<option key={r}>{r}</option>
										))}
									</select>
								</label>
							</div>

							<h3>Price</h3>
							<div className="stats-grid">
								<div>
									<strong>${preview.band.low}</strong>
									<span className="field-hint">low</span>
								</div>
								<div>
									<strong>${preview.band.target}</strong>
									<span className="field-hint">target</span>
								</div>
								<div>
									<strong>${preview.band.high}</strong>
									<span className="field-hint">high</span>
								</div>
							</div>
							{preview.band.minimumApplied && <p className="field-hint">The job minimum lifted this band.</p>}

							<div className="pane-grid">
								<label>
									Your price
									<input
										type="number"
										min="0"
										value={state.ownerSelectedPrice}
										onChange={(e) => update({ ownerSelectedPrice: e.target.value })}
									/>
								</label>
								<label>
									Reason (optional)
									<span className="field-hint">Worth a note when your price sits well outside the suggested band.</span>
									<input
										type="text"
										value={state.ownerOverrideReason}
										onChange={(e) => update({ ownerOverrideReason: e.target.value })}
									/>
								</label>
							</div>

							<p className="field-hint">Labor model: {preview.estimate.laborModelVersion}</p>
						</>
					)}

					<label>
						General notes
						<textarea value={state.notes} onChange={(e) => update({ notes: e.target.value })} />
					</label>

					{saveError && <p role="alert">{saveError}</p>}
					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(2)}>
							Back
						</button>
						<button type="button" className="btn-secondary" disabled={loadingPreview} onClick={loadPreview}>
							{loadingPreview ? 'Calculating…' : 'Recalculate'}
						</button>
						<button type="button" disabled={saving || !preview} onClick={save}>
							{saving ? 'Saving…' : 'Save walkthrough'}
						</button>
					</div>
				</section>
			)}
		</div>
	);
}

/**
 * A checkbox list where checking an item reveals its own scope and minutes.
 *
 * Restoration and property modifiers share this because they are the same
 * shape — a named extra with its own affected counts and its own time. The
 * minutes field stays empty until the operator fills it in: no configuration
 * can know how bad the overspray is until someone looks at it, and a default
 * would be a guess presented as a calculation.
 */
function AdjustmentPicker({
	title,
	hint,
	kind,
	options,
	adjustments,
	onToggle,
	onUpdate,
}: {
	title: string;
	hint: string;
	kind: 'Restoration' | 'Modifier';
	options: readonly string[];
	adjustments: AdjustmentState[];
	onToggle: (kind: 'Restoration' | 'Modifier', label: string) => void;
	onUpdate: (id: string, patch: Partial<AdjustmentState>) => void;
}) {
	const selected = adjustments.filter((a) => a.kind === kind);

	return (
		<div className="card" style={{ background: 'var(--color-cream)' }}>
			<h3>{title}</h3>
			<span className="field-hint">{hint}</span>
			<div className="checkbox-grid">
				{options.map((option) => (
					<label key={option}>
						<input
							type="checkbox"
							checked={selected.some((a) => a.label === option)}
							onChange={() => onToggle(kind, option)}
						/>{' '}
						{option}
					</label>
				))}
			</div>

			{selected.map((adjustment) => (
				<div key={adjustment.id} className="card">
					<p className="field-label">{adjustment.label}</p>
					<div className="count-grid">
						{kind === 'Restoration' && (
							<>
								<label>
									Affected units
									<input
										type="number"
										min="0"
										value={adjustment.affectedUnits}
										onChange={(e) => onUpdate(adjustment.id, { affectedUnits: e.target.value })}
									/>
								</label>
								<label>
									Affected panes
									<input
										type="number"
										min="0"
										value={adjustment.affectedPanes}
										onChange={(e) => onUpdate(adjustment.id, { affectedPanes: e.target.value })}
									/>
								</label>
							</>
						)}
						<label>
							Added minutes
							<input
								type="number"
								min="0"
								value={adjustment.additionalMinutes}
								onChange={(e) => onUpdate(adjustment.id, { additionalMinutes: e.target.value })}
							/>
						</label>
					</div>
					<label>
						Notes
						<input
							type="text"
							value={adjustment.notes}
							onChange={(e) => onUpdate(adjustment.id, { notes: e.target.value })}
						/>
					</label>
				</div>
			))}
		</div>
	);
}
