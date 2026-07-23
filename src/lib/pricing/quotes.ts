import { createRelatedRows, type SheetsEnv } from '../sheets';
import { quoteConfig, type Quote } from '../models/quote';
import { quoteItemConfig, type QuoteItem } from '../models/quoteItem';
import { getActivePricingConfig } from './config';
import { listServices } from './services';
import { calculateQuote } from './engine';
import type { QuoteInput } from './types';

export interface CreateQuoteParams {
	clientId: string;
	propertyId: string;
	opportunityId?: string;
	input: QuoteInput;
	createdBy?: string;
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
	const config = await getActivePricingConfig(env);
	if (!config) {
		throw new Error('No active PricingConfig — cannot calculate a quote without one.');
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
