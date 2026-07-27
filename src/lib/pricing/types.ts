export type Stories = 1 | 2 | 3;
export type Condition = 'light' | 'moderate' | 'heavy' | 'firstTime';

export interface QuoteCounts {
	windowExtStandard: number;
	windowIntStandard: number;
	windowExtOversized: number;
	windowIntOversized: number;
	windowExtFrenchPane: number;
	windowIntFrenchPane: number;
	slidingDoorExt: number;
	slidingDoorInt: number;
	screenClean: number;
	trackBasic: number;
	trackDeep: number;
	skylightExt: number;
	skylightInt: number;
}

export interface QuoteInput {
	stories: Stories;
	condition: Condition;
	counts: QuoteCounts;
	hardWater: boolean;
	constructionDebris: boolean;
	difficultAccess: boolean;
	// Restoration Services Required — reporting only (none of these are
	// read by calculateQuote; hardWater/constructionDebris above already
	// carry the pricing-affecting duty, and collectively any of the 8 can
	// still force 'firstTime' via conditionForEngine/hasAnyRestorationFlag
	// in ./condition.ts). Stored here so they land in a Quote's Input
	// Snapshot, the prerequisite for future calibration segmentation by
	// restoration technique.
	siliconeResidue?: boolean;
	paintOverspray?: boolean;
	razorScraping?: boolean;
	steelWool?: boolean;
	nonScratchPad?: boolean;
	restorationNotes?: string;
	// The human-readable Glass Condition level actually selected — `condition`
	// above is the *derived* engine enum (conditionForEngine's output), which
	// loses information (e.g. 'Maintenance' and 'Light Buildup' both map to
	// 'light'). Stored so an edit/duplicate can re-populate the original
	// selection instead of guessing backward from the collapsed enum.
	// Interior Condition is purely descriptive — never read by
	// calculateQuote, matching Walkthrough's own Interior Condition.
	exteriorGlassCondition?: string;
	interiorGlassCondition?: string;
	// Same relationship as above: `difficultAccess` is the derived boolean
	// the engine reads; this is the original 3-value selection (matching
	// Historical Entry's trimmed Easy/Standard/Difficult scale) that
	// produced it.
	overallAccessDifficulty?: string;
	// Access & Equipment Modifiers — reporting only, matching Walkthrough's
	// own set of the same name (never read by calculateQuote).
	secondStoryExterior?: boolean;
	ladderRequired?: boolean;
	vaultedInteriorGlass?: boolean;
	roofAccessRequired?: boolean;
	oversizedGlass?: boolean;
	exteriorObstructions?: boolean;
	limitedInteriorAccess?: boolean;
	waterFedPoleUsed?: boolean;
	traditionalExteriorCleaningUsed?: boolean;
	otherAccessIssue?: boolean;
	otherAccessNotes?: string;
	manualAdjustment?: number;
	discount?: number;
	overrideReason?: string;
}

export interface CalculatedLineItem {
	serviceCode: string;
	description: string;
	quantity: number;
	unit: string;
	unitPrice: number;
	estimatedLaborMinutes: number;
	lineTotal: number;
}

export interface QuoteCalculationResult {
	lineItems: CalculatedLineItem[];
	estimatedLaborHours: number;
	targetHourlyRate: number;
	calculatedBaseAmount: number;
	calculatedAddOns: number;
	calculatedSurcharges: number;
	targetPriceBeforeAdjustments: number;
	minimumJobPriceApplied: boolean;
	manualAdjustment: number;
	discount: number;
	finalQuotedPrice: number;
	expectedRevenuePerLaborHour: number;
	pricingConfigId: string;
	calculatorVersion: string;
	roundingPolicy: string;
	currency: string;
}

export interface EstimateRange {
	low: number;
	high: number;
	minimumApplied: boolean;
}
