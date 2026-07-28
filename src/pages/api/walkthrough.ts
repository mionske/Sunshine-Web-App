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

export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json()) as { action: string; [key: string]: unknown };

	try {
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
