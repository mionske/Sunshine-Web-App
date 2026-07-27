import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeFetch, type FakeFetchHandle } from './sheets/testHarness';
import { _clearHeaderCacheForTests } from './sheets/rows';
import { propertyPhotoSchema } from './models/propertyPhoto';
import { installFakeR2, type FakeR2Bucket } from './r2TestHarness';
import { uploadPropertyPhoto, listPropertyPhotos, deletePropertyPhoto, InvalidPhotoError, MAX_PHOTO_BYTES } from './propertyPhotos';

const ACTIVITY_LOG_HEADERS = [
	'Activity ID', 'Entity Type', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'User', 'Timestamp', 'Request ID', 'Notes',
];

describe('uploadPropertyPhoto / listPropertyPhotos / deletePropertyPhoto', () => {
	let harness: FakeFetchHandle;
	let r2: FakeR2Bucket;

	beforeEach(async () => {
		harness = installFakeFetch();
		_clearHeaderCacheForTests();
		harness.spreadsheet.setTab('PropertyPhotos', [Object.keys(propertyPhotoSchema.shape)]);
		harness.spreadsheet.setTab('ActivityLog', [ACTIVITY_LOG_HEADERS]);
		r2 = installFakeR2();
	});

	afterEach(() => {
		harness.restore();
	});

	function makeFile(overrides: Partial<{ name: string; type: string; bytes: string }> = {}): File {
		const bytes = overrides.bytes ?? 'fake-image-bytes';
		return new File([bytes], overrides.name ?? 'photo.jpg', { type: overrides.type ?? 'image/jpeg' });
	}

	function env() {
		return { ...harness.env, PROPERTY_PHOTOS: r2 as unknown as R2Bucket };
	}

	it('uploads a photo: creates a metadata row and an R2 object with matching bytes', async () => {
		const file = makeFile({ bytes: 'hello-world' });
		const photo = await uploadPropertyPhoto(env(), { propertyId: 'prop-1', file, caption: 'Front door' });

		expect(photo['Property ID']).toBe('prop-1');
		expect(photo['Original Filename']).toBe('photo.jpg');
		expect(photo['Content Type']).toBe('image/jpeg');
		expect(photo.Caption).toBe('Front door');
		expect(photo['R2 Key']).toContain('properties/prop-1/');
		expect(photo['R2 Key']).toMatch(/\.jpg$/);

		const stored = r2.objects.get(photo['R2 Key']);
		expect(stored).toBeDefined();
		expect(new TextDecoder().decode(stored!.body)).toBe('hello-world');
	});

	it('rejects a non-image content-type before any write happens', async () => {
		const file = makeFile({ type: 'application/pdf', name: 'doc.pdf' });
		await expect(uploadPropertyPhoto(env(), { propertyId: 'prop-1', file })).rejects.toThrow(InvalidPhotoError);

		expect(r2.objects.size).toBe(0);
		const rows = harness.spreadsheet.getTab('PropertyPhotos').slice(1);
		expect(rows).toHaveLength(0);
	});

	it('rejects an oversized file before any write happens', async () => {
		const file = makeFile();
		Object.defineProperty(file, 'size', { value: MAX_PHOTO_BYTES + 1 });
		await expect(uploadPropertyPhoto(env(), { propertyId: 'prop-1', file })).rejects.toThrow(InvalidPhotoError);

		expect(r2.objects.size).toBe(0);
		const rows = harness.spreadsheet.getTab('PropertyPhotos').slice(1);
		expect(rows).toHaveLength(0);
	});

	it('listPropertyPhotos returns only active photos for the given property', async () => {
		await uploadPropertyPhoto(env(), { propertyId: 'prop-1', file: makeFile() });
		const other = await uploadPropertyPhoto(env(), { propertyId: 'prop-2', file: makeFile() });
		const toArchive = await uploadPropertyPhoto(env(), { propertyId: 'prop-1', file: makeFile() });
		await deletePropertyPhoto(env(), toArchive['Photo ID']);

		const photos = await listPropertyPhotos(env(), 'prop-1');
		expect(photos).toHaveLength(1);
		expect(photos[0]['Property ID']).toBe('prop-1');

		const otherPhotos = await listPropertyPhotos(env(), 'prop-2');
		expect(otherPhotos.map((p) => p['Photo ID'])).toContain(other['Photo ID']);
	});

	it('deletePropertyPhoto soft-deletes the metadata row without touching the R2 object', async () => {
		const photo = await uploadPropertyPhoto(env(), { propertyId: 'prop-1', file: makeFile() });
		await deletePropertyPhoto(env(), photo['Photo ID']);

		const headers = harness.spreadsheet.getTab('PropertyPhotos')[0];
		const idIdx = headers.indexOf('Photo ID');
		const archivedAtIdx = headers.indexOf('Archived At');
		const row = harness.spreadsheet.getTab('PropertyPhotos').slice(1).find((r) => r[idIdx] === photo['Photo ID']);
		expect(row?.[archivedAtIdx]).toBeTruthy();

		// R2 object is untouched — never hard-deleted.
		expect(r2.objects.has(photo['R2 Key'])).toBe(true);
	});

	it('deletePropertyPhoto throws a clear error when the photo does not exist', async () => {
		await expect(deletePropertyPhoto(env(), 'missing-photo-id')).rejects.toThrow(/not found/);
	});
});
