// Likely-duplicate detection for the historical-entry wizard: before
// creating a new Client/Property, surface anything that looks like the
// same real-world person or address so the owner can choose to reuse it
// instead. Never merges automatically — this only informs the choice.
import { listActiveRows, type SheetsEnv } from '../sheets';
import { clientConfig, type Client } from '../models/client';
import { propertyConfig, type Property } from '../models/property';

function normalizeAddress(value: string): string {
	return value.trim().toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ');
}

function normalizePhone(value: string): string {
	return value.replace(/\D/g, '');
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

export interface DuplicateCheckInput {
	firstName?: string;
	lastName?: string;
	phone?: string;
	email?: string;
	streetAddress?: string;
	zip?: string;
}

export interface DuplicateCandidate {
	client?: Client;
	property?: Property;
	matchedOn: string[];
}

export async function findLikelyDuplicates(
	env: SheetsEnv,
	input: DuplicateCheckInput
): Promise<DuplicateCandidate[]> {
	const [clients, properties] = await Promise.all([
		listActiveRows(env, clientConfig),
		listActiveRows(env, propertyConfig),
	]);

	const normPhone = input.phone ? normalizePhone(input.phone) : '';
	const normEmail = input.email ? normalizeEmail(input.email) : '';
	const normAddress = input.streetAddress ? normalizeAddress(input.streetAddress) : '';
	const lastName = input.lastName?.trim().toLowerCase() ?? '';
	const zip = input.zip?.trim() ?? '';

	// Keyed by property ID when a property's involved (the more specific
	// match), otherwise by client ID — so a client + their property found
	// via two different signals collapse into one candidate, not two.
	// Address/name+zip checks (property-specific) run first so a later
	// phone/email match for the same client merges into that same
	// candidate instead of creating a second, less-informative one.
	const candidates = new Map<string, DuplicateCandidate>();
	const propertyKeyByClientId = new Map<string, string>();

	function addMatch(client: Client | undefined, property: Property | undefined, reason: string) {
		let key = property ? `property:${property['Property ID']}` : `client:${client?.['Client ID']}`;
		if (!property && client) {
			key = propertyKeyByClientId.get(client['Client ID']) ?? key;
		}
		const existing = candidates.get(key);
		if (existing) {
			if (!existing.matchedOn.includes(reason)) existing.matchedOn.push(reason);
			if (!existing.client && client) existing.client = client;
			if (!existing.property && property) existing.property = property;
		} else {
			candidates.set(key, { client, property, matchedOn: [reason] });
		}
		if (property && client) propertyKeyByClientId.set(client['Client ID'], key);
	}

	if (normAddress) {
		for (const property of properties) {
			if (normalizeAddress(property['Street Address']) !== normAddress) continue;
			const client = clients.find((c) => c['Client ID'] === property['Client ID']);
			addMatch(client, property, 'Address matches exactly');
		}
	}

	if (lastName && zip) {
		for (const property of properties) {
			if (property.Zip.trim() !== zip) continue;
			const client = clients.find((c) => c['Client ID'] === property['Client ID']);
			if (!client || client['Last Name'].trim().toLowerCase() !== lastName) continue;
			addMatch(client, property, 'Name + ZIP matches');
		}
	}

	if (normPhone || normEmail) {
		for (const client of clients) {
			if (normPhone && normalizePhone(client.Phone) === normPhone) addMatch(client, undefined, 'Phone matches');
			if (normEmail && normalizeEmail(client.Email) === normEmail) addMatch(client, undefined, 'Email matches');
		}
	}

	return Array.from(candidates.values());
}
