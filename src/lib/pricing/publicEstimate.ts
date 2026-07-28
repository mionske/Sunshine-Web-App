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
import { formatPhoneDigits } from '../phoneFormat';
import type { EstimateRange } from './types';

// The public form offers lowercase 'residential'/'commercial' (a public,
// customer-facing choice, not the internal enum); mapped to Property's
// PROPERTY_TYPES here rather than exposing the internal casing publicly.
// Defaults to Residential when unset/unrecognized — the vast majority of
// public estimate requests — rather than leaving the Property untyped.
const PUBLIC_PROPERTY_TYPE_MAP: Record<string, string> = {
	residential: 'Residential',
	commercial: 'Commercial',
};

export interface PublicEstimateInput {
	approxWindowCount: number;
	stories: 1 | 2 | 3;
	propertyType?: string;
	streetAddress: string;
	city?: string;
	state?: string;
	zip?: string;
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
	const propertyType = PUBLIC_PROPERTY_TYPE_MAP[(input.propertyType ?? '').toLowerCase()] ?? 'Residential';
	const config = await getActivePricingConfig(env, propertyType);
	if (!config) {
		throw new Error(`No active PricingConfig for ${propertyType} — cannot calculate an estimate without one.`);
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
					Phone: formatPhoneDigits(input.phone ?? ''),
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
					'Property Type': propertyType,
					'Street Address': input.streetAddress,
					City: input.city ?? '',
					State: input.state ?? '',
					Zip: input.zip ?? '',
					Stories: String(input.stories),
					'Total Window Units': String(input.approxWindowCount),
					// 'Window Condition' is deliberately not written. It is a
					// deprecated Property column (condition moved to Walkthrough,
					// where it can differ per visit), and stamping a sentinel into
					// it made every estimator-created property trip the
					// legacy-condition migration banner on the Property page.
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
