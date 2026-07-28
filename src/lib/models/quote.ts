import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'] as const;
export const QUOTE_TYPES = ['ballpark', 'in-field'] as const;

// Quoter redesign (Property + In-Field Quote shared visual system, Part 2).
// Service Scope narrows which side(s) of the Quote Inventory counts apply —
// a UI convenience over the same underlying ext/int QuoteCounts fields, not
// a new pricing input; stored for reporting/reference only.
export const SERVICE_SCOPE_OPTIONS = ['Exterior Only', 'Interior & Exterior', 'Interior Only', 'Custom Selection'] as const;
// Whether Quote Inventory used the property's latest-walkthrough-derived
// defaults as-is, or the rep overrode specific quantities for this one quote.
export const INVENTORY_COVERAGE_OPTIONS = ['Entire Property', 'Selected Windows Only'] as const;
export const LABOR_ESTIMATE_CREW_SIZE_OPTIONS = ['1', '2', '3+'] as const;
export const LABOR_ESTIMATE_CONFIDENCE_OPTIONS = ['Low', 'Medium', 'High'] as const;
// Required whenever Manual Adjustment or Discount is non-zero (see the
// hand-written check in lib/pricing/quotes.ts, mirroring Pipeline's Lost
// Reason pattern) — stored in the existing 'Override Reason' column, which
// already served exactly this purpose as free text; this just gives it a
// defined option set. "Other" reveals a free-text field in the UI, which is
// appended to the stored value rather than needing a second column.
export const ADJUSTMENT_REASON_OPTIONS = [
	'Competitive Pricing',
	'Referral or Relationship',
	'First-Service Uncertainty',
	'Bundled Property Discount',
	'Minimum Charge',
	'Access Complexity',
	'Pricing Experiment',
	'Owner Discretion',
	'Other',
] as const;

export const quoteSchema = z.object({
	'Quote ID': z.string().min(1),
	'Quote Type': z.enum(QUOTE_TYPES).default('in-field'),
	'Client ID': blank(),
	'Property ID': blank(),
	'Opportunity ID': blank(),
	'Walkthrough ID': blank(),
	'Pricing Config ID': blank(),
	'Calculator Version': blank(),
	'Input Snapshot': blank(),
	'Calculation Result Snapshot': blank(),
	'Rounding Policy': blank(),
	Currency: blank(),
	'Calculated Base Amount': blank(),
	'Calculated Add-ons': blank(),
	'Calculated Surcharges': blank(),
	'Estimated Labor Hours': blank(),
	'Target Hourly Rate': blank(),
	'Target Price Before Adjustments': blank(),
	'Manual Adjustment': blank(),
	Discount: blank(),
	'Final Quoted Price': blank(),
	'Expected Revenue Per Labor Hour': blank(),
	'Override Reason': blank(),
	'Quote Status': z.enum(QUOTE_STATUSES).default('Draft'),
	'Created At': blank(),
	'Updated At': blank(),
	'Sent At': blank(),
	'Accepted At': blank(),
	'Declined At': blank(),
	'Expired At': blank(),
	'Archived At': blank(),
	'Created By': blank(),
	Notes: blank(),
	// Legacy — superseded by 'QB Estimate ID' below. Was a manually-pasted
	// raw QuickBooks URL; never written to again by the new QuickBooks
	// linking UI (see lib/qb/recordLinking.ts). Kept declared so old rows
	// still round-trip.
	'QB Estimate Link': blank(),
	// The real link to a synced QBEstimates row (see lib/models/qbEstimate.ts)
	// — set only via lib/qb/recordLinking.ts's confirmQBEstimateLink(),
	// never hand-typed. Once set, the linked estimate's Status/Total/
	// Doc Number/Txn Date/Updated At are the authoritative display, and this
	// app never writes back to QuickBooks.
	'QB Estimate ID': blank(),
	// Stores a QB Estimate ID the owner explicitly dismissed from the
	// "Potential QuickBooks Match Found" suggestion (see
	// findStrongQuoteMatchSuggestion in lib/qb/recordLinking.ts) so the same
	// suggestion doesn't keep reappearing on every page view.
	'QB Match Suggestion Dismissed': blank(),
	// Window-characteristic calibration reporting: how many items in this
	// quote's scope were marked Difficult/Specialty Access at walkthrough
	// time (summed by item Quantity, not row count). Only ever populated
	// for quotes created from a Walkthrough, where per-item access
	// difficulty is actually observed — quotes from the plain in-field
	// quoter have no per-item data at all, so these stay blank/unknown
	// rather than a fabricated zero. Reporting only; never read by the
	// pricing engine.
	'Difficult Access Item Count': blank(),
	'Specialty Access Item Count': blank(),
	// Quoter redesign: reporting-only fields (see SERVICE_SCOPE_OPTIONS/
	// INVENTORY_COVERAGE_OPTIONS above for what drove which). Neither is
	// read by calculateQuote — the resulting Quote Inventory counts (already
	// captured in Input Snapshot) are what actually price the job.
	'Service Scope': blank(),
	'Inventory Coverage': blank(),
	// Labor Estimate: a second, independent, human-entered figure — never
	// read by calculateQuote's own itemized estimatedLaborHours. Purely
	// reporting, per the owner's explicit choice during the Property+Quote
	// planning phase.
	'Labor Estimate Solo Hours': blank(),
	'Labor Estimate Crew Size': blank(),
	'Labor Estimate Confidence': blank(),
	'Labor Estimate Notes': blank(),
	// Legacy — superseded by the Overall Access Difficulty / Glass Condition
	// / Restoration Services / Access & Equipment Modifiers fields now
	// captured in Input Snapshot (matching the same structure Walkthrough
	// and Historical Entry already use — see QuoteInput in
	// lib/pricing/types.ts). Kept declared so old quotes' values still
	// round-trip and display; the Quoter never writes any of these again.
	'Job High Interior Glass (Y/N)': blank(),
	'Job Steep Or Uneven Terrain (Y/N)': blank(),
	'Job Exterior Access Obstructed (Y/N)': blank(),
	'Job Furniture Movement Required (Y/N)': blank(),
	'Job Water Access Difficult (Y/N)': blank(),
	'Job Silicone Or Sticker Residue (Y/N)': blank(),
	'Job Heavy Interior Residue (Y/N)': blank(),
	'Job Other Condition Notes': blank(),

	// --- Labor-model price band ---
	// Written only for quotes built from a grouped-inventory walkthrough. The
	// three suggestions come from productive hours x the low/target/high
	// hourly production targets in PricingConfig; 'Owner Selected Price' is
	// whatever the owner actually decided and is never clamped toward the
	// suggestion. A ten-hour job priced at $1,700 is a legitimate answer, and
	// the app's job is to record it, not argue with it.
	'Suggested Low Price': blank(),
	'Suggested Target Price': blank(),
	'Suggested High Price': blank(),
	'Owner Selected Price': blank(),
	// Both versions are stored so a past quote stays explainable after either
	// model changes. 'Labor Model Version' is the LaborConfig version label
	// (e.g. "Residential v2"); 'Pricing Model Version' is the PricingConfig
	// the hourly targets came from.
	'Labor Model Version': blank(),
	'Pricing Model Version': blank(),
	// Optional. Asked for when the owner's price sits well outside the
	// suggested band — recorded for later calibration, never required to save.
	'Owner Override Reason': blank(),
})
	// Insurance against the whole-row-rewrite blanking trap — see the same
	// note on models/property.ts and models/walkthrough.ts.
	.catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));

export type Quote = z.infer<typeof quoteSchema>;

export const quoteConfig: TabConfig<Quote> = {
	tab: 'Quotes',
	idColumn: 'Quote ID',
	requiredColumns: Object.keys(quoteSchema.shape),
	schema: quoteSchema,
	entityType: 'Quote',
};
