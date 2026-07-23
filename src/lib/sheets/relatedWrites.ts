import { batchUpdateValues, ensureGridSize, type CellValue } from './client';
import { assertHeadersInclude, columnLetterAt, nextEmptyRow, objectToRowValues, readHeaders } from './rows';
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
 * a stable caller-supplied or freshly-assigned ID (safe to retry the whole
 * call with the same IDs — see `createRow`'s idempotency doc for the same
 * pattern), and every record's "committed" ActivityLog entry is tagged with
 * this operation's `Write Operation ID`, so a health check can find any
 * operation whose prepared records never got a matching committed entry
 * and re-verify/re-drive it.
 */
export async function createRelatedRows(
	env: SheetsEnv,
	ops: RelatedWriteOp<Record<string, CellValue>>[],
	meta: { requestId?: string; user?: string } = {}
): Promise<RelatedWriteResult> {
	const writeOperationId = crypto.randomUUID();
	const now = nowIso();

	// 1. Validate + assign IDs/timestamps for every record, across every op,
	// before writing anything.
	const prepared = await Promise.all(
		ops.map(async ({ config, records }) => {
			const headers = await readHeaders(env, config.tab);
			assertHeadersInclude(config.tab, headers, config.requiredColumns);

			const built = records.map((input) => {
				const id = input.id ?? crypto.randomUUID();
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
				return parsed.data;
			});

			return { config, headers, records: built };
		})
	);

	// 2. Compute append target ranges per tab.
	const rangesData: { range: string; values: CellValue[][] }[] = [];
	for (const { config, headers, records } of prepared) {
		const startRow = await nextEmptyRow(env, config.tab);
		const values = records.map((r) => objectToRowValues(headers, r));
		const endColumn = columnLetterAt(headers.length);
		await ensureGridSize(env, config.tab, { minRows: startRow + values.length - 1 });
		rangesData.push({
			range: `'${config.tab}'!A${startRow}:${endColumn}${startRow + values.length - 1}`,
			values,
		});
	}

	// 3. Single write.
	await batchUpdateValues(env, rangesData);

	// 4. Mark committed.
	for (const { config, records } of prepared) {
		for (const record of records) {
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

	return { writeOperationId, created: prepared.map((p) => p.records) };
}
