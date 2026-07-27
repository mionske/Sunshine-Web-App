// Pure, dependency-free condition/restoration logic shared by the pricing
// engine call sites — Walkthrough-to-quote conversion (server-side) and the
// Quoter form's live client-side price preview. Deliberately has zero
// imports beyond ./types, so it's safe to bundle into a React island;
// walkthroughToQuote.ts pulls in server-only Sheets client code that must
// never end up in a client bundle.
import type { Condition } from './types';

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
 * dirtiness.
 */
export function conditionForEngine(exteriorCondition: string, hasRestorationFlag: boolean): Condition {
	if (hasRestorationFlag) return 'firstTime';
	return EXTERIOR_CONDITION_TO_ENGINE[exteriorCondition] ?? 'light';
}

export interface RestorationFlags {
	hardWaterPresent: boolean;
	constructionDebrisPresent: boolean;
	siliconeResidue?: boolean;
	paintOverspray?: boolean;
	razorScraping?: boolean;
	steelWool?: boolean;
	nonScratchPad?: boolean;
}

export function hasAnyRestorationFlag(input: RestorationFlags): boolean {
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
