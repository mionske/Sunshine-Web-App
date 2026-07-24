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

export const WATER_SOURCE_OPTIONS = ['Exterior Spigot', 'Well Water', 'No On-Site Water'] as const;
export const EXTERIOR_CLEANING_METHOD_OPTIONS = ['Water-Fed Pole Suitable', 'Traditional Cleaning Required'] as const;

export const LADDER_REQUIREMENT_OPTIONS = ['None', 'Standard (6-10 ft)', 'Extension (16-24 ft)', 'Tall Extension (28+ ft)'] as const;
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
	'Total Window Units': blank(),
	'Total Glass Panes': blank(),
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
