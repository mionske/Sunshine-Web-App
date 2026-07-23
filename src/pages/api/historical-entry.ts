import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { findLikelyDuplicates } from '../../lib/pricing/duplicateDetection';
import { previewCalibrationEligibility, saveHistoricalEntry, type HistoricalEntryPayload } from '../../lib/pricing/historicalEntry';

export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json()) as { action: string; [key: string]: unknown };

	try {
		if (body.action === 'check-duplicates') {
			const candidates = await findLikelyDuplicates(env, body.input as never);
			return json({ ok: true, candidates });
		}

		if (body.action === 'preview-calibration') {
			const preview = previewCalibrationEligibility(body.job as HistoricalEntryPayload['job']);
			return json({ ok: true, ...preview });
		}

		if (body.action === 'save') {
			const result = await saveHistoricalEntry(env, body.payload as HistoricalEntryPayload);
			return json({ ok: true, ...result });
		}

		return json({ ok: false, error: `Unknown action "${body.action}"` }, 400);
	} catch (error) {
		// Nothing is written until createRelatedRows' single batched write —
		// a thrown error here means the whole submission was rejected before
		// any record landed, so it's always safe to retry the exact same
		// payload (the IDs are stable, and createRelatedRows is idempotent
		// by ID — see relatedWrites.ts).
		return json({ ok: false, error: (error as Error).message, retryable: true }, 502);
	}
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
