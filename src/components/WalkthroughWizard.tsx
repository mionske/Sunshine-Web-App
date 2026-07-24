import { useEffect, useState } from 'react';

const AREA_STEPS = ['Front', 'Left', 'Rear', 'Right', 'Interior'] as const;
const ALL_AREAS = ['Front', 'Left', 'Rear', 'Right', 'Interior', 'Garage', 'Basement', 'Other'];
const ITEM_TYPES = ['Window', 'Sliding Door', 'Skylight'];
const SIZE_CLASSES = ['Standard', 'Oversized', 'French/Divided-Light'];
const CONDITION_LEVELS = ['Maintenance', 'Moderate Buildup', 'Heavy Buildup', 'Restoration Required', 'Unknown'];
const ACCESS_LEVELS = ['Easy', 'Standard', 'Difficult', 'Specialty Access', 'Unknown'];

function newId(): string {
	return crypto.randomUUID();
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

interface WizardState {
	step: number; // 0 = start details, 1-5 = area steps, 6 = review, 7 = pricing, 8 = saved
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
		items: [],
	};
}

function draftKey(propertyId: string): string {
	return `sww-walkthrough-draft-${propertyId}`;
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
					},
					items: state.items,
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
					items: state.items,
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

	return (
		<div>
			<p>Step {state.step + 1} of 8</p>

			{state.step === 0 && (
				<section className="card">
					<h2>Start walkthrough</h2>

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
						Current condition
						<select value={state.exteriorCondition} onChange={(e) => update({ exteriorCondition: e.target.value })}>
							{CONDITION_LEVELS.filter((c) => c !== 'Unknown').map((c) => (
								<option key={c}>{c}</option>
							))}
						</select>
					</label>
					<label>
						<input
							type="checkbox"
							checked={state.hardWaterPresent}
							onChange={(e) => update({ hardWaterPresent: e.target.checked })}
						/>{' '}
						Hard water present
					</label>
					<label>
						<input
							type="checkbox"
							checked={state.constructionDebrisPresent}
							onChange={(e) => update({ constructionDebrisPresent: e.target.checked })}
						/>{' '}
						Construction debris present
					</label>
					<label>
						<input
							type="checkbox"
							checked={state.siliconeResidue}
							onChange={(e) => update({ siliconeResidue: e.target.checked })}
						/>{' '}
						Silicone, adhesive, or sticker residue
					</label>
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
					<label>
						Condition notes
						<textarea value={state.conditionNotes} onChange={(e) => update({ conditionNotes: e.target.value })} />
					</label>
					<label>
						<input
							type="checkbox"
							checked={state.waterFedPoleSuitable}
							onChange={(e) => update({ waterFedPoleSuitable: e.target.checked })}
						/>{' '}
						Water-fed pole suitable
					</label>
					<label>
						Ladder requirement
						<input type="text" value={state.ladderRequired} onChange={(e) => update({ ladderRequired: e.target.value })} />
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
					<label>
						Temporary access notes
						<span className="field-hint">Anything else about getting set up for this specific visit.</span>
						<textarea value={state.temporaryAccessNotes} onChange={(e) => update({ temporaryAccessNotes: e.target.value })} />
					</label>
					<button type="button" onClick={() => goTo(1)}>
						Next: Front
					</button>
				</section>
			)}

			{state.step >= 1 && state.step <= 5 && (
				<AreaStep
					area={AREA_STEPS[state.step - 1]}
					items={currentAreaItems(AREA_STEPS[state.step - 1])}
					editingItem={editingItem}
					onAdd={() => setEditingItem(emptyItem(AREA_STEPS[state.step - 1]))}
					onEdit={setEditingItem}
					onDelete={deleteItem}
					onDuplicate={duplicateItem}
					onSaveItem={saveItem}
					onCancelItem={() => setEditingItem(null)}
					onBack={() => goTo(state.step - 1)}
					onNext={() => goTo(state.step + 1)}
					nextLabel={state.step === 5 ? 'Review' : `Next: ${AREA_STEPS[state.step]}`}
				/>
			)}

			{state.step === 6 && (
				<section className="card">
					<h2>Review</h2>
					<p>{state.items.length} item(s) recorded across all areas.</p>
					<table>
						<thead>
							<tr><th>Area</th><th>Type</th><th>Qty</th><th>Ext</th><th>Int</th><th>Screen</th><th>Track</th></tr>
						</thead>
						<tbody>
							{state.items.map((i) => (
								<tr key={i.id}>
									<td>{i.area}</td>
									<td>{i.itemType}{i.itemType === 'Window' ? ` (${i.sizeClass})` : ''}</td>
									<td>{i.quantity}</td>
									<td>{i.exteriorIncluded ? 'Y' : ''}</td>
									<td>{i.interiorIncluded ? 'Y' : ''}</td>
									<td>{i.screenIncluded ? 'Y' : ''}</td>
									<td>{i.trackIncluded ? 'Y' : ''}</td>
								</tr>
							))}
							{state.items.length === 0 && <tr><td colSpan={7}>No items recorded.</td></tr>}
						</tbody>
					</table>
					<label>
						General notes
						<textarea value={state.notes} onChange={(e) => update({ notes: e.target.value })} />
					</label>
					<button type="button" onClick={() => goTo(5)}>
						Back
					</button>{' '}
					<button
						type="button"
						disabled={loadingPricing}
						onClick={async () => {
							await loadPricingPreview();
							goTo(7);
						}}
					>
						{loadingPricing ? 'Calculating…' : 'Calculate pricing'}
					</button>
				</section>
			)}

			{state.step === 7 && (
				<section className="card">
					<h2>Pricing summary</h2>
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
							<p>Active PricingConfig: {pricing.pricingConfigId}</p>
						</>
					) : (
						<p>No pricing calculated yet.</p>
					)}
					{saveError && <p role="alert">{saveError}</p>}
					<button type="button" onClick={() => goTo(6)}>
						Back
					</button>{' '}
					<button type="button" disabled={saving || !pricing} onClick={save}>
						{saving ? 'Saving…' : 'Save walkthrough'}
					</button>
				</section>
			)}
		</div>
	);
}

function AreaStep({
	area,
	items,
	editingItem,
	onAdd,
	onEdit,
	onDelete,
	onDuplicate,
	onSaveItem,
	onCancelItem,
	onBack,
	onNext,
	nextLabel,
}: {
	area: string;
	items: ItemState[];
	editingItem: ItemState | null;
	onAdd: () => void;
	onEdit: (item: ItemState) => void;
	onDelete: (id: string) => void;
	onDuplicate: (item: ItemState) => void;
	onSaveItem: (item: ItemState) => void;
	onCancelItem: () => void;
	onBack: () => void;
	onNext: () => void;
	nextLabel: string;
}) {
	return (
		<section className="card">
			<h2>{area}</h2>
			{items.length > 0 && (
				<ul>
					{items.map((i) => (
						<li key={i.id}>
							{i.quantity}× {i.itemType}
							{i.itemType === 'Window' ? ` (${i.sizeClass})` : ''}
							{i.exteriorIncluded && ' — ext'}
							{i.interiorIncluded && ' — int'}
							{i.screenIncluded && ' — screen'}
							{i.trackIncluded && ' — track'}
							{' '}
							<button type="button" onClick={() => onEdit(i)}>
								Edit
							</button>{' '}
							<button type="button" onClick={() => onDuplicate(i)}>
								Duplicate
							</button>{' '}
							<button type="button" onClick={() => onDelete(i.id)}>
								Delete
							</button>
						</li>
					))}
				</ul>
			)}

			{editingItem && editingItem.area === area ? (
				<ItemForm item={editingItem} area={area} onSave={onSaveItem} onCancel={onCancelItem} />
			) : (
				<button type="button" onClick={onAdd}>
					+ Add item
				</button>
			)}

			<p>
				<button type="button" onClick={onBack}>
					Back
				</button>{' '}
				<button type="button" onClick={onNext}>
					{nextLabel}
				</button>
			</p>
		</section>
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
			{draft.itemType === 'Sliding Door' && (
				<span className="field-hint">Count an oversized/XL slider as 2.</span>
			)}
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
