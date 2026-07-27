import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Leads / Clients separation: a Lead is a genuinely lighter-weight record
// than an Opportunity (lib/models/pipeline.ts) — it never requires an
// existing Client, just enough to schedule a walkthrough. Stages mirror the
// spec exactly (New Lead -> Contacted -> Walkthrough Scheduled -> Quoted ->
// Won/Lost) rather than reusing PIPELINE_STAGES, since Quote Draft/Quote
// Sent/Follow-up collapse into a single "Quoted" stage here.
export const LEAD_STAGES = ['New Lead', 'Contacted', 'Walkthrough Scheduled', 'Quoted', 'Won', 'Lost'] as const;

export const LEAD_OUTCOMES = ['Won', 'Lost'] as const;

export const leadSchema = z.object({
	'Lead ID': z.string().min(1),
	'First Name': blank(),
	'Last Name': blank(),
	Phone: blank(),
	Email: blank(),
	// Rough address only — enough to schedule a walkthrough, not a full
	// Property record. Uses Property's own field names (Street Address/
	// City/State/Zip) so Convert to Client can copy them onto a new Property
	// verbatim, with no parsing/splitting of a single free-text address.
	'Street Address': blank(),
	City: blank(),
	State: blank(),
	Zip: blank(),
	Source: blank(),
	Stage: z.enum(LEAD_STAGES).default('New Lead'),
	'Next Follow-up Date': blank(),
	Notes: blank(),
	// Manual pointer only — a reference (e.g. QuickBooks estimate doc
	// number/link), never an authoritative dollar amount. QuickBooks stays
	// the source of truth for real quote/invoice data.
	'Quote Link': blank(),
	// Set only when Stage closes (Won or Lost) — see LEAD_OUTCOMES above.
	Outcome: blank(),
	'Converted Client ID': blank(),
	'Converted Property ID': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Closed At': blank(),
	'Archived At': blank(),
});

export type Lead = z.infer<typeof leadSchema>;

export const leadConfig: TabConfig<Lead> = {
	tab: 'Leads',
	idColumn: 'Lead ID',
	requiredColumns: Object.keys(leadSchema.shape),
	schema: leadSchema,
	entityType: 'Lead',
};
