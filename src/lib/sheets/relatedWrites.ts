import { batchUpdateValues, ensureGridSize, type CellValue } from './client';
import { assertHeadersInclude, columnLetterAt, nextEmptyRow, objectToRowValues, readHeaders, readRows } from './rows';
import { logActivity } from './activityLog';
import { SheetsWriteError, type SheetsEnv } from './types';
import type { TabConfig } from './crud';
import { nowIso } from './time';

export interface RelatedWriteOp<T extends Record<string, CellValue>> {
	config: TabConfig<T>;
	records: (Partial<T> & { id?: string })[];
}

export interface RelatedWriteResult {
	writeOperationId: string;
	created: Record<string, CellValue>[][];
}

/**
 * Creates related rows across multiple tabs (e.g. a Quote plus its
 * QuoteItems) as one write. The Sheets API's `values:batchUpdate` applies
 * the ranges in that single call as a unit, but the *response* to this
 * Worker's HTTP request can still be lost after Google has already applied
 * the change (a dropped connection, a Cloudflare-level retry, etc.) — this
 * is what makes it a recoverable operation rather than a true cross-tab
 * database transaction. Recovery relies on two things: every record keeps
 * a stable caller-supplied or freshly-assigned ID, and every record's
 * "committed" ActivityLog entry is tagged with this operation's
 * `Write Operation ID`, so a health check can find any operation whose
 * prepared records never got a matching committed entry and re-verify/
 * re-drive it.
 *
 * Idempotent by ID, same as `createRow`: a record whose ID already exists
 * in its target tab is treated as already-committed and is neither
 * re-validated nor re-written — so retrying an entire multi-record
 * submission with the same caller-supplied IDs (a safe retry path after a
 * partial/uncertain failure) never creates duplicates.
 */
export async function createRelatedRows(
	env: SheetsEnv,
	ops: RelatedWriteOp<Record<string, CellValue>>[],
	meta: { requestId?: string; user?: string } = {}
): Promise<RelatedWriteResult> {
	const writeOperationId = crypto.randomUUID();
	const now = nowIso();

	// 1. Validate + assign IDs/timestamps for every genuinely new record,
	// across every op, before writing anything. Records whose ID already
	// exists are collected too (so `created` still reflects the full set)
	// but are excluded from validation and from the write below.
	const prepared = await Promise.all(
		ops.map(async ({ config, records }) => {
			const headers = await readHeaders(env, config.tab);
			assertHeadersInclude(config.tab, headers, config.requiredColumns);
			const existingRows = await readRows(env, config.tab, { idColumn: config.idColumn });
			const existingById = new Map(existingRows.map((r) => [String(r.data[config.idColumn]), r.data]));

			const allRecords: Record<string, CellValue>[] = [];
			const toWrite: Record<string, CellValue>[] = [];
			for (const input of records) {
				const id = input.id ?? crypto.randomUUID();
				const existing = existingById.get(id);
				if (existing) {
					allRecords.push(existing);
					continue;
				}
				const { id: _discard, ...rest } = input;
				const record = {
					...rest,
					[config.idColumn]: id,
					'Created At': now,
					'Updated At': now,
					'Archived At': '',
				};
				const parsed = config.schema.safeParse(record);
				if (!parsed.success) {
					throw new SheetsWriteError(`Validation failed for ${config.tab}: ${parsed.error.message}`);
				}
				allRecords.push(parsed.data);
				toWrite.push(parsed.data);
			}

			return { config, headers, allRecords, toWrite };
		})
	);

	// 2. Compute append target ranges per tab — only for genuinely new rows.
	const rangesData: { range: string; values: CellValue[][] }[] = [];
	for (const { config, headers, toWrite } of prepared) {
		if (toWrite.length === 0) continue;
		const startRow = await nextEmptyRow(env, config.tab);
		const values = toWrite.map((r) => objectToRowValues(headers, r));
		const endColumn = columnLetterAt(headers.length);
		await ensureGridSize(env, config.tab, { minRows: startRow + values.length - 1 });
		rangesData.push({
			range: `'${config.tab}'!A${startRow}:${endColumn}${startRow + values.length - 1}`,
			values,
		});
	}

	// 3. Single write — skipped entirely if every record already existed.
	if (rangesData.length > 0) {
		await batchUpdateValues(env, rangesData);
	}

	// 4. Mark committed — only for rows actually written this call.
	for (const { config, toWrite } of prepared) {
		for (const record of toWrite) {
			await logActivity(env, {
				entityType: config.entityType,
				entityId: String(record[config.idColumn]),
				action: 'created',
				newValue: JSON.stringify(record),
				requestId: meta.requestId,
				user: meta.user,
				notes: `Write Operation ID: ${writeOperationId} — committed`,
			});
		}
	}

	return { writeOperationId, created: prepared.map((p) => p.allRecords) };
}
