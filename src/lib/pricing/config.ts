// PricingConfig operations. Core rule (from the plan, revised): exactly one
// row may be Active *per Property Type* at a time (was globally exactly
// one — scoped per segment since Residential/Commercial/New
// Build-Construction are independently priced and versioned), and this is
// the *only* path that flips Status — nothing else in the app is allowed
// to write PricingConfig.Status directly, so the invariant can't be
// bypassed.
import { createRow, findById, listActiveRows, logActivity, updateRow, type SheetsEnv } from '../sheets';
import { pricingConfigConfig, type PricingConfig } from '../models/pricingConfig';

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/** propertyType is required — callers with a specific Property in scope
 * pass its actual type; callers showing one global stat without property
 * context (the dashboard, the calibration overview) pass 'Residential'
 * explicitly as the primary-segment default, documented at the call site,
 * rather than this function guessing on their behalf. */
export async function getActivePricingConfig(env: SheetsEnv, propertyType: string): Promise<PricingConfig | null> {
	const rows = await listActiveRows(env, pricingConfigConfig);
	return rows.find((r) => r.Status === 'Active' && r['Property Type'] === propertyType) ?? null;
}

export async function listPricingConfigs(env: SheetsEnv): Promise<PricingConfig[]> {
	return listActiveRows(env, pricingConfigConfig);
}

/** Activates a PricingConfig row, superseding whatever was previously
 * active *for the same Property Type* (a Commercial activation never
 * touches the Residential active row, and vice versa). This is the only
 * function allowed to set Status to Active — every other write path must
 * go through it, so "exactly one Active row per segment" can never be
 * violated by a stray direct update. */
export async function activatePricingConfig(
	env: SheetsEnv,
	id: string,
	meta: { user?: string; requestId?: string } = {}
): Promise<PricingConfig> {
	const target = await findById(env, pricingConfigConfig, id);
	if (!target) throw new Error(`PricingConfig "${id}" not found`);

	const current = target['Property Type'] ? await getActivePricingConfig(env, target['Property Type']) : null;
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

/** Edits a non-Active PricingConfig row in place — the "review and edit
 * before activating" step of the calibration recommendation flow. Refuses
 * to touch an Active row directly (that invariant is only ever changed
 * through activatePricingConfig's supersede logic): to change an active
 * price, create a new draft and activate that instead. */
export async function updatePricingConfigDraft(
	env: SheetsEnv,
	id: string,
	patch: Partial<PricingConfig>,
	meta: { user?: string; requestId?: string } = {}
): Promise<PricingConfig> {
	const target = await findById(env, pricingConfigConfig, id);
	if (!target) throw new Error(`PricingConfig "${id}" not found`);
	if (target.Status === 'Active') {
		throw new Error('Cannot edit an Active PricingConfig directly — create a new draft and activate that instead.');
	}
	return updateRow(env, pricingConfigConfig, id, patch, { ...meta, action: 'Draft edited' });
}

/** Idempotent: seeds the initial $150/on-site-hour active config if no
 * PricingConfig rows exist yet. No-ops otherwise — never overwrites an
 * existing config, including one the owner already changed. */
export async function seedInitialPricingConfig(env: SheetsEnv): Promise<PricingConfig | null> {
	const existing = await listPricingConfigs(env);
	if (existing.length > 0) return null;

	const created = await createRow(env, pricingConfigConfig, {
		'Config Name': 'Initial pricing policy',
		'Property Type': 'Residential',
		'Calculator Version': '1',
		'Target Hourly Rate': '150',
		Notes: '$150 per estimated on-site labor hour — the initial operating target.',
	});

	return activatePricingConfig(env, created['Pricing Config ID']);
}
