import { createRow, listActiveRows, type SheetsEnv } from '../sheets';
import { serviceConfig, type Service } from '../models/service';

export async function listServices(env: SheetsEnv): Promise<Service[]> {
	return listActiveRows(env, serviceConfig);
}

export async function getService(env: SheetsEnv, code: string): Promise<Service | undefined> {
	const services = await listServices(env);
	return services.find((s) => s['Service Code'] === code);
}

interface SeedService {
	code: string;
	name: string;
	category: string;
	unit: string;
	laborMinutes: number;
	pricingMethod: Service['Pricing Method'];
	publiclyAvailable: boolean;
	internallyAvailable: boolean;
}

// Default labor-minute estimates are starting assumptions (v1), the same
// role sunshine-website's original internalPricingConfig placeholders
// played — expected to be replaced by real calibration data over time, never
// hand-tuned to "look right" for a specific quote.
const INITIAL_SERVICES: SeedService[] = [
	{ code: 'WINDOW_EXT_STANDARD', name: 'Standard window — exterior', category: 'Window', unit: 'window', laborMinutes: 2.5, pricingMethod: 'LABOR_HOURS', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'WINDOW_INT_STANDARD', name: 'Standard window — interior', category: 'Window', unit: 'window', laborMinutes: 2.5, pricingMethod: 'LABOR_HOURS', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'WINDOW_EXT_OVERSIZED', name: 'Oversized/picture window — exterior', category: 'Window', unit: 'window', laborMinutes: 5, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'WINDOW_INT_OVERSIZED', name: 'Oversized/picture window — interior', category: 'Window', unit: 'window', laborMinutes: 5, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'WINDOW_EXT_FRENCH_PANE', name: 'French/grid pane window — exterior', category: 'Window', unit: 'window', laborMinutes: 5, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'WINDOW_INT_FRENCH_PANE', name: 'French/grid pane window — interior', category: 'Window', unit: 'window', laborMinutes: 5, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'SLIDING_DOOR_EXT', name: 'Sliding glass door — exterior', category: 'Door', unit: 'door', laborMinutes: 8, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'SLIDING_DOOR_INT', name: 'Sliding glass door — interior', category: 'Door', unit: 'door', laborMinutes: 8, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'SCREEN_CLEAN', name: 'Screen clean', category: 'Add-on', unit: 'screen', laborMinutes: 1, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'TRACK_BASIC', name: 'Track clean — basic', category: 'Add-on', unit: 'track', laborMinutes: 0.5, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'TRACK_DEEP', name: 'Track clean — deep', category: 'Add-on', unit: 'track', laborMinutes: 1, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: false, internallyAvailable: true },
	{ code: 'SKYLIGHT_EXT', name: 'Skylight — exterior', category: 'Skylight', unit: 'skylight', laborMinutes: 8, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'SKYLIGHT_INT', name: 'Skylight — interior', category: 'Skylight', unit: 'skylight', laborMinutes: 8, pricingMethod: 'FLAT_UNIT_PRICE', publiclyAvailable: true, internallyAvailable: true },
	{ code: 'HARD_WATER_REMOVAL', name: 'Hard water mineral removal', category: 'Adjustment', unit: 'job', laborMinutes: 0, pricingMethod: 'ADJUSTMENT', publiclyAvailable: false, internallyAvailable: true },
	{ code: 'CONSTRUCTION_DEBRIS', name: 'Construction debris cleanup', category: 'Adjustment', unit: 'job', laborMinutes: 0, pricingMethod: 'ADJUSTMENT', publiclyAvailable: false, internallyAvailable: true },
	{ code: 'FIRST_TIME_CLEAN', name: 'First-time/deep clean', category: 'Adjustment', unit: 'job', laborMinutes: 0, pricingMethod: 'ADJUSTMENT', publiclyAvailable: false, internallyAvailable: true },
	{ code: 'ACCESS_SURCHARGE', name: 'Difficult access surcharge', category: 'Adjustment', unit: 'job', laborMinutes: 0, pricingMethod: 'ADJUSTMENT', publiclyAvailable: false, internallyAvailable: true },
	{ code: 'MINIMUM_JOB_ADJUSTMENT', name: 'Minimum job adjustment', category: 'Adjustment', unit: 'job', laborMinutes: 0, pricingMethod: 'ADJUSTMENT', publiclyAvailable: false, internallyAvailable: true },
	{ code: 'MANUAL_ADJUSTMENT', name: 'Manual adjustment', category: 'Adjustment', unit: 'job', laborMinutes: 0, pricingMethod: 'ADJUSTMENT', publiclyAvailable: false, internallyAvailable: true },
	{ code: 'DISCOUNT', name: 'Discount', category: 'Adjustment', unit: 'job', laborMinutes: 0, pricingMethod: 'ADJUSTMENT', publiclyAvailable: false, internallyAvailable: true },
];

/** Idempotent: creates any of the initial service codes that don't exist
 * yet. Never overwrites an existing Service row (the owner may have already
 * tuned it), including on repeated calls after new codes are added here. */
export async function seedInitialServices(env: SheetsEnv): Promise<{ created: string[] }> {
	const existing = new Set((await listServices(env)).map((s) => s['Service Code']));
	const created: string[] = [];

	for (const svc of INITIAL_SERVICES) {
		if (existing.has(svc.code)) continue;
		await createRow(env, serviceConfig, {
			id: svc.code,
			'Service Name': svc.name,
			'Service Category': svc.category,
			'Default Unit': svc.unit,
			'Default Labor Minutes': String(svc.laborMinutes),
			'Pricing Method': svc.pricingMethod,
			'Publicly Available': svc.publiclyAvailable ? 'Y' : 'N',
			'Internally Available': svc.internallyAvailable ? 'Y' : 'N',
			Active: 'Y',
		});
		created.push(svc.code);
	}

	return { created };
}
