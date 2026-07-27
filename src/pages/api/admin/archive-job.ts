import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { softDeleteRow } from '../../../lib/sheets';
import { jobConfig } from '../../../lib/models/job';

// Internal-only. Soft-deletes (Archived At, never hard-deleted) a Job row —
// same purpose as archive-property.ts, for a mistaken/test Job with no
// equivalent delete action in the Job Day UI.
export const POST: APIRoute = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) {
		return new Response(JSON.stringify({ ok: false, error: 'id required' }), { status: 400 });
	}
	try {
		const archived = await softDeleteRow(env, jobConfig, id);
		return new Response(JSON.stringify({ ok: true, archived }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
