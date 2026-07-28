import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { findById } from '../../lib/sheets';
import { propertyConfig } from '../../lib/models/property';
import type { WalkthroughItem } from '../../lib/models/walkthroughItem';
import { getActivePricingConfig } from '../../lib/pricing/config';
import { listServices } from '../../lib/pricing/services';
import {
	computeWalkthroughPricing,
	createQuoteFromWalkthrough,
	saveWalkthrough,
	type SaveWalkthroughPayload,
	type WalkthroughItemInput,
} from '../../lib/pricing/walkthroughToQuote';
import { loadActiveLaborModel } from '../../lib/labor/config';
import {
	computeWalkthroughLabor,
	saveLaborWalkthrough,
	type AdjustmentInput,
	type LaborWalkthroughInput,
	type WindowGroupInput,
} from '../../lib/labor/walkthroughLabor';

// Client-submitted item shape (see WalkthroughWizard.tsx) -> the shape
// itemsToQuoteCounts/computeWalkthroughPricing expect. Quantity stays a
// string throughout — the Sheets column is a string, and num() coercion
// happens inside the pricing module, not here.
function toWalkthroughItem(raw: Record<string, unknown>): WalkthroughItem {
	return {
		'Walkthrough Item ID': String(raw.id ?? ''),
		'Walkthrough ID': '',
		Area: String(raw.area ?? ''),
		'Window Units': String(raw.windowUnits ?? ''),
		'Pane Count': String(raw.paneCount ?? ''),
		'Item Type': String(raw.itemType ?? ''),
		Quantity: String(raw.quantity ?? ''),
		'Size Class': String(raw.sizeClass ?? ''),
		// Window group fields (see the row-shape note in
		// models/walkthroughItem.ts). Blank here, because this function only
		// ever builds the legacy area-row and detailed-item shapes — grouped
		// rows have their own path.
		'Production Class': '',
		Story: '',
		'Interior Access': '',
		'Exterior Access': '',
		'Panes Per Unit': '',
		'Screens Per Unit': '',
		'Tracks Per Unit': '',
		'Specialty Description': '',
		'Special Item Type': '',
		'Interior Included': raw.interiorIncluded ? 'Y' : 'N',
		'Exterior Included': raw.exteriorIncluded ? 'Y' : 'N',
		// Same dual meaning as the save path: a count on an area row, a Y/N
		// flag on a detailed item row. The preview has to agree with what
		// saving would produce, or the price changes on save.
		'Screen Included': raw.itemType ? (raw.screenIncluded ? 'Y' : 'N') : String(raw.screenCount ?? ''),
		'Track Included': raw.itemType ? (raw.trackIncluded ? 'Y' : 'N') : String(raw.trackCount ?? ''),
		Condition: String(raw.condition ?? ''),
		'Access Difficulty': String(raw.accessDifficulty ?? ''),
		'Hard Water': raw.hardWater ? 'Y' : 'N',
		'Construction Debris': raw.constructionDebris ? 'Y' : 'N',
		'Estimated Labor Minutes': '',
		Notes: String(raw.notes ?? ''),
		'Sort Order': '0',
		'Created At': '',
		'Updated At': '',
		'Archived At': '',
	};
}

function toWalkthroughItemInput(raw: Record<string, unknown>): WalkthroughItemInput {
	return {
		id: String(raw.id ?? ''),
		area: String(raw.area ?? ''),
		windowUnits: raw.windowUnits === undefined ? undefined : String(raw.windowUnits),
		paneCount: raw.paneCount === undefined ? undefined : String(raw.paneCount),
		itemType: String(raw.itemType ?? ''),
		quantity: String(raw.quantity ?? ''),
		sizeClass: String(raw.sizeClass ?? ''),
		interiorIncluded: Boolean(raw.interiorIncluded),
		exteriorIncluded: Boolean(raw.exteriorIncluded),
		screenIncluded: Boolean(raw.screenIncluded),
		trackIncluded: Boolean(raw.trackIncluded),
		screenCount: raw.screenCount === undefined ? undefined : String(raw.screenCount),
		trackCount: raw.trackCount === undefined ? undefined : String(raw.trackCount),
		condition: String(raw.condition ?? ''),
		accessDifficulty: String(raw.accessDifficulty ?? ''),
		hardWater: Boolean(raw.hardWater),
		constructionDebris: Boolean(raw.constructionDebris),
		notes: String(raw.notes ?? ''),
	};
}

/** The Active PricingConfig for a property, or a 400 explaining why not.
 * Shared by every action here — all four need the same two lookups. */
async function resolvePropertyPricing(propertyId: string) {
	const property = await findById(env, propertyConfig, propertyId);
	if (!property?.['Property Type']) {
		return { error: json({ ok: false, error: 'Property has no Property Type — cannot resolve a PricingConfig.' }, 400) };
	}
	const config = await getActivePricingConfig(env, property['Property Type']);
	if (!config) {
		return { error: json({ ok: false, error: `No active PricingConfig for ${property['Property Type']}.` }, 400) };
	}
	return { property, config };
}

/** The labor-model half of a wizard request. Sent by both the live preview
 * and the save, from the same client state, so the number on the review
 * screen is the number that gets stored. */
function toLaborInput(body: Record<string, unknown>): LaborWalkthroughInput {
	const scope = (body.scope ?? {}) as Record<string, unknown>;
	const access = (body.access ?? {}) as Record<string, unknown>;
	return {
		inventory: body.inventory as LaborWalkthroughInput['inventory'],
		groups: (body.groups as WindowGroupInput[] | undefined) ?? [],
		access: { interior: String(access.interior ?? ''), exterior: String(access.exterior ?? '') },
		adjustments: (body.adjustments as AdjustmentInput[] | undefined) ?? [],
		scope: {
			interior: Boolean(scope.interior),
			exterior: Boolean(scope.exterior),
			screens: Boolean(scope.screens),
			tracks: Boolean(scope.tracks),
			frames: Boolean(scope.frames),
			twoDay: Boolean(scope.twoDay),
		},
		conditions: (body.conditions ?? {}) as LaborWalkthroughInput['conditions'],
		manualScreenTotal: body.manualScreenTotal ? String(body.manualScreenTotal) : undefined,
		manualTrackTotal: body.manualTrackTotal ? String(body.manualTrackTotal) : undefined,
		scheduledMinutesOverride: body.scheduledMinutesOverride ? String(body.scheduledMinutesOverride) : undefined,
	};
}

export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json()) as { action: string; [key: string]: unknown };

	try {
		// --- Labor model (grouped inventory) ---

		if (body.action === 'preview-labor') {
			const resolved = await resolvePropertyPricing(String(body.propertyId ?? ''));
			if (resolved.error) return resolved.error;
			const model = await loadActiveLaborModel(env, resolved.property['Property Type']);
			return json({ ok: true, ...computeWalkthroughLabor(model, resolved.config, toLaborInput(body)) });
		}

		if (body.action === 'save-labor') {
			const resolved = await resolvePropertyPricing(String(body.propertyId ?? ''));
			if (resolved.error) return resolved.error;
			const model = await loadActiveLaborModel(env, resolved.property['Property Type']);
			const result = await saveLaborWalkthrough(env, model, resolved.config, {
				...toLaborInput(body),
				id: String(body.id ?? ''),
				clientId: String(body.clientId ?? ''),
				propertyId: String(body.propertyId ?? ''),
				opportunityId: body.opportunityId ? String(body.opportunityId) : undefined,
				walkthroughDate: String(body.walkthroughDate ?? ''),
				conductedBy: body.conductedBy ? String(body.conductedBy) : undefined,
				notes: body.notes ? String(body.notes) : undefined,
				conditionNotes: body.conditionNotes ? String(body.conditionNotes) : undefined,
				temporaryAccessNotes: body.temporaryAccessNotes ? String(body.temporaryAccessNotes) : undefined,
				restorationNotes: body.restorationNotes ? String(body.restorationNotes) : undefined,
				storyCountObserved: body.storyCountObserved ? String(body.storyCountObserved) : undefined,
				ladderRequired: body.ladderRequired ? String(body.ladderRequired) : undefined,
				roofAccessRequired: body.roofAccessRequired ? String(body.roofAccessRequired) : undefined,
				waterFedPoleSuitable: Boolean(body.waterFedPoleSuitable),
				exteriorAccessObstructed: Boolean(body.exteriorAccessObstructed),
				furnitureMovementRequired: Boolean(body.furnitureMovementRequired),
				ownerSelectedPrice: body.ownerSelectedPrice ? String(body.ownerSelectedPrice) : undefined,
				ownerOverrideReason: body.ownerOverrideReason ? String(body.ownerOverrideReason) : undefined,
				scheduleRecommendationOverride: body.scheduleRecommendationOverride
					? String(body.scheduleRecommendationOverride)
					: undefined,
			});
			return json({
				ok: true,
				walkthroughId: result.walkthrough['Walkthrough ID'],
				productiveMinutes: result.estimate.productiveMinutes,
				scheduledMinutes: result.schedule.scheduledMinutes,
				scheduleRecommendation: result.walkthrough['Schedule Recommendation'],
				band: result.band,
			});
		}

		// --- Legacy count-based path, unchanged ---

		if (body.action === 'preview-pricing') {
			const property = await findById(env, propertyConfig, String(body.propertyId ?? ''));
			if (!property?.['Property Type']) {
				return json({ ok: false, error: 'Property has no Property Type — cannot resolve a PricingConfig.' }, 400);
			}
			const config = await getActivePricingConfig(env, property['Property Type']);
			if (!config) {
				return json({ ok: false, error: `No active PricingConfig for ${property['Property Type']}.` }, 400);
			}
			const services = await listServices(env);
			const items = (body.items as Record<string, unknown>[]).map(toWalkthroughItem);
			const pricing = computeWalkthroughPricing(config, services, items, body.input as never);
			return json({ ok: true, pricing });
		}

		if (body.action === 'save') {
			const property = await findById(env, propertyConfig, String(body.propertyId ?? ''));
			if (!property?.['Property Type']) {
				return json({ ok: false, error: 'Property has no Property Type — cannot resolve a PricingConfig.' }, 400);
			}
			const config = await getActivePricingConfig(env, property['Property Type']);
			if (!config) {
				return json({ ok: false, error: `No active PricingConfig for ${property['Property Type']}.` }, 400);
			}
			const services = await listServices(env);
			const payload: SaveWalkthroughPayload = {
				id: String(body.id ?? ''),
				clientId: String(body.clientId ?? ''),
				propertyId: String(body.propertyId ?? ''),
				opportunityId: body.opportunityId ? String(body.opportunityId) : undefined,
				walkthroughDate: String(body.walkthroughDate ?? ''),
				conductedBy: body.conductedBy ? String(body.conductedBy) : undefined,
				exteriorCondition: String(body.exteriorCondition ?? ''),
				interiorCondition: String(body.interiorCondition ?? ''),
				storyCountObserved: String(body.storyCountObserved ?? ''),
				accessDifficulty: String(body.accessDifficulty ?? ''),
				hardWaterPresent: Boolean(body.hardWaterPresent),
				constructionDebrisPresent: Boolean(body.constructionDebrisPresent),
				waterFedPoleSuitable: Boolean(body.waterFedPoleSuitable),
				ladderRequired: String(body.ladderRequired ?? ''),
				roofAccessRequired: String(body.roofAccessRequired ?? ''),
				ownerOverridePrice: String(body.ownerOverridePrice ?? ''),
				notes: String(body.notes ?? ''),
				siliconeResidue: Boolean(body.siliconeResidue),
				heavyInteriorResidue: Boolean(body.heavyInteriorResidue),
				oxidizedFramesOrScreens: Boolean(body.oxidizedFramesOrScreens),
				conditionVariesByArea: Boolean(body.conditionVariesByArea),
				conditionNotes: body.conditionNotes ? String(body.conditionNotes) : undefined,
				exteriorAccessObstructed: Boolean(body.exteriorAccessObstructed),
				furnitureMovementRequired: Boolean(body.furnitureMovementRequired),
				temporaryAccessNotes: body.temporaryAccessNotes ? String(body.temporaryAccessNotes) : undefined,
				paintOverspray: Boolean(body.paintOverspray),
				razorScraping: Boolean(body.razorScraping),
				steelWool: Boolean(body.steelWool),
				nonScratchPad: Boolean(body.nonScratchPad),
				restorationNotes: body.restorationNotes ? String(body.restorationNotes) : undefined,
				totalWindowUnits: String(body.totalWindowUnits ?? ''),
				totalGlassPanes: String(body.totalGlassPanes ?? ''),
				totalScreens: String(body.totalScreens ?? ''),
				totalTracks: String(body.totalTracks ?? ''),
				totalSkylights: String(body.totalSkylights ?? ''),
				totalSlidingDoors: String(body.totalSlidingDoors ?? ''),
				interiorIncluded: Boolean(body.interiorIncluded),
				exteriorIncluded: body.exteriorIncluded === undefined ? true : Boolean(body.exteriorIncluded),
				countEntryMode: body.countEntryMode ? String(body.countEntryMode) : undefined,
				items: (body.items as Record<string, unknown>[]).map(toWalkthroughItemInput),
			};
			const result = await saveWalkthrough(env, config, services, payload);
			return json({
				ok: true,
				walkthroughId: result.walkthrough['Walkthrough ID'],
				suggestedLowPrice: result.pricing.suggestedLowPrice,
				suggestedTargetPrice: result.pricing.suggestedTargetPrice,
				suggestedHighPrice: result.pricing.suggestedHighPrice,
			});
		}

		if (body.action === 'create-quote') {
			const result = await createQuoteFromWalkthrough(env, String(body.walkthroughId ?? ''));
			return json({ ok: true, quote: result.quote });
		}

		return json({ ok: false, error: `Unknown action "${body.action}"` }, 400);
	} catch (error) {
		return json({ ok: false, error: (error as Error).message, retryable: true }, 502);
	}
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
