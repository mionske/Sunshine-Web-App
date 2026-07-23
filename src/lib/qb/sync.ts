// Orchestrates the full and targeted syncs: incremental watermark, all-
// or-nothing per-sync validation, idempotent upsert by QB's own ID, and
// Delete/Merge handling for the webhook. Read-only against QuickBooks —
// this never writes back.
import { createRow, findById, listActiveRows, logActivity, softDeleteRow, updateRow, type SheetsEnv, type TabConfig } from '../sheets';
import type { CellValue } from '../sheets/client';
import { qbCustomerConfig, type QBCustomer } from '../models/qbCustomer';
import { qbEstimateConfig, type QBEstimate } from '../models/qbEstimate';
import { qbInvoiceConfig, type QBInvoice } from '../models/qbInvoice';
import { qbPaymentConfig, type QBPayment } from '../models/qbPayment';
import { queryAllPages, queryById } from './client';
import { mapCustomer, mapEstimate, mapInvoice, mapPayment, type RawQBCustomer, type RawQBEstimate, type RawQBInvoice, type RawQBPayment } from './mapping';
import type { QBOAuthEnv } from './oauth';
import type { QBTokenStore } from './tokens';

export type QBSyncEnv = SheetsEnv & QBOAuthEnv;

const WATERMARK_KEY = 'qb-sync-watermark';
const LAST_SYNC_KEY = 'qb-last-sync-at';

async function getWatermark(store: QBTokenStore): Promise<string> {
	return (await store.get(WATERMARK_KEY)) ?? '';
}

async function setWatermark(store: QBTokenStore, iso: string): Promise<void> {
	await store.put(WATERMARK_KEY, iso);
}

export async function getLastSyncAt(store: QBTokenStore): Promise<string | null> {
	return store.get(LAST_SYNC_KEY);
}

/** All-or-nothing per entity: validates every mapped record against the
 * tab's own schema before writing anything, then upserts by the tab's ID
 * column against a map of existing rows fetched once (not re-fetched per
 * record). */
async function upsertMirrorRows<T extends Record<string, CellValue>>(
	env: SheetsEnv,
	config: TabConfig<T>,
	mapped: Array<Partial<T>>
): Promise<{ created: number; updated: number }> {
	for (const record of mapped) {
		const result = config.schema.safeParse({ ...record, 'Created At': '', 'Updated At': '', 'Archived At': '' });
		if (!result.success) {
			throw new Error(`QuickBooks sync: invalid ${config.tab} record ${String(record[config.idColumn as keyof T])}: ${result.error.message}`);
		}
	}

	const existing = await listActiveRows(env, config);
	const existingById = new Map(existing.map((row) => [row[config.idColumn], row]));

	let created = 0;
	let updated = 0;
	for (const record of mapped) {
		const id = record[config.idColumn as keyof T] as string;
		if (existingById.has(id)) {
			await updateRow(env, config, id, record, { action: 'QuickBooks sync' });
			updated++;
		} else {
			await createRow(env, config, { id, ...record } as Partial<T> & { id: string });
			created++;
		}
	}
	return { created, updated };
}

export interface SyncResult {
	customers: { created: number; updated: number };
	estimates: { created: number; updated: number };
	invoices: { created: number; updated: number };
	payments: { created: number; updated: number };
}

/** Full paginated sync of all four entities, incremental since the last
 * successful run. The watermark is the START time of THIS run (recorded
 * before any fetch), not its completion time — anything edited in QB
 * mid-sync is picked up next round instead of silently missed. Only
 * advances the stored watermark if every entity's upsert succeeds. */
export async function runFullSync(env: QBSyncEnv, meta: { user?: string; requestId?: string } = {}): Promise<SyncResult> {
	const syncStartedAt = new Date().toISOString();
	const watermark = await getWatermark(env.QB_TOKENS);
	const where = watermark ? `MetaData.LastUpdatedTime > '${watermark}'` : '';
	const today = syncStartedAt.slice(0, 10);

	try {
		const [rawCustomers, rawEstimates, rawInvoices, rawPayments] = await Promise.all([
			queryAllPages<RawQBCustomer>(env, 'Customer', where),
			queryAllPages<RawQBEstimate>(env, 'Estimate', where),
			queryAllPages<RawQBInvoice>(env, 'Invoice', where),
			queryAllPages<RawQBPayment>(env, 'Payment', where),
		]);

		const result: SyncResult = {
			customers: await upsertMirrorRows(env, qbCustomerConfig, rawCustomers.map(mapCustomer)),
			estimates: await upsertMirrorRows(env, qbEstimateConfig, rawEstimates.map(mapEstimate)),
			invoices: await upsertMirrorRows(env, qbInvoiceConfig, rawInvoices.map((r) => mapInvoice(r, today))),
			payments: await upsertMirrorRows(env, qbPaymentConfig, rawPayments.map(mapPayment)),
		};

		await setWatermark(env.QB_TOKENS, syncStartedAt);
		await env.QB_TOKENS.put(LAST_SYNC_KEY, syncStartedAt);

		await logActivity(env, {
			entityType: 'QBSync',
			entityId: 'full-sync',
			action: 'QuickBooks sync succeeded',
			user: meta.user,
			requestId: meta.requestId,
			notes: `Customers +${result.customers.created}/${result.customers.updated} · Estimates +${result.estimates.created}/${result.estimates.updated} · Invoices +${result.invoices.created}/${result.invoices.updated} · Payments +${result.payments.created}/${result.payments.updated}`,
		});

		return result;
	} catch (error) {
		await logActivity(env, {
			entityType: 'QBSync',
			entityId: 'full-sync',
			action: 'QuickBooks sync failed',
			user: meta.user,
			requestId: meta.requestId,
			notes: (error as Error).message,
		});
		throw error;
	}
}

const ENTITY_CONFIG = {
	Customer: { config: qbCustomerConfig, map: (raw: RawQBCustomer) => mapCustomer(raw) },
	Estimate: { config: qbEstimateConfig, map: (raw: RawQBEstimate) => mapEstimate(raw) },
	Invoice: { config: qbInvoiceConfig, map: (raw: RawQBInvoice, today: string) => mapInvoice(raw, today) },
	Payment: { config: qbPaymentConfig, map: (raw: RawQBPayment) => mapPayment(raw) },
} as const;

export type QBEntityType = keyof typeof ENTITY_CONFIG;

/** Targeted single-record sync for the webhook path — fetches and upserts
 * just the one changed entity, never a full paginated pull. Non-critical:
 * callers (the webhook route) are expected to catch and swallow failures
 * here, since the manual full sync remains authoritative regardless. */
export async function syncSingleEntity(env: QBSyncEnv, entityType: QBEntityType, qbId: string): Promise<void> {
	const today = new Date().toISOString().slice(0, 10);

	if (entityType === 'Customer') {
		const raw = await queryById<RawQBCustomer>(env, 'Customer', qbId);
		if (raw) await upsertMirrorRows(env, qbCustomerConfig, [mapCustomer(raw)]);
	} else if (entityType === 'Estimate') {
		const raw = await queryById<RawQBEstimate>(env, 'Estimate', qbId);
		if (raw) await upsertMirrorRows(env, qbEstimateConfig, [mapEstimate(raw)]);
	} else if (entityType === 'Invoice') {
		const raw = await queryById<RawQBInvoice>(env, 'Invoice', qbId);
		if (raw) await upsertMirrorRows(env, qbInvoiceConfig, [mapInvoice(raw, today)]);
	} else if (entityType === 'Payment') {
		const raw = await queryById<RawQBPayment>(env, 'Payment', qbId);
		if (raw) await upsertMirrorRows(env, qbPaymentConfig, [mapPayment(raw)]);
	}
}

const CONFIG_BY_ENTITY: Record<QBEntityType, TabConfig<QBCustomer | QBEstimate | QBInvoice | QBPayment>> = {
	Customer: qbCustomerConfig as unknown as TabConfig<QBCustomer | QBEstimate | QBInvoice | QBPayment>,
	Estimate: qbEstimateConfig as unknown as TabConfig<QBCustomer | QBEstimate | QBInvoice | QBPayment>,
	Invoice: qbInvoiceConfig as unknown as TabConfig<QBCustomer | QBEstimate | QBInvoice | QBPayment>,
	Payment: qbPaymentConfig as unknown as TabConfig<QBCustomer | QBEstimate | QBInvoice | QBPayment>,
};

/** Soft-deletes the mirror row for a webhook's Delete operation. A
 * harmless no-op if the row was never synced in the first place. */
export async function deleteMirrorRow(env: SheetsEnv, entityType: QBEntityType, qbId: string): Promise<void> {
	const config = CONFIG_BY_ENTITY[entityType];
	const existing = await findById(env, config, qbId);
	if (existing) await softDeleteRow(env, config, qbId);
}

/** A webhook Merge operation: the losing id's mirror row is deleted, then
 * the surviving record is re-fetched and upserted under its own id. */
export async function mergeMirrorRow(env: QBSyncEnv, entityType: QBEntityType, deletedId: string, survivingId: string): Promise<void> {
	await deleteMirrorRow(env, entityType, deletedId);
	await syncSingleEntity(env, entityType, survivingId);
}
