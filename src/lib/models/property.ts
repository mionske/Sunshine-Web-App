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
export const MAINTENANCE_FREQUENCY_OPTIONS = ['One Time', 'Quarterly', 'Twice Yearly', 'Yearly', 'Custom', 'Unknown'] as const;
export const PREFERRED_SERVICE_SEASON_OPTIONS = ['Spring', 'Summer', 'Fall', 'Winter', 'No preference', 'Unknown'] as const;

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
	'Easy Parking And Setup (Y/N)': blank(),
	'Limited Parking Or Setup Space (Y/N)': blank(),
	'Gate Or Entry Restriction (Y/N)': blank(),
	'Long Hose Run (Y/N)': blank(),
	'Water Source Far From Work Area (Y/N)': blank(),
	'Site Access Notes': blank(),
	// Legacy — superseded by the fields above. 'Ladder Requirement' and
	// 'Window Condition' are reused as-is below (only their form widget
	// changed from a checkbox group to a single-select radio group).
	'Roof Access Difficulty': blank(),
	'Overall Access Difficulty': blank(),
	'Water Access': blank(),
	'Equipment Suitability': blank(),
	// Reused as-is under the new Window Condition card, as "Hard Water
	// Staining Present" / "Construction Debris Present" — the same
	// property-level flags, just presented as supplemental checkboxes
	// alongside Window Condition instead of their own separate fieldset.
	'Hard Water History (Y/N)': blank(),
	'Construction Debris (Y/N)': blank(),
	'Window Condition': blank(),
	// Glass Condition redesign — supplements the Window Condition scale
	// with specific known flags. Hard Water History / Construction Debris
	// above already cover two of the mockup's six flags; not duplicated.
	'Silicone Adhesive Or Sticker Residue (Y/N)': blank(),
	'Heavy Interior Residue (Y/N)': blank(),
	'Oxidized Frames Or Screens (Y/N)': blank(),
	'Condition Varies By Area (Y/N)': blank(),
	'Condition Notes': blank(),
	'Total Window Units': blank(),
	'Total Glass Panes': blank(),
	// Windows & Doors redesign — set only via the "Mark Inventory Verified"
	// action (never auto-set on a plain field save), so it reflects an
	// explicit "I checked this is still accurate" moment, not just "someone
	// once edited a count."
	'Inventory Verified At': blank(),
	'Count - Double Hung': blank(),
	'Count - Casement': blank(),
	'Count - Picture': blank(),
	'Count - Sliding': blank(),
	'Count - French': blank(),
	'Count - Awning': blank(),
	'Count - Skylights': blank(),
	'Count - Solar Panels': blank(),
	'Screen Count': blank(),
	'Track Count': blank(),
	'Desired Maintenance Frequency': blank(),
	// Distinct from "Next Scheduled Visit" below: that one is a confirmed
	// date once something is actually on the calendar; this is a planning/
	// reminder estimate — informational only, never auto-creates a Job.
	'Preferred Service Season': blank(),
	'Next Recommended Service Date': blank(),
	'Maintenance Notes': blank(),
	'Next Scheduled Visit': blank(),
	'Last Review Requested Date': blank(),
	'Last Review Received Date': blank(),
	// Distinct from "Count - Sliding" (a sliding *window* type, alongside
	// Double Hung/Casement/etc.) — sliding glass doors are a separate
	// service in the pricing catalog (SLIDING_DOOR_EXT/INT), so they get
	// their own count rather than being folded into the window counts.
	'Sliding Glass Door Pane Count': blank(),
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
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

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

	return { exteriorCleaningMethodValue, ladderRequirementValue, waterAccessValue, waterSupplyValue };
}
