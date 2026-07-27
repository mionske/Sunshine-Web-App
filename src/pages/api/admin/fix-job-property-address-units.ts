import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listActiveRows, updateRow } from '../../../lib/sheets';
import { jobConfig } from '../../../lib/models/job';
import { propertyConfig } from '../../../lib/models/property';

// One-off, idempotent data repair: Jobs created before jobLifecycle.ts's
// createJobFromQuote started appending a linked Property's Unit Identifier
// to its stored 'Property Address' snapshot are stuck with an address that
// can't distinguish one unit in a multi-unit building from another (e.g.
// four "601 Canyon Blvd, Boulder" Jobs with no way to tell units A/B/C/D
// apart). Re-derives the same snapshot going forward would produce, for
// every existing Job whose linked Property has a Unit Identifier not
// already reflected in the stored string. Safe to re-run — a Job whose
// address already includes the unit is left untouched.
export const POST: APIRoute = async () => {
	try {
		const [jobs, properties] = await Promise.all([listActiveRows(env, jobConfig), listActiveRows(env, propertyConfig)]);
		const propertyById = new Map(properties.map((p) => [p['Property ID'], p]));

		const updated: { jobId: string; from: string; to: string }[] = [];
		for (const job of jobs) {
			if (!job['Property ID']) continue;
			const property = propertyById.get(job['Property ID']);
			if (!property?.['Unit Identifier']) continue;

			const unitSuffix = ` — Unit ${property['Unit Identifier']}`;
			if (job['Property Address'].includes(unitSuffix)) continue;

			const correctedAddress = `${property['Street Address']}, ${property.City}${unitSuffix}`;
			await updateRow(env, jobConfig, job['Job ID'], { 'Property Address': correctedAddress });
			updated.push({ jobId: job['Job ID'], from: job['Property Address'], to: correctedAddress });
		}

		return new Response(JSON.stringify({ ok: true, updatedCount: updated.length, updated }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
