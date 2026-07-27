import { useEffect, useMemo, useState } from 'react';
import { calculateQuote } from '../lib/pricing/engine';
import type { Condition, QuoteCounts, QuoteInput, Stories } from '../lib/pricing/types';
import type { PricingConfig } from '../lib/models/pricingConfig';
import type { Service } from '../lib/models/service';
import {
	SERVICE_SCOPE_OPTIONS,
	INVENTORY_COVERAGE_OPTIONS,
	LABOR_ESTIMATE_CREW_SIZE_OPTIONS,
	LABOR_ESTIMATE_CONFIDENCE_OPTIONS,
	ADJUSTMENT_REASON_OPTIONS,
} from '../lib/models/quote';

type ServiceScope = (typeof SERVICE_SCOPE_OPTIONS)[number];
type InventoryCoverage = (typeof INVENTORY_COVERAGE_OPTIONS)[number];
type ScreensMode = 'Not Included' | 'Include All' | 'Custom Quantity';
type TrackMode = 'Not Included' | 'Basic Wipe' | 'Deep Cleaning';

const CONDITION_OPTIONS: { value: Condition; label: string }[] = [
	{ value: 'light', label: 'Maintenance' },
	{ value: 'moderate', label: 'Moderate Buildup' },
	{ value: 'heavy', label: 'Heavy Buildup' },
	{ value: 'firstTime', label: 'Restoration Required' },
];

const EMPTY_COUNTS: QuoteCounts = {
	windowExtStandard: 0,
	windowIntStandard: 0,
	windowExtOversized: 0,
	windowIntOversized: 0,
	windowExtFrenchPane: 0,
	windowIntFrenchPane: 0,
	slidingDoorExt: 0,
	slidingDoorInt: 0,
	screenClean: 0,
	trackBasic: 0,
	trackDeep: 0,
	skylightExt: 0,
	skylightInt: 0,
};

interface ClientOption {
	id: string;
	firstName: string;
	lastName: string;
}

interface PropertyOption {
	id: string;
	clientId: string;
	address: string;
	propertyType: string;
}

interface PropertySummary {
	stories: string;
	totalWindowUnits: string;
	totalGlassPanes: string;
	windowCondition: string;
	exteriorCleaningMethod: string;
	ladderRequirement: string;
	conditionDefault: Condition;
	highInteriorGlass: string;
	steepOrUnevenTerrain: string;
	exteriorAccessObstructed: string;
	furnitureMovementRequired: string;
	waterSourceFarFromWorkArea: string;
	siliconeResidue: string;
	heavyInteriorResidue: string;
}

interface WalkthroughDefault {
	walkthroughId: string;
	walkthroughDate: string;
	counts: QuoteCounts;
}

/** Everything needed to re-populate the form from an existing Quote — see
 * quoter.astro's `?quoteId=` edit-mode loading. Counts/stories/condition/
 * hardWater/constructionDebris/manualAdjustment/discount/overrideReason
 * come straight from the Quote's own stored Input Snapshot (already this
 * exact shape); the rest are plain Quote columns. */
export interface InitialQuoteData {
	quoteId: string;
	clientId: string;
	propertyId: string;
	pricingConfigId: string;
	serviceScope: string;
	inventoryCoverage: string;
	counts: QuoteCounts;
	stories: Stories;
	condition: Condition;
	hardWater: boolean;
	constructionDebris: boolean;
	jobHighInteriorGlass: boolean;
	jobSteepOrUnevenTerrain: boolean;
	jobExteriorAccessObstructed: boolean;
	jobFurnitureMovementRequired: boolean;
	jobWaterAccessDifficult: boolean;
	jobSiliconeOrStickerResidue: boolean;
	jobHeavyInteriorResidue: boolean;
	otherConditionNotes: string;
	laborSoloHours: string;
	laborCrewSize: string;
	laborConfidence: string;
	laborNotes: string;
	manualAdjustment: string;
	discount: string;
	overrideReason: string;
}

interface QuoterFormProps {
	clients: ClientOption[];
	properties: PropertyOption[];
	clientLastNameById: Record<string, string>;
	propertySummaryById: Record<string, PropertySummary>;
	latestWalkthroughByProperty: Record<string, WalkthroughDefault | null>;
	pricingConfigs: PricingConfig[];
	services: Service[];
	preselectedClientId: string;
	preselectedPropertyId: string;
	/** Present only when editing an existing Quote (see quoter.astro) —
	 * pre-fills every field from it and locks Client/Property (an edit
	 * corrects scope/pricing, it never reassigns the quote to a different
	 * property) instead of running the usual property-change auto-defaults. */
	initialQuote?: InitialQuoteData;
}

function Segmented<T extends string>({
	name,
	options,
	labels,
	value,
	onChange,
	disabledOptions,
}: {
	name: string;
	options: readonly T[];
	labels?: Partial<Record<T, string>>;
	value: T;
	onChange: (value: T) => void;
	disabledOptions?: readonly T[];
}) {
	return (
		<div className="segmented">
			{options.map((option) => (
				<label key={option}>
					<input
						type="radio"
						name={name}
						value={option}
						checked={value === option}
						disabled={disabledOptions?.includes(option)}
						onChange={() => onChange(option)}
					/>
					{labels?.[option] ?? option}
				</label>
			))}
		</div>
	);
}

function money(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

export default function QuoterForm(props: QuoterFormProps) {
	const {
		clients,
		properties,
		clientLastNameById,
		propertySummaryById,
		latestWalkthroughByProperty,
		pricingConfigs,
		services,
		preselectedClientId,
		preselectedPropertyId,
		initialQuote,
	} = props;

	const [clientId, setClientId] = useState(initialQuote?.clientId || preselectedClientId || clients[0]?.id || '');
	const [propertyId, setPropertyId] = useState(initialQuote?.propertyId || preselectedPropertyId || '');
	const [pricingConfigId, setPricingConfigId] = useState(initialQuote?.pricingConfigId ?? '');

	const [serviceScope, setServiceScope] = useState<ServiceScope>((initialQuote?.serviceScope as ServiceScope) || 'Interior & Exterior');
	const [inventoryCoverage, setInventoryCoverage] = useState<InventoryCoverage>(
		(initialQuote?.inventoryCoverage as InventoryCoverage) || 'Selected Windows Only'
	);
	const [counts, setCounts] = useState<QuoteCounts>(initialQuote?.counts ?? EMPTY_COUNTS);
	const [stories, setStories] = useState<Stories>(initialQuote?.stories ?? 1);
	const [condition, setCondition] = useState<Condition>(initialQuote?.condition ?? 'light');

	const [screensMode, setScreensMode] = useState<ScreensMode>(
		initialQuote ? (initialQuote.counts.screenClean > 0 ? 'Include All' : 'Not Included') : 'Not Included'
	);
	const [screensCustomQty, setScreensCustomQty] = useState(initialQuote ? String(initialQuote.counts.screenClean || 0) : '0');
	const [trackMode, setTrackMode] = useState<TrackMode>(
		initialQuote
			? initialQuote.counts.trackDeep > 0
				? 'Deep Cleaning'
				: initialQuote.counts.trackBasic > 0
					? 'Basic Wipe'
					: 'Not Included'
			: 'Not Included'
	);
	const [trackQty, setTrackQty] = useState(
		initialQuote ? String(initialQuote.counts.trackDeep || initialQuote.counts.trackBasic || 0) : '0'
	);
	const [skylightsIncluded, setSkylightsIncluded] = useState(
		initialQuote ? initialQuote.counts.skylightExt + initialQuote.counts.skylightInt > 0 : false
	);
	const [hardWater, setHardWater] = useState(initialQuote?.hardWater ?? false);
	const [constructionDebris, setConstructionDebris] = useState(initialQuote?.constructionDebris ?? false);
	const [otherSpecialtyTreatment, setOtherSpecialtyTreatment] = useState(false);

	const [jobHighInteriorGlass, setJobHighInteriorGlass] = useState(initialQuote?.jobHighInteriorGlass ?? false);
	const [jobSteepOrUnevenTerrain, setJobSteepOrUnevenTerrain] = useState(initialQuote?.jobSteepOrUnevenTerrain ?? false);
	const [jobExteriorAccessObstructed, setJobExteriorAccessObstructed] = useState(initialQuote?.jobExteriorAccessObstructed ?? false);
	const [jobFurnitureMovementRequired, setJobFurnitureMovementRequired] = useState(initialQuote?.jobFurnitureMovementRequired ?? false);
	const [jobWaterAccessDifficult, setJobWaterAccessDifficult] = useState(initialQuote?.jobWaterAccessDifficult ?? false);
	const [jobSiliconeOrStickerResidue, setJobSiliconeOrStickerResidue] = useState(initialQuote?.jobSiliconeOrStickerResidue ?? false);
	const [jobHeavyInteriorResidue, setJobHeavyInteriorResidue] = useState(initialQuote?.jobHeavyInteriorResidue ?? false);
	const [otherConditionNotes, setOtherConditionNotes] = useState(initialQuote?.otherConditionNotes ?? '');

	const [laborSoloHours, setLaborSoloHours] = useState(initialQuote?.laborSoloHours ?? '');
	const [laborCrewSize, setLaborCrewSize] = useState<(typeof LABOR_ESTIMATE_CREW_SIZE_OPTIONS)[number]>(
		(initialQuote?.laborCrewSize as (typeof LABOR_ESTIMATE_CREW_SIZE_OPTIONS)[number]) || '1'
	);
	const [laborConfidence, setLaborConfidence] = useState<(typeof LABOR_ESTIMATE_CONFIDENCE_OPTIONS)[number]>(
		(initialQuote?.laborConfidence as (typeof LABOR_ESTIMATE_CONFIDENCE_OPTIONS)[number]) || 'Medium'
	);
	const [laborNotes, setLaborNotes] = useState(initialQuote?.laborNotes ?? '');

	const [manualAdjustment, setManualAdjustment] = useState(initialQuote?.manualAdjustment ?? '0');
	const [discount, setDiscount] = useState(initialQuote?.discount ?? '0');
	const [adjustmentReason, setAdjustmentReason] = useState(() => {
		if (!initialQuote?.overrideReason) return '';
		return (ADJUSTMENT_REASON_OPTIONS as readonly string[]).includes(initialQuote.overrideReason) ? initialQuote.overrideReason : 'Other';
	});
	const [adjustmentReasonOther, setAdjustmentReasonOther] = useState(() => {
		if (!initialQuote?.overrideReason) return '';
		return (ADJUSTMENT_REASON_OPTIONS as readonly string[]).includes(initialQuote.overrideReason) ? '' : initialQuote.overrideReason;
	});

	const property = propertyId ? properties.find((p) => p.id === propertyId) : undefined;
	const summary = propertyId ? propertySummaryById[propertyId] : undefined;
	const walkthroughDefault = propertyId ? latestWalkthroughByProperty[propertyId] : undefined;
	const propertiesForClient = properties.filter((p) => p.clientId === clientId);

	// Reset every property-derived field whenever the selected property
	// changes — pre-filling from its latest completed Walkthrough (Quote
	// Inventory) and its own saved Access/Glass Condition flags (Current Job
	// Conditions), so the diff notice below has a real baseline to compare
	// against rather than always firing.
	useEffect(() => {
		// Editing an existing Quote: Client/Property are fixed (see the
		// read-only display below) and every field already comes from the
		// Quote itself — this auto-defaulting only applies to a fresh quote.
		if (initialQuote) return;
		if (!propertyId) return;
		const matchingConfig = pricingConfigs.find((c) => c['Property Type'] === property?.propertyType);
		setPricingConfigId(matchingConfig?.['Pricing Config ID'] ?? '');

		const wt = latestWalkthroughByProperty[propertyId];
		if (wt) {
			setInventoryCoverage('Entire Property');
			setCounts(wt.counts);
			setScreensMode(wt.counts.screenClean > 0 ? 'Include All' : 'Not Included');
			setScreensCustomQty(String(wt.counts.screenClean || 0));
			setTrackMode(wt.counts.trackDeep > 0 ? 'Deep Cleaning' : wt.counts.trackBasic > 0 ? 'Basic Wipe' : 'Not Included');
			setTrackQty(String(wt.counts.trackDeep || wt.counts.trackBasic || 0));
			setSkylightsIncluded(wt.counts.skylightExt + wt.counts.skylightInt > 0);
		} else {
			setInventoryCoverage('Selected Windows Only');
			setCounts(EMPTY_COUNTS);
			setScreensMode('Not Included');
			setScreensCustomQty('0');
			setTrackMode('Not Included');
			setTrackQty('0');
			setSkylightsIncluded(false);
		}

		const s = propertySummaryById[propertyId];
		if (s) {
			setCondition(s.conditionDefault);
			setJobHighInteriorGlass(s.highInteriorGlass === 'Y');
			setJobSteepOrUnevenTerrain(s.steepOrUnevenTerrain === 'Y');
			setJobExteriorAccessObstructed(s.exteriorAccessObstructed === 'Y');
			setJobFurnitureMovementRequired(s.furnitureMovementRequired === 'Y');
			setJobWaterAccessDifficult(s.waterSourceFarFromWorkArea === 'Y');
			setJobSiliconeOrStickerResidue(s.siliconeResidue === 'Y');
			setJobHeavyInteriorResidue(s.heavyInteriorResidue === 'Y');
			setStories(s.stories === '2' ? 2 : s.stories === '3' ? 3 : 1);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [propertyId]);

	const editableInventory = inventoryCoverage === 'Selected Windows Only' || serviceScope === 'Custom Selection';

	// Included Services (screens/track/skylights) resolve into the same
	// QuoteCounts fields Quote Inventory uses — one set of numbers, priced
	// once, never asked twice.
	const resolvedScreenClean = screensMode === 'Not Included' ? 0 : screensMode === 'Include All' ? counts.screenClean : Number(screensCustomQty) || 0;
	const resolvedTrackBasic = trackMode === 'Basic Wipe' ? Number(trackQty) || 0 : 0;
	const resolvedTrackDeep = trackMode === 'Deep Cleaning' ? Number(trackQty) || 0 : 0;

	const countsWithServices: QuoteCounts = {
		...counts,
		screenClean: resolvedScreenClean,
		trackBasic: resolvedTrackBasic,
		trackDeep: resolvedTrackDeep,
		skylightExt: skylightsIncluded ? counts.skylightExt : 0,
		skylightInt: skylightsIncluded ? counts.skylightInt : 0,
	};

	// Service Scope narrows which side's counts actually get quoted — a UI
	// convenience over the same ext/int fields, not a second set of inputs.
	const effectiveCounts: QuoteCounts = useMemo(() => {
		if (serviceScope === 'Exterior Only') {
			return { ...countsWithServices, windowIntStandard: 0, windowIntOversized: 0, windowIntFrenchPane: 0, slidingDoorInt: 0, skylightInt: 0 };
		}
		if (serviceScope === 'Interior Only') {
			return { ...countsWithServices, windowExtStandard: 0, windowExtOversized: 0, windowExtFrenchPane: 0, slidingDoorExt: 0, skylightExt: 0 };
		}
		return countsWithServices;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [serviceScope, counts, resolvedScreenClean, resolvedTrackBasic, resolvedTrackDeep, skylightsIncluded]);

	const difficultAccess =
		jobHighInteriorGlass || jobSteepOrUnevenTerrain || jobExteriorAccessObstructed || jobFurnitureMovementRequired || jobWaterAccessDifficult;

	const selectedConfig = pricingConfigs.find((c) => c['Pricing Config ID'] === pricingConfigId);

	const quoteInput: QuoteInput = useMemo(
		() => ({
			stories,
			condition,
			counts: effectiveCounts,
			hardWater,
			constructionDebris,
			difficultAccess,
			manualAdjustment: Number(manualAdjustment) || 0,
			discount: Number(discount) || 0,
			overrideReason: adjustmentReason === 'Other' ? adjustmentReasonOther : adjustmentReason,
		}),
		[stories, condition, effectiveCounts, hardWater, constructionDebris, difficultAccess, manualAdjustment, discount, adjustmentReason, adjustmentReasonOther]
	);

	// The exact same pure engine function the server uses — never a second,
	// reimplemented calculation path. calculateQuote/engine.ts has no I/O,
	// so it's safe to run client-side for a live preview.
	const result = useMemo(() => {
		if (!selectedConfig) return null;
		try {
			return calculateQuote(selectedConfig, services, quoteInput);
		} catch {
			return null;
		}
	}, [selectedConfig, services, quoteInput]);

	const adjustmentReasonRequired = (Number(manualAdjustment) || 0) !== 0 || (Number(discount) || 0) !== 0;
	const adjustmentReasonMissing = adjustmentReasonRequired && !adjustmentReason;

	const conditionsDiffer =
		!!summary &&
		(condition !== summary.conditionDefault ||
			jobHighInteriorGlass !== (summary.highInteriorGlass === 'Y') ||
			jobSteepOrUnevenTerrain !== (summary.steepOrUnevenTerrain === 'Y') ||
			jobExteriorAccessObstructed !== (summary.exteriorAccessObstructed === 'Y') ||
			jobFurnitureMovementRequired !== (summary.furnitureMovementRequired === 'Y') ||
			jobWaterAccessDifficult !== (summary.waterSourceFarFromWorkArea === 'Y') ||
			jobSiliconeOrStickerResidue !== (summary.siliconeResidue === 'Y') ||
			jobHeavyInteriorResidue !== (summary.heavyInteriorResidue === 'Y'));

	function setCount(key: keyof QuoteCounts, value: string) {
		setCounts((prev) => ({ ...prev, [key]: Number(value) || 0 }));
	}

	const laborTotalHours = (Number(laborSoloHours) || 0) * (laborCrewSize === '3+' ? 3 : Number(laborCrewSize));

	const editingClient = clients.find((c) => c.id === clientId);
	const editingProperty = properties.find((p) => p.id === propertyId);

	return (
		<form method="POST" className="quoter-layout">
			{initialQuote && <input type="hidden" name="quoteId" value={initialQuote.quoteId} />}
			<div className="quoter-main">
				<section className="card">
					<span className="badge">{initialQuote ? 'Editing Quote' : 'In-Field Quote · Not an Official Estimate'}</span>
					<h2>Quote Header</h2>
					{initialQuote ? (
						<>
							<input type="hidden" name="clientId" value={clientId} />
							<input type="hidden" name="propertyId" value={propertyId} />
							<p className="field-hint">
								Client: {editingClient ? `${editingClient.firstName} ${editingClient.lastName}` : clientId}
								<br />
								Property: {editingProperty ? editingProperty.address : propertyId}
								<br />
								An edit corrects this quote's scope/pricing — to move it to a different client or property, create a new quote instead.
							</p>
						</>
					) : (
						<>
							<label>
								Client
								<select name="clientId" required value={clientId} onChange={(e) => { setClientId(e.target.value); setPropertyId(''); }}>
									{clients.map((c) => (
										<option key={c.id} value={c.id}>
											{c.firstName} {c.lastName}
										</option>
									))}
								</select>
							</label>
							<label>
								Property
								<select name="propertyId" required value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
									<option value="" disabled>
										— select a property —
									</option>
									{propertiesForClient.map((p) => (
										<option key={p.id} value={p.id}>
											{p.address} ({clientLastNameById[p.clientId] ?? '?'})
										</option>
									))}
								</select>
							</label>
						</>
					)}
					<label>
						Pricing config (pre-selected from the property's type — change anytime)
						<select name="pricingConfigId" value={pricingConfigId} onChange={(e) => setPricingConfigId(e.target.value)}>
							<option value="">— use property's type default —</option>
							{pricingConfigs.map((c) => (
								<option key={c['Pricing Config ID']} value={c['Pricing Config ID']}>
									{c['Config Name']} ({c['Property Type']})
								</option>
							))}
						</select>
					</label>
					<input type="hidden" name="walkthroughId" value={walkthroughDefault?.walkthroughId ?? ''} />

					{summary && (
						<div className="stats-grid">
							<div className="card">
								<span className="stat-label">Stories</span>
								<div className="stat" style={{ fontSize: '1.1rem' }}>{summary.stories || '— not set'}</div>
							</div>
							<div className="card">
								<span className="stat-label">Window Units</span>
								<div className="stat" style={{ fontSize: '1.1rem' }}>{summary.totalWindowUnits || '0'}</div>
							</div>
							<div className="card">
								<span className="stat-label">Glass Panes</span>
								<div className="stat" style={{ fontSize: '1.1rem' }}>{summary.totalGlassPanes || '0'}</div>
							</div>
							<div className="card">
								<span className="stat-label">Typical Condition</span>
								<div className="stat" style={{ fontSize: '1.1rem' }}>{summary.windowCondition || '— not set'}</div>
							</div>
							<div className="card">
								<span className="stat-label">Exterior Method</span>
								<div className="stat" style={{ fontSize: '1.1rem' }}>{summary.exteriorCleaningMethod || '— not set'}</div>
							</div>
							<div className="card">
								<span className="stat-label">Ladder Requirement</span>
								<div className="stat" style={{ fontSize: '1.1rem' }}>{summary.ladderRequirement || '— not set'}</div>
							</div>
						</div>
					)}
					{propertyId && (
						<p className="field-hint">
							<a href={`/properties/${propertyId}`}>View Property Details →</a>
						</p>
					)}
				</section>

				<section className="card">
					<h2>Service Scope</h2>
					<p className="field-label">Primary scope</p>
					<Segmented name="serviceScope" options={SERVICE_SCOPE_OPTIONS} value={serviceScope} onChange={setServiceScope} />
					{(serviceScope === 'Exterior Only' || serviceScope === 'Interior Only') && (
						<p className="field-hint">
							{serviceScope === 'Exterior Only' ? 'Interior' : 'Exterior'} counts below are ignored for this scope.
						</p>
					)}

					<p className="field-label" style={{ marginTop: '1rem' }}>
						Inventory Coverage
					</p>
					<Segmented
						name="inventoryCoverage"
						options={INVENTORY_COVERAGE_OPTIONS}
						value={inventoryCoverage}
						onChange={setInventoryCoverage}
						disabledOptions={walkthroughDefault ? [] : ['Entire Property']}
					/>
					{walkthroughDefault ? (
						<p className="field-hint">
							Loaded from the latest walkthrough ({walkthroughDefault.walkthroughDate || 'date unknown'}).{' '}
							{inventoryCoverage === 'Entire Property' ? 'Switch to Selected Windows Only to override quantities for this quote only.' : ''}
						</p>
					) : (
						<p className="field-hint">No completed walkthrough on file for this property yet — enter counts manually below.</p>
					)}
				</section>

				<section className="card">
					<h2>Included Services</h2>
					<div className="card-grid">
						<div>
							<p className="field-label">Screens</p>
							<Segmented name="screensModeDisplay" options={['Not Included', 'Include All', 'Custom Quantity'] as const} value={screensMode} onChange={setScreensMode} />
							{walkthroughDefault && <p className="field-hint">{walkthroughDefault.counts.screenClean} from latest walkthrough</p>}
							{screensMode === 'Custom Quantity' && (
								<input type="number" className="field-numeric" min="0" value={screensCustomQty} onChange={(e) => setScreensCustomQty(e.target.value)} />
							)}
						</div>
						<div>
							<p className="field-label">Track Cleaning</p>
							<Segmented name="trackModeDisplay" options={['Not Included', 'Basic Wipe', 'Deep Cleaning'] as const} value={trackMode} onChange={setTrackMode} />
							{walkthroughDefault && (
								<p className="field-hint">
									{walkthroughDefault.counts.trackBasic || walkthroughDefault.counts.trackDeep} from latest walkthrough
								</p>
							)}
							{trackMode !== 'Not Included' && (
								<label>
									Track quantity
									<input type="number" className="field-numeric" min="0" value={trackQty} onChange={(e) => setTrackQty(e.target.value)} />
								</label>
							)}
						</div>
					</div>
					<label>
						<input type="checkbox" checked={skylightsIncluded} onChange={(e) => setSkylightsIncluded(e.target.checked)} /> Skylights
					</label>
					<label>
						<input type="checkbox" checked={hardWater} onChange={(e) => setHardWater(e.target.checked)} /> Hard-Water Treatment
					</label>
					<label>
						<input type="checkbox" checked={constructionDebris} onChange={(e) => setConstructionDebris(e.target.checked)} /> Paint or Construction Debris Removal
					</label>
					<label>
						<input type="checkbox" checked={otherSpecialtyTreatment} onChange={(e) => setOtherSpecialtyTreatment(e.target.checked)} /> Other Specialty Treatment
					</label>
				</section>

				<section className="card">
					<h2>Quote Inventory</h2>
					{!editableInventory && <p className="field-hint">Read-only — from the latest walkthrough. Switch Inventory Coverage to edit.</p>}
					<div className="count-grid">
						<label>
							Standard — ext <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.windowExtStandard} onChange={(e) => setCount('windowExtStandard', e.target.value)} />
						</label>
						<label>
							Standard — int <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.windowIntStandard} onChange={(e) => setCount('windowIntStandard', e.target.value)} />
						</label>
						<label>
							Oversized — ext <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.windowExtOversized} onChange={(e) => setCount('windowExtOversized', e.target.value)} />
						</label>
						<label>
							Oversized — int <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.windowIntOversized} onChange={(e) => setCount('windowIntOversized', e.target.value)} />
						</label>
						<label>
							Divided-Light — ext <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.windowExtFrenchPane} onChange={(e) => setCount('windowExtFrenchPane', e.target.value)} />
						</label>
						<label>
							Divided-Light — int <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.windowIntFrenchPane} onChange={(e) => setCount('windowIntFrenchPane', e.target.value)} />
						</label>
						<label>
							Sliding doors — ext <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.slidingDoorExt} onChange={(e) => setCount('slidingDoorExt', e.target.value)} />
						</label>
						<label>
							Sliding doors — int <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.slidingDoorInt} onChange={(e) => setCount('slidingDoorInt', e.target.value)} />
						</label>
						{skylightsIncluded && (
							<>
								<label>
									Skylights — ext <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.skylightExt} onChange={(e) => setCount('skylightExt', e.target.value)} />
								</label>
								<label>
									Skylights — int <input type="number" className="field-numeric" min="0" disabled={!editableInventory} value={counts.skylightInt} onChange={(e) => setCount('skylightInt', e.target.value)} />
								</label>
							</>
						)}
					</div>

					{/* Hidden inputs carry the *effective* (service-scope-masked) counts
					    actually submitted — matches exactly what the live total above previews. */}
					<input type="hidden" name="windowExtStandard" value={effectiveCounts.windowExtStandard} />
					<input type="hidden" name="windowIntStandard" value={effectiveCounts.windowIntStandard} />
					<input type="hidden" name="windowExtOversized" value={effectiveCounts.windowExtOversized} />
					<input type="hidden" name="windowIntOversized" value={effectiveCounts.windowIntOversized} />
					<input type="hidden" name="windowExtFrenchPane" value={effectiveCounts.windowExtFrenchPane} />
					<input type="hidden" name="windowIntFrenchPane" value={effectiveCounts.windowIntFrenchPane} />
					<input type="hidden" name="slidingDoorExt" value={effectiveCounts.slidingDoorExt} />
					<input type="hidden" name="slidingDoorInt" value={effectiveCounts.slidingDoorInt} />
					<input type="hidden" name="screenClean" value={effectiveCounts.screenClean} />
					<input type="hidden" name="trackBasic" value={effectiveCounts.trackBasic} />
					<input type="hidden" name="trackDeep" value={effectiveCounts.trackDeep} />
					<input type="hidden" name="skylightExt" value={effectiveCounts.skylightExt} />
					<input type="hidden" name="skylightInt" value={effectiveCounts.skylightInt} />
				</section>

				<section className="card">
					<h2>Current Job Conditions</h2>
					{conditionsDiffer && (
						<p className="diff-notice">
							This quote differs from the saved property details.
							<br />
							<a href={`/properties/${propertyId}`}>Update Property After Saving</a> · <em>or continue — this note is informational only, nothing is overwritten automatically.</em>
						</p>
					)}
					<p className="field-label">Current Glass Condition</p>
					<Segmented name="condition" options={CONDITION_OPTIONS.map((o) => o.value)} labels={Object.fromEntries(CONDITION_OPTIONS.map((o) => [o.value, o.label]))} value={condition} onChange={setCondition} />

					<label>
						<input type="checkbox" name="jobHighInteriorGlass" checked={jobHighInteriorGlass} onChange={(e) => setJobHighInteriorGlass(e.target.checked)} /> High interior glass
					</label>
					<label>
						<input type="checkbox" name="jobSteepOrUnevenTerrain" checked={jobSteepOrUnevenTerrain} onChange={(e) => setJobSteepOrUnevenTerrain(e.target.checked)} /> Steep or uneven terrain
					</label>
					<label>
						<input type="checkbox" name="jobExteriorAccessObstructed" checked={jobExteriorAccessObstructed} onChange={(e) => setJobExteriorAccessObstructed(e.target.checked)} /> Obstructed exterior access
					</label>
					<label>
						<input type="checkbox" name="jobFurnitureMovementRequired" checked={jobFurnitureMovementRequired} onChange={(e) => setJobFurnitureMovementRequired(e.target.checked)} /> Furniture or belongings must be moved
					</label>
					<label>
						<input type="checkbox" name="jobWaterAccessDifficult" checked={jobWaterAccessDifficult} onChange={(e) => setJobWaterAccessDifficult(e.target.checked)} /> Water unavailable or difficult to access
					</label>
					<label>
						<input type="checkbox" name="jobSiliconeOrStickerResidue" checked={jobSiliconeOrStickerResidue} onChange={(e) => setJobSiliconeOrStickerResidue(e.target.checked)} /> Silicone/adhesive/sticker residue
					</label>
					<label>
						<input type="checkbox" name="jobHeavyInteriorResidue" checked={jobHeavyInteriorResidue} onChange={(e) => setJobHeavyInteriorResidue(e.target.checked)} /> Heavy interior residue
					</label>
					<label>
						Other unusual condition / specialty treatment notes
						<textarea name="jobOtherConditionNotes" value={otherConditionNotes} onChange={(e) => setOtherConditionNotes(e.target.value)} placeholder={otherSpecialtyTreatment ? 'Describe the specialty treatment requested…' : 'Anything else unusual about this job…'} />
					</label>
					<p className="field-hint">Affects pricing only via the flags above — checking any of the access-related ones applies the difficult-access surcharge.</p>
					<input type="hidden" name="hardWater" value={hardWater ? 'on' : ''} />
					<input type="hidden" name="constructionDebris" value={constructionDebris ? 'on' : ''} />
					<input type="hidden" name="stories" value={stories} />
				</section>

				<section className="card">
					<h2>Labor Estimate</h2>
					<span className="field-hint">Internal only — never shown on a customer-facing estimate.</span>
					<div className="card-grid">
						<label>
							Estimated solo hours
							<input type="number" step="0.25" min="0" name="laborEstimateSoloHours" value={laborSoloHours} onChange={(e) => setLaborSoloHours(e.target.value)} />
						</label>
						<label>
							Estimated crew size
							<select name="laborEstimateCrewSize" value={laborCrewSize} onChange={(e) => setLaborCrewSize(e.target.value as (typeof LABOR_ESTIMATE_CREW_SIZE_OPTIONS)[number])}>
								{LABOR_ESTIMATE_CREW_SIZE_OPTIONS.map((v) => (
									<option key={v} value={v}>
										{v}
									</option>
								))}
							</select>
						</label>
						<div>
							<p className="field-label">Estimated total labor hours</p>
							<p className="stat" style={{ fontSize: '1.1rem' }}>{laborTotalHours.toFixed(2)}</p>
						</div>
						<label>
							Confidence
							<select name="laborEstimateConfidence" value={laborConfidence} onChange={(e) => setLaborConfidence(e.target.value as (typeof LABOR_ESTIMATE_CONFIDENCE_OPTIONS)[number])}>
								{LABOR_ESTIMATE_CONFIDENCE_OPTIONS.map((v) => (
									<option key={v} value={v}>
										{v}
									</option>
								))}
							</select>
						</label>
					</div>
					<label>
						Labor estimate notes
						<textarea name="laborEstimateNotes" value={laborNotes} onChange={(e) => setLaborNotes(e.target.value)} placeholder="What is likely to make this job faster, slower, or less predictable?" />
					</label>
				</section>

				<section className="card">
					<h2>Price &amp; Adjustments</h2>
					<div className="card-grid">
						<label>
							Manual adjustment ($)
							<input type="number" name="manualAdjustment" value={manualAdjustment} onChange={(e) => setManualAdjustment(e.target.value)} />
						</label>
						<label>
							Discount ($)
							<input type="number" name="discount" value={discount} onChange={(e) => setDiscount(e.target.value)} />
						</label>
					</div>
					<label>
						Adjustment reason{adjustmentReasonRequired ? ' (required)' : ''}
						<select value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} required={adjustmentReasonRequired}>
							<option value="">— select a reason —</option>
							{ADJUSTMENT_REASON_OPTIONS.map((r) => (
								<option key={r} value={r}>
									{r}
								</option>
							))}
						</select>
					</label>
					{adjustmentReason === 'Other' && (
						<label>
							Explain
							<input type="text" value={adjustmentReasonOther} onChange={(e) => setAdjustmentReasonOther(e.target.value)} />
						</label>
					)}
					<input type="hidden" name="overrideReason" value={adjustmentReason === 'Other' ? adjustmentReasonOther : adjustmentReason} />
					{adjustmentReasonMissing && <p role="alert">Adjustment Reason is required when a Manual Adjustment or Discount is applied.</p>}
				</section>

			</div>

			<aside className="quoter-sticky-panel">
				<p className="field-label">Calculated Price</p>
				<p className="stat" style={{ fontSize: '1.75rem' }}>{result ? money(result.finalQuotedPrice) : '—'}</p>
				{result && (result.manualAdjustment !== 0 || result.discount !== 0) && (
					<p className="field-hint">
						Before adjustments: {money(result.targetPriceBeforeAdjustments)}
					</p>
				)}
				{result && (
					<p className="field-hint">
						Est. labor hours: {result.estimatedLaborHours.toFixed(2)} · Revenue/hr: {money(result.expectedRevenuePerLaborHour)}
					</p>
				)}
				<button type="submit" disabled={!propertyId || !clientId || adjustmentReasonMissing}>
					{initialQuote ? 'Update Quote' : 'Save Quote'}
				</button>
			</aside>
		</form>
	);
}
