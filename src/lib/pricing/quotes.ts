import { findById, createRelatedRows, type SheetsEnv } from '../sheets';
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
