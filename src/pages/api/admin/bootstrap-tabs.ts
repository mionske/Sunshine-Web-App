import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { bootstrapMissingTabs } from '../../../lib/sheets';

// Internal-only. Idempotent — creates any tab from TAB_SCHEMAS that doesn't
// exist yet (with its header row) and leaves everything else untouched.
// Safe to call again any time a new tab is added to the schema later.
export const POST: APIRoute = async () => {
	try {
		const result = await bootstrapMissingTabs(env);
		return new Response(JSON.stringify({ ok: true, ...result }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
