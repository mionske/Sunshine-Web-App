import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Drives PricingConfig selection (one Active config per Property Type —
// see lib/pricing/config.ts) and is a calibration segmentation dimension.
// Required — no default — since Properties currently has zero live rows,
// so there's no legacy-data risk in enforcing it from day one.
export const PROPERTY_TYPES = ['Residential', 'Commercial', 'New Build-Construction'] as const;

// Checkbox-group option sets for the Property Characteristics form. Stored
// as a single comma-joined string (the Sheets column stays a plain
// string — no schema change) rather than an array, so a cell stays
// directly human-readable in the live spreadsheet too. Multiple values
// can apply at once (e.g. a property might need both a tall extension
// ladder for one elevation and no ladder for another).
export const ACCESS_DIFFICULTY_OPTIONS = ['Easy', 'Standard', 'Difficult', 'Specialty Access'] as const;
export const WATER_ACCESS_OPTIONS = [
	'Exterior spigot',
	'Interior only',
	'No on-site water',
	'Well water',
	'Water-fed pole compatible',
] as const;
export const EQUIPMENT_SUITABILITY_OPTIONS = [
	'Standard pole',
	'Water-fed pole',
	'Ladder',
	'Lift/scaffold',
	'Boat/dock access',
] as const;
export const LADDER_REQUIREMENT_OPTIONS = [
	'None needed',
	'Standard (6-10 ft)',
	'Extension (16-24 ft)',
	'Tall extension (28+ ft)',
] as const;
export const WINDOW_CONDITION_OPTIONS = ['Maintenance', 'Moderate Buildup', 'Heavy Buildup', 'Restoration Required'] as const;

/** Joins checked checkbox values into the single comma-separated string
 * the Sheets column stores. */
export function joinCheckboxValues(values: string[]): string {
	return values.join(', ');
}

/** True when `value` (one option in a checkbox group) is present in the
 * comma-separated string currently stored for that field. */
export function checkboxValueSelected(stored: string, value: string): boolean {
	return stored
		.split(',')
		.map((v) => v.trim())
		.includes(value);
}

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
	'Roof Access Difficulty': blank(),
	'Overall Access Difficulty': blank(),
	'Water Access': blank(),
	'Equipment Suitability': blank(),
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
	'Next Scheduled Visit': blank(),
	'Last Review Requested Date': blank(),
	'Last Review Received Date': blank(),
	// Distinct from "Count - Sliding" (a sliding *window* type, alongside
	// Double Hung/Casement/etc.) — sliding glass doors are a separate
	// service in the pricing catalog (SLIDING_DOOR_EXT/INT), so they get
	// their own count rather than being folded into the window counts.
	'Sliding Glass Door Pane Count': blank(),
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
