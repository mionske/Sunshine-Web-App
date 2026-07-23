import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from '../sheets/testHarness';
import { _clearHeaderCacheForTests } from '../sheets/rows';
import { createRow } from '../sheets';
import { clientConfig, clientSchema } from '../models/client';
import { propertyConfig, propertySchema } from '../models/property';
import { findLikelyDuplicates } from './duplicateDetection';

describe('findLikelyDuplicates', () => {
	let harness: FakeFetchHandle;

	beforeEach(() => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('Clients', [Object.keys(clientSchema.shape)]);
		harness.spreadsheet.setTab('Properties', [Object.keys(propertySchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [
			['Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes'],
		]);
	});

	afterEach(() => {
		harness.restore();
	});

	async function seedClientAndProperty(overrides: { client?: Record<string, string>; property?: Record<string, string> } = {}) {
		const client = await createRow(harness.env, clientConfig, {
			'First Name': 'Stevie',
			'Last Name': 'Damboise',
			Phone: '303-931-3903',
			Email: 'stevie@example.com',
			...overrides.client,
		});
		const property = await createRow(harness.env, propertyConfig, {
			'Client ID': client['Client ID'],
			'Street Address': '1285 Georgetown Road',
			City: 'Boulder',
			State: 'CO',
			Zip: '80304',
			...overrides.property,
		});
		return { client, property };
	}

	it('finds no candidates when nothing matches', async () => {
		await seedClientAndProperty();
		const result = await findLikelyDuplicates(harness.env, {
			phone: '555-000-1111',
			email: 'nobody@example.com',
			streetAddress: '999 Nowhere Ave',
			lastName: 'Nobody',
			zip: '00000',
		});
		expect(result).toHaveLength(0);
	});

	it('matches on phone number regardless of formatting', async () => {
		await seedClientAndProperty();
		const result = await findLikelyDuplicates(harness.env, { phone: '(303) 931-3903' });
		expect(result).toHaveLength(1);
		expect(result[0].matchedOn).toContain('Phone matches');
	});

	it('matches on email case-insensitively', async () => {
		await seedClientAndProperty();
		const result = await findLikelyDuplicates(harness.env, { email: 'STEVIE@EXAMPLE.COM' });
		expect(result).toHaveLength(1);
		expect(result[0].matchedOn).toContain('Email matches');
	});

	it('matches on a normalized exact address', async () => {
		await seedClientAndProperty();
		const result = await findLikelyDuplicates(harness.env, { streetAddress: '1285 georgetown road' });
		expect(result).toHaveLength(1);
		expect(result[0].matchedOn).toContain('Address matches exactly');
		expect(result[0].property?.['Street Address']).toBe('1285 Georgetown Road');
	});

	it('matches on last name + zip', async () => {
		await seedClientAndProperty();
		const result = await findLikelyDuplicates(harness.env, { lastName: 'Damboise', zip: '80304' });
		expect(result).toHaveLength(1);
		expect(result[0].matchedOn).toContain('Name + ZIP matches');
	});

	it('does not match a different last name in the same zip', async () => {
		await seedClientAndProperty();
		const result = await findLikelyDuplicates(harness.env, { lastName: 'Someone Else', zip: '80304' });
		expect(result).toHaveLength(0);
	});

	it('collapses multiple matched signals for the same property into one candidate', async () => {
		await seedClientAndProperty();
		const result = await findLikelyDuplicates(harness.env, {
			phone: '303-931-3903',
			streetAddress: '1285 Georgetown Road',
			lastName: 'Damboise',
			zip: '80304',
		});
		expect(result).toHaveLength(1);
		expect(result[0].matchedOn.length).toBeGreaterThan(1);
	});
});
