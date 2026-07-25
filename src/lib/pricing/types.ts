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
	// carry the pricing-affecting duty). Stored here so they land in a
	// Quote's Input Snapshot, the prerequisite for future calibration
	// segmentation by restoration technique.
	siliconeResidue?: boolean;
	paintOverspray?: boolean;
	razorScraping?: boolean;
	steelWool?: boolean;
	nonScratchPad?: boolean;
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
