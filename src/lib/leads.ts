import { findById, createRow, updateRow, softDeleteRow, type SheetsEnv } from './sheets';
import { leadConfig, type Lead } from './models/lead';
import { clientConfig, type Client } from './models/client';
import { propertyConfig, type Property } from './models/property';
import { nowIso } from './sheets/time';

// Stages from which "Convert to Client" is allowed — per spec, "only
// enabled once stage = Quoted or later." Lost is excluded (a Lost lead
// never converts) and Won is included so a lead already marked Won but not
// yet converted can still be completed.
const CONVERTIBLE_STAGES: ReadonlySet<Lead['Stage']> = new Set(['Quoted', 'Won']);

/** Soft-deletes a Lead (mistaken entry, duplicate, etc.) — does not set
 * Outcome, distinguishing it from a Won/Lost archive (see markLeadLost /
 * convertLeadToClient below), matching this app's soft-delete convention. */
export async function deleteLead(env: SheetsEnv, leadId: string): Promise<void> {
	const lead = await findById(env, leadConfig, leadId);
	if (!lead) throw new Error(`Lead "${leadId}" not found`);
	await softDeleteRow(env, leadConfig, leadId);
}

/** Undoes deleteLead() (or reopens a Won/Lost archive) — just clears
 * Archived At, leaving Stage/Outcome exactly as they were. */
export async function restoreLead(env: SheetsEnv, leadId: string): Promise<void> {
	const lead = await findById(env, leadConfig, leadId);
	if (!lead) throw new Error(`Lead "${leadId}" not found`);
	if (!lead['Archived At']) throw new Error('This lead is not deleted.');
	await updateRow(env, leadConfig, leadId, { 'Archived At': '' }, { action: 'restored' });
}

/**
 * Marks a Lead Lost and archives it the same way as a Won conversion — kept
 * for close-rate/lead-source reporting, dropped out of the active Leads
 * list, never hard-deleted.
 */
export async function markLeadLost(env: SheetsEnv, leadId: string, lostReason?: string): Promise<Lead> {
	const lead = await findById(env, leadConfig, leadId);
	if (!lead) throw new Error(`Lead "${leadId}" not found`);

	const now = nowIso();
	return updateRow(
		env,
		leadConfig,
		leadId,
		{
			Stage: 'Lost',
			Outcome: 'Lost',
			'Closed At': now,
			'Archived At': now,
			...(lostReason ? { Notes: lead.Notes ? `${lead.Notes}\n\nLost: ${lostReason}` : `Lost: ${lostReason}` } : {}),
		},
		{ action: 'lost' }
	);
}

/**
 * Creates a new Lead by copying the contact/address/source/notes fields
 * from an existing one — e.g. a second cold contact from the same
 * referral/household. Resets to a fresh, unconverted lead: Stage back to
 * 'New Lead', Outcome/Next Follow-up Date/Converted Client ID/Converted
 * Property ID all cleared — duplicating a Won/Lost/mid-funnel lead
 * shouldn't carry its funnel progress along with it.
 */
export async function duplicateLead(env: SheetsEnv, leadId: string): Promise<Lead> {
	const source = await findById(env, leadConfig, leadId);
	if (!source) throw new Error(`Lead "${leadId}" not found`);

	const {
		'Lead ID': _id,
		'Created At': _createdAt,
		'Updated At': _updatedAt,
		'Closed At': _closedAt,
		'Archived At': _archivedAt,
		Stage: _stage,
		Outcome: _outcome,
		'Next Follow-up Date': _nextFollowUpDate,
		'Converted Client ID': _convertedClientId,
		'Converted Property ID': _convertedPropertyId,
		...rest
	} = source;

	return createRow(env, leadConfig, { ...rest, Stage: 'New Lead' });
}

export interface ConvertLeadResult {
	lead: Lead;
	client: Client;
	property: Property;
}

/**
 * "Convert to Client" — triggered manually when a Lead's quote is accepted.
 * Name/phone/email carry over to a new Client; the Lead's rough address
 * auto-creates a full Property on that Client (no manual re-entry).
 * Property-specific fields not knowable from a Lead (window inventory,
 * access notes, hard water history, desired maintenance frequency) are left
 * blank for the operator to fill in after the walkthrough — Property Type
 * defaults to 'Residential' (by far the common case here) since it's a
 * required field with no blank option; correctable immediately afterward on
 * the new Property's own detail page. The Lead's outcome is set to Won and
 * it archives out of the active Leads list — never deleted, kept for
 * close-rate and lead-source reporting.
 */
export async function convertLeadToClient(env: SheetsEnv, leadId: string): Promise<ConvertLeadResult> {
	const lead = await findById(env, leadConfig, leadId);
	if (!lead) throw new Error(`Lead "${leadId}" not found`);
	if (lead['Converted Client ID']) throw new Error('This lead has already been converted to a Client.');
	if (lead['Archived At']) throw new Error('This lead is archived and cannot be converted.');
	if (!CONVERTIBLE_STAGES.has(lead.Stage)) {
		throw new Error('This lead can only be converted once its Stage is "Quoted" or "Won".');
	}

	const client = await createRow(env, clientConfig, {
		'First Name': lead['First Name'],
		'Last Name': lead['Last Name'],
		Phone: lead.Phone,
		Email: lead.Email,
		'Referral Source': lead.Source,
		'First Contact Date': lead['Created At'],
		Notes: lead.Notes ? `Converted from Lead — ${lead.Notes}` : 'Converted from Lead',
	});

	const property = await createRow(env, propertyConfig, {
		'Client ID': client['Client ID'],
		'Property Type': 'Residential',
		'Street Address': lead['Street Address'],
		City: lead.City,
		State: lead.State,
		Zip: lead.Zip,
	});

	const now = nowIso();
	const updatedLead = await updateRow(
		env,
		leadConfig,
		leadId,
		{
			Stage: 'Won',
			Outcome: 'Won',
			'Converted Client ID': client['Client ID'],
			'Converted Property ID': property['Property ID'],
			'Closed At': now,
			'Archived At': now,
		},
		{ action: 'converted to client' }
	);

	return { lead: updatedLead, client, property };
}
