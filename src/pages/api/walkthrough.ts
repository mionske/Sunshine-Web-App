import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { findById } from '../../lib/sheets';
import { propertyConfig } from '../../lib/models/property';
import { getActivePricingConfig } from '../../lib/pricing/config';
import { createQuoteFromWalkthrough } from '../../lib/pricing/walkthroughToQuote';
import { loadActiveLaborModel } from '../../lib/labor/config';
import {
	saveLaborWalkthrough,
	type AdjustmentInput,
	type LaborWalkthroughInput,
	type WindowGroupInput,
} from '../../lib/labor/walkthroughLabor';

/** The Active PricingConfig for a property, or a 400 explaining why not. */
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

/**
 * The labor-model half of a save.
 *
 * The wizard also computes this estimate in the browser, from the same pure
 * functions and the same client state, so the number on the review screen is
 * the number that gets stored. It is recomputed here rather than trusted from
 * the request: a price that arrives over the wire is a price a client could
 * have edited.
 */
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
