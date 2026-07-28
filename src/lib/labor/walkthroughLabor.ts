import { createRelatedRows, type SheetsEnv } from '../sheets';
import { walkthroughConfig, type Walkthrough } from '../models/walkthrough';
import { walkthroughItemConfig, type WalkthroughItem } from '../models/walkthroughItem';
import { walkthroughAdjustmentConfig, type WalkthroughAdjustment } from '../models/walkthroughAdjustment';
import type { PricingConfig } from '../models/pricingConfig';
import type { LaborModel } from './config';
import { estimateLabor, type ComponentConditions, type LaborEstimate, type LaborScope, type WindowGroup } from './estimate';
import { suggestSchedule, type ScheduleSuggestion } from './schedule';
import { suggestPriceBand, type PriceBand } from './price';
import type { AdjustmentKind, ProductionClass, RestorationService } from './types';

/** A grouped inventory row as the wizard sends it — strings, because that's
 * what a form produces and what the Sheet stores. */
export interface WindowGroupInput {
	id: string;
	quantity: string;
	productionClass: string;
	sizeClass?: string;
	story?: string;
	interiorAccess?: string;
	exteriorAccess?: string;
	panesPerUnit?: string;
	screensPerUnit?: string;
	tracksPerUnit?: string;
	specialtyDescription?: string;
	notes?: string;
}

export interface AdjustmentInput {
	id: string;
	kind: AdjustmentKind;
	label: string;
	affectedUnits?: string;
	affectedPanes?: string;
	additionalMinutes?: string;
	notes?: string;
}

export interface LaborWalkthroughInput {
	groups: WindowGroupInput[];
	adjustments: AdjustmentInput[];
	scope: LaborScope;
	conditions: ComponentConditions;
	manualScreenTotal?: string;
	manualTrackTotal?: string;
	scheduledMinutesOverride?: string;
}

export interface LaborWalkthroughResult {
	estimate: LaborEstimate;
	schedule: ScheduleSuggestion;
	band: PriceBand;
}

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

/** Blank stays blank: an unfilled per-unit count means "the typical amount
 * for this class", which the production profile answers. Coercing it to 0
 * here would silently mean "this window has no screen". */
function optionalNum(value: string | undefined): number | undefined {
	if (value === undefined || value === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

export function toWindowGroups(inputs: WindowGroupInput[]): WindowGroup[] {
	return inputs.map((g) => ({
		id: g.id,
		quantity: num(g.quantity),
		productionClass: g.productionClass as ProductionClass,
		sizeClass: (g.sizeClass || '') as WindowGroup['sizeClass'],
		story: (g.story || '') as WindowGroup['story'],
		interiorAccess: (g.interiorAccess || '') as WindowGroup['interiorAccess'],
		exteriorAccess: (g.exteriorAccess || '') as WindowGroup['exteriorAccess'],
		panesPerUnit: optionalNum(g.panesPerUnit),
		screensPerUnit: optionalNum(g.screensPerUnit),
		tracksPerUnit: optionalNum(g.tracksPerUnit),
	}));
}

/** The whole calculation in one call — labor, then schedule, then price.
 * Pure; both the live preview and the save path go through it, so what the
 * operator sees on the review screen is exactly what gets stored. */
export function computeWalkthroughLabor(
	model: LaborModel,
	pricingConfig: PricingConfig,
	input: LaborWalkthroughInput
): LaborWalkthroughResult {
	const estimate = estimateLabor(model, {
		groups: toWindowGroups(input.groups),
		scope: input.scope,
		conditions: input.conditions,
		adjustments: input.adjustments.map((a) => ({
			kind: a.kind,
			label: a.label,
			additionalMinutes: num(a.additionalMinutes),
		})),
		manualTotals: {
			screens: optionalNum(input.manualScreenTotal),
			tracks: optionalNum(input.manualTrackTotal),
		},
	});

	const schedule = suggestSchedule(model, estimate.productiveMinutes, {
		hazardousAccess: estimate.hazardousAccess,
		overrideMinutes: optionalNum(input.scheduledMinutesOverride),
	});

	return { estimate, schedule, band: suggestPriceBand(pricingConfig, estimate.productiveMinutes) };
}

/**
 * Restoration line items also set the walkthrough's existing Y/N columns.
 *
 * Those columns are read by the quote's Input Snapshot, by the walkthrough
 * detail page, and by calibration's segmentation. Writing only the new
 * adjustment rows would leave all three quietly blind to restoration work
 * that the operator did record — so the line item is the source of truth for
 * labor, and the flag stays as the thing everything else already reads.
 */
const RESTORATION_FLAG_COLUMNS: Partial<Record<RestorationService, keyof Walkthrough>> = {
	'Construction Debris': 'Construction Debris Present (Y/N)',
	'Stickers or Adhesive': 'Silicone Adhesive Or Sticker Residue (Y/N)',
	'Paint Overspray': 'Paint Overspray (Y/N)',
	'Hard Water or Mineral Deposits': 'Hard Water Present (Y/N)',
	'Razor Scraping': 'Razor Scraping Required (Y/N)',
	'Steel Wool or Fine Abrasive': 'Steel Wool Required (Y/N)',
	'Non-Scratch Pad Work': 'Non-Scratch Pad Required (Y/N)',
};

export interface SaveLaborWalkthroughPayload extends LaborWalkthroughInput {
	id: string;
	clientId: string;
	propertyId: string;
	opportunityId?: string;
	walkthroughDate: string;
	conductedBy?: string;
	notes?: string;
	conditionNotes?: string;
	temporaryAccessNotes?: string;
	restorationNotes?: string;
	storyCountObserved?: string;
	ladderRequired?: string;
	roofAccessRequired?: string;
	waterFedPoleSuitable?: boolean;
	exteriorAccessObstructed?: boolean;
	furnitureMovementRequired?: boolean;
	ownerSelectedPrice?: string;
	ownerOverrideReason?: string;
	scheduleRecommendationOverride?: string;
}

export interface SaveLaborWalkthroughResult extends LaborWalkthroughResult {
	walkthrough: Walkthrough;
	groups: WalkthroughItem[];
	adjustments: WalkthroughAdjustment[];
}

export async function saveLaborWalkthrough(
	env: SheetsEnv,
	model: LaborModel,
	pricingConfig: PricingConfig,
	payload: SaveLaborWalkthroughPayload,
	meta: { user?: string; requestId?: string } = {}
): Promise<SaveLaborWalkthroughResult> {
	const computed = computeWalkthroughLabor(model, pricingConfig, payload);
	const { estimate, schedule, band } = computed;

	const groupRecords = payload.groups.map((g, index) => ({
		id: g.id,
		'Walkthrough ID': payload.id,
		'Production Class': g.productionClass,
		Quantity: g.quantity,
		'Size Class': g.sizeClass ?? '',
		Story: g.story ?? '',
		'Interior Access': g.interiorAccess ?? '',
		'Exterior Access': g.exteriorAccess ?? '',
		'Panes Per Unit': g.panesPerUnit ?? '',
		'Screens Per Unit': g.screensPerUnit ?? '',
		'Tracks Per Unit': g.tracksPerUnit ?? '',
		'Specialty Description': g.specialtyDescription ?? '',
		'Interior Included': payload.scope.interior ? 'Y' : 'N',
		'Exterior Included': payload.scope.exterior ? 'Y' : 'N',
		Notes: g.notes ?? '',
		'Sort Order': String(index),
	}));

	const adjustmentRecords = payload.adjustments.map((a, index) => ({
		id: a.id,
		'Walkthrough ID': payload.id,
		Kind: a.kind,
		Label: a.label,
		'Affected Units': a.affectedUnits ?? '',
		'Affected Panes': a.affectedPanes ?? '',
		'Additional Minutes': a.additionalMinutes ?? '',
		Notes: a.notes ?? '',
		'Sort Order': String(index),
	}));

	// Every mapped flag is written, 'N' included. A restoration service the
	// operator looked at and didn't select is a real "no", and calibration's
	// segmentation reads a blank as "unknown" — leaving them empty would turn
	// a decision into missing data.
	const restorationFlags: Partial<Record<keyof Walkthrough, string>> = {};
	for (const column of Object.values(RESTORATION_FLAG_COLUMNS)) restorationFlags[column] = 'N';
	for (const adjustment of payload.adjustments) {
		if (adjustment.kind !== 'Restoration') continue;
		const column = RESTORATION_FLAG_COLUMNS[adjustment.label as RestorationService];
		if (column) restorationFlags[column] = 'Y';
	}

	const { created } = await createRelatedRows(
		env,
		[
			{
				config: walkthroughConfig,
				records: [
					{
						id: payload.id,
						'Client ID': payload.clientId,
						'Property ID': payload.propertyId,
						'Opportunity ID': payload.opportunityId ?? '',
						'Walkthrough Date': payload.walkthroughDate,
						Status: 'Completed',
						'Conducted By': payload.conductedBy ?? '',

						// Component conditions.
						'Interior Glass Condition': payload.conditions.interiorGlass ?? '',
						'Track Condition': payload.conditions.track ?? '',
						'Exterior Glass Condition': payload.conditions.exteriorGlass ?? '',
						'Exterior Frame Condition': payload.conditions.exteriorFrame ?? '',
						'Screen Condition': payload.conditions.screen ?? '',
						// The two broad fields these replaced are still written,
						// mirroring their glass equivalents. createQuoteFromWalkthrough,
						// the detail page and calibration all still read them, and a
						// v2 walkthrough that left them blank would look, to every one
						// of those, like a walkthrough with no condition recorded.
						'Exterior Condition': payload.conditions.exteriorGlass ?? '',
						'Interior Condition': payload.conditions.interiorGlass ?? '',

						'Screens Included (Y/N)': payload.scope.screens ? 'Y' : 'N',
						'Tracks Included (Y/N)': payload.scope.tracks ? 'Y' : 'N',
						'Frames Included (Y/N)': payload.scope.frames ? 'Y' : 'N',
						'Interior Included (Y/N)': payload.scope.interior ? 'Y' : 'N',
						'Exterior Included (Y/N)': payload.scope.exterior ? 'Y' : 'N',

						// Totals as computed from the groups, so every existing
						// reader — the property page, the walkthrough list, the
						// legacy count resolver — keeps working unchanged.
						'Total Window Units': String(estimate.totals.windowUnits),
						'Total Glass Panes': String(estimate.totals.glassPanes),
						'Total Screens': String(estimate.totals.screens),
						'Total Tracks': String(estimate.totals.tracks),
						'Manual Screen Total': payload.manualScreenTotal ?? '',
						'Manual Track Total': payload.manualTrackTotal ?? '',
						'Count Entry Mode': 'grouped',
						'Inventory Model': 'grouped-v2',

						'Productive Labor Minutes': estimate.productiveMinutes.toFixed(1),
						'Scheduled Minutes': schedule.scheduledMinutes.toFixed(1),
						'Scheduled Minutes Override': payload.scheduledMinutesOverride ?? '',
						'Schedule Recommendation': payload.scheduleRecommendationOverride || schedule.recommendation,
						'Labor Breakdown (JSON)': JSON.stringify({
							breakdown: estimate.breakdown,
							totals: estimate.totals,
							explanation: estimate.explanation,
							hazardousAccess: estimate.hazardousAccess,
							scheduleReasons: schedule.reasons,
						}),
						'Labor Model Version': estimate.laborModelVersion,
						'Labor Config ID': estimate.laborConfigId,

						// Kept for continuity with the older shape of this record.
						'Estimated On-Site Labor Hours': (estimate.productiveMinutes / 60).toFixed(2),
						'Story Count Observed': payload.storyCountObserved ?? '',
						'Access Difficulty': '',
						'Suggested Low Price': String(band.low),
						'Suggested Target Price': String(band.target),
						'Suggested High Price': String(band.high),
						'Owner Override Price': payload.ownerSelectedPrice ?? '',
						'Pricing Config ID': band.pricingConfigId,

						'Water-Fed Pole Suitable (Y/N)': payload.waterFedPoleSuitable ? 'Y' : 'N',
						'Ladder Required': payload.ladderRequired ?? '',
						'Roof Access Required': payload.roofAccessRequired ?? '',
						'Exterior Access Obstructed (Y/N)': payload.exteriorAccessObstructed ? 'Y' : 'N',
						'Furniture Or Belongings Movement Required (Y/N)': payload.furnitureMovementRequired ? 'Y' : 'N',
						'Temporary Access Notes': payload.temporaryAccessNotes ?? '',
						'Condition Notes': payload.conditionNotes ?? '',
						'Restoration Notes': payload.restorationNotes ?? '',
						...restorationFlags,
						Notes: payload.notes ?? '',
					},
				],
			},
			{ config: walkthroughItemConfig, records: groupRecords },
			{ config: walkthroughAdjustmentConfig, records: adjustmentRecords },
		],
		meta
	);

	return {
		...computed,
		walkthrough: created[0][0] as Walkthrough,
		groups: created[1] as WalkthroughItem[],
		adjustments: created[2] as WalkthroughAdjustment[],
	};
}
