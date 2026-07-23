import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const propertySchema = z.object({
	'Property ID': z.string().min(1),
	'Client ID': blank(),
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
