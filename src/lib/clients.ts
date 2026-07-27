import { findById, createRow, updateRow, softDeleteRow, listActiveRows, type SheetsEnv } from './sheets';
import { clientConfig, type Client } from './models/client';
import { propertyConfig } from './models/property';
import { jobConfig, JOB_STATUSES } from './models/job';

// Same guard/rationale as deleteProperty() in lib/properties.ts — a Job
// that's merely Unscheduled doesn't block a delete, only real committed
// work (Scheduled/In Progress) does.
const ACTIVE_JOB_STATUSES: ReadonlySet<(typeof JOB_STATUSES)[number]> = new Set(['Scheduled', 'In Progress']);

/**
 * Soft-deletes a Client (Archived At set, never hard-deleted). Refused when
 * any of the Client's Properties has a Job that's Scheduled or In Progress
 * — real physical work is committed under this Client's name; finish,
 * cancel, or reschedule that Job first. Does not cascade to the Client's
 * Properties/Quotes/Jobs/Pipeline rows — same "leave dependents referencing
 * the archived record" precedent used by deleteProperty().
 */
export async function deleteClient(env: SheetsEnv, clientId: string): Promise<void> {
	const client = await findById(env, clientConfig, clientId);
	if (!client) throw new Error(`Client "${clientId}" not found`);

	const [properties, jobs] = await Promise.all([listActiveRows(env, propertyConfig), listActiveRows(env, jobConfig)]);
	const propertyIds = new Set(properties.filter((p) => p['Client ID'] === clientId).map((p) => p['Property ID']));
	const hasActiveJob = jobs.some((j) => propertyIds.has(j['Property ID']) && ACTIVE_JOB_STATUSES.has(j['Job Status']));
	if (hasActiveJob) {
		throw new Error('This client has a Job that is Scheduled or In Progress — complete, cancel, or reschedule it before deleting the client.');
	}

	await softDeleteRow(env, clientConfig, clientId);
}

/** Undoes deleteClient(). */
export async function restoreClient(env: SheetsEnv, clientId: string): Promise<void> {
	const client = await findById(env, clientConfig, clientId);
	if (!client) throw new Error(`Client "${clientId}" not found`);
	if (!client['Archived At']) throw new Error('This client is not deleted.');
	await updateRow(env, clientConfig, clientId, { 'Archived At': '' }, { action: 'restored' });
}

/**
 * Creates a new Client by copying every contact/preference field from an
 * existing one — useful for a second household member or a related contact
 * at the same property. Never copies 'QB Customer ID': the duplicate is a
 * different real-world contact, and carrying over the source's QuickBooks
 * link would misleadingly show the same real customer's estimates/invoices
 * against two separate Client records. The caller navigates to the new
 * Client's own detail page afterward to adjust whatever differs (name,
 * phone, etc.) and to add its own Property.
 */
export async function duplicateClient(env: SheetsEnv, clientId: string): Promise<Client> {
	const source = await findById(env, clientConfig, clientId);
	if (!source) throw new Error(`Client "${clientId}" not found`);

	const {
		'Client ID': _id,
		'Created At': _createdAt,
		'Updated At': _updatedAt,
		'Archived At': _archivedAt,
		'QB Customer ID': _qbCustomerId,
		...rest
	} = source;

	return createRow(env, clientConfig, rest);
}
