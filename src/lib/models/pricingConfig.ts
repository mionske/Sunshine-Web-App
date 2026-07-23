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
