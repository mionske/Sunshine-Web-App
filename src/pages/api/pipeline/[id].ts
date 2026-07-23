import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { findById, softDeleteRow, updateRow } from '../../../lib/sheets';
import { guarded, json } from '../../../lib/apiCrud';
import { pipelineConfig, type Opportunity } from '../../../lib/models/pipeline';

export const GET: APIRoute = ({ params }) =>
	guarded(async () => {
		const row = await findById(env, pipelineConfig, params.id!);
		if (!row) return json({ ok: false, error: 'Not found' }, 404);
		return json({ ok: true, row });
	});

// Custom (not the generic itemRoutes helper): moving to Accepted or Lost
// closes the opportunity, and Lost requires a reason — business rules
// specific to the sales pipeline, not generic CRUD.
export const PATCH: APIRoute = ({ params, request }) =>
	guarded(async () => {
		const body = (await request.json()) as { patch: Partial<Opportunity>; expectedUpdatedAt?: string };
		const patch: Partial<Opportunity> = { ...body.patch };

		if (patch.Stage === 'Lost') {
			const lostReason = patch['Lost Reason'] ?? (await findById(env, pipelineConfig, params.id!))?.['Lost Reason'];
			if (!lostReason) {
				return json({ ok: false, error: 'Lost Reason is required when marking an opportunity Lost' }, 400);
			}
		}
		if (patch.Stage === 'Accepted' || patch.Stage === 'Lost') {
			patch['Closed At'] = new Date().toISOString();
		}

		// A distinct, named action (not just the generic "updated") when this
		// update is specifically attaching a property to a lead that didn't
		// have one yet — the normal case: contact comes in first, a property
		// gets attached once the walkthrough happens.
		let action: string | undefined;
		if (patch['Property ID']) {
			const current = await findById(env, pipelineConfig, params.id!);
			if (current && !current['Property ID']) {
				action = 'Property attached';
			}
		}

		const row = await updateRow(env, pipelineConfig, params.id!, patch, {
			expectedUpdatedAt: body.expectedUpdatedAt,
			action,
		});
		return json({ ok: true, row });
	});

export const DELETE: APIRoute = ({ params }) =>
	guarded(async () => {
		const row = await softDeleteRow(env, pipelineConfig, params.id!);
		return json({ ok: true, row });
	});
