// The public ballpark estimator's server-side orchestration. Calls the same
// shared pricing engine as the in-field quoter (calculateEstimate lives in
// engine.ts, next to calculateQuote) but returns only a restricted shape —
// see the API route for the response filtering.
import { createRelatedRows, type SheetsEnv } from '../sheets';
import { clientConfig } from '../models/client';
import { propertyConfig } from '../models/property';
import { pipelineConfig } from '../models/pipeline';
import { quoteConfig } from '../models/quote';
import { getActivePricingConfig } from './config';
import { calculateEstimate, CALCULATOR_VERSION } from './engine';
import type { EstimateRange } from './types';

export interface PublicEstimateInput {
	approxWindowCount: number;
	stories: 1 | 2 | 3;
	propertyType?: string;
	streetAddress: string;
	city?: string;
	firstName: string;
	lastName: string;
	email?: string;
	phone?: string;
	referralSource?: string;
}

/**
 * Captures a public estimate submission as a lead: a new Client, Property
 * (window count marked as client-reported, not measured), Pipeline
 * opportunity (New Lead), and a Quote row (Quote Type: ballpark) recording
 * what was shown — all so a later walkthrough's actual count can be
 * compared against what the client typed in.
 */
export async function createPublicEstimate(
	env: SheetsEnv,
	input: PublicEstimateInput
): Promise<EstimateRange> {
	const config = await getActivePricingConfig(env);
	if (!config) {
		throw new Error('No active PricingConfig — cannot calculate an estimate without one.');
	}

	const range = calculateEstimate(config, { approxWindowCount: input.approxWindowCount, stories: input.stories });

	const clientId = crypto.randomUUID();
	const propertyId = crypto.randomUUID();
	const opportunityId = crypto.randomUUID();
	const quoteId = crypto.randomUUID();

	await createRelatedRows(env, [
		{
			config: clientConfig,
			records: [
				{
					id: clientId,
					'First Name': input.firstName,
					'Last Name': input.lastName,
					Email: input.email ?? '',
					Phone: input.phone ?? '',
					'Referral Source': input.referralSource ?? '',
					'First Contact Date': new Date().toISOString().slice(0, 10),
				},
			],
		},
		{
			config: propertyConfig,
			records: [
				{
					id: propertyId,
					'Client ID': clientId,
					'Street Address': input.streetAddress,
					City: input.city ?? '',
					Stories: String(input.stories),
					'Total Window Units': String(input.approxWindowCount),
					'Window Condition': 'Client-reported (ballpark estimate) — not yet measured',
				},
			],
		},
		{
			config: pipelineConfig,
			records: [
				{
					id: opportunityId,
					'Client ID': clientId,
					'Property ID': propertyId,
					'Primary Quote ID': quoteId,
					Stage: 'New Lead',
					Status: 'Open',
					'Referral Source': input.referralSource ?? '',
				},
			],
		},
		{
			config: quoteConfig,
			records: [
				{
					id: quoteId,
					'Quote Type': 'ballpark',
					'Client ID': clientId,
					'Property ID': propertyId,
					'Opportunity ID': opportunityId,
					'Pricing Config ID': config['Pricing Config ID'],
					'Calculator Version': CALCULATOR_VERSION,
					'Input Snapshot': JSON.stringify({
						approxWindowCount: input.approxWindowCount,
						stories: input.stories,
						propertyType: input.propertyType ?? '',
					}),
					'Calculation Result Snapshot': JSON.stringify(range),
					'Final Quoted Price': String(Math.round((range.low + range.high) / 2)),
					'Quote Status': 'Sent',
				},
			],
		},
	]);

	return range;
}
