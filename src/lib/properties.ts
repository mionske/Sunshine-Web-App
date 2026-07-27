import { findById, createRow, updateRow, softDeleteRow, listActiveRows, type SheetsEnv } from './sheets';
import { propertyConfig, type Property } from './models/property';
import { jobConfig, JOB_STATUSES } from './models/job';

// Deliberately excludes 'Unscheduled' — that just means a Job row exists
// with no date set yet, not that real work is actually underway (and in
// practice a lot of properties accumulate an Unscheduled Job that never
// gets acted on, which made this guard block nearly every delete when it
// included that status). Only a Job that's genuinely committed to
// (Scheduled) or already happening (In Progress) blocks a delete.
const ACTIVE_JOB_STATUSES: ReadonlySet<(typeof JOB_STATUSES)[number]> = new Set(['Scheduled', 'In Progress']);

/**
 * Soft-deletes a Property (Archived At set, never hard-deleted, matching
 * this app's convention everywhere else). Refused when the property has a
 * Job that's Scheduled or In Progress — real physical work is committed to
 * this address; finish, cancel, or reschedule that Job first. An
 * Unscheduled Job never blocks a delete (see ACTIVE_JOB_STATUSES above).
 * Does not cascade to the property's Walkthroughs/Quotes/Jobs/Pipeline
 * rows — same "leave dependents referencing the archived record" precedent
 * already established elsewhere in this app (e.g. deleting a Quote never
 * touches its Job).
 */
export async function deleteProperty(env: SheetsEnv, propertyId: string): Promise<void> {
	const property = await findById(env, propertyConfig, propertyId);
	if (!property) throw new Error(`Property "${propertyId}" not found`);

	const jobs = await listActiveRows(env, jobConfig);
	const hasActiveJob = jobs.some((j) => j['Property ID'] === propertyId && ACTIVE_JOB_STATUSES.has(j['Job Status']));
	if (hasActiveJob) {
		throw new Error('This property has a Job that is Scheduled or In Progress — complete, cancel, or reschedule it before deleting the property.');
	}

	await softDeleteRow(env, propertyConfig, propertyId);
}

/** Undoes deleteProperty(). */
export async function restoreProperty(env: SheetsEnv, propertyId: string): Promise<void> {
	const property = await findById(env, propertyConfig, propertyId);
	if (!property) throw new Error(`Property "${propertyId}" not found`);
	if (!property['Archived At']) throw new Error('This property is not deleted.');
	await updateRow(env, propertyConfig, propertyId, { 'Archived At': '' }, { action: 'restored' });
}

/**
 * Creates a new Property by copying every field from an existing one
 * (same Client, same address/type/access/inventory details) — the common
 * case is a multi-unit building's next near-identical unit. The caller
 * navigates to the new Property's own detail page afterward to adjust
 * whatever differs (Unit Identifier, counts, etc.) — that page already
 * doubles as the edit form, so no separate prefill UI is needed here.
 * Never copies Inventory Verified At (a fresh property hasn't had its own
 * inventory verified yet, even if the source's counts were).
 */
export async function duplicateProperty(env: SheetsEnv, propertyId: string): Promise<Property> {
	const source = await findById(env, propertyConfig, propertyId);
	if (!source) throw new Error(`Property "${propertyId}" not found`);

	const {
		'Property ID': _id,
		'Created At': _createdAt,
		'Updated At': _updatedAt,
		'Archived At': _archivedAt,
		'Inventory Verified At': _verifiedAt,
		...rest
	} = source;

	return createRow(env, propertyConfig, rest);
}
