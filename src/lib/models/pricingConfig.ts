import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const PRICING_CONFIG_STATUSES = ['Draft', 'Active', 'Superseded', 'Archived'] as const;

export const pricingConfigSchema = z.object({
	'Pricing Config ID': z.string().min(1),
	'Config Name': blank(),
	'Effective Date': blank(),
	'End Date': blank(),
	Status: z.enum(PRICING_CONFIG_STATUSES).default('Draft'),
	// Free string, not a strict enum (unlike Property's required version) —
	// the one pre-existing live PricingConfig row predates this column, so
	// it must round-trip safely with a blank value until explicitly
	// migrated. "Exactly one Active row" is now scoped per Property Type
	// (see lib/pricing/config.ts) rather than globally.
	'Property Type': blank(),
	'Calculator Version': blank(),
	'Target Hourly Rate': blank(),
	'Minimum Job Price': blank(),
	'Exterior Labor Weight': blank(),
	'Interior Labor Weight': blank(),
	'Screen Unit Price': blank(),
	'Track Unit Price': blank(),
	'Deep Track Unit Price': blank(),
	'Skylight Unit Price': blank(),
	'Sliding Door Unit Price': blank(),
	'French Pane Unit Price': blank(),
	'Oversized Glass Unit Price': blank(),
	'Second Story Factor': blank(),
	'Third Story Factor': blank(),
	'Moderate Condition Factor': blank(),
	'Heavy Condition Factor': blank(),
	'First-Time Cleaning Factor': blank(),
	'Hard Water Minimum': blank(),
	'Construction Debris Minimum': blank(),
	'Access Surcharge Minimum': blank(),
	'Estimate Low Variance': blank(),
	'Estimate High Variance': blank(),
	// Revenue per PRODUCTIVE labor hour, used by the labor model to turn an
	// estimate into a suggested price band (see lib/labor/price.ts). Target is
	// the default recommendation; low and high are shown as guidance either
	// side of it. Distinct from 'Target Hourly Rate' above, which the older
	// per-service engine still uses to price standard window line items.
	//
	// These three are a stable reference point, not a tuning knob: when an
	// estimate comes out wrong the fix belongs in the production model —
	// classes, access, condition, screens, tracks — not in moving the rate.
	'Low Hourly Production Target': blank(),
	'Target Hourly Production Target': blank(),
	'High Hourly Production Target': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
	Notes: blank(),
});

export type PricingConfig = z.infer<typeof pricingConfigSchema>;

export const pricingConfigConfig: TabConfig<PricingConfig> = {
	tab: 'PricingConfig',
	idColumn: 'Pricing Config ID',
	requiredColumns: Object.keys(pricingConfigSchema.shape),
	schema: pricingConfigSchema,
	entityType: 'PricingConfig',
};
