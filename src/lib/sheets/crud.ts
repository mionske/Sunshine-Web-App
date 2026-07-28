import type { ZodType } from 'zod';
import { ensureGridSize, getValues, updateValues, type CellValue } from './client';
import {
	assertHeadersInclude,
	nextEmptyRow,
	objectToRowValues,
	readTab,
	rowRangeFor,
	type SheetRow,
} from './rows';
import { logActivity } from './activityLog';
import { SheetsConcurrencyError, SheetsNotFoundError, SheetsWriteError, type SheetsEnv } from './types';
import { nowIso } from './time';

export interface TabConfig<T extends Record<string, CellValue>> {
	tab: string;
	idColumn: string;
	requiredColumns: string[];
	schema: ZodType<T>;
	entityType: string;
}

async function findRowById(
	env: SheetsEnv,
	config: TabConfig<Record<string, CellValue>>
): Promise<{ rows: SheetRow[]; headers: string[] }> {
	// One batched read for headers AND rows. Asking readHeaders separately
	// first would warm the cache and defeat the batching, costing two API
	// calls per tab — which is what exhausted the 60-reads-per-minute quota
	// on a nine-tab property page.
	const { headers, rows } = await readTab(env, config.tab, { idColumn: config.idColumn });
	assertHeadersInclude(config.tab, headers, config.requiredColumns);
	// idColumn-filtered: a row with no value in its own ID column is never a
	// genuine record for us, regardless of what else is in it — legacy
	// sheets (Jobs) can have stray formula cells scattered many rows deep
	// with nothing behind them (see nextEmptyRow's doc comment).
	return { rows, headers };
}

function validate<T extends Record<string, CellValue>>(config: TabConfig<T>, record: unknown): T {
	const result = config.schema.safeParse(record);
	if (!result.success) {
		throw new SheetsWriteError(`Validation failed for ${config.tab}: ${result.error.message}`);
	}
	return result.data;
}

/**
 * Creates a row. Idempotent by ID: pass `input.id` as a UUID generated once
 * by the caller (e.g. when a form loads) and reused across retries of the
 * same logical submission — a double-tapped Save, a dropped connection
 * retry, or a Cloudflare-level retry all resolve to the same ID, so this
 * simply returns the already-created row instead of writing a duplicate.
 */
export async function createRow<T extends Record<string, CellValue>>(
	env: SheetsEnv,
	config: TabConfig<T>,
	input: Partial<T> & { id?: string },
	meta: { requestId?: string; user?: string } = {}
): Promise<T> {
	const { rows, headers } = await findRowById(env, config);

	const id = input.id ?? crypto.randomUUID();
	const existing = rows.find((row) => row.data[config.idColumn] === id);
	if (existing) {
		return existing.data as T;
	}

	const now = nowIso();
	const { id: _discard, ...rest } = input;
	const record = validate(config, {
		...rest,
		[config.idColumn]: id,
		'Created At': now,
		'Updated At': now,
		'Archived At': '',
	});

	// An explicit target range, not the Sheets API's `:append` convenience
	// endpoint — `:append`'s "smart" placement has proven unreliable on
	// sparse sheets with stray formula cells scattered far down unrelated
	// columns (discovered on Jobs: it silently shifted an entire row 15
	// columns off from where it should have landed).
	// Appending is a read-then-write (find the first empty row, then write to
	// it), so two creates racing on the same tab can pick the same row and
	// the second silently overwrites the first. That is exactly what happened
	// when the photo grid uploaded a camera roll in parallel: the R2 objects
	// all landed, but most of their metadata rows were lost.
	//
	// Callers should not create concurrently on one tab (the photo uploader
	// now serializes). This is the backstop for when something does anyway:
	// write, read the row back, and if our own ID isn't the one sitting there,
	// someone else won the race — recompute and try again rather than
	// reporting a success that quietly lost the row.
	// Retrying alone can't fully solve this — a pile of racers will keep
	// colliding in lockstep — so attempts are spaced by a randomized backoff
	// to break up the convoy. What this DOES guarantee, which is the part
	// that matters, is that a create never reports success when its row was
	// taken: if the row-back read doesn't show our own ID after every
	// attempt, this throws instead of returning a record that isn't there.
	const MAX_APPEND_ATTEMPTS = 6;
	const idColumnIndex = headers.indexOf(String(config.idColumn));
	let written = false;
	for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS && !written; attempt++) {
		if (attempt > 0) {
			const backoffMs = Math.round((2 ** attempt) * 15 * (0.5 + Math.random()));
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
		}

		const startRow = await nextEmptyRow(env, config.tab);
		await ensureGridSize(env, config.tab, { minRows: startRow });
		await updateValues(env, rowRangeFor(config.tab, startRow, headers), [objectToRowValues(headers, record)]);

		const landed = await getValues(env, rowRangeFor(config.tab, startRow, headers));
		written = String(landed?.[0]?.[idColumnIndex] ?? '') === id;
	}
	if (!written) {
		throw new SheetsWriteError(
			`Could not append a row to ${config.tab} after ${MAX_APPEND_ATTEMPTS} attempts — another write kept taking the same row. Nothing was saved; retry this one on its own.`
		);
	}

	await logActivity(env, {
		entityType: config.entityType,
		entityId: id,
		action: 'created',
		newValue: JSON.stringify(record),
		requestId: meta.requestId,
		user: meta.user,
	});

	return record;
}

export interface UpdateOptions {
	expectedUpdatedAt?: string;
	requestId?: string;
	user?: string;
	action?: string;
}

/** Updates an existing row by ID. Pass `expectedUpdatedAt` (the row's
 * `Updated At` value as last read by the caller) to get an optimistic-
 * concurrency check — if the row changed since, this throws rather than
 * silently overwriting someone else's edit. */
export async function updateRow<T extends Record<string, CellValue>>(
	env: SheetsEnv,
	config: TabConfig<T>,
	id: string,
	patch: Partial<T>,
	opts: UpdateOptions = {}
): Promise<T> {
	const { rows, headers } = await findRowById(env, config);
	const row = rows.find((r) => r.data[config.idColumn] === id);
	if (!row) throw new SheetsNotFoundError(config.tab, id);

	if (opts.expectedUpdatedAt !== undefined && row.data['Updated At'] !== opts.expectedUpdatedAt) {
		throw new SheetsConcurrencyError(config.tab, id);
	}

	const now = nowIso();
	const merged = validate(config, { ...row.data, ...patch, 'Updated At': now });

	await updateValues(env, rowRangeFor(config.tab, row.rowNumber, headers), [
		objectToRowValues(headers, merged),
	]);

	await logActivity(env, {
		entityType: config.entityType,
		entityId: id,
		action: opts.action ?? 'updated',
		previousValue: JSON.stringify(row.data),
		newValue: JSON.stringify(merged),
		requestId: opts.requestId,
		user: opts.user,
	});

	return merged;
}

export async function softDeleteRow<T extends Record<string, CellValue>>(
	env: SheetsEnv,
	config: TabConfig<T>,
	id: string,
	meta: { requestId?: string; user?: string } = {}
): Promise<T> {
	const now = nowIso();
	return updateRow(env, config, id, { 'Archived At': now } as unknown as Partial<T>, {
		...meta,
		action: 'archived',
	});
}

/** All non-archived rows for a tab, as typed objects. */
export async function listActiveRows<T extends Record<string, CellValue>>(
	env: SheetsEnv,
	config: TabConfig<T>
): Promise<T[]> {
	const { rows } = await findRowById(env, config);
	return rows.filter((r) => !r.data['Archived At']).map((r) => r.data as T);
}

/** All archived (soft-deleted) rows for a tab, as typed objects — the
 * complement of listActiveRows(), for the occasional "view what was
 * deleted" surface. */
export async function listArchivedRows<T extends Record<string, CellValue>>(
	env: SheetsEnv,
	config: TabConfig<T>
): Promise<T[]> {
	const { rows } = await findRowById(env, config);
	return rows.filter((r) => Boolean(r.data['Archived At'])).map((r) => r.data as T);
}

export async function findById<T extends Record<string, CellValue>>(
	env: SheetsEnv,
	config: TabConfig<T>,
	id: string
): Promise<T | null> {
	const { rows } = await findRowById(env, config);
	const row = rows.find((r) => r.data[config.idColumn] === id);
	return (row?.data as T) ?? null;
}
