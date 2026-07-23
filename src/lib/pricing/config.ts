// PricingConfig operations. Core rule (from the plan): exactly one row may
// be Active at a time, and this is the *only* path that flips Status —
// nothing else in the app is allowed to write PricingConfig.Status
// directly, so the invariant can't be bypassed.
import { createRow, listActiveRows, logActivity, updateRow, type SheetsEnv } from '../sheets';
import { pricingConfigConfig, type PricingConfig } from '../models/pricingConfig';

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

export async function getActivePricingConfig(env: SheetsEnv): Promise<PricingConfig | null> {
	const rows = await listActiveRows(env, pricingConfigConfig);
	return rows.find((r) => r.Status === 'Active') ?? null;
}

export async function listPricingConfigs(env: SheetsEnv): Promise<PricingConfig[]> {
	return listActiveRows(env, pricingConfigConfig);
}

/** Activates a PricingConfig row, superseding whatever was previously
 * active. This is the only function allowed to set Status to Active — every
 * other write path must go through it, so "exactly one Active row" can
 * never be violated by a stray direct update. */
export async function activatePricingConfig(
	env: SheetsEnv,
	id: string,
	meta: { user?: string; requestId?: string } = {}
): Promise<PricingConfig> {
	const current = await getActivePricingConfig(env);
	if (current && current['Pricing Config ID'] !== id) {
		await updateRow(
			env,
			pricingConfigConfig,
			current['Pricing Config ID'],
			{ Status: 'Superseded', 'End Date': today() },
			{ ...meta, action: 'superseded' }
		);
	}

	const activated = await updateRow(
		env,
		pricingConfigConfig,
		id,
		{ Status: 'Active', 'Effective Date': today() },
		{ ...meta, action: 'activated' }
	);

	await logActivity(env, {
		entityType: 'PricingConfig',
		entityId: id,
		action: 'PricingConfig activated',
		user: meta.user,
		requestId: meta.requestId,
	});

	return activated;
}

/** Creates a new PricingConfig row. Drafts by default — activating a
 * pricing change is a distinct, explicit action (see activatePricingConfig),
 * never an automatic side effect of creating the row. */
export async function createPricingConfig(
	env: SheetsEnv,
	input: Partial<PricingConfig> & { id?: string }
): Promise<PricingConfig> {
	return createRow(env, pricingConfigConfig, input);
}

/** Idempotent: seeds the initial $150/on-site-hour active config if no
 * PricingConfig rows exist yet. No-ops otherwise — never overwrites an
 * existing config, including one the owner already changed. */
export async function seedInitialPricingConfig(env: SheetsEnv): Promise<PricingConfig | null> {
	const existing = await listPricingConfigs(env);
	if (existing.length > 0) return null;

	const created = await createRow(env, pricingConfigConfig, {
		'Config Name': 'Initial pricing policy',
		'Calculator Version': '1',
		'Target Hourly Rate': '150',
		Notes: '$150 per estimated on-site labor hour — the initial operating target.',
	});

	return activatePricingConfig(env, created['Pricing Config ID']);
}
