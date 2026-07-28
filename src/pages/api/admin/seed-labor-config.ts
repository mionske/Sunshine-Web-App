import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createRow, findById, listActiveRows, updateRow } from '../../../lib/sheets';
import { laborConfigConfig } from '../../../lib/models/laborConfig';
import { windowProductionProfileConfig } from '../../../lib/models/windowProductionProfile';
import { pricingConfigConfig } from '../../../lib/models/pricingConfig';
import {
	SEED_HOURLY_TARGETS,
	SEED_LABOR_CONFIG,
	SEED_LABOR_CONFIG_ID,
	SEED_WINDOW_PRODUCTION_PROFILES,
} from '../../../lib/labor/seed';

// Internal-only. Writes the initial labor model into the live spreadsheet:
// one LaborConfig row, one WindowProductionProfiles row per production class,
// and the owner's hourly production targets onto the Active PricingConfig.
//
// Idempotent by construction — every seeded row uses a fixed, meaningful ID
// rather than a fresh UUID, so createRow's own idempotency turns a second run
// into a no-op instead of a duplicate set of profiles.
//
// GET is a dry run: it reports what a POST would change and writes nothing.

interface SeedPlan {
	storedProfileCount: number;
	duplicateProfileIds: string[];
	storedProfiles: { id: string; productionClass: string; laborConfigId: string; minutes: string; paneFactor: string }[];
	laborConfig: 'create' | 'exists';
	profiles: { productionClass: string; action: 'create' | 'exists' }[];
	pricingConfig:
		| { status: 'no-active-config' }
		| { id: string; changes: Record<string, { from: string; to: string }> };
}

async function plan(): Promise<SeedPlan> {
	const existingConfig = await findById(env, laborConfigConfig, SEED_LABOR_CONFIG_ID);
	const existingProfiles = await listActiveRows(env, windowProductionProfileConfig);
	const profileIds = new Set(existingProfiles.map((p) => p['Profile ID']));

	const pricingConfigs = await listActiveRows(env, pricingConfigConfig);
	const active = pricingConfigs.find((c) => c.Status === 'Active');

	let pricingConfig: SeedPlan['pricingConfig'];
	if (!active) {
		pricingConfig = { status: 'no-active-config' };
	} else {
		const changes: Record<string, { from: string; to: string }> = {};
		for (const [column, value] of Object.entries(SEED_HOURLY_TARGETS)) {
			const current = String(active[column as keyof typeof active] ?? '');
			// Only fills blanks. A number the owner has already set is never
			// overwritten by a seed script.
			if (!current) changes[column] = { from: current, to: value };
		}
		pricingConfig = { id: active['Pricing Config ID'], changes };
	}

	// Appending a row is a read-then-write, so a run that dies partway can in
	// principle leave a mess. Report what is actually stored, not just
	// whether each ID resolves — a duplicated or half-written profile is
	// exactly the thing a "looks fine" existence check would miss.
	const seen = new Map<string, number>();
	for (const p of existingProfiles) seen.set(p['Profile ID'], (seen.get(p['Profile ID']) ?? 0) + 1);
	const duplicateProfileIds = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);

	return {
		laborConfig: existingConfig ? 'exists' : 'create',
		profiles: SEED_WINDOW_PRODUCTION_PROFILES.map((p) => ({
			productionClass: p['Production Class'],
			action: profileIds.has(p['Profile ID']) ? 'exists' : 'create',
		})),
		pricingConfig,
		storedProfileCount: existingProfiles.length,
		duplicateProfileIds,
		storedProfiles: existingProfiles.map((p) => ({
			id: p['Profile ID'],
			productionClass: p['Production Class'],
			laborConfigId: p['Labor Config ID'],
			minutes: [
				p['Interior Glass Base Minutes'],
				p['Exterior Glass Base Minutes'],
				p['Screen Handling Base Minutes'],
				p['Screen Cleaning Base Minutes'],
				p['Track Base Minutes'],
				p['Frame Base Minutes'],
			].join('/'),
			paneFactor: p['Default Pane Factor'],
		})),
	};
}

export const GET: APIRoute = async () => {
	try {
		return new Response(JSON.stringify({ ok: true, dryRun: true, plan: await plan() }, null, 2), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};

export const POST: APIRoute = async () => {
	try {
		const before = await plan();

		await createRow(env, laborConfigConfig, { ...SEED_LABOR_CONFIG, id: SEED_LABOR_CONFIG_ID });

		// Sequentially, not Promise.all — appending a row is a read-then-write
		// (find the first empty row, then write to it), so concurrent creates
		// on one tab race for the same row. See the note in sheets/crud.ts.
		for (const profile of SEED_WINDOW_PRODUCTION_PROFILES) {
			await createRow(env, windowProductionProfileConfig, { ...profile, id: profile['Profile ID'] });
		}

		if ('id' in before.pricingConfig && Object.keys(before.pricingConfig.changes).length > 0) {
			const patch = Object.fromEntries(
				Object.entries(before.pricingConfig.changes).map(([column, change]) => [column, change.to])
			);
			await updateRow(env, pricingConfigConfig, before.pricingConfig.id, patch, {
				action: 'seeded hourly production targets',
			});
		}

		return new Response(JSON.stringify({ ok: true, applied: before, after: await plan() }, null, 2), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
