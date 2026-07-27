import { useEffect, useMemo, useState } from 'react';
import { calculateQuote } from '../lib/pricing/engine';
import type { QuoteCounts, QuoteInput, Stories } from '../lib/pricing/types';
import { conditionForEngine, hasAnyRestorationFlag } from '../lib/pricing/condition';
import type { PricingConfig } from '../lib/models/pricingConfig';
import type { Service } from '../lib/models/service';
import { GLASS_CONDITION_LEVELS } from '../lib/models/walkthrough';
import { EXTERIOR_CLEANING_METHOD_OPTIONS, LADDER_REQUIREMENT_OPTIONS } from '../lib/models/property';
import {
	SERVICE_SCOPE_OPTIONS,
	INVENTORY_COVERAGE_OPTIONS,
	LABOR_ESTIMATE_CREW_SIZE_OPTIONS,
	LABOR_ESTIMATE_CONFIDENCE_OPTIONS,
	ADJUSTMENT_REASON_OPTIONS,
} from '../lib/models/quote';

type ServiceScope = (typeof SERVICE_SCOPE_OPTIONS)[number];
type InventoryCoverage = (typeof INVENTORY_COVERAGE_OPTIONS)[number];
type ExteriorMethod = (typeof EXTERIOR_CLEANING_METHOD_OPTIONS)[number];
type LadderReq = (typeof LADDER_REQUIREMENT_OPTIONS)[number];
type ScreensMode = 'Not Included' | 'Include All' | 'Custom Quantity';
type TrackMode = 'Not Included' | 'Basic Wipe' | 'Deep Cleaning';
type GlassConditionLevel = (typeof GLASS_CONDITION_LEVELS)[number];

// Trimmed to 3 values, matching Historical Entry's own trimmed scale (see
// HistoricalEntryWizard.tsx) rather than the field-use Walkthrough's fuller
// 5-value list — this is the "how I quote a home" mental model the Quoter
// is being redesigned to match.
const ACCESS_LEVELS = ['Easy', 'Standard', 'Difficult'] as const;

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
	exteriorCleaningMethod: string;
	ladderRequirement: string;
}

interface WalkthroughDefault {
	walkthroughId: string;
	walkthroughDate: string;
	counts: QuoteCounts;
	// Real per-visit observations from this property's latest completed
	// Walkthrough — the accurate source for defaulting the new Job
	// Assessment section below, unlike Property's own legacy Window
	// Condition field (a stale, permanent-record guess this redesign
	// deliberately stops reading).
	exteriorCondition: string;
	interiorCondition: string;
	accessDifficulty: string;
	hardWater: boolean;
	constructionDebris: boolean;
	siliconeResidue: boolean;
	paintOverspray: boolean;
	razorScraping: boolean;
	steelWool: boolean;
	nonScratchPad: boolean;
	restorationNotes: string;
}

/** Everything needed to re-populate the form from an existing Quote — see
 * quoter.astro's `?quoteId=` edit-mode loading. Every field here comes
 * straight from the Quote's own stored Input Snapshot (already this exact
 * shape) except quoteId/clientId/propertyId/pricingConfigId/serviceScope/
 * inventoryCoverage/laborX, which are plain Quote columns. */
export interface InitialQuoteData {
	quoteId: string;
	clientId: string;
	propertyId: string;
	pricingConfigId: string;
	serviceScope: string;
	inventoryCoverage: string;
	counts: QuoteCounts;
	stories: Stories;
	hardWater: boolean;
	constructionDebris: boolean;
	// Job Assessment — see QuoteInput in lib/pricing/types.ts for why
	// exterior/interior Glass Condition and Overall Access Difficulty are
	// stored as their original human-readable selections, not just the
	// engine-derived condition/difficultAccess booleans.
	exteriorGlassCondition: string;
	interiorGlassCondition: string;
	overallAccessDifficulty: string;
	secondStoryExterior: boolean;
	ladderRequired: boolean;
	vaultedInteriorGlass: boolean;
	roofAccessRequired: boolean;
	oversizedGlass: boolean;
	exteriorObstructions: boolean;
	limitedInteriorAccess: boolean;
	waterFedPoleUsed: boolean;
	traditionalExteriorCleaningUsed: boolean;
	otherAccessIssue: boolean;
	otherAccessNotes: string;
	siliconeResidue: boolean;
	paintOverspray: boolean;
	razorScraping: boolean;
	steelWool: boolean;
	nonScratchPad: boolean;
	restorationNotes: string;
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
	/** Present when editing an existing Quote OR duplicating one as a
	 * starting point for a new Quote (see quoter.astro) — pre-fills every
	 * field from it either way. */
	initialQuote?: InitialQuoteData;
	/** Only meaningful when initialQuote is set. 'edit' (the default) locks
	 * Client/Property and submits back to the same Quote ID — an edit
	 * corrects scope/pricing, it never reassigns the quote to a different
	 * property. 'duplicate' pre-fills the same fields but leaves
	 * Client/Property editable and submits as a brand new Quote — the
	 * common case is duplicating onto a different property entirely (e.g.
	 * a multi-unit building's near-identical next unit). */
	quoterMode?: 'edit' | 'duplicate';
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
		quoterMode = 'edit',
	} = props;
	const isEditing = Boolean(initialQuote) && quoterMode === 'edit';
	const isDuplicating = Boolean(initialQuote) && quoterMode === 'duplicate';
	// Duplicate mode keeps Client/Property editable — if the user actually
	// moves off the duplicated-from property, the usual property-change
	// auto-defaults below should kick in just like a fresh quote; staying on
	// it (including on mount) keeps the duplicated values intact.
	const duplicateSourcePropertyId = isDuplicating ? initialQuote?.propertyId : undefined;

	const [clientId, setClientId] = useState(initialQuote?.clientId || preselectedClientId || clients[0]?.id || '');
	const [propertyId, setPropertyId] = useState(initialQuote?.propertyId || preselectedPropertyId || '');
	const [pricingConfigId, setPricingConfigId] = useState(initialQuote?.pricingConfigId ?? '');

	const [serviceScope, setServiceScope] = useState<ServiceScope>((initialQuote?.serviceScope as ServiceScope) || 'Interior & Exterior');
	const [inventoryCoverage, setInventoryCoverage] = useState<InventoryCoverage>(
		(initialQuote?.inventoryCoverage as InventoryCoverage) || 'Selected Windows Only'
	);
	const [counts, setCounts] = useState<QuoteCounts>(initialQuote?.counts ?? EMPTY_COUNTS);
	const [stories, setStories] = useState<Stories>(initialQuote?.stories ?? 1);

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
	// Job Assessment — mirrors Walkthrough/Historical Entry's own model
	// (Glass Condition, Overall Access Difficulty, Access & Equipment
	// Modifiers, Restoration Services Required) instead of the old flat
	// "Current Job Conditions" checklist.
	const [exteriorGlassCondition, setExteriorGlassCondition] = useState<GlassConditionLevel>(
		(initialQuote?.exteriorGlassCondition as GlassConditionLevel) || 'Maintenance'
	);
	const [interiorGlassCondition, setInteriorGlassCondition] = useState<GlassConditionLevel>(
		(initialQuote?.interiorGlassCondition as GlassConditionLevel) || 'Maintenance'
	);
	const [overallAccessDifficulty, setOverallAccessDifficulty] = useState<(typeof ACCESS_LEVELS)[number]>(
		(initialQuote?.overallAccessDifficulty as (typeof ACCESS_LEVELS)[number]) || 'Easy'
	);
	const [secondStoryExterior, setSecondStoryExterior] = useState(initialQuote?.secondStoryExterior ?? false);
	const [ladderRequired, setLadderRequired] = useState(initialQuote?.ladderRequired ?? false);
	const [vaultedInteriorGlass, setVaultedInteriorGlass] = useState(initialQuote?.vaultedInteriorGlass ?? false);
	const [roofAccessRequired, setRoofAccessRequired] = useState(initialQuote?.roofAccessRequired ?? false);
	const [oversizedGlass, setOversizedGlass] = useState(initialQuote?.oversizedGlass ?? false);
	const [exteriorObstructions, setExteriorObstructions] = useState(initialQuote?.exteriorObstructions ?? false);
	const [limitedInteriorAccess, setLimitedInteriorAccess] = useState(initialQuote?.limitedInteriorAccess ?? false);
	const [waterFedPoleUsed, setWaterFedPoleUsed] = useState(initialQuote?.waterFedPoleUsed ?? false);
	const [traditionalExteriorCleaningUsed, setTraditionalExteriorCleaningUsed] = useState(initialQuote?.traditionalExteriorCleaningUsed ?? false);
	const [otherAccessIssue, setOtherAccessIssue] = useState(initialQuote?.otherAccessIssue ?? false);
	const [otherAccessNotes, setOtherAccessNotes] = useState(initialQuote?.otherAccessNotes ?? '');

	const [hardWater, setHardWater] = useState(initialQuote?.hardWater ?? false);
	const [constructionDebris, setConstructionDebris] = useState(initialQuote?.constructionDebris ?? false);
	const [siliconeResidue, setSiliconeResidue] = useState(initialQuote?.siliconeResidue ?? false);
	const [paintOverspray, setPaintOverspray] = useState(initialQuote?.paintOverspray ?? false);
	const [razorScraping, setRazorScraping] = useState(initialQuote?.razorScraping ?? false);
	const [steelWool, setSteelWool] = useState(initialQuote?.steelWool ?? false);
	const [nonScratchPad, setNonScratchPad] = useState(initialQuote?.nonScratchPad ?? false);
	const [restorationNotes, setRestorationNotes] = useState(initialQuote?.restorationNotes ?? '');

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

	// Property Details quick-edit — lets the crew fix a few permanent
	// property facts right here instead of navigating to the Property Detail
	// page and losing their place in the quote. Saved back to the Property
	// record alongside the quote (see quoter.astro's POST handler). These are
	// property facts, not QuoteInput fields, so they're plain named inputs
	// submitted directly — no engine/effectiveCounts involvement.
	const [totalWindowUnits, setTotalWindowUnits] = useState(summary?.totalWindowUnits ?? '');
	const [totalGlassPanes, setTotalGlassPanes] = useState(summary?.totalGlassPanes ?? '');
	const [exteriorCleaningMethod, setExteriorCleaningMethod] = useState<ExteriorMethod>(
		(summary?.exteriorCleaningMethod as ExteriorMethod) || 'Undetermined'
	);
	const [ladderRequirement, setLadderRequirement] = useState<LadderReq>((summary?.ladderRequirement as LadderReq) || 'None');

	// Reset every property-derived field whenever the selected property
	// changes — pre-filling Quote Inventory and the Job Assessment section
	// from the property's latest completed Walkthrough (a real per-visit
	// observation), so the diff notice below has a real baseline to compare
	// against rather than always firing. Property's own legacy Window
	// Condition field is deliberately not read here — it's a stale,
	// permanent-record guess superseded by the Walkthrough model.
	useEffect(() => {
		// Editing an existing Quote: Client/Property are fixed (see the
		// read-only display below) and every field already comes from the
		// Quote itself — this auto-defaulting only applies to a fresh quote.
		if (isEditing) return;
		// Duplicating: still sitting on the property duplicated from — keep
		// the duplicated values instead of overwriting them with that same
		// property's auto-defaults.
		if (isDuplicating && propertyId === duplicateSourcePropertyId) return;
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
			setExteriorGlassCondition((GLASS_CONDITION_LEVELS as readonly string[]).includes(wt.exteriorCondition) ? (wt.exteriorCondition as GlassConditionLevel) : 'Maintenance');
			setInteriorGlassCondition((GLASS_CONDITION_LEVELS as readonly string[]).includes(wt.interiorCondition) ? (wt.interiorCondition as GlassConditionLevel) : 'Maintenance');
			setOverallAccessDifficulty(
				wt.accessDifficulty === 'Difficult' || wt.accessDifficulty === 'Specialty Access'
					? 'Difficult'
					: wt.accessDifficulty === 'Standard'
						? 'Standard'
						: 'Easy'
			);
			setHardWater(wt.hardWater);
			setConstructionDebris(wt.constructionDebris);
			setSiliconeResidue(wt.siliconeResidue);
			setPaintOverspray(wt.paintOverspray);
			setRazorScraping(wt.razorScraping);
			setSteelWool(wt.steelWool);
			setNonScratchPad(wt.nonScratchPad);
			setRestorationNotes(wt.restorationNotes);
		} else {
			setInventoryCoverage('Selected Windows Only');
			setCounts(EMPTY_COUNTS);
			setScreensMode('Not Included');
			setScreensCustomQty('0');
			setTrackMode('Not Included');
			setTrackQty('0');
			setSkylightsIncluded(false);
			setExteriorGlassCondition('Maintenance');
			setInteriorGlassCondition('Maintenance');
			setOverallAccessDifficulty('Easy');
			setHardWater(false);
			setConstructionDebris(false);
			setSiliconeResidue(false);
			setPaintOverspray(false);
			setRazorScraping(false);
			setSteelWool(false);
			setNonScratchPad(false);
			setRestorationNotes('');
		}
		// Access & Equipment Modifiers never auto-default from a Walkthrough
		// — WalkthroughWizard doesn't collect them yet either, so there's no
		// real signal to pre-fill from; the crew checks whatever applies
		// fresh on this visit.

		const s = propertySummaryById[propertyId];
		if (s) {
			setStories(s.stories === '2' ? 2 : s.stories === '3' ? 3 : 1);
			setTotalWindowUnits(s.totalWindowUnits || '');
			setTotalGlassPanes(s.totalGlassPanes || '');
			setExteriorCleaningMethod((s.exteriorCleaningMethod as ExteriorMethod) || 'Undetermined');
			setLadderRequirement((s.ladderRequirement as LadderReq) || 'None');
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

	const restorationFlagsActive = hasAnyRestorationFlag({
		hardWaterPresent: hardWater,
		constructionDebrisPresent: constructionDebris,
		siliconeResidue,
		paintOverspray,
		razorScraping,
		steelWool,
		nonScratchPad,
	});
	const condition = conditionForEngine(exteriorGlassCondition, restorationFlagsActive);
	const difficultAccess = overallAccessDifficulty === 'Difficult';

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

	// Compares against the property's latest Walkthrough (the real source
	// this section auto-fills from) rather than a permanent property fact —
	// a mismatch here just means this particular job differs from what was
	// last observed, not that something needs correcting.
	const conditionsDiffer =
		!!walkthroughDefault &&
		(exteriorGlassCondition !== walkthroughDefault.exteriorCondition ||
			hardWater !== walkthroughDefault.hardWater ||
			constructionDebris !== walkthroughDefault.constructionDebris);

	// A window (or sliding door, or skylight) always has both an interior
	// and exterior side — Quote Inventory asks for one count per type and
	// applies it to both ext/int fields at once, rather than making the crew
	// enter the same number twice. Service Scope (below) still narrows which
	// side actually gets priced via effectiveCounts.
	function setPairedCount(extKey: keyof QuoteCounts, intKey: keyof QuoteCounts, value: string) {
		const n = Number(value) || 0;
		setCounts((prev) => ({ ...prev, [extKey]: n, [intKey]: n }));
	}

	const laborTotalHours = (Number(laborSoloHours) || 0) * (laborCrewSize === '3+' ? 3 : Number(laborCrewSize));

	const editingClient = clients.find((c) => c.id === clientId);
	const editingProperty = properties.find((p) => p.id === propertyId);

	return (
		<form method="POST" className="quoter-layout">
			{isEditing && <input type="hidden" name="quoteId" value={initialQuote!.quoteId} />}
			<div className="quoter-main">
				<section className="card">
					<span className="badge">
						{isEditing ? 'Editing Quote' : isDuplicating ? 'Duplicating Quote — Saves as New' : 'In-Field Quote · Not an Official Estimate'}
					</span>
					<h2>Quote Header</h2>
					{isEditing ? (
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
						<div className="card" style={{ background: 'var(--color-cream)' }}>
							<h3>Property Details</h3>
							<p className="field-hint">Saves to the property when you save this quote — no need to open a separate page.</p>
							<p className="field-label">Stories</p>
							<div className="segmented">
								{([1, 2, 3] as const).map((n) => (
									<label key={n}>
										<input type="radio" name="stories" value={n} checked={stories === n} onChange={() => setStories(n)} />
										{n}
									</label>
								))}
							</div>
							<div className="count-grid" style={{ marginTop: '0.75rem' }}>
								<label>
									Window units
									<input
										type="number"
										className="field-numeric"
										min="0"
										name="totalWindowUnits"
										value={totalWindowUnits}
										onChange={(e) => setTotalWindowUnits(e.target.value)}
									/>
								</label>
								<label>
									Glass panes
									<input
										type="number"
										className="field-numeric"
										min="0"
										name="totalGlassPanes"
										value={totalGlassPanes}
										onChange={(e) => setTotalGlassPanes(e.target.value)}
									/>
								</label>
							</div>
							<p className="field-label" style={{ marginTop: '0.75rem' }}>Typical Exterior Method</p>
							<Segmented name="exteriorCleaningMethod" options={EXTERIOR_CLEANING_METHOD_OPTIONS} value={exteriorCleaningMethod} onChange={setExteriorCleaningMethod} />
							<p className="field-label" style={{ marginTop: '0.75rem' }}>Ladder Requirement</p>
							<Segmented name="ladderRequirement" options={LADDER_REQUIREMENT_OPTIONS} value={ladderRequirement} onChange={setLadderRequirement} />
						</div>
					)}
					{propertyId && (
						<p className="field-hint">
							<a href={`/properties/${propertyId}`}>View full Property page →</a>
						</p>
					)}
				</section>

				<section className="card">
					<h2>Service Scope</h2>
					<p className="field-label">Primary scope</p>
					<Segmented name="serviceScope" options={SERVICE_SCOPE_OPTIONS} value={serviceScope} onChange={setServiceScope} />
					{(serviceScope === 'Exterior Only' || serviceScope === 'Interior Only') && (
						<p className="field-hint">
							Quote Inventory counts below cover both sides automatically — with {serviceScope} selected, only the{' '}
							{serviceScope === 'Exterior Only' ? 'exterior' : 'interior'} side of each is priced.
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
					<p className="field-hint">Hard water and construction debris/restoration cleaning move to the Restoration Services Required card below.</p>
				</section>

				<section className="card">
					<h2>Quote Inventory</h2>
					<p className="field-hint">One count per type — a window is always both interior and exterior. Service Scope above narrows which side is actually priced.</p>
					{!editableInventory && <p className="field-hint">Read-only — from the latest walkthrough. Switch Inventory Coverage to edit.</p>}
					<div className="count-grid">
						<label>
							Standard windows
							<input
								type="number"
								className="field-numeric"
								min="0"
								disabled={!editableInventory}
								value={Math.max(counts.windowExtStandard, counts.windowIntStandard)}
								onChange={(e) => setPairedCount('windowExtStandard', 'windowIntStandard', e.target.value)}
							/>
						</label>
						<label>
							Oversized windows
							<input
								type="number"
								className="field-numeric"
								min="0"
								disabled={!editableInventory}
								value={Math.max(counts.windowExtOversized, counts.windowIntOversized)}
								onChange={(e) => setPairedCount('windowExtOversized', 'windowIntOversized', e.target.value)}
							/>
						</label>
						<label>
							Divided-Light windows
							<input
								type="number"
								className="field-numeric"
								min="0"
								disabled={!editableInventory}
								value={Math.max(counts.windowExtFrenchPane, counts.windowIntFrenchPane)}
								onChange={(e) => setPairedCount('windowExtFrenchPane', 'windowIntFrenchPane', e.target.value)}
							/>
						</label>
						<label>
							Sliding doors
							<input
								type="number"
								className="field-numeric"
								min="0"
								disabled={!editableInventory}
								value={Math.max(counts.slidingDoorExt, counts.slidingDoorInt)}
								onChange={(e) => setPairedCount('slidingDoorExt', 'slidingDoorInt', e.target.value)}
							/>
						</label>
						{skylightsIncluded && (
							<label>
								Skylights
								<input
									type="number"
									className="field-numeric"
									min="0"
									disabled={!editableInventory}
									value={Math.max(counts.skylightExt, counts.skylightInt)}
									onChange={(e) => setPairedCount('skylightExt', 'skylightInt', e.target.value)}
								/>
							</label>
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
					<h2>Job Assessment</h2>
					<span className="field-hint">
						How this specific visit looks — matches the same Glass Condition / Access Difficulty / Restoration Services model used in
						Walkthroughs and Historical Entry.
					</span>
					{conditionsDiffer && (
						<p className="diff-notice">
							This quote differs from the property's latest walkthrough.
							<br />
							{walkthroughDefault ? (
								<a href={`/walkthroughs/${walkthroughDefault.walkthroughId}`}>View that walkthrough</a>
							) : null}{' '}
							<em>— informational only, nothing is overwritten automatically.</em>
						</p>
					)}

					<p className="field-label">Overall Access Difficulty</p>
					<Segmented name="overallAccessDifficulty" options={ACCESS_LEVELS} value={overallAccessDifficulty} onChange={setOverallAccessDifficulty} />
					<p className="field-hint">Drives the difficult-access pricing surcharge — "Difficult" applies it, "Easy"/"Standard" don't.</p>

					<p className="field-label" style={{ marginTop: '1rem' }}>Exterior Glass Condition</p>
					<Segmented name="exteriorGlassCondition" options={GLASS_CONDITION_LEVELS} value={exteriorGlassCondition} onChange={setExteriorGlassCondition} />
					<p className="field-label" style={{ marginTop: '1rem' }}>Interior Glass Condition</p>
					<Segmented name="interiorGlassCondition" options={GLASS_CONDITION_LEVELS} value={interiorGlassCondition} onChange={setInteriorGlassCondition} />

					<fieldset style={{ marginTop: '1rem' }}>
						<legend>Access &amp; Equipment Modifiers</legend>
						<div className="checkbox-grid">
							<label>
								<input type="checkbox" checked={secondStoryExterior} onChange={(e) => setSecondStoryExterior(e.target.checked)} /> Second-Story Exterior
							</label>
							<label>
								<input type="checkbox" checked={ladderRequired} onChange={(e) => setLadderRequired(e.target.checked)} /> Ladder Required
							</label>
							<label>
								<input type="checkbox" checked={vaultedInteriorGlass} onChange={(e) => setVaultedInteriorGlass(e.target.checked)} /> Vaulted Interior Glass
							</label>
							<label>
								<input type="checkbox" checked={roofAccessRequired} onChange={(e) => setRoofAccessRequired(e.target.checked)} /> Roof Access Required
							</label>
							<label>
								<input type="checkbox" checked={oversizedGlass} onChange={(e) => setOversizedGlass(e.target.checked)} /> Oversized Glass / Large Sliders
							</label>
							<label>
								<input type="checkbox" checked={exteriorObstructions} onChange={(e) => setExteriorObstructions(e.target.checked)} /> Tight Landscaping or Obstructions
							</label>
							<label>
								<input type="checkbox" checked={limitedInteriorAccess} onChange={(e) => setLimitedInteriorAccess(e.target.checked)} /> Limited Interior Access
							</label>
							<label>
								<input type="checkbox" checked={waterFedPoleUsed} onChange={(e) => setWaterFedPoleUsed(e.target.checked)} /> Water-Fed Pole Used
							</label>
							<label>
								<input type="checkbox" checked={traditionalExteriorCleaningUsed} onChange={(e) => setTraditionalExteriorCleaningUsed(e.target.checked)} /> Traditional Exterior Cleaning Used
							</label>
							<label>
								<input type="checkbox" checked={otherAccessIssue} onChange={(e) => setOtherAccessIssue(e.target.checked)} /> Other Access Issue
							</label>
						</div>
						{otherAccessIssue && (
							<label>
								Other Access Notes
								<textarea value={otherAccessNotes} onChange={(e) => setOtherAccessNotes(e.target.value)} />
							</label>
						)}
					</fieldset>

					<div className="card" style={{ background: 'var(--color-cream)', marginTop: '1rem' }}>
						<h3>Restoration Services Required</h3>
						<span className="field-hint">
							Specialized cleaning beyond a standard window cleaning — supplements the condition rating above, doesn't replace it.
						</span>
						<div className="checkbox-grid">
							<label>
								<input type="checkbox" checked={constructionDebris} onChange={(e) => setConstructionDebris(e.target.checked)} /> Construction Debris
							</label>
							<label>
								<input type="checkbox" checked={siliconeResidue} onChange={(e) => setSiliconeResidue(e.target.checked)} /> Window Stickers / Adhesive
							</label>
							<label>
								<input type="checkbox" checked={paintOverspray} onChange={(e) => setPaintOverspray(e.target.checked)} /> Paint Overspray
							</label>
							<label>
								<input type="checkbox" checked={hardWater} onChange={(e) => setHardWater(e.target.checked)} /> Hard Water / Mineral Deposits
							</label>
							<label>
								<input type="checkbox" checked={razorScraping} onChange={(e) => setRazorScraping(e.target.checked)} /> Razor Scraping Required
							</label>
							<label>
								<input type="checkbox" checked={steelWool} onChange={(e) => setSteelWool(e.target.checked)} /> Steel Wool Required
							</label>
							<label>
								<input type="checkbox" checked={nonScratchPad} onChange={(e) => setNonScratchPad(e.target.checked)} /> Non-Scratch Pad Required
							</label>
						</div>
						<label>
							Other
							<textarea value={restorationNotes} onChange={(e) => setRestorationNotes(e.target.value)} />
						</label>
						<p className="field-hint">Any of the boxes above (or Restoration Required condition) applies the First-Time Cleaning surcharge.</p>
					</div>

					<input type="hidden" name="hardWater" value={hardWater ? 'on' : ''} />
					<input type="hidden" name="constructionDebris" value={constructionDebris ? 'on' : ''} />
					<input type="hidden" name="secondStoryExterior" value={secondStoryExterior ? 'on' : ''} />
					<input type="hidden" name="ladderRequired" value={ladderRequired ? 'on' : ''} />
					<input type="hidden" name="vaultedInteriorGlass" value={vaultedInteriorGlass ? 'on' : ''} />
					<input type="hidden" name="roofAccessRequired" value={roofAccessRequired ? 'on' : ''} />
					<input type="hidden" name="oversizedGlass" value={oversizedGlass ? 'on' : ''} />
					<input type="hidden" name="exteriorObstructions" value={exteriorObstructions ? 'on' : ''} />
					<input type="hidden" name="limitedInteriorAccess" value={limitedInteriorAccess ? 'on' : ''} />
					<input type="hidden" name="waterFedPoleUsed" value={waterFedPoleUsed ? 'on' : ''} />
					<input type="hidden" name="traditionalExteriorCleaningUsed" value={traditionalExteriorCleaningUsed ? 'on' : ''} />
					<input type="hidden" name="otherAccessIssue" value={otherAccessIssue ? 'on' : ''} />
					<input type="hidden" name="otherAccessNotes" value={otherAccessNotes} />
					<input type="hidden" name="siliconeResidue" value={siliconeResidue ? 'on' : ''} />
					<input type="hidden" name="paintOverspray" value={paintOverspray ? 'on' : ''} />
					<input type="hidden" name="razorScraping" value={razorScraping ? 'on' : ''} />
					<input type="hidden" name="steelWool" value={steelWool ? 'on' : ''} />
					<input type="hidden" name="nonScratchPad" value={nonScratchPad ? 'on' : ''} />
					<input type="hidden" name="restorationNotes" value={restorationNotes} />
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
					{isEditing ? 'Update Quote' : 'Save Quote'}
				</button>
			</aside>
		</form>
	);
}
