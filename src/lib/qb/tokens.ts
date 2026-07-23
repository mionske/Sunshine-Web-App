// Token storage for the QuickBooks one-way sync (Phase 14). A dedicated KV
// namespace, not the Sheet — these are secrets/session state, not business
// records, and shouldn't sit in a spreadsheet Editor-accessible tab
// alongside real client data. Single-tenant (one business, one realmId),
// so everything lives under one fixed key.
const KV_KEY = 'qb-tokens';

export interface QBTokens {
	accessToken: string;
	refreshToken: string;
	realmId: string;
	/** ms since epoch */
	accessExpiresAt: number;
	/** ms since epoch */
	refreshExpiresAt: number;
}

/** Minimal structural subset of Cloudflare's KVNamespace this module
 * actually uses — lets tests pass a plain in-memory fake instead of a real
 * KVNamespace. */
export interface QBTokenStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface QBTokenEnv {
	QB_TOKENS: QBTokenStore;
}

export async function getStoredTokens(env: QBTokenEnv): Promise<QBTokens | null> {
	const raw = await env.QB_TOKENS.get(KV_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as QBTokens;
	} catch {
		return null;
	}
}

export async function saveTokens(env: QBTokenEnv, tokens: QBTokens): Promise<void> {
	await env.QB_TOKENS.put(KV_KEY, JSON.stringify(tokens));
}

export async function clearTokens(env: QBTokenEnv): Promise<void> {
	await env.QB_TOKENS.delete(KV_KEY);
}
