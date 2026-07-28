import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { softDeleteRow } from '../../../lib/sheets';
import { walkthroughConfig } from '../../../lib/models/walkthrough';

// Internal-only. Soft-deletes (Archived At, never hard-deleted) a Walkthrough
// row — same purpose as archive-job.ts/archive-property.ts. There is no
// delete action anywhere in the walkthrough UI, so a mistaken or test
// walkthrough would otherwise sit on the Walkthroughs list permanently.
export const POST: APIRoute = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) {
		return new Response(JSON.stringify({ ok: false, error: 'id required' }), { status: 400 });
	}
	try {
		const archived = await softDeleteRow(env, walkthroughConfig, id);
		return new Response(JSON.stringify({ ok: true, archived }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
