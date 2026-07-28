import {
	findById,
	createRelatedRows,
	readRows,
	readHeaders,
	batchUpdateValues,
	columnLetterAt,
	updateRow,
	type SheetsEnv,
} from '../sheets';
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
}

/** Archives every existing (non-archived) QuoteItem for a Quote in a single
 * batched write, rather than one updateRow() per row — each updateRow does
 * its own header read + full-tab read + write + activity log, and
 * Cloudflare Workers caps the number of subrequests a single incoming
 * request may make. A Quote with even a handful of line items could push
 * the sequential version over that cap and fail the whole request with an
 * opaque 500. One read + one batched write scales to any item count at
 * roughly constant request cost. Shared by updateQuote() (replacing items)
 * and deleteQuote() (removing them along with the Quote itself). Accepts an
 * explicit timestamp so deleteQuote() can stamp the Quote and its items with
 * the exact same value — restoreQuote() uses that match to know which
 * archived items belong to the delete being undone, vs. older items
 * superseded by a previous edit (which must stay archived). */
async function archiveQuoteItems(env: SheetsEnv, quoteId: string, timestamp?: string): Promise<void> {
	const itemHeaders = await readHeaders(env, quoteItemConfig.tab);
	const archivedAtColumn = columnLetterAt(itemHeaders.indexOf('Archived At') + 1);
	const allItemRows = await readRows(env, quoteItemConfig.tab, { idColumn: quoteItemConfig.idColumn });
	const rowsToArchive = allItemRows.filter((r) => r.data['Quote ID'] === quoteId && !r.data['Archived At']);
	if (rowsToArchive.length === 0) return;
	const now = timestamp ?? new Date().toISOString();
	await batchUpdateValues(
		env,
		rowsToArchive.map((r) => ({
			range: `'${quoteItemConfig.tab}'!${archivedAtColumn}${r.rowNumber}:${archivedAtColumn}${r.rowNumber}`,
			values: [[now]],
		}))
	);
}

/**
 * Soft-deletes a Quote and all of its QuoteItems (Archived At set, never
 * hard-deleted, matching this app's convention everywhere else). Refused for
 * an Accepted quote — it always has a linked Job, and deleting the Quote out
 * from under a real Job would leave that Job referencing a Quote that no
 * longer appears anywhere in the app. Change the status away from Accepted
 * first (its own dedicated action, see quotes/[id].astro's status dropdown)
 * if the quote genuinely needs to go away.
 */
export async function deleteQuote(env: SheetsEnv, quoteId: string): Promise<void> {
	const quote = await findById(env, quoteConfig, quoteId);
	if (!quote) throw new Error(`Quote "${quoteId}" not found`);
	if (quote['Quote Status'] === 'Accepted') {
		throw new Error('This quote is Accepted and has a linked Job — change its status away from Accepted before deleting it.');
	}
	const now = new Date().toISOString();
	await archiveQuoteItems(env, quoteId, now);
	await updateRow(env, quoteConfig, quoteId, { 'Archived At': now }, { action: 'archived' });
}

/**
 * Undoes deleteQuote() — clears Archived At on the Quote and on exactly the
 * QuoteItems that were archived as part of that same delete (matched by the
 * shared timestamp deleteQuote() stamped both with), leaving any older,
 * edit-superseded items untouched and still archived.
 */
export async function restoreQuote(env: SheetsEnv, quoteId: string): Promise<void> {
	const quote = await findById(env, quoteConfig, quoteId);
	if (!quote) throw new Error(`Quote "${quoteId}" not found`);
	const archivedAt = quote['Archived At'];
	if (!archivedAt) throw new Error('This quote is not deleted.');

	const itemHeaders = await readHeaders(env, quoteItemConfig.tab);
	const archivedAtColumn = columnLetterAt(itemHeaders.indexOf('Archived At') + 1);
	const allItemRows = await readRows(env, quoteItemConfig.tab, { idColumn: quoteItemConfig.idColumn });
	const rowsToRestore = allItemRows.filter((r) => r.data['Quote ID'] === quoteId && r.data['Archived At'] === archivedAt);
	if (rowsToRestore.length > 0) {
		await batchUpdateValues(
			env,
			rowsToRestore.map((r) => ({
				range: `'${quoteItemConfig.tab}'!${archivedAtColumn}${r.rowNumber}:${archivedAtColumn}${r.rowNumber}`,
				values: [['']],
			}))
		);
	}
	await updateRow(env, quoteConfig, quoteId, { 'Archived At': '' }, { action: 'restored' });
}

// bulkUpdateQuoteStatus / bulkDeleteQuotes / bulkRestoreQuotes were removed
// along with the Quotes list's bulk multi-select toolbar in the
// simplification pass — a solo operator works one row at a time, and the
// single-row deleteQuote()/restoreQuote()/status actions cover the real
// workflow.

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
		},
		{ action: 'Quote edited' }
	);

	await archiveQuoteItems(env, quoteId);
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
