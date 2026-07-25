// Walkthrough -> pricing preview -> Quote. Reuses the exact same shared
// pricing engine (calculateQuote) the in-field quoter uses — one
// calculation path, never a second one for walkthroughs.
import { createRelatedRows, findById, listActiveRows, updateRow, type SheetsEnv } from '../sheets';
import { walkthroughConfig, type Walkthrough } from '../models/walkthrough';
import { walkthroughItemConfig, type WalkthroughItem } from '../models/walkthroughItem';
import { quoteConfig } from '../models/quote';
import { quoteItemConfig } from '../models/quoteItem';
import type { PricingConfig } from '../models/pricingConfig';
import type { Service } from '../models/service';
import { calculateQuote } from './engine';
import { createQuote, type CreateQuoteResult } from './quotes';
import type { Condition, QuoteCounts, Stories } from './types';

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

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

/** Item Type + Size Class -> the QuoteCounts key for one side (ext/int) —
 * reuses the Services catalog's own taxonomy rather than a second one.
 * Track Included always maps to the basic track service; the deep-track
 * distinction isn't captured at the walkthrough-item level yet. */
function countsKeyFor(item: WalkthroughItem, side: 'ext' | 'int'): keyof QuoteCounts | null {
	if (item['Item Type'] === 'Window') {
		if (item['Size Class'] === 'Oversized') return side === 'ext' ? 'windowExtOversized' : 'windowIntOversized';
		if (item['Size Class'] === 'French/Divided-Light') return side === 'ext' ? 'windowExtFrenchPane' : 'windowIntFrenchPane';
		return side === 'ext' ? 'windowExtStandard' : 'windowIntStandard';
	}
	if (item['Item Type'] === 'Sliding Door') return side === 'ext' ? 'slidingDoorExt' : 'slidingDoorInt';
	if (item['Item Type'] === 'Skylight') return side === 'ext' ? 'skylightExt' : 'skylightInt';
	return null;
}

export function itemsToQuoteCounts(items: WalkthroughItem[]): QuoteCounts {
	const counts: QuoteCounts = { ...EMPTY_COUNTS };
	for (const item of items) {
		const quantity = num(item.Quantity);
		if (quantity <= 0) continue;
		if (item['Exterior Included'] === 'Y') {
			const key = countsKeyFor(item, 'ext');
			if (key) counts[key] += quantity;
		}
		if (item['Interior Included'] === 'Y') {
			const key = countsKeyFor(item, 'int');
			if (key) counts[key] += quantity;
		}
		if (item['Screen Included'] === 'Y') counts.screenClean += quantity;
		if (item['Track Included'] === 'Y') counts.trackBasic += quantity;
	}
	return counts;
}

/** Window-characteristic calibration reporting: sums item Quantity (not
 * row count — one row can represent several physical windows) for items
 * whose per-item Access Difficulty is 'Difficult' or 'Specialty Access'.
 * This data is already collected by the wizard today (see WalkthroughItem's
 * own Access Difficulty field) but was previously discarded entirely once
 * itemsToQuoteCounts() rolled everything into aggregate window counts —
 * this preserves it instead, purely for later calibration reporting. Never
 * read by the pricing engine. */
export interface AccessDifficultyItemCounts {
	difficultAccessItemCount: number;
	specialtyAccessItemCount: number;
}

export function countAccessDifficultyItems(items: WalkthroughItem[]): AccessDifficultyItemCounts {
	let difficultAccessItemCount = 0;
	let specialtyAccessItemCount = 0;
	for (const item of items) {
		const quantity = num(item.Quantity);
		if (quantity <= 0) continue;
		if (item['Access Difficulty'] === 'Difficult') difficultAccessItemCount += quantity;
		else if (item['Access Difficulty'] === 'Specialty Access') specialtyAccessItemCount += quantity;
	}
	return { difficultAccessItemCount, specialtyAccessItemCount };
}

const EXTERIOR_CONDITION_TO_ENGINE: Record<string, Condition> = {
	Maintenance: 'light',
	'Light Buildup': 'light',
	'Moderate Buildup': 'moderate',
	'Heavy Buildup': 'heavy',
};

/**
 * The Glass Condition level (how dirty the glass is) maps to the engine's
 * light/moderate/heavy tiers. But if any Restoration Services Required
 * checkbox is set, that overrides the level entirely — this preserves the
 * exact pricing behavior the old "Restoration Required" condition level
 * used to trigger (the First-Time Cleaning Factor surcharge), just with a
 * more accurate trigger condition (any of the 8 restoration flags, not one
 * blunt dropdown value) now that restoration is tracked separately from
 * dirtiness. See the Restoration Services Required addendum for why.
 */
export function conditionForEngine(exteriorCondition: string, hasRestorationFlag: boolean): Condition {
	if (hasRestorationFlag) return 'firstTime';
	return EXTERIOR_CONDITION_TO_ENGINE[exteriorCondition] ?? 'light';
}

export function storiesForEngine(storyCountObserved: string): Stories {
	const n = num(storyCountObserved);
	return n === 2 ? 2 : n === 3 ? 3 : 1;
}

export interface WalkthroughPricingInput {
	storyCountObserved: string;
	exteriorCondition: string;
	hardWaterPresent: boolean;
	constructionDebrisPresent: boolean;
	accessDifficulty: string;
	// Restoration Services Required — reporting only, except for their
	// combined effect on conditionForEngine's firstTime override (see
	// there). hardWaterPresent/constructionDebrisPresent above already
	// double as two of the 8 restoration flags.
	siliconeResidue?: boolean;
	paintOverspray?: boolean;
	razorScraping?: boolean;
	steelWool?: boolean;
	nonScratchPad?: boolean;
}

function hasAnyRestorationFlag(input: {
	hardWaterPresent: boolean;
	constructionDebrisPresent: boolean;
	siliconeResidue?: boolean;
	paintOverspray?: boolean;
	razorScraping?: boolean;
	steelWool?: boolean;
	nonScratchPad?: boolean;
}): boolean {
	return Boolean(
		input.hardWaterPresent ||
			input.constructionDebrisPresent ||
			input.siliconeResidue ||
			input.paintOverspray ||
			input.razorScraping ||
			input.steelWool ||
			input.nonScratchPad
	);
}

export interface WalkthroughPricingSuggestion {
	estimatedLaborHours: number;
	suggestedLowPrice: number;
	suggestedTargetPrice: number;
	suggestedHighPrice: number;
	pricingConfigId: string;
}

const DIFFICULT_ACCESS_LEVELS = new Set(['Difficult', 'Specialty Access']);

/** The suggested price range: target = the same finalQuotedPrice a real
 * quote would get from this exact item set, low/high = that target
 * adjusted by the PricingConfig's own Estimate Low/High Variance — the
 * same variance the public ballpark estimator uses, just applied to a
 * precise itemized total instead of a rough window-count guess. */
export function computeWalkthroughPricing(
	config: PricingConfig,
	services: Service[],
	items: WalkthroughItem[],
	input: WalkthroughPricingInput
): WalkthroughPricingSuggestion {
	const counts = itemsToQuoteCounts(items);
	const result = calculateQuote(config, services, {
		stories: storiesForEngine(input.storyCountObserved),
		condition: conditionForEngine(input.exteriorCondition, hasAnyRestorationFlag(input)),
		counts,
		hardWater: input.hardWaterPresent,
		constructionDebris: input.constructionDebrisPresent,
		difficultAccess: DIFFICULT_ACCESS_LEVELS.has(input.accessDifficulty),
		siliconeResidue: input.siliconeResidue,
		paintOverspray: input.paintOverspray,
		razorScraping: input.razorScraping,
		steelWool: input.steelWool,
		nonScratchPad: input.nonScratchPad,
	});

	const lowVariance = num(config['Estimate Low Variance']);
	const highVariance = num(config['Estimate High Variance']);
	const target = result.finalQuotedPrice;

	return {
		estimatedLaborHours: result.estimatedLaborHours,
		suggestedLowPrice: Math.round(target * (1 - lowVariance)),
		suggestedTargetPrice: target,
		suggestedHighPrice: Math.round(target * (1 + highVariance)),
		pricingConfigId: config['Pricing Config ID'],
	};
}

export interface WalkthroughItemInput {
	id: string;
	area: string;
	itemType: string;
	quantity: string;
	sizeClass: string;
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

export interface SaveWalkthroughPayload {
	id: string;
	clientId: string;
	propertyId: string;
	opportunityId?: string;
	walkthroughDate: string;
	conductedBy?: string;
	exteriorCondition: string;
	interiorCondition: string;
	storyCountObserved: string;
	accessDifficulty: string;
	hardWaterPresent: boolean;
	constructionDebrisPresent: boolean;
	waterFedPoleSuitable: boolean;
	ladderRequired: string;
	roofAccessRequired: string;
	ownerOverridePrice: string;
	notes: string;
	// Data-ownership separation: temporary condition/access observations
	// that used to live on Property — see walkthrough.ts for why these
	// belong here instead. Reporting only, none of these feed
	// calculateQuote (matching exteriorCondition/hardWaterPresent/
	// constructionDebrisPresent/accessDifficulty above, which already do).
	siliconeResidue?: boolean;
	heavyInteriorResidue?: boolean;
	oxidizedFramesOrScreens?: boolean;
	conditionVariesByArea?: boolean;
	conditionNotes?: string;
	exteriorAccessObstructed?: boolean;
	furnitureMovementRequired?: boolean;
	temporaryAccessNotes?: string;
	// Restoration Services Required — supplements exteriorCondition/
	// interiorCondition above, doesn't replace them. siliconeResidue above
	// already doubles as one of the 8 restoration checkboxes (Window
	// Stickers / Adhesive), alongside hardWaterPresent/
	// constructionDebrisPresent.
	paintOverspray?: boolean;
	razorScraping?: boolean;
	steelWool?: boolean;
	nonScratchPad?: boolean;
	restorationNotes?: string;
	items: WalkthroughItemInput[];
}

export interface SaveWalkthroughResult {
	walkthrough: Walkthrough;
	items: WalkthroughItem[];
	pricing: WalkthroughPricingSuggestion;
}

/** Saves a completed walkthrough (Walkthrough + WalkthroughItems, one
 * write-operation-ID'd write) after computing the pricing suggestion
 * server-side — the client never has to be trusted for the numbers that
 * get written to Suggested Low/Target/High Price. */
export async function saveWalkthrough(
	env: SheetsEnv,
	config: PricingConfig,
	services: Service[],
	payload: SaveWalkthroughPayload,
	meta: { user?: string; requestId?: string } = {}
): Promise<SaveWalkthroughResult> {
	const itemRecords = payload.items.map((item, index) => ({
		id: item.id,
		'Walkthrough ID': payload.id,
		Area: item.area,
		'Item Type': item.itemType,
		Quantity: item.quantity,
		'Size Class': item.sizeClass,
		'Interior Included': item.interiorIncluded ? 'Y' : 'N',
		'Exterior Included': item.exteriorIncluded ? 'Y' : 'N',
		'Screen Included': item.screenIncluded ? 'Y' : 'N',
		'Track Included': item.trackIncluded ? 'Y' : 'N',
		Condition: item.condition,
		'Access Difficulty': item.accessDifficulty,
		'Hard Water': item.hardWater ? 'Y' : 'N',
		'Construction Debris': item.constructionDebris ? 'Y' : 'N',
		Notes: item.notes,
		'Sort Order': String(index),
	}));

	const asWalkthroughItems = itemRecords.map((r) => walkthroughItemConfig.schema.parse({ ...r, 'Walkthrough Item ID': r.id }));
	const pricing = computeWalkthroughPricing(config, services, asWalkthroughItems, payload);

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
						'Exterior Condition': payload.exteriorCondition,
						'Interior Condition': payload.interiorCondition,
						'Story Count Observed': payload.storyCountObserved,
						'Access Difficulty': payload.accessDifficulty,
						'Hard Water Present (Y/N)': payload.hardWaterPresent ? 'Y' : 'N',
						'Construction Debris Present (Y/N)': payload.constructionDebrisPresent ? 'Y' : 'N',
						'Water-Fed Pole Suitable (Y/N)': payload.waterFedPoleSuitable ? 'Y' : 'N',
						'Ladder Required': payload.ladderRequired,
						'Roof Access Required': payload.roofAccessRequired,
						'Estimated On-Site Labor Hours': pricing.estimatedLaborHours.toFixed(2),
						'Suggested Low Price': String(pricing.suggestedLowPrice),
						'Suggested Target Price': String(pricing.suggestedTargetPrice),
						'Suggested High Price': String(pricing.suggestedHighPrice),
						'Owner Override Price': payload.ownerOverridePrice,
						'Pricing Config ID': pricing.pricingConfigId,
						Notes: payload.notes,
						'Silicone Adhesive Or Sticker Residue (Y/N)': payload.siliconeResidue ? 'Y' : 'N',
						'Heavy Interior Residue (Y/N)': payload.heavyInteriorResidue ? 'Y' : 'N',
						'Oxidized Frames Or Screens (Y/N)': payload.oxidizedFramesOrScreens ? 'Y' : 'N',
						'Condition Varies By Area (Y/N)': payload.conditionVariesByArea ? 'Y' : 'N',
						'Condition Notes': payload.conditionNotes ?? '',
						'Exterior Access Obstructed (Y/N)': payload.exteriorAccessObstructed ? 'Y' : 'N',
						'Furniture Or Belongings Movement Required (Y/N)': payload.furnitureMovementRequired ? 'Y' : 'N',
						'Temporary Access Notes': payload.temporaryAccessNotes ?? '',
						'Paint Overspray (Y/N)': payload.paintOverspray ? 'Y' : 'N',
						'Razor Scraping Required (Y/N)': payload.razorScraping ? 'Y' : 'N',
						'Steel Wool Required (Y/N)': payload.steelWool ? 'Y' : 'N',
						'Non-Scratch Pad Required (Y/N)': payload.nonScratchPad ? 'Y' : 'N',
						'Restoration Notes': payload.restorationNotes ?? '',
					},
				],
			},
			{
				config: walkthroughItemConfig,
				records: itemRecords,
			},
		],
		meta
	);

	return {
		walkthrough: created[0][0] as Walkthrough,
		items: created[1] as WalkthroughItem[],
		pricing,
	};
}

/**
 * Converts a completed Walkthrough into a Quote, reusing its item set and
 * the PricingConfig actually used at walkthrough time (never re-resolving
 * live, even if a newer config has since been activated — reproducibility).
 * Idempotent: a Walkthrough that already has a Quote ID returns the
 * existing Quote instead of creating a duplicate.
 */
export async function createQuoteFromWalkthrough(
	env: SheetsEnv,
	walkthroughId: string,
	opts: { createdBy?: string; user?: string; requestId?: string } = {}
): Promise<CreateQuoteResult> {
	const walkthrough = await findById(env, walkthroughConfig, walkthroughId);
	if (!walkthrough) {
		throw new Error(`Walkthrough "${walkthroughId}" not found`);
	}

	if (walkthrough['Quote ID']) {
		const existingQuote = await findById(env, quoteConfig, walkthrough['Quote ID']);
		if (existingQuote) {
			const allItems = await listActiveRows(env, quoteItemConfig);
			return { quote: existingQuote, items: allItems.filter((i) => i['Quote ID'] === existingQuote['Quote ID']) };
		}
	}

	const allWalkthroughItems = await listActiveRows(env, walkthroughItemConfig);
	const items = allWalkthroughItems.filter((i) => i['Walkthrough ID'] === walkthroughId);
	const counts = itemsToQuoteCounts(items);
	const { difficultAccessItemCount, specialtyAccessItemCount } = countAccessDifficultyItems(items);

	const suggestedTarget = num(walkthrough['Suggested Target Price']);
	const overridePrice = num(walkthrough['Owner Override Price']);
	const manualAdjustment = overridePrice > 0 ? overridePrice - suggestedTarget : 0;

	const hardWater = walkthrough['Hard Water Present (Y/N)'] === 'Y';
	const constructionDebris = walkthrough['Construction Debris Present (Y/N)'] === 'Y';
	const siliconeResidue = walkthrough['Silicone Adhesive Or Sticker Residue (Y/N)'] === 'Y';
	const paintOverspray = walkthrough['Paint Overspray (Y/N)'] === 'Y';
	const razorScraping = walkthrough['Razor Scraping Required (Y/N)'] === 'Y';
	const steelWool = walkthrough['Steel Wool Required (Y/N)'] === 'Y';
	const nonScratchPad = walkthrough['Non-Scratch Pad Required (Y/N)'] === 'Y';

	const result = await createQuote(env, {
		clientId: walkthrough['Client ID'],
		propertyId: walkthrough['Property ID'],
		opportunityId: walkthrough['Opportunity ID'] || undefined,
		pricingConfigId: walkthrough['Pricing Config ID'] || undefined,
		walkthroughId,
		difficultAccessItemCount,
		specialtyAccessItemCount,
		input: {
			stories: storiesForEngine(walkthrough['Story Count Observed']),
			condition: conditionForEngine(
				walkthrough['Exterior Condition'],
				hasAnyRestorationFlag({ hardWaterPresent: hardWater, constructionDebrisPresent: constructionDebris, siliconeResidue, paintOverspray, razorScraping, steelWool, nonScratchPad })
			),
			counts,
			hardWater,
			constructionDebris,
			difficultAccess: DIFFICULT_ACCESS_LEVELS.has(walkthrough['Access Difficulty']),
			siliconeResidue,
			paintOverspray,
			razorScraping,
			steelWool,
			nonScratchPad,
			manualAdjustment: manualAdjustment || undefined,
			overrideReason: manualAdjustment ? 'Owner override from walkthrough' : undefined,
		},
		createdBy: opts.createdBy,
	});

	await updateRow(
		env,
		walkthroughConfig,
		walkthroughId,
		{ 'Quote ID': result.quote['Quote ID'], Status: 'Converted to Quote' },
		{ ...opts, action: 'Converted to Quote' }
	);

	return result;
}
