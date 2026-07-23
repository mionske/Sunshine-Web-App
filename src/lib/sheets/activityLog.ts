import { ensureGridSize, updateValues } from './client';
import { nextEmptyRow, objectToRowValues, readHeaders, rowRangeFor } from './rows';
import type { SheetsEnv } from './types';
import { nowIso } from './time';

const TAB = 'ActivityLog';

export interface ActivityLogEntry {
	entityType: string;
	entityId: string;
	action: string;
	previousValue?: string;
	newValue?: string;
	user?: string;
	requestId?: string;
	notes?: string;
}

// Deliberately does not call the generic createRow() CRUD helper — logging a
// mutation must never itself trigger another log entry, and it never needs
// idempotency/optimistic-concurrency (log entries are append-only).
export async function logActivity(env: SheetsEnv, entry: ActivityLogEntry): Promise<void> {
	const headers = await readHeaders(env, TAB);
	const now = nowIso();
	const record: Record<string, string> = {
		'Activity ID': crypto.randomUUID(),
		'Entity Type': entry.entityType,
		'Entity ID': entry.entityId,
		Action: entry.action,
		'Previous Value': entry.previousValue ?? '',
		'New Value': entry.newValue ?? '',
		User: entry.user ?? 'system',
		Timestamp: now,
		'Request ID': entry.requestId ?? '',
		Notes: entry.notes ?? '',
	};
	// An explicit target row, not `:append` — see crud.ts's createRow for why.
	// ActivityLog grows on every mutation across the whole app, so it's the
	// tab most likely to eventually outgrow its starting grid size.
	const startRow = await nextEmptyRow(env, TAB);
	await ensureGridSize(env, TAB, { minRows: startRow });
	await updateValues(env, rowRangeFor(TAB, startRow, headers), [objectToRowValues(headers, record)]);
}
