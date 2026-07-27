import { findById, createRelatedRows, listActiveRows, softDeleteRow, updateRow, type SheetsEnv } from '../sheets';
import { quoteConfig, type Quote } from '../models/quote';
import { quoteItemConfig, type QuoteItem } from '../models/quoteItem';
import { propertyConfig } from '../models/property';
import { getActivePricingConfig } from './config';
import { pricingConfigConfig } from '../models/pricingConfig';
import { listServices } from './services';
import { calculateQuote } from './engine';
import type { QuoteInput } from './types';

export interface CreateQuoteParams {
	clientId: string;
	propertyId: string;
	opportunityId?: string;
	input: QuoteInput;
	createdBy?: string;
	/** Explicit override — the quoter pre-selects the Active config
	 * matching the property's type, but the owner can always pick a
	 * different one; nothing is auto-applied or locked. Falls back to the
	 * property's own type when omitted. */
	pricingConfigId?: string;
	/** Set when this quote was generated from a completed Walkthrough —
	 * see lib/pricing/walkthroughToQuote.ts. */
	walkthroughId?: string;
	/** Window-characteristic calibration reporting — only ever passed by
	 * the walkthrough-to-quote path, which is the only one with per-item
	 * Access Difficulty data to summarize. Omitted (not zero) when unknown. */
	difficultAccessItemCount?: number;
	specialtyAccessItemCount?: number;
	/** Quoter redesign — reporting-only fields (see SERVICE_SCOPE_OPTIONS/
	 * INVENTORY_COVERAGE_OPTIONS in models/quote.ts). Never read by
	 * calculateQuote. */
	serviceScope?: string;
	inventoryCoverage?: string;
	laborEstimate?: {
		soloHours?: string;
		crewSize?: string;
		confidence?: string;
		notes?: string;
	};
	jobConditions?: {
		highInteriorGlass?: boolean;
		steepOrUnevenTerrain?: boolean;
		exteriorAccessObstructed?: boolean;
		furnitureMovementRequired?: boolean;
		waterAccessDifficult?: boolean;
		siliconeOrStickerResidue?: boolean;
		heavyInteriorResidue?: boolean;
		otherConditionNotes?: string;
	};
}

export interface CreateQuoteResult {
	quote: Quote;
	items: QuoteItem[];
}

/**
 * Runs the shared pricing engine and persists the result as a Quote row plus
 * its QuoteItems, written together under one write-operation ID (see
 * relatedWrites.ts). The Input Snapshot + Calculation Result Snapshot mean
 * this quote stays auditable even after PricingConfig or the engine changes
 * later — see the plan's reproducibility rule.
 */
export async function createQuote(env: SheetsEnv, params: CreateQuoteParams): Promise<CreateQuoteResult> {
	// Adjustment Reason required whenever a Manual Adjustment or Discount is
	// applied — mirrors the hand-written Lost Reason check in
	// api/pipeline/[id].ts (no zod enum/refinement precedent in this
	// codebase for "field X required when field Y is non-zero"). Checked
	// here, not in a specific page handler, since this is the one choke
	// point every quote-creation path (plain quoter, walkthrough-to-quote)
	// goes through.
	const manualAdjustment = params.input.manualAdjustment ?? 0;
	const discount = params.input.discount ?? 0;
	if ((manualAdjustment !== 0 || discount !== 0) && !params.input.overrideReason) {
		throw new Error('Adjustment Reason is required when a Manual Adjustment or Discount is applied.');
	}

	let config = params.pricingConfigId ? await findById(env, pricingConfigConfig, params.pricingConfigId) : null;
	if (!config) {
		const property = await findById(env, propertyConfig, params.propertyId);
		config = property?.['Property Type'] ? await getActivePricingConfig(env, property['Property Type']) : null;
	}
	if (!config) {
		throw new Error('No active PricingConfig for this property\'s type — cannot calculate a quote without one.');
	}
	const services = await listServices(env);
	const result = calculateQuote(config, services, params.input);

	const quoteId = crypto.randomUUID();
	const { created } = await createRelatedRows(env, [
		{
			config: quoteConfig,
			records: [
				{
					id: quoteId,
					'Client ID': params.clientId,
					'Property ID': params.propertyId,
					'Opportunity ID': params.opportunityId ?? '',
					'Walkthrough ID': params.walkthroughId ?? '',
					'Pricing Config ID': result.pricingConfigId,
					'Calculator Version': result.calculatorVersion,
					'Input Snapshot': JSON.stringify(params.input),
					'Calculation Result Snapshot': JSON.stringify(result),
					'Rounding Policy': result.roundingPolicy,
					Currency: result.currency,
					'Calculated Base Amount': String(result.calculatedBaseAmount),
					'Calculated Add-ons': String(result.calculatedAddOns),
					'Calculated Surcharges': String(result.calculatedSurcharges),
					'Estimated Labor Hours': String(result.estimatedLaborHours),
					'Target Hourly Rate': String(result.targetHourlyRate),
					'Target Price Before Adjustments': String(result.targetPriceBeforeAdjustments),
					'Manual Adjustment': String(result.manualAdjustment),
					Discount: String(result.discount),
					'Final Quoted Price': String(result.finalQuotedPrice),
					'Expected Revenue Per Labor Hour': String(result.expectedRevenuePerLaborHour),
					'Override Reason': params.input.overrideReason ?? '',
					'Quote Status': 'Draft',
					'Created By': params.createdBy ?? '',
					'Difficult Access Item Count': params.difficultAccessItemCount !== undefined ? String(params.difficultAccessItemCount) : '',
					'Specialty Access Item Count': params.specialtyAccessItemCount !== undefined ? String(params.specialtyAccessItemCount) : '',
					'Service Scope': params.serviceScope ?? '',
					'Inventory Coverage': params.inventoryCoverage ?? '',
					'Labor Estimate Solo Hours': params.laborEstimate?.soloHours ?? '',
					'Labor Estimate Crew Size': params.laborEstimate?.crewSize ?? '',
					'Labor Estimate Confidence': params.laborEstimate?.confidence ?? '',
					'Labor Estimate Notes': params.laborEstimate?.notes ?? '',
					'Job High Interior Glass (Y/N)': params.jobConditions ? (params.jobConditions.highInteriorGlass ? 'Y' : 'N') : '',
					'Job Steep Or Uneven Terrain (Y/N)': params.jobConditions ? (params.jobConditions.steepOrUnevenTerrain ? 'Y' : 'N') : '',
					'Job Exterior Access Obstructed (Y/N)': params.jobConditions ? (params.jobConditions.exteriorAccessObstructed ? 'Y' : 'N') : '',
					'Job Furniture Movement Required (Y/N)': params.jobConditions ? (params.jobConditions.furnitureMovementRequired ? 'Y' : 'N') : '',
					'Job Water Access Difficult (Y/N)': params.jobConditions ? (params.jobConditions.waterAccessDifficult ? 'Y' : 'N') : '',
					'Job Silicone Or Sticker Residue (Y/N)': params.jobConditions ? (params.jobConditions.siliconeOrStickerResidue ? 'Y' : 'N') : '',
					'Job Heavy Interior Residue (Y/N)': params.jobConditions ? (params.jobConditions.heavyInteriorResidue ? 'Y' : 'N') : '',
					'Job Other Condition Notes': params.jobConditions?.otherConditionNotes ?? '',
				},
			],
		},
		{
			config: quoteItemConfig,
			records: result.lineItems.map((item, index) => ({
				'Quote ID': quoteId,
				'Service Code': item.serviceCode,
				'Service Category': '',
				Description: item.description,
				Quantity: String(item.quantity),
				Unit: item.unit,
				'Unit Price': String(item.unitPrice),
				'Estimated Labor Minutes': String(item.estimatedLaborMinutes),
				'Line Total': String(item.lineTotal),
				Taxable: 'N',
				'Sort Order': String(index),
			})),
		},
	]);

	return {
		quote: created[0][0] as Quote,
		items: created[1] as QuoteItem[],
	};
}

export interface UpdateQuoteParams {
	input: QuoteInput;
	pricingConfigId?: string;
	difficultAccessItemCount?: number;
	specialtyAccessItemCount?: number;
	serviceScope?: string;
	inventoryCoverage?: string;
	laborEstimate?: {
		soloHours?: string;
		crewSize?: string;
		confidence?: string;
		notes?: string;
	};
	jobConditions?: {
		highInteriorGlass?: boolean;
		steepOrUnevenTerrain?: boolean;
		exteriorAccessObstructed?: boolean;
		furnitureMovementRequired?: boolean;
		waterAccessDifficult?: boolean;
		siliconeOrStickerResidue?: boolean;
		heavyInteriorResidue?: boolean;
		otherConditionNotes?: string;
	};
}

/**
 * Recalculates an existing Quote in place — same engine call as
 * createQuote(), but updates the existing row (never touches Client ID/
 * Property ID/Opportunity ID/Walkthrough ID/Quote Status/Created By, which
 * an edit never changes) and replaces its QuoteItems (soft-deletes the old
 * set, writes the freshly calculated set) instead of creating a new Quote.
 * Never called for an Accepted quote from the UI (see quotes/[id].astro) —
 * once a Job exists, its Quoted Price snapshot would otherwise drift out of
 * sync with a silently-changed Quote.
 */
export async function updateQuote(env: SheetsEnv, quoteId: string, params: UpdateQuoteParams): Promise<CreateQuoteResult> {
	const manualAdjustment = params.input.manualAdjustment ?? 0;
	const discount = params.input.discount ?? 0;
	if ((manualAdjustment !== 0 || discount !== 0) && !params.input.overrideReason) {
		throw new Error('Adjustment Reason is required when a Manual Adjustment or Discount is applied.');
	}

	const existing = await findById(env, quoteConfig, quoteId);
	if (!existing) throw new Error(`Quote "${quoteId}" not found`);

	let config = params.pricingConfigId ? await findById(env, pricingConfigConfig, params.pricingConfigId) : null;
	if (!config) {
		const property = await findById(env, propertyConfig, existing['Property ID']);
		config = property?.['Property Type'] ? await getActivePricingConfig(env, property['Property Type']) : null;
	}
	if (!config) {
		throw new Error('No active PricingConfig for this property\'s type — cannot calculate a quote without one.');
	}
	const services = await listServices(env);
	const result = calculateQuote(config, services, params.input);

	const updatedQuote = await updateRow(
		env,
		quoteConfig,
		quoteId,
		{
			'Pricing Config ID': result.pricingConfigId,
			'Calculator Version': result.calculatorVersion,
			'Input Snapshot': JSON.stringify(params.input),
			'Calculation Result Snapshot': JSON.stringify(result),
			'Rounding Policy': result.roundingPolicy,
			Currency: result.currency,
			'Calculated Base Amount': String(result.calculatedBaseAmount),
			'Calculated Add-ons': String(result.calculatedAddOns),
			'Calculated Surcharges': String(result.calculatedSurcharges),
			'Estimated Labor Hours': String(result.estimatedLaborHours),
			'Target Hourly Rate': String(result.targetHourlyRate),
			'Target Price Before Adjustments': String(result.targetPriceBeforeAdjustments),
			'Manual Adjustment': String(result.manualAdjustment),
			Discount: String(result.discount),
			'Final Quoted Price': String(result.finalQuotedPrice),
			'Expected Revenue Per Labor Hour': String(result.expectedRevenuePerLaborHour),
			'Override Reason': params.input.overrideReason ?? '',
			'Difficult Access Item Count': params.difficultAccessItemCount !== undefined ? String(params.difficultAccessItemCount) : '',
			'Specialty Access Item Count': params.specialtyAccessItemCount !== undefined ? String(params.specialtyAccessItemCount) : '',
			'Service Scope': params.serviceScope ?? '',
			'Inventory Coverage': params.inventoryCoverage ?? '',
			'Labor Estimate Solo Hours': params.laborEstimate?.soloHours ?? '',
			'Labor Estimate Crew Size': params.laborEstimate?.crewSize ?? '',
			'Labor Estimate Confidence': params.laborEstimate?.confidence ?? '',
			'Labor Estimate Notes': params.laborEstimate?.notes ?? '',
			'Job High Interior Glass (Y/N)': params.jobConditions ? (params.jobConditions.highInteriorGlass ? 'Y' : 'N') : '',
			'Job Steep Or Uneven Terrain (Y/N)': params.jobConditions ? (params.jobConditions.steepOrUnevenTerrain ? 'Y' : 'N') : '',
			'Job Exterior Access Obstructed (Y/N)': params.jobConditions ? (params.jobConditions.exteriorAccessObstructed ? 'Y' : 'N') : '',
			'Job Furniture Movement Required (Y/N)': params.jobConditions ? (params.jobConditions.furnitureMovementRequired ? 'Y' : 'N') : '',
			'Job Water Access Difficult (Y/N)': params.jobConditions ? (params.jobConditions.waterAccessDifficult ? 'Y' : 'N') : '',
			'Job Silicone Or Sticker Residue (Y/N)': params.jobConditions ? (params.jobConditions.siliconeOrStickerResidue ? 'Y' : 'N') : '',
			'Job Heavy Interior Residue (Y/N)': params.jobConditions ? (params.jobConditions.heavyInteriorResidue ? 'Y' : 'N') : '',
			'Job Other Condition Notes': params.jobConditions?.otherConditionNotes ?? '',
		},
		{ action: 'Quote edited' }
	);

	const existingItems = (await listActiveRows(env, quoteItemConfig)).filter((i) => i['Quote ID'] === quoteId);
	for (const item of existingItems) {
		await softDeleteRow(env, quoteItemConfig, item['Quote Item ID']);
	}
	const { created } = await createRelatedRows(env, [
		{
			config: quoteItemConfig,
			records: result.lineItems.map((item, index) => ({
				'Quote ID': quoteId,
				'Service Code': item.serviceCode,
				'Service Category': '',
				Description: item.description,
				Quantity: String(item.quantity),
				Unit: item.unit,
				'Unit Price': String(item.unitPrice),
				'Estimated Labor Minutes': String(item.estimatedLaborMinutes),
				'Line Total': String(item.lineTotal),
				Taxable: 'N',
				'Sort Order': String(index),
			})),
		},
	]);

	return {
		quote: updatedQuote,
		items: created[0] as QuoteItem[],
	};
}
