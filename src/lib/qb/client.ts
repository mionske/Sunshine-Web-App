// Thin QuickBooks REST client: authenticated queries with the retry/
// backoff discipline the spec calls for. No writes — this app never
// writes back to QuickBooks, so there's no create/update/delete here.
import { getValidAccessToken, type QBOAuthEnv } from './oauth';

const API_HOST = 'https://quickbooks.api.intuit.com';
const PAGE_SIZE = 1000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

function jitter(ms: number): number {
	return ms / 2 + Math.random() * (ms / 2);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Honors Retry-After on 429/503; otherwise exponential backoff (1s
 * doubling, capped at 30s, jittered), up to 5 attempts. */
async function fetchWithRetry(url: string, init: RequestInit, attempt = 0): Promise<Response> {
	const response = await fetch(url, init);
	if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
		const retryAfter = response.headers.get('Retry-After');
		const delayMs = retryAfter ? Number(retryAfter) * 1000 : jitter(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS));
		await sleep(delayMs);
		return fetchWithRetry(url, init, attempt + 1);
	}
	return response;
}

interface QBQueryResponse {
	QueryResponse: Record<string, unknown>;
}

/** Runs one QBO SQL-like query and returns the array under `entityKey`
 * (QBO's response nests results under the entity name, e.g. `Customer`). */
export async function runQuery<T>(env: QBOAuthEnv, entityKey: string, query: string): Promise<T[]> {
	const { accessToken, realmId } = await getValidAccessToken(env);
	const url = `${API_HOST}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
	const response = await fetchWithRetry(url, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(`QuickBooks query failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as QBQueryResponse;
	const rows = body.QueryResponse[entityKey];
	return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Pages through STARTPOSITION until a page comes back short of
 * MAXRESULTS. `whereClause` is a raw QBO WHERE expression (e.g. the
 * incremental watermark filter) or '' for no filter. */
export async function queryAllPages<T>(env: QBOAuthEnv, entityKey: string, whereClause: string): Promise<T[]> {
	const results: T[] = [];
	let position = 1;
	for (;;) {
		const where = whereClause ? ` WHERE ${whereClause}` : '';
		const query = `SELECT * FROM ${entityKey}${where} ORDERBY MetaData.LastUpdatedTime STARTPOSITION ${position} MAXRESULTS ${PAGE_SIZE}`;
		const page = await runQuery<T>(env, entityKey, query);
		results.push(...page);
		if (page.length < PAGE_SIZE) break;
		position += PAGE_SIZE;
	}
	return results;
}

/** Targeted single-record fetch, used for the webhook's immediate sync.
 * QB's own IDs are always numeric — reject anything else rather than
 * interpolating unsanitized input into the query string. */
export async function queryById<T>(env: QBOAuthEnv, entityKey: string, id: string): Promise<T | null> {
	if (!/^\d+$/.test(id)) throw new Error(`Invalid QuickBooks ID "${id}"`);
	const results = await runQuery<T>(env, entityKey, `SELECT * FROM ${entityKey} WHERE Id = '${id}'`);
	return results[0] ?? null;
}

interface QBCountResponse {
	QueryResponse: { totalCount?: number };
}

/** Diagnostic-only: QBO's own record count for an entity, completely
 * independent of this app's pagination/mapping/upsert path — lets a
 * "0 records synced" result be checked against "does QBO itself see any
 * records at all for this company" without trusting anything else in the
 * sync pipeline. */
export async function getRawEntityCount(env: QBOAuthEnv, entityKey: string): Promise<number> {
	const { accessToken, realmId } = await getValidAccessToken(env);
	const query = `SELECT COUNT(*) FROM ${entityKey}`;
	const url = `${API_HOST}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
	const response = await fetchWithRetry(url, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(`QuickBooks count query failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as QBCountResponse;
	return body.QueryResponse.totalCount ?? 0;
}

interface CompanyInfoResponse {
	CompanyInfo: { CompanyName: string; LegalName?: string };
}

/** Diagnostic-only: which real QuickBooks company the stored realmId
 * actually points at. Surfaced on /qb-settings so a wrong-company
 * connection (e.g. authorizing a different QBO company than expected) is
 * obvious at a glance instead of showing up only as a silent 0-record
 * sync. */
export async function getCompanyName(env: QBOAuthEnv): Promise<string> {
	const { accessToken, realmId } = await getValidAccessToken(env);
	const url = `${API_HOST}/v3/company/${realmId}/companyinfo/${realmId}`;
	const response = await fetchWithRetry(url, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(`QuickBooks company info lookup failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as CompanyInfoResponse;
	return body.CompanyInfo.CompanyName;
}
