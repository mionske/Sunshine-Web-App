import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const SERVICE_PRICING_METHODS = ['LABOR_HOURS', 'FLAT_UNIT_PRICE', 'ADJUSTMENT'] as const;

export const serviceSchema = z.object({
	'Service Code': z.string().min(1),
	'Service Name': blank(),
	'Service Category': blank(),
	'Default Unit': blank(),
	'Default Labor Minutes': blank(),
	'Pricing Method': z.enum(SERVICE_PRICING_METHODS).default('LABOR_HOURS'),
	'Publicly Available': blank(),
	'Internally Available': blank(),
	Active: blank(),
	'Sort Order': blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
	Notes: blank(),
});

export type Service = z.infer<typeof serviceSchema>;

export const serviceConfig: TabConfig<Service> = {
	tab: 'Services',
	idColumn: 'Service Code',
	requiredColumns: Object.keys(serviceSchema.shape),
	schema: serviceSchema,
	entityType: 'Service',
};
