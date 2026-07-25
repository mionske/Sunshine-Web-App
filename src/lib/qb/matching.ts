// Scores candidate Clients against a QB Customer for the match-review
// queue. Stateless — recomputed live whenever the review screen opens,
// never cached, never auto-applied. No auto-linking, ever; a human always
// confirms via confirmQBLink below.
import { findById, listActiveRows, updateRow, type SheetsEnv } from '../sheets';
import { clientConfig, type Client } from '../models/client';
import { propertyConfig, type Property } from '../models/property';
import { qbEstimateConfig, type QBEstimate } from '../models/qbEstimate';
import { qbInvoiceConfig, type QBInvoice } from '../models/qbInvoice';
import { qbPaymentConfig, type QBPayment } from '../models/qbPayment';
import type { QBCustomer } from '../models/qbCustomer';

function normalizePhone(value: string): string {
	return value.replace(/\D/g, '').slice(-10);
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
	for (let i = 0; i < rows; i++) dp[i][0] = i;
	for (let j = 0; j < cols; j++) dp[0][j] = j;
	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
		}
	}
	return dp[a.length][b.length];
}

/** 1 = identical, 0 = completely dissimilar (normalized edit distance). */
export function nameSimilarity(a: string, b: string): number {
	const x = a.trim().toLowerCase();
	const y = b.trim().toLowerCase();
	if (!x || !y) return 0;
	const maxLen = Math.max(x.length, y.length);
	if (maxLen === 0) return 1;
	return 1 - levenshteinDistance(x, y) / maxLen;
}

function leadingStreetNumber(address: string): string {
	return address.trim().match(/^(\d+)/)?.[1] ?? '';
}

function extractZip(address: string): string {
	return address.match(/(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? '';
}

/** Best-effort split of a QB "Display Name" into First/Last for creating a
 * new Client from a QB Customer — QBO's Display Name is usually "First
 * Last", so this splits on the LAST whitespace run (handles "Mary Jane
 * Smith" -> First "Mary Jane", Last "Smith"). No whitespace at all -> the
 * whole name becomes the first name, last stays blank, rather than
 * guessing. Just a starting point; the owner can edit the result
 * afterward like any other Client field. */
export function splitDisplayName(displayName: string): { firstName: string; lastName: string } {
	const trimmed = displayName.trim();
	const lastSpace = trimmed.lastIndexOf(' ');
	if (lastSpace === -1) return { firstName: trimmed, lastName: '' };
	return { firstName: trimmed.slice(0, lastSpace).trim(), lastName: trimmed.slice(lastSpace + 1).trim() };
}

/** Best-effort inverse of mapping.ts's flattenAddress() — only splits when
 * the flattened string has exactly the 4 expected comma-separated parts
 * (street, city, state, zip); otherwise the whole string is kept as-is in
 * `street` and the rest left blank rather than risk mis-assigning parts.
 * Used only to prefill the "Add property" form after creating a Client
 * from a QB Customer — never auto-saved, so a wrong guess is just an edit
 * away. */
export function parseFlatAddress(address: string): { street: string; city: string; state: string; zip: string } {
	const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
	if (parts.length === 4) {
		return { street: parts[0], city: parts[1], state: parts[2], zip: parts[3] };
	}
	return { street: address, city: '', state: '', zip: '' };
}

export interface MatchScoreBreakdown {
	emailMatch: boolean;
	phoneMatch: boolean;
	nameSimilarity: number;
	addressMatch: boolean;
	score: number;
}

const EMAIL_WEIGHT = 0.6;
const PHONE_WEIGHT = 0.3;
const NAME_WEIGHT = 0.3;
const NAME_SIMILARITY_THRESHOLD = 0.6;
const ADDRESS_WEIGHT = 0.2;

export function scoreMatch(customer: QBCustomer, client: Client, property?: Property): MatchScoreBreakdown {
	const emailMatch = Boolean(customer.Email && client.Email) && normalizeEmail(customer.Email) === normalizeEmail(client.Email);

	const customerPhone = normalizePhone(customer.Phone);
	const clientPhone = normalizePhone(client.Phone);
	const phoneMatch = customerPhone.length === 10 && customerPhone === clientPhone;

	const similarity = nameSimilarity(customer['Display Name'], `${client['First Name']} ${client['Last Name']}`);

	let addressMatch = false;
	if (property) {
		const customerZip = extractZip(customer.Address);
		const customerNumber = leadingStreetNumber(customer.Address);
		addressMatch = Boolean(customerZip && customerNumber) && customerZip === property.Zip.trim() && customerNumber === leadingStreetNumber(property['Street Address']);
	}

	let score = 0;
	if (emailMatch) score += EMAIL_WEIGHT;
	if (phoneMatch) score += PHONE_WEIGHT;
	if (similarity >= NAME_SIMILARITY_THRESHOLD) score += similarity * NAME_WEIGHT;
	if (addressMatch) score += ADDRESS_WEIGHT;

	return { emailMatch, phoneMatch, nameSimilarity: similarity, addressMatch, score: Math.min(score, 1) };
}

export type MatchConfidence = 'likely' | 'possible' | 'low-confidence' | 'no signal';

/** UI grouping only — never stored, never used to gate anything (linking
 * is always an explicit human confirmation regardless of tier — see
 * confirmQBLink). Every score gets a label; none are hidden. */
export function confidenceTier(score: number): MatchConfidence {
	if (score >= 0.85) return 'likely';
	if (score >= 0.5) return 'possible';
	if (score >= 0.3) return 'low-confidence';
	return 'no signal';
}

export interface MatchCandidate {
	client: Client;
	property?: Property;
	breakdown: MatchScoreBreakdown;
	confidence: MatchConfidence;
}

/** Every Client scored against one QB Customer, sorted best-first — every
 * Client is included regardless of score (no hidden threshold): linking is
 * always an explicit human confirmation (see confirmQBLink), never
 * automatic, so there's no safety reason to hide a weak-looking candidate
 * the owner can still recognize by eye. Already-linked clients are still
 * included too (a client can be a candidate for re-linking to a different
 * QB Customer — see confirmQBLink's re-link guard) rather than silently
 * excluded. Callers that want to cap the list length (e.g. the review
 * page's top-N display) do that themselves. */
export async function findMatchCandidates(env: SheetsEnv, qbCustomer: QBCustomer): Promise<MatchCandidate[]> {
	const [clients, properties] = await Promise.all([listActiveRows(env, clientConfig), listActiveRows(env, propertyConfig)]);
	const propertyByClientId = new Map(properties.map((p) => [p['Client ID'], p]));

	const candidates: MatchCandidate[] = clients.map((client) => {
		const property = propertyByClientId.get(client['Client ID']);
		const breakdown = scoreMatch(qbCustomer, client, property);
		return { client, property, breakdown, confidence: confidenceTier(breakdown.score) };
	});
	return candidates.sort((a, b) => b.breakdown.score - a.breakdown.score);
}

// Shared by every QuickBooks link-confirmation flow in this app — Client↔
// QBCustomer here, and Quote↔QBEstimate / Job↔QBInvoice in
// lib/qb/recordLinking.ts. `entityLabel` names what's already linked (e.g.
// "QB Customer", "QB Estimate") so one error class serves all three
// without duplicating this exact re-link-guard pattern three times.
export class QBRelinkConfirmationRequiredError extends Error {
	constructor(
		public readonly currentLinkedId: string,
		entityLabel = 'QB Customer'
	) {
		super(`This record is already linked to ${entityLabel} "${currentLinkedId}" — confirm to overwrite that link.`);
		this.name = 'QBRelinkConfirmationRequiredError';
	}
}

/**
 * Links a Client to a QB Customer — always an explicit human confirmation,
 * never automatic. Re-linking a Client already linked to a *different* QB
 * Customer requires opts.confirmRelink, matching the guardrail from
 * SunshineTool. Cascading onto already-synced QBEstimates/Invoices/
 * Payments happens implicitly: those rows already carry the QB Customer
 * ID directly, so nothing needs to be rewritten there — see
 * suggestQBLinksForClient for how they're surfaced once linked.
 */
export async function confirmQBLink(
	env: SheetsEnv,
	clientId: string,
	qbCustomerId: string,
	opts: { confirmRelink?: boolean; user?: string; requestId?: string } = {}
): Promise<Client> {
	const client = await findById(env, clientConfig, clientId);
	if (!client) throw new Error(`Client "${clientId}" not found`);

	const previousQBCustomerId = client['QB Customer ID'];
	if (previousQBCustomerId && previousQBCustomerId !== qbCustomerId && !opts.confirmRelink) {
		throw new QBRelinkConfirmationRequiredError(previousQBCustomerId);
	}

	// updateRow already logs this activity internally via opts.action — no
	// second explicit logActivity call here (that used to double-log every
	// QB link event, the exact "repeated QuickBooks events seconds apart"
	// duplication the Activity Timeline cleanup fixed at the source).
	const updated = await updateRow(env, clientConfig, clientId, { 'QB Customer ID': qbCustomerId }, { ...opts, action: 'QB Customer linked' });

	return updated;
}

export interface QBLinkedRecords {
	estimates: QBEstimate[];
	invoices: QBInvoice[];
	payments: QBPayment[];
}

/** The unified customer-level view for a linked Client's detail page —
 * every QBEstimate/QBInvoice/QBPayment sharing that Client's QB Customer
 * ID. Returns empty arrays for an unlinked client rather than throwing. */
export async function suggestQBLinksForClient(env: SheetsEnv, clientId: string): Promise<QBLinkedRecords> {
	const client = await findById(env, clientConfig, clientId);
	const qbCustomerId = client?.['QB Customer ID'];
	if (!qbCustomerId) return { estimates: [], invoices: [], payments: [] };

	const [estimates, invoices, payments] = await Promise.all([
		listActiveRows(env, qbEstimateConfig),
		listActiveRows(env, qbInvoiceConfig),
		listActiveRows(env, qbPaymentConfig),
	]);

	return {
		estimates: estimates.filter((e) => e['QB Customer ID'] === qbCustomerId),
		invoices: invoices.filter((i) => i['QB Customer ID'] === qbCustomerId),
		payments: payments.filter((p) => p['QB Customer ID'] === qbCustomerId),
	};
}

export function qboEstimateWebUrl(qbEstimateId: string): string {
	return `https://qbo.intuit.com/app/estimate?txnId=${encodeURIComponent(qbEstimateId)}`;
}

export function qboInvoiceWebUrl(qbInvoiceId: string): string {
	return `https://qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(qbInvoiceId)}`;
}
