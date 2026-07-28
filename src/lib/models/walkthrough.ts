import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const WALKTHROUGH_STATUSES = ['Draft', 'In Progress', 'Completed', 'Converted to Quote', 'Cancelled'] as const;

export const CONDITION_LEVELS = [
	'Maintenance',
	'Moderate Buildup',
	'Heavy Buildup',
	'Restoration Required',
	'Unknown',
] as const;

// Glass Condition vs. Restoration Services Required split: a single
// "Condition" value used to conflate "how dirty is the glass" with
// "what specialized restoration technique does this job need" — a
// modern home with construction residue/adhesive isn't "Heavy Buildup",
// it's a light/moderate-dirt job that also needs restoration methods.
// This is the pure-dirtiness scale (no "Restoration Required" level,
// no "Unknown" — the form layer adds its own blank/unset option where
// needed, matching every other optional select in this app). Used only
// for the job-wide Exterior/Interior Condition fields below — the
// still-separate, still-5-value CONDITION_LEVELS above stays exactly as
// is for WalkthroughItem's own per-item Condition field, a different,
// per-window-granularity concept.
export const GLASS_CONDITION_LEVELS = ['Maintenance', 'Light Buildup', 'Moderate Buildup', 'Heavy Buildup'] as const;

export const ACCESS_LEVELS = ['Easy', 'Standard', 'Difficult', 'Specialty Access', 'Unknown'] as const;

// A walkthrough-only visit (no quote, no job) is a real, standalone record
// — it never gets faked into a Job just to have somewhere to live. This
// schema is intentionally broader than what any one surface populates
// today: Suggested Low/Target/High Price and Pricing
// Config ID are here now so the guided mobile walkthrough mode (a later
// phase, once it computes live pricing suggestions) can start writing to
// them without another live schema change.
export const walkthroughSchema = z.object({
	'Walkthrough ID': z.string().min(1),
	'Client ID': blank(),
	'Property ID': blank(),
	'Opportunity ID': blank(),
	'Quote ID': blank(),
	'Walkthrough Date': blank(),
	Status: z.enum(WALKTHROUGH_STATUSES).default('Draft'),
	'Conducted By': blank(),
	'Exterior Condition': blank(),
	'Interior Condition': blank(),
	'Story Count Observed': blank(),
	'Access Difficulty': blank(),
	'Hard Water Present (Y/N)': blank(),
	'Construction Debris Present (Y/N)': blank(),
	// Whole-property counts — the default and fastest way to record a
	// walkthrough. The operator enters totals for the property and moves on;
	// no window-type classification, no row per opening.
	//
	// 'Total Window Units' and 'Total Glass Panes' measure two different
	// things and are deliberately stored separately — the app never derives
	// one from the other. A window unit is the operator's own field judgment
	// of how much work an opening represents (a bank of windows, or one
	// oversized assembly, may be counted as more than one); a pane is the
	// objective count of individual pieces of glass. Only window units feed
	// pricing today; pane count is recorded for comparison and calibration.
	//
	// Optional per-area breakdown lives in WalkthroughItems rows carrying
	// 'Window Units'/'Pane Count' (see walkthroughItem.ts). When those exist
	// they are summed and win over these totals — see resolveWalkthroughCounts
	// in lib/pricing/walkthroughToQuote.ts.
	'Total Window Units': blank(),
	'Total Glass Panes': blank(),
	'Total Screens': blank(),
	'Total Tracks': blank(),
	'Total Skylights': blank(),
	'Total Sliding Doors': blank(),
	// Which sides this visit is scoped to. Gates whether window units price
	// as exterior, interior, or both.
	'Interior Included (Y/N)': blank(),
	'Exterior Included (Y/N)': blank(),
	// 'whole-property' | 'by-area' | 'detailed'. Recorded for reporting;
	// pricing derives the mode from the data actually present so that
	// walkthroughs predating this field keep pricing exactly as before.
	'Count Entry Mode': blank(),
	// Data-ownership separation (Property Detail simplification): these
	// describe what THIS visit found, which is exactly why they live here
	// rather than on Property — a maintenance visit can change every one of
	// them. Reuses 'Exterior Condition' above (already existing) as the
	// "Current Condition" concept that used to live on Property as 'Window
	// Condition'; the four flags below plus 'Condition Notes' had no prior
	// Walkthrough equivalent (they used to be Property-only).
	'Silicone Adhesive Or Sticker Residue (Y/N)': blank(),
	'Heavy Interior Residue (Y/N)': blank(),
	'Oxidized Frames Or Screens (Y/N)': blank(),
	'Condition Varies By Area (Y/N)': blank(),
	'Condition Notes': blank(),
	// Restoration Services Required — supplements the Glass Condition
	// rating, doesn't replace it (see GLASS_CONDITION_LEVELS above). Along
	// with the reused 'Construction Debris Present (Y/N)', 'Hard Water
	// Present (Y/N)', and 'Silicone Adhesive Or Sticker Residue (Y/N)'
	// above, these are the 8 restoration checkboxes; checking any of them
	// still triggers the pricing engine's First-Time Cleaning Factor (see
	// conditionForEngine in walkthroughToQuote.ts), same as the old
	// "Restoration Required" condition level used to.
	'Paint Overspray (Y/N)': blank(),
	'Razor Scraping Required (Y/N)': blank(),
	'Steel Wool Required (Y/N)': blank(),
	'Non-Scratch Pad Required (Y/N)': blank(),
	'Restoration Notes': blank(),
	// Data-ownership separation: temporary access obstructions observed at
	// this visit — moved from Property (same field names there,
	// 'Exterior Access Obstructed (Y/N)' / 'Furniture Or Belongings
	// Movement Required (Y/N)', now deprecated on that model) since these
	// can differ from one visit to the next. 'Temporary Access Notes' also
	// covers any other one-off setup obstruction not worth its own flag.
	'Exterior Access Obstructed (Y/N)': blank(),
	'Furniture Or Belongings Movement Required (Y/N)': blank(),
	'Temporary Access Notes': blank(),
	'Water-Fed Pole Suitable (Y/N)': blank(),
	'Ladder Required': blank(),
	'Roof Access Required': blank(),
	// Access & Equipment Modifiers (Historical Entry Wizard) — specific,
	// checkbox-level equipment/complexity flags recorded for a completed
	// historical job, purely for reporting, never read by the pricing
	// engine. Distinct from the free-text 'Ladder Required'/'Roof Access
	// Required' above and from 'Water-Fed Pole Suitable (Y/N)'/'Exterior
	// Access Obstructed (Y/N)'/'Furniture Or Belongings Movement Required
	// (Y/N)' — those are prospective property-capability judgments made by
	// the live Walkthrough Wizard; these are a retrospective record of what
	// this specific historical job actually involved.
	'Second-Story Exterior (Y/N)': blank(),
	'Ladder Required (Y/N)': blank(),
	'Vaulted Interior Glass (Y/N)': blank(),
	'Roof Access Required (Y/N)': blank(),
	'Oversized Glass Or Large Sliders (Y/N)': blank(),
	'Tight Landscaping Or Obstructions (Y/N)': blank(),
	'Limited Interior Access (Y/N)': blank(),
	'Water-Fed Pole Used (Y/N)': blank(),
	'Traditional Exterior Cleaning Used (Y/N)': blank(),
	'Other Access Issue (Y/N)': blank(),
	'Other Access Notes': blank(),
	// Manual override for the Dashboard's "Walkthroughs needing follow-up"
	// reminder — set when the owner marks one as handled directly (e.g. a
	// quote was actually sent/agreed outside the normal Quote-creation flow,
	// or a historical walkthrough predates the fix that links 'Quote ID'
	// back automatically). Never auto-set; purely a manual dismiss.
	'Follow-up Dismissed (Y/N)': blank(),
	'Estimated On-Site Labor Hours': blank(),
	'Suggested Low Price': blank(),
	'Suggested Target Price': blank(),
	'Suggested High Price': blank(),
	'Owner Override Price': blank(),
	'Pricing Config ID': blank(),
	Notes: blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type Walkthrough = z.infer<typeof walkthroughSchema>;

export const walkthroughConfig: TabConfig<Walkthrough> = {
	tab: 'Walkthroughs',
	idColumn: 'Walkthrough ID',
	requiredColumns: Object.keys(walkthroughSchema.shape),
	schema: walkthroughSchema,
	entityType: 'Walkthrough',
};
