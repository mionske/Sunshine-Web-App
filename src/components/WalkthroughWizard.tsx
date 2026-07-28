import { useEffect, useState } from 'react';
import {
	COMPONENT_CONDITIONS,
	EXTERIOR_ACCESS_LEVELS,
	INTERIOR_ACCESS_LEVELS,
	COMPONENT_EXCEPTION_LEVELS,
	COMPONENT_EXCEPTION_TO_CONDITION,
	PROPERTY_MODIFIERS,
	RESTORATION_ISSUES,
	SCHEDULE_RECOMMENDATIONS,
	SEVERITY_LEVELS,
	SPECIAL_ITEM_LABELS,
	SPECIAL_ITEM_STORIES,
	SPECIAL_ITEM_STORY_LABELS,
	SPECIAL_ITEM_TYPES,
	STANDARD_FLOORS,
	STANDARD_FLOOR_LABELS,
	specialItemUnitLabel,
	type ComponentCondition,
	type ComponentException,
	type SpecialItemType,
	type StandardFloor,
} from '../lib/labor/types';
import { estimateInventoryLabor } from '../lib/labor/inventoryEstimate';
import type { LaborBreakdown } from '../lib/labor/estimate';
import { adjustmentMinutes } from '../lib/labor/adjustments';
import { suggestSchedule } from '../lib/labor/schedule';
import { suggestPriceBand } from '../lib/labor/price';
import type { LaborModel } from '../lib/labor/config';
import type { PricingConfig } from '../lib/models/pricingConfig';
import {
	EMPTY_INVENTORY_MESSAGE,
	hasAnyInventory,
	inventoryTotals,
	specialItemError,
	toInventory,
} from '../lib/labor/inventory';

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

/** One unusual window or door. Ordinary windows never get a row — they are
 * four counts, one per floor. */
interface SpecialItemState {
	id: string;
	type: string;
	quantity: string;
	story: string;
	notes: string;
}

/** Blank on purpose. A freshly added row is in progress, not in error, and
 * has to be removable without ever having shown a complaint. */
function emptySpecialItem(): SpecialItemState {
	return { id: newId(), type: '', quantity: '', story: '', notes: '' };
}

/** A restoration service or property-level modifier the operator selected,
 * with its own scope and its own minutes. */
interface AdjustmentState {
	id: string;
	kind: 'Restoration' | 'Modifier';
	label: string;
	affectedPanes: string;
	severity: string;
	notes: string;
}

/** Blank panes and severity on purpose. A freshly checked issue hasn't been
 * described yet, and defaulting the severity would put a price on something
 * nobody looked at. */
function emptyAdjustment(kind: 'Restoration' | 'Modifier', label: string): AdjustmentState {
	return { id: newId(), kind, label, affectedPanes: '', severity: '', notes: '' };
}

/** A restoration issue that's checked but not yet described costs nothing —
 * which is right, but worth saying out loud so it isn't mistaken for priced. */
function restorationIncomplete(adjustment: AdjustmentState): boolean {
	return adjustment.kind === 'Restoration' && (!adjustment.severity || !(Number(adjustment.affectedPanes) > 0));
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

	// Simplified inventory. Standard windows per floor, then only the
	// openings that are genuinely unusual.
	standardWindows: Record<StandardFloor, string>;
	specialItems: SpecialItemState[];
	totalGlassPanes: string;
	screens: string;
	tracks: string;
	solarPanels: string;

	// One access selection each for the whole property. This used to be asked
	// per window group, which is most of what made the old inventory step too
	// slow to finish in the field.
	interiorAccess: string;
	exteriorAccess: string;

	// One glass rating for the property, because that's how it almost always
	// is. The two split apart only when the operator says they differ — until
	// then both sides read from `overallCondition`, so there is exactly one
	// number to keep right.
	overallCondition: string;
	conditionsDiffer: boolean;
	interiorGlassCondition: string;
	exteriorGlassCondition: string;

	// Frames, screens and tracks are exceptions rather than ratings: either
	// ordinary, or costing extra. See COMPONENT_EXCEPTION_LEVELS.
	frameException: string;
	screenException: string;
	trackException: string;
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
		standardWindows: { first: '', second: '', third: '', fourthPlus: '' },
		specialItems: [],
		totalGlassPanes: '',
		screens: '',
		tracks: '',
		solarPanels: '',
		interiorAccess: '',
		exteriorAccess: '',
		overallCondition: 'Maintenance',
		conditionsDiffer: false,
		interiorGlassCondition: 'Maintenance',
		exteriorGlassCondition: 'Maintenance',
		frameException: 'Normal',
		screenException: 'Normal',
		trackException: 'Normal',
		conditionNotes: '',
		adjustments: [],
		restorationNotes: '',
		scheduledHoursOverride: '',
		scheduleRecommendationOverride: '',
		ownerSelectedPrice: '',
		ownerOverrideReason: '',
	};
}

// Bumped on every change to WizardState's shape. A stale draft restored into
// a form that can't represent it looks like a saved walkthrough while
// silently dropping most of what it held — retiring the draft is the honest
// failure. v5 reshapes condition into one overall rating plus exceptions.
function draftKey(propertyId: string): string {
	return `sww-walkthrough-draft-v5-${propertyId}`;
}

/** The recommendation in the words someone would actually use for it. The
 * underlying value is unchanged — this is only how it reads. */
function scheduleHeadline(recommendation: string): string {
	switch (recommendation) {
		case 'One-Day Job':
			return 'One full day';
		case 'Two-Day Job':
			return 'Two-day project';
		case 'Crew Recommended':
			return 'Too big for one person — bring a crew';
		default:
			return 'Your call';
	}
}

/** How a two-day job splits. Exterior first: it's the half that depends on
 * the weather, and finishing inside on day two means the glass isn't
 * re-dirtied by the outside work. Only offered when both sides are in scope —
 * an exterior-only job spread over two days splits by area, not by side, and
 * this screen has no way to know where. */
function scheduleSplit(recommendation: string, scope: { interior: boolean; exterior: boolean }): string[] {
	if (recommendation !== 'Two-Day Job') return [];
	if (!scope.interior || !scope.exterior) return ['Split across two days — the areas are yours to choose.'];
	return ['Day 1: Exterior', 'Day 2: Interior'];
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
	laborModel,
	pricingConfig,
}: {
	clientId: string;
	propertyId: string;
	opportunityId?: string;
	propertyReference?: PropertyReference;
	laborModel: LaborModel;
	pricingConfig: PricingConfig;
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

	function setFloor(floor: StandardFloor, value: string) {
		setState((s) => ({ ...s, standardWindows: { ...s.standardWindows, [floor]: value } }));
	}

	function updateSpecialItem(id: string, patch: Partial<SpecialItemState>) {
		setState((s) => ({ ...s, specialItems: s.specialItems.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
	}

	function addSpecialItem() {
		setState((s) => ({ ...s, specialItems: [...s.specialItems, emptySpecialItem()] }));
	}

	function removeSpecialItem(id: string) {
		setState((s) => ({ ...s, specialItems: s.specialItems.filter((i) => i.id !== id) }));
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

	// The component exceptions map onto the existing condition factors, so the
	// same multiplier does the same job it always did and no new configuration
	// is needed for them.
	const exception = (value: string) => COMPONENT_EXCEPTION_TO_CONDITION[value as ComponentException] ?? 'Maintenance';
	const glass = (v: string) => v as ComponentCondition;
	const conditions = {
		interiorGlass: glass(state.conditionsDiffer ? state.interiorGlassCondition : state.overallCondition),
		exteriorGlass: glass(state.conditionsDiffer ? state.exteriorGlassCondition : state.overallCondition),
		exteriorFrame: exception(state.frameException),
		screen: exception(state.screenException),
		track: exception(state.trackException),
	};

	const inventory = {
		standardWindowsByStory: state.standardWindows,
		specialItems: state.specialItems,
		totalGlassPanes: state.totalGlassPanes,
		screens: state.screens,
		tracks: state.tracks,
		solarPanels: state.solarPanels,
	};

	// Everything on the review screen, recomputed on every render.
	//
	// The three functions below are the same pure ones the server calls on
	// save, given the same labor model, so what the operator reads here is
	// what gets stored — there is no second implementation to drift. And
	// because none of it touches the network, the estimate can simply always
	// be current instead of waiting behind a button.
	const estimate = estimateInventoryLabor(laborModel, {
		inventory: toInventory(inventory),
		scope,
		conditions,
		access: { interior: state.interiorAccess as never, exterior: state.exteriorAccess as never },
		adjustments: state.adjustments.map((a) => ({
			kind: a.kind,
			label: a.label,
			additionalMinutes: adjustmentMinutes(laborModel, a),
		})),
	});
	const schedule = suggestSchedule(laborModel, estimate.productiveMinutes, {
		hazardousAccess: estimate.hazardousAccess,
		overrideMinutes: state.scheduledHoursOverride ? Number(state.scheduledHoursOverride) * 60 : undefined,
	});
	const band = suggestPriceBand(pricingConfig, estimate.productiveMinutes);

	// Only the adjustments that actually cost something. A checked restoration
	// issue with no pane count yet is real to the operator but worth nothing
	// to the estimate, and listing it at 0.0 h reads like a bug.
	const selectedAdjustments = state.adjustments.filter((a) => adjustmentMinutes(laborModel, a) > 0);

	const productiveHours = estimate.productiveMinutes / 60;
	const scheduledHours = schedule.scheduledMinutes / 60;
	const price = Number(state.ownerSelectedPrice) || band.target;
	const perProductiveHour = productiveHours > 0 ? Math.round(price / productiveHours) : 0;
	const perScheduledHour = scheduledHours > 0 ? Math.round(price / scheduledHours) : 0;

	function laborPayload() {
		return {
			propertyId,
			inventory,
			access: { interior: state.interiorAccess, exterior: state.exteriorAccess },
			adjustments: state.adjustments,
			scope,
			conditions,
			scheduledMinutesOverride: state.scheduledHoursOverride
				? String(Number(state.scheduledHoursOverride) * 60)
				: '',
		};
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

	// Totals are computed here, on every keystroke, from the same coercion the
	// server uses. There is no "update totals" button: a number the operator
	// has to ask for is a number they'll stop trusting.
	const totals = inventoryTotals(toInventory(inventory));
	const itemErrors = new Map(
		state.specialItems.map((item) => [
			item.id,
			specialItemError({
				id: item.id,
				type: item.type as SpecialItemType,
				quantity: Number(item.quantity) || 0,
				story: item.story as never,
			}),
		])
	);
	const inventoryValid = hasAnyInventory(toInventory(inventory)) && [...itemErrors.values()].every((e) => e === null);

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
								inputMode="numeric"
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

					{/* One selection each for the whole property. Asked here rather
					    than per window: a walkthrough that has to rate every opening
					    doesn't get finished in the field. Height is charged
					    separately, per occupied floor — being upstairs is not by
					    itself difficult access. */}
					{state.exteriorIncluded && (
						<Segmented
							label="Exterior access"
							name="exterior-access"
							value={state.exteriorAccess}
							options={EXTERIOR_ACCESS_LEVELS}
							allowBlank
							hint="How you'll reach the exterior glass across this property. Leave unset if it's ordinary ground-level work."
							onChange={(v) => update({ exteriorAccess: v })}
						/>
					)}
					{state.interiorIncluded && (
						<Segmented
							label="Interior access"
							name="interior-access"
							value={state.interiorAccess}
							options={INTERIOR_ACCESS_LEVELS}
							allowBlank
							hint="How you'll reach the interior glass. Leave unset if everything is reachable from the floor."
							onChange={(v) => update({ interiorAccess: v })}
						/>
					)}

					<button type="button" onClick={() => goTo(1)}>
						Next: Window Inventory
					</button>
				</section>
			)}

			{state.step === 1 && (
				<section className="card">
					<div className="card-header-row">
						<h2>Window Inventory</h2>
						<span className="field-hint">
							{totals.totalWindowUnits} units · {totals.totalGlassPanes} panes
						</span>
					</div>
					<p className="field-hint">
						Count ordinary windows by floor. Only describe an opening individually when it&apos;s genuinely unusual —
						everything else is assumed standard.
					</p>

					<h3>Standard windows</h3>
					<p className="field-hint">
						By floor. The floor is asked because it changes the trip, not the window — a standard window costs the same
						wherever it is. Leave a floor blank if there are none.
					</p>
					<div className="count-grid">
						{STANDARD_FLOORS.map((floor) => (
							<label key={floor}>
								{STANDARD_FLOOR_LABELS[floor]}
								<input
									type="number"
									inputMode="numeric"
									min="0"
									value={state.standardWindows[floor]}
									onChange={(e) => setFloor(floor, e.target.value)}
								/>
							</label>
						))}
					</div>

					<h3>Special windows &amp; doors</h3>
					<p className="field-hint">
						Skip this entirely if there aren&apos;t any. Divided-light rows are counted in <strong>panes</strong>;
						everything else in units.
					</p>

					{state.specialItems.map((item, index) => {
						const error = itemErrors.get(item.id);
						return (
							<div key={item.id} className="card">
								<div className="card-header-row">
									<h4>Item {index + 1}</h4>
									<button type="button" className="btn-secondary" onClick={() => removeSpecialItem(item.id)}>
										Remove
									</button>
								</div>
								<div className="form-grid">
									<label>
										Type
										<select value={item.type} onChange={(e) => updateSpecialItem(item.id, { type: e.target.value })}>
											<option value="">Choose…</option>
											{SPECIAL_ITEM_TYPES.map((type) => (
												<option key={type} value={type}>
													{SPECIAL_ITEM_LABELS[type]}
												</option>
											))}
										</select>
									</label>
									<label>
										{item.type ? `Quantity (${specialItemUnitLabel(item.type as SpecialItemType)})` : 'Quantity'}
										<input
											type="number"
											inputMode="numeric"
											min="1"
											value={item.quantity}
											onChange={(e) => updateSpecialItem(item.id, { quantity: e.target.value })}
										/>
									</label>
									<label>
										Story
										<select value={item.story} onChange={(e) => updateSpecialItem(item.id, { story: e.target.value })}>
											<option value="">Choose…</option>
											{SPECIAL_ITEM_STORIES.map((story) => (
												<option key={story} value={story}>
													{SPECIAL_ITEM_STORY_LABELS[story]}
												</option>
											))}
										</select>
									</label>
								</div>
								<label>
									Notes
									<span className="field-hint">Optional.</span>
									<input type="text" value={item.notes} onChange={(e) => updateSpecialItem(item.id, { notes: e.target.value })} />
								</label>
								{error && <p role="alert">{error}</p>}
							</div>
						);
					})}

					<button type="button" className="btn-secondary" onClick={addSpecialItem}>
						+ Add special item
					</button>

					<h3>Total glass panes</h3>
					<p className="field-hint">
						Counted directly, not worked out from the windows above. It measures a different thing — panes are an
						objective count of glass, units are a judgment about work — so the two are never reconciled against each
						other and a mismatch is never an error.
					</p>
					<label>
						Total glass panes
						<input
							type="number"
							inputMode="numeric"
							min="0"
							value={state.totalGlassPanes}
							onChange={(e) => update({ totalGlassPanes: e.target.value })}
						/>
					</label>

					<h3>Accessories</h3>
					<p className="field-hint">Counted directly too. Leave blank if not applicable.</p>
					<div className="count-grid">
						<label>
							Screens
							<input
								type="number"
								inputMode="numeric"
								min="0"
								value={state.screens}
								onChange={(e) => update({ screens: e.target.value })}
							/>
						</label>
						<label>
							Tracks
							<input
								type="number"
								inputMode="numeric"
								min="0"
								value={state.tracks}
								onChange={(e) => update({ tracks: e.target.value })}
							/>
						</label>
						<label>
							Solar panels
							<input
								type="number"
								inputMode="numeric"
								min="0"
								value={state.solarPanels}
								onChange={(e) => update({ solarPanels: e.target.value })}
							/>
						</label>
					</div>

					<h3>Summary</h3>
					<div className="stats-grid">
						<div>
							<strong>{totals.standardWindowTotal}</strong>
							<span className="field-hint">standard windows</span>
						</div>
						<div>
							<strong>{totals.specialUnitTotal}</strong>
							<span className="field-hint">special units</span>
						</div>
						<div>
							<strong>{totals.dividedLightPaneTotal}</strong>
							<span className="field-hint">divided-light panes</span>
						</div>
						<div>
							<strong>{totals.totalWindowUnits}</strong>
							<span className="field-hint">total window units</span>
						</div>
						<div>
							<strong>{totals.totalGlassPanes}</strong>
							<span className="field-hint">total glass panes</span>
						</div>
						<div>
							<strong>{totals.screens}</strong>
							<span className="field-hint">screens</span>
						</div>
						<div>
							<strong>{totals.tracks}</strong>
							<span className="field-hint">tracks</span>
						</div>
						<div>
							<strong>{totals.solarPanels}</strong>
							<span className="field-hint">solar panels</span>
						</div>
					</div>
					{totals.dividedLightPaneTotal > 0 && (
						<span className="field-hint">
							Divided-light panes are not counted as window units — one french door with {totals.dividedLightPaneTotal}{' '}
							lights is one opening to set up at.
						</span>
					)}

					{!inventoryValid && <p className="field-hint">{EMPTY_INVENTORY_MESSAGE}</p>}
					{saveError && <p role="alert">{saveError}</p>}

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(0)}>
							Back
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

					<h3>Overall condition</h3>
					<p className="field-hint">
						How dirty the glass is. Restoration work is asked about separately below — a two-year-old house with
						construction residue is a light-dirt job that also needs a razor, not a heavy one.
					</p>
					<Segmented
						label="Glass condition"
						name="overallCondition"
						value={state.overallCondition}
						options={COMPONENT_CONDITIONS}
						onChange={(v) => update({ overallCondition: v })}
					/>
					<label>
						<input
							type="checkbox"
							checked={state.conditionsDiffer}
							onChange={(e) => update({ conditionsDiffer: e.target.checked })}
						/>{' '}
						Interior and exterior conditions differ
					</label>

					{state.conditionsDiffer && (
						<>
							{state.interiorIncluded && (
								<Segmented
									label="Interior glass"
									name="interiorGlassCondition"
									value={state.interiorGlassCondition}
									options={COMPONENT_CONDITIONS}
									onChange={(v) => update({ interiorGlassCondition: v })}
								/>
							)}
							{state.exteriorIncluded && (
								<Segmented
									label="Exterior glass"
									name="exteriorGlassCondition"
									value={state.exteriorGlassCondition}
									options={COMPONENT_CONDITIONS}
									onChange={(v) => update({ exteriorGlassCondition: v })}
								/>
							)}
						</>
					)}

					<h3>Component exceptions</h3>
					<p className="field-hint">
						Only the components that are costing extra. A rating here affects that component and nothing else — heavy
						frames cost frame time, they don&apos;t make the glass take longer.
					</p>
					{state.exteriorIncluded && state.framesIncluded && (
						<Segmented
							label="Frames and exterior sills"
							name="frameException"
							value={state.frameException}
							options={COMPONENT_EXCEPTION_LEVELS}
							onChange={(v) => update({ frameException: v })}
						/>
					)}
					{state.screensIncluded && (
						<Segmented
							label="Screens"
							name="screenException"
							value={state.screenException}
							options={COMPONENT_EXCEPTION_LEVELS}
							onChange={(v) => update({ screenException: v })}
						/>
					)}
					{state.tracksIncluded && (
						<Segmented
							label="Tracks"
							name="trackException"
							value={state.trackException}
							options={COMPONENT_EXCEPTION_LEVELS}
							onChange={(v) => update({ trackException: v })}
						/>
					)}

					<h3>Restoration issues</h3>
					<p className="field-hint">
						Specialized work beyond a standard cleaning. Priced per affected pane at the severity you saw, so a
						four-pane sunroom and a whole south elevation don&apos;t cost the same.
					</p>
					<div className="checkbox-grid">
						{RESTORATION_ISSUES.map((issue) => (
							<label key={issue}>
								<input
									type="checkbox"
									checked={state.adjustments.some((a) => a.kind === 'Restoration' && a.label === issue)}
									onChange={() => toggleAdjustment('Restoration', issue)}
								/>{' '}
								{issue}
							</label>
						))}
					</div>

					{state.adjustments
						.filter((a) => a.kind === 'Restoration')
						.map((adjustment) => (
							<div key={adjustment.id} className="card">
								<p className="field-label">{adjustment.label}</p>
								<label>
									Affected panes
									<input
										type="number"
										inputMode="numeric"
										min="0"
										value={adjustment.affectedPanes}
										onChange={(e) => updateAdjustment(adjustment.id, { affectedPanes: e.target.value })}
									/>
								</label>
								<Segmented
									label="Severity"
									name={`severity-${adjustment.id}`}
									value={adjustment.severity}
									options={SEVERITY_LEVELS}
									onChange={(v) => updateAdjustment(adjustment.id, { severity: v })}
								/>
								<label>
									Notes
									<input
										type="text"
										value={adjustment.notes}
										onChange={(e) => updateAdjustment(adjustment.id, { notes: e.target.value })}
									/>
								</label>
								{restorationIncomplete(adjustment) && (
									<p className="field-hint">
										Add the pane count and severity, or this issue is recorded but costs nothing.
									</p>
								)}
							</div>
						))}

					<h3>Property-level factors</h3>
					<p className="field-hint">
						Whole-property time that isn&apos;t attributable to any one window. Each carries its own configured cost —
						don&apos;t check anything already covered by ordinary setup and breakdown.
					</p>
					<div className="checkbox-grid">
						{PROPERTY_MODIFIERS.map((modifier) => (
							<label key={modifier}>
								<input
									type="checkbox"
									checked={state.adjustments.some((a) => a.kind === 'Modifier' && a.label === modifier)}
									onChange={() => toggleAdjustment('Modifier', modifier)}
								/>{' '}
								{modifier}
							</label>
						))}
					</div>

					<label>
						Notes
						<span className="field-hint">Optional.</span>
						<textarea value={state.conditionNotes} onChange={(e) => update({ conditionNotes: e.target.value })} />
					</label>

					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(1)}>
							Back
						</button>
						<button type="button" onClick={() => goTo(3)}>
							Next: Review &amp; Price
						</button>
					</div>
				</section>
			)}
			{state.step === 3 && (
				<section className="card">
					<h2>Review, Labor &amp; Price</h2>

					{/* Header: what the job is, before what it costs. */}
					<div className="stats-grid">
						<div>
							<strong>{productiveHours.toFixed(1)} h</strong>
							<span className="field-hint">estimated productive labor</span>
						</div>
						<div>
							<strong>{scheduledHours.toFixed(1)} h</strong>
							<span className="field-hint">scheduled time</span>
						</div>
						<div>
							<strong>{state.scheduleRecommendationOverride || schedule.recommendation}</strong>
							<span className="field-hint">schedule recommendation</span>
						</div>
					</div>

					<p>{estimate.explanation}</p>

					{/* --- Price. The decision this screen exists to support. --- */}
					<div className="card">
						<h3>Recommended price</h3>
						<p className="price-headline">${band.target}</p>
						<p className="field-hint">
							Recommended range ${band.low} to ${band.high}
							{band.minimumApplied ? ' — lifted by the job minimum' : ''}
						</p>

						<div className="pane-grid">
							<label>
								Your price
								<span className="field-hint">Starts at the recommendation. Change it and the rates below follow.</span>
								<input
									type="number"
									inputMode="decimal"
									min="0"
									value={state.ownerSelectedPrice}
									placeholder={String(band.target)}
									onChange={(e) => update({ ownerSelectedPrice: e.target.value })}
								/>
							</label>
							<label>
								Pricing notes
								<span className="field-hint">
									Optional. Referral, repeat customer, neighbour discount, bundle, competitive adjustment.
								</span>
								<input
									type="text"
									value={state.ownerOverrideReason}
									onChange={(e) => update({ ownerOverrideReason: e.target.value })}
								/>
							</label>
						</div>

						<div className="stats-grid">
							<div>
								<strong>${perProductiveHour}/hr</strong>
								<span className="field-hint">revenue / productive hour</span>
							</div>
							<div>
								<strong>${perScheduledHour}/hr</strong>
								<span className="field-hint">revenue / scheduled hour</span>
							</div>
						</div>
					</div>

					{/* --- Where the time comes from. --- */}
					<div className="card">
						<h3>Where the time goes</h3>
						<table>
							<tbody>
								{BREAKDOWN_ROWS.filter((row) => estimate.breakdown[row.key] > 0).map((row) => (
									<tr key={row.key}>
										<td>{row.label}</td>
										<td>{hours(estimate.breakdown[row.key])} h</td>
									</tr>
								))}
								<tr>
									<td>
										<strong>Total productive labor</strong>
									</td>
									<td>
										<strong>{productiveHours.toFixed(1)} h</strong>
									</td>
								</tr>
							</tbody>
						</table>

						{selectedAdjustments.length > 0 && (
							<>
								<h4>Included in the adjustments above</h4>
								<table>
									<tbody>
										{selectedAdjustments.map((a) => (
											<tr key={a.id}>
												<td>
													{a.label}
													{a.kind === 'Restoration' && a.severity && a.affectedPanes
														? ` — ${a.affectedPanes} panes, ${a.severity.toLowerCase()}`
														: ''}
												</td>
												<td>{hours(adjustmentMinutes(laborModel, a))} h</td>
											</tr>
										))}
									</tbody>
								</table>
							</>
						)}
					</div>

					{/* --- Schedule. --- */}
					<div className="card">
						<h3>Recommended schedule</h3>
						<p className="schedule-headline">✓ {scheduleHeadline(state.scheduleRecommendationOverride || schedule.recommendation)}</p>
						<p className="field-hint">Estimated onsite time: {scheduledHours.toFixed(1)} hours</p>
						{scheduleSplit(state.scheduleRecommendationOverride || schedule.recommendation, scope).map((line) => (
							<p key={line} className="field-hint">
								{line}
							</p>
						))}
						{schedule.reasons.length > 0 && (
							<ul>
								{schedule.reasons.map((reason) => (
									<li key={reason} className="field-hint">
										{reason}
									</li>
								))}
							</ul>
						)}

						<details>
							<summary>Override the schedule</summary>
							<div className="pane-grid">
								<label>
									Scheduled hours
									<span className="field-hint">Changes the time you block out. Never changes the estimate above.</span>
									<input
										type="number"
										inputMode="decimal"
										min="0"
										step="0.25"
										value={state.scheduledHoursOverride}
										onChange={(e) => update({ scheduledHoursOverride: e.target.value })}
									/>
								</label>
								<label>
									Recommendation
									<select
										value={state.scheduleRecommendationOverride}
										onChange={(e) => update({ scheduleRecommendationOverride: e.target.value })}
									>
										<option value="">Use recommendation ({schedule.recommendation})</option>
										{SCHEDULE_RECOMMENDATIONS.map((r) => (
											<option key={r}>{r}</option>
										))}
									</select>
								</label>
							</div>
						</details>
					</div>

					<label>
						General notes
						<textarea value={state.notes} onChange={(e) => update({ notes: e.target.value })} />
					</label>

					<p className="field-hint">Labor model: {estimate.laborModelVersion}</p>

					{saveError && <p role="alert">{saveError}</p>}
					<div className="button-row">
						<button type="button" className="btn-secondary" onClick={() => goTo(2)}>
							Back
						</button>
						<button type="button" disabled={saving} onClick={save}>
							{saving ? 'Saving…' : 'Save walkthrough'}
						</button>
					</div>
				</section>
			)}
		</div>
	);
}