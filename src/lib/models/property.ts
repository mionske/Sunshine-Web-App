import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Drives PricingConfig selection (one Active config per Property Type —
// see lib/pricing/config.ts) and is a calibration segmentation dimension.
// Required — no default — since Properties currently has zero live rows,
// so there's no legacy-data risk in enforcing it from day one.
export const PROPERTY_TYPES = ['Residential', 'Commercial', 'New Build-Construction'] as const;

// Single-select option sets for the Property Characteristics form —
// rendered as radio groups (only one value is ever actually true: a
// property has one interior access difficulty, one water source, etc.).
// Access Difficulty is split into Interior/Exterior (each using this same
// three-level scale) rather than one combined "Overall" difficulty plus a
// separate Roof scale — a roof visit either requires special access or it
// doesn't, captured by the plain ROOF_ACCESS_REQUIRED boolean below rather
// than a whole extra difficulty scale of its own. "Specialty Access" and
// "Boat/Dock Access" were dropped as options — never actually used, and a
// property either needs roof access or doesn't; there's no third tier.
export const ACCESS_LEVEL_OPTIONS = ['Easy', 'Standard', 'Difficult'] as const;

// Legacy — superseded by the Water Access / Water Supply split below (a
// real semantic split, not a rename: this one field conflated "how you
// get to water" with "where the water comes from").
export const WATER_SOURCE_OPTIONS = ['Exterior Spigot', 'Well Water', 'No On-Site Water'] as const;

// Water Access & Water Supply redesign — replaces the single Water Source
// field above with two independent questions.
export const WATER_ACCESS_OPTIONS = ['Exterior Spigot', 'Interior Connection Only', 'No Usable Connection', 'Unknown'] as const;
export const WATER_SUPPLY_OPTIONS = ['Municipal', 'Well', 'Unknown'] as const;

// Property + In-Field Quote redesign: expanded from a binary choice to
// four options — UI label is "Typical Exterior Method" (column name
// unchanged, so no Sheets migration beyond the option set itself).
export const EXTERIOR_CLEANING_METHOD_OPTIONS = ['Water-Fed Pole', 'Traditional', 'Mixed', 'Undetermined'] as const;

// Property + In-Field Quote redesign: full words instead of abbreviated
// ranges, plus a new "Specialty Access" tier with no legacy equivalent.
export const LADDER_REQUIREMENT_OPTIONS = ['None', 'Step Ladder', 'Extension Ladder', 'Tall Extension Ladder', 'Specialty Access'] as const;
export const WINDOW_CONDITION_OPTIONS = ['Maintenance', 'Moderate Buildup', 'Heavy Buildup', 'Restoration Required'] as const;

// Phase 9 (recurring-maintenance prep): reminders/planning only — nothing
// here ever auto-creates a future Job. "Desired Maintenance Frequency"
// already existed as a free-text field (reused rather than duplicated with
// a new "Preferred Service Frequency" column); this just gives it the
// defined option set the spec calls for.
// Data-ownership separation: these are customer preferences, not physical
// property facts — MOVED to Client (see lib/models/client.ts, which
// imports these same two option sets rather than duplicating them). Kept
// exported here since the legacy Property columns below still reuse them
// for compat display.
export const MAINTENANCE_FREQUENCY_OPTIONS = ['One Time', 'Quarterly', 'Twice Yearly', 'Yearly', 'Custom', 'Unknown'] as const;
export const PREFERRED_SERVICE_SEASON_OPTIONS = ['Spring', 'Summer', 'Fall', 'Winter', 'No preference', 'Unknown'] as const;

// Data-ownership separation redesign: replaces the two standalone "Easy
// Parking And Setup (Y/N)" / "Limited Parking Or Setup Space (Y/N)"
// checkboxes below with one segmented field, matching how every other
// difficulty-style property field already works.
export const PARKING_AND_SETUP_OPTIONS = ['Easy', 'Limited', 'Difficult', 'Unknown'] as const;

// Leads / Clients separation: repeat business on an EXISTING Client (a
// second property, or a one-off add-on job) is tracked here rather than
// through a second parallel sales pipeline — reuses the existing Job-driven
// follow-up mechanism (Next Maintenance Follow-up Date/Maintenance Follow-up
// Status on lib/models/job.ts) for scheduling. Left blank for a property
// with no active repeat-business request. Named distinctly from the page's
// own derived/ephemeral "property status" badge (see derivePropertyStatus()
// in properties/[id].astro, e.g. "Prospect"/"Established Client") — that's
// computed from Pipeline/Job data and never stored; this is a real column.
export const REPEAT_BUSINESS_STATUS_OPTIONS = ['Active', 'Quote Pending', 'One-time Job'] as const;

export const propertySchema = z.object({
	'Property ID': z.string().min(1),
	'Client ID': blank(),
	'Property Type': z.enum(PROPERTY_TYPES),
	'Street Address': blank(),
	City: blank(),
	State: blank(),
	Zip: blank(),
	'Year Built': blank(),
	'Square Footage': blank(),
	Stories: blank(),
	// Access & Conditions redesign — Interior/Exterior Access Difficulty,
	// Water Source, Exterior Cleaning Method, and Roof Access Required
	// replace the five legacy fields below (kept declared, never written by
	// the current form, so any pre-existing values still round-trip safely
	// instead of being silently dropped).
	'Interior Access Difficulty': blank(),
	'Exterior Access Difficulty': blank(),
	'Roof Access Required (Y/N)': blank(),
	'Water Source': blank(),
	'Exterior Cleaning Method': blank(),
	// Access Considerations — supplements Interior/Exterior Access
	// Difficulty with specific known conditions, rather than trying to
	// squeeze every nuance into the three-level scale. Roof Access Required
	// above already covers roof access; not duplicated here.
	'High Interior Glass (Y/N)': blank(),
	'Steep Or Uneven Terrain (Y/N)': blank(),
	// Data-ownership separation: these two describe what a *particular
	// visit* found, not a permanent fact about the property (the furniture
	// gets moved back, the obstruction gets cleared) — MOVED to Walkthrough
	// ('Exterior Access Obstructed (Y/N)' / 'Furniture Or Belongings
	// Movement Required (Y/N)', same names, see lib/models/walkthrough.ts).
	// Kept declared so pre-existing values still round-trip; the new
	// Property form never writes either again.
	'Exterior Access Obstructed (Y/N)': blank(),
	'Furniture Or Belongings Movement Required (Y/N)': blank(),
	'Restricted Work Or Setup Area (Y/N)': blank(),
	// Water & Site Access redesign — Water Access Method answers "how do
	// you connect" (spigot/interior/none), Water Supply answers "where does
	// it come from" (municipal/well) — see WATER_ACCESS_OPTIONS/
	// WATER_SUPPLY_OPTIONS above for why this used to be one field. Named
	// "...Method" (not just "Water Access") to avoid colliding with the
	// legacy 'Water Access' column below, superseded by 'Water Source' from
	// an earlier redesign — that column keeps its original name untouched.
	'Water Access Method': blank(),
	'Water Supply': blank(),
	// Data-ownership separation: replaced by the single 'Parking And Setup
	// Difficulty' segmented field below (PARKING_AND_SETUP_OPTIONS). Kept
	// declared for compat; the new form derives a one-time default from
	// these two (Limited wins if both are somehow set) and never writes
	// either checkbox again.
	'Easy Parking And Setup (Y/N)': blank(),
	'Limited Parking Or Setup Space (Y/N)': blank(),
	'Parking And Setup Difficulty': blank(),
	'Gate Or Entry Restriction (Y/N)': blank(),
	'Long Hose Run (Y/N)': blank(),
	'Water Source Far From Work Area (Y/N)': blank(),
	// Data-ownership separation: merged into the surviving 'Access Notes'
	// field below (combined once, on first load after this shipped, if
	// both held content — see derivePropertyCompatDefaults). Kept declared
	// for compat; never written again.
	'Site Access Notes': blank(),
	// Legacy — superseded by the fields above. 'Ladder Requirement' and
	// 'Window Condition' are reused as-is below (only their form widget
	// changed from a checkbox group to a single-select radio group).
	'Roof Access Difficulty': blank(),
	'Overall Access Difficulty': blank(),
	'Water Access': blank(),
	'Equipment Suitability': blank(),
	// Data-ownership separation: all Glass Condition fields describe what a
	// *particular visit* observed (buildup, residue, staining), not a
	// permanent property fact — a maintenance visit can change every one of
	// these. MOVED to Walkthrough: 'Hard Water History (Y/N)' and
	// 'Construction Debris (Y/N)' are reused as Walkthrough's pre-existing
	// 'Hard Water Present (Y/N)' / 'Construction Debris Present (Y/N)'
	// (already collected there, not duplicated); 'Window Condition' is
	// reused as Walkthrough's pre-existing 'Exterior Condition' (the one
	// that already feeds calculateQuote); the remaining four flags plus
	// Condition Notes are new Walkthrough columns (no prior Walkthrough
	// equivalent). All kept declared here for compat; the new Property
	// form never writes any of them again.
	'Hard Water History (Y/N)': blank(),
	'Construction Debris (Y/N)': blank(),
	'Window Condition': blank(),
	'Silicone Adhesive Or Sticker Residue (Y/N)': blank(),
	'Heavy Interior Residue (Y/N)': blank(),
	'Oxidized Frames Or Screens (Y/N)': blank(),
	'Condition Varies By Area (Y/N)': blank(),
	'Condition Notes': blank(),
	'Total Window Units': blank(),
	'Total Glass Panes': blank(),
	// Data-ownership separation (Windows & Doors simplification): the new
	// primary "Standard Windows" aggregate — a quick top-level count
	// distinct from the detailed Double Hung/Casement/Picture/Sliding
	// Window breakdown below, exactly the same relationship Total Glass
	// Panes already has to its own detailed breakdown. Optional — never
	// required just because the detailed fields are used, and vice versa.
	// Windows & Doors redesign — set only via the "Mark Inventory Verified"
	// action (never auto-set on a plain field save), so it reflects an
	// explicit "I checked this is still accurate" moment, not just "someone
	// once edited a count."
	'Inventory Verified At': blank(),
	// Who confirmed the standing counts are still accurate. Solo business
	// today, so this is nearly always the owner — recorded anyway because
	// "verified July 28 by Greg" is a claim someone made, and an unattributed
	// verification date is worth noticeably less a year later.
	'Inventory Verified By': blank(),
	// The per-window-style counts (Count - Standard/Double Hung/Casement/
	// Picture/Sliding/French/Awning/Skylights/Solar Panels and Sliding Glass
	// Door Pane Count) were removed here. Identifying every window type in a
	// house was field busywork that nothing downstream ever read — pricing,
	// calibration and reporting all work from window units and panes. Their
	// sheet columns are left in place and preserved verbatim by the
	// .passthrough() below, so the one property that has a real breakdown
	// keeps it; the app simply no longer asks for or writes it.
	'Screen Count': blank(),
	'Track Count': blank(),
	// Data-ownership separation: both are customer preferences (a client
	// may move, sell, or own multiple properties without the preference
	// changing) — MOVED to Client (same names, see lib/models/client.ts).
	// Copied onto the linked Client the first time this loads if the
	// Client's own field is still blank, never overwriting an existing
	// Client value. Kept declared for compat; the new Property form never
	// writes either again.
	'Desired Maintenance Frequency': blank(),
	'Preferred Service Season': blank(),
	// Data-ownership separation: all four below were manually-typed CRM/
	// scheduling fields with no connection to the real Job/review data
	// that already tracks this. Next Recommended Service Date and Next
	// Scheduled Visit are superseded by values derived live from Jobs (see
	// properties/[id].astro's summary strip); Last Review Requested/
	// Received Date are superseded by Job's real, already-working 'Review
	// Requested At'/'Review Left' fields (used by the Dashboard's review
	// reminders) — these two were always a disconnected parallel system.
	// Maintenance Notes has no single auto-obvious destination and is
	// simply dropped from the editable form; its historical content stays
	// in the legacy column. Kept declared for compat; the new Property
	// form never writes any of these four again.
	'Next Recommended Service Date': blank(),
	'Maintenance Notes': blank(),
	'Next Scheduled Visit': blank(),
	'Last Review Requested Date': blank(),
	'Last Review Received Date': blank(),
	// Legacy — superseded by 'Exterior Cleaning Method' above. Kept
	// declared so the one existing property with a value here still
	// round-trips; the new form pre-selects a default from it once
	// ('Water-Fed Pole Suitable' when 'Y', 'Traditional Cleaning Required'
	// when 'N') but never writes to it again.
	'Water-Fed Pole Suitable (Y/N)': blank(),
	'Ladder Requirement': blank(),
	'Access Notes': blank(),
	'Pet Notes': blank(),
	'General Notes': blank(),
	// Display/logistics grouping only — not a data relationship the app
	// enforces. Each unit in a multi-unit building is still its own full
	// Property record with its own Client, per the "a Client always lives
	// at one Property" rule.
	'Building/Complex Name': blank(),
	'Unit Identifier': blank(),
	// Leads / Clients separation — see REPEAT_BUSINESS_STATUS_OPTIONS above.
	'Repeat Business Status': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
})
	// REQUIRED, not cosmetic. updateRow rewrites the whole row
	// (objectToRowValues writes '' for any header missing from the validated
	// record), and a strict zod object strips keys it doesn't declare — so
	// without this, every column removed from the schema above would be
	// silently blanked on the next save of that property. Jobs has carried
	// .passthrough() for the same reason since its legacy columns were first
	// tolerated; Properties needs it now that it has undeclared columns too.
	.catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));

export type Property = z.infer<typeof propertySchema>;

export const propertyConfig: TabConfig<Property> = {
	tab: 'Properties',
	idColumn: 'Property ID',
	requiredColumns: Object.keys(propertySchema.shape),
	schema: propertySchema,
	entityType: 'Property',
};

const LADDER_REQUIREMENT_LEGACY_MAP: Record<string, string> = {
	'Standard (6-10 ft)': 'Step Ladder',
	'Extension (16-24 ft)': 'Extension Ladder',
	'Tall Extension (28+ ft)': 'Tall Extension Ladder',
};

export interface PropertyCompatDefaults {
	exteriorCleaningMethodValue: string;
	ladderRequirementValue: string;
	waterAccessValue: string;
	waterSupplyValue: string;
	parkingAndSetupValue: string;
	/** Merge of the legacy 'Site Access Notes' + 'Access Notes' columns —
	 * see derivePropertyCompatDefaults for the exact combination rule. */
	accessNotesValue: string;
}

/**
 * One-time compatibility defaults for the enum fields renamed/split during
 * the Property + In-Field Quote redesign — shared by the Property Detail
 * page and the Quoter (which needs the same read-only summary values).
 * None of these ever write to Sheets; they only decide what shows
 * pre-selected/displayed. The raw legacy value stays exactly as stored
 * until the owner actually saves that specific property through the form.
 */
export function derivePropertyCompatDefaults(property: Property): PropertyCompatDefaults {
	// 'Exterior Cleaning Method' expanded from 2 options to 4 ('Typical
	// Exterior Method' in the UI). A pre-expansion value ('Water-Fed Pole
	// Suitable'/'Traditional Cleaning Required') maps onto its closest new
	// equivalent; falls back further to the even-older
	// 'Water-Fed Pole Suitable (Y/N)' checkbox for properties that predate
	// the field entirely.
	const exteriorCleaningMethodValue =
		(property['Exterior Cleaning Method'] === 'Water-Fed Pole Suitable'
			? 'Water-Fed Pole'
			: property['Exterior Cleaning Method'] === 'Traditional Cleaning Required'
				? 'Traditional'
				: property['Exterior Cleaning Method']) ||
		(property['Water-Fed Pole Suitable (Y/N)'] === 'Y'
			? 'Water-Fed Pole'
			: property['Water-Fed Pole Suitable (Y/N)'] === 'N'
				? 'Traditional'
				: '');

	// 'Ladder Requirement' renamed from abbreviated ranges to full words,
	// plus a new 'Specialty Access' tier with no legacy equivalent.
	const ladderRequirementValue = LADDER_REQUIREMENT_LEGACY_MAP[property['Ladder Requirement']] ?? property['Ladder Requirement'];

	// 'Water Source' split into 'Water Access Method' (how you connect) and
	// 'Water Supply' (where it comes from) — a real semantic split, not a
	// rename. The legacy 'Well Water' value actually described supply, not
	// access, so it maps to Water Supply and leaves Water Access Unknown
	// rather than guessing.
	const waterAccessValue =
		property['Water Access Method'] ||
		(property['Water Source'] === 'Exterior Spigot'
			? 'Exterior Spigot'
			: property['Water Source'] === 'No On-Site Water'
				? 'No Usable Connection'
				: property['Water Source'] === 'Well Water'
					? 'Unknown'
					: '');
	const waterSupplyValue = property['Water Supply'] || (property['Water Source'] === 'Well Water' ? 'Well' : '');

	// Data-ownership separation: 'Easy Parking And Setup (Y/N)' / 'Limited
	// Parking Or Setup Space (Y/N)' collapse into one segmented field.
	// Limited wins if a property somehow has both checked, since that's the
	// more operationally important case to surface.
	const parkingAndSetupValue =
		property['Parking And Setup Difficulty'] ||
		(property['Limited Parking Or Setup Space (Y/N)'] === 'Y'
			? 'Limited'
			: property['Easy Parking And Setup (Y/N)'] === 'Y'
				? 'Easy'
				: '');

	// Data-ownership separation: 'Site Access Notes' merges into the
	// surviving 'Access Notes' field. If only one has content, it passes
	// through unchanged; if both do, they're combined (labeled, so neither
	// is silently discarded) the same way every time this renders, until
	// the owner actually saves the property and the combined text becomes
	// the new 'Access Notes' value.
	const accessNotesValue =
		property['Site Access Notes'] && property['Access Notes']
			? `Site access:\n${property['Site Access Notes']}\n\nAdditional setup:\n${property['Access Notes']}`
			: property['Access Notes'] || property['Site Access Notes'];

	return { exteriorCleaningMethodValue, ladderRequirementValue, waterAccessValue, waterSupplyValue, parkingAndSetupValue, accessNotesValue };
}
