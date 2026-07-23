import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
	createRow,
	findById,
	listActiveRows,
	softDeleteRow,
	updateRow,
	SheetsConcurrencyError,
	SheetsNotFoundError,
	SheetsWriteError,
	type CellValue,
	type TabConfig,
} from './sheets';

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function guarded(fn: () => Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof SheetsNotFoundError) return json({ ok: false, error: error.message }, 404);
		if (error instanceof SheetsConcurrencyError) return json({ ok: false, error: error.message }, 409);
		if (error instanceof SheetsWriteError) return json({ ok: false, error: error.message }, 400);
		return json({ ok: false, error: (error as Error).message }, 500);
	}
}

/** Generic GET (list active rows) + POST (create) handlers for a tab's
 * `/api/<tab>/index` route. Shared because Clients/Properties/Pipeline/etc.
 * all need the identical read/validate/create shape. */
export function listCreateRoutes<T extends Record<string, CellValue>>(config: TabConfig<T>) {
	const GET: APIRoute = () =>
		guarded(async () => {
			const rows = await listActiveRows(env, config);
			return json({ ok: true, rows });
		});

	const POST: APIRoute = ({ request }) =>
		guarded(async () => {
			const input = (await request.json()) as Partial<T> & { id?: string };
			const row = await createRow(env, config, input);
			return json({ ok: true, row }, 201);
		});

	return { GET, POST };
}

/** Generic GET (one) + PATCH (update) + DELETE (soft-delete) handlers for a
 * tab's `/api/<tab>/[id]` route. */
export function itemRoutes<T extends Record<string, CellValue>>(config: TabConfig<T>) {
	const GET: APIRoute = ({ params }) =>
		guarded(async () => {
			const row = await findById(env, config, params.id!);
			if (!row) return json({ ok: false, error: 'Not found' }, 404);
			return json({ ok: true, row });
		});

	const PATCH: APIRoute = ({ params, request }) =>
		guarded(async () => {
			const body = (await request.json()) as { patch: Partial<T>; expectedUpdatedAt?: string };
			const row = await updateRow(env, config, params.id!, body.patch, {
				expectedUpdatedAt: body.expectedUpdatedAt,
			});
			return json({ ok: true, row });
		});

	const DELETE: APIRoute = ({ params }) =>
		guarded(async () => {
			const row = await softDeleteRow(env, config, params.id!);
			return json({ ok: true, row });
		});

	return { GET, PATCH, DELETE };
}
