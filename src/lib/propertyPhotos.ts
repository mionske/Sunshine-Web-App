import { createRow, findById, listActiveRows, softDeleteRow } from './sheets';
import type { SheetsEnv } from './sheets/types';
import { propertyPhotoConfig, type PropertyPhoto } from './models/propertyPhoto';

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // iPhone JPEG/HEIC typically runs 2-8MB; headroom without risking Worker memory/CPU limits.

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/heic': 'heic',
	'image/heif': 'heic',
	'image/webp': 'webp',
	'image/gif': 'gif',
};

export class InvalidPhotoError extends Error {}

/** Narrow interface (matches lib/qb/tokens.ts's QBTokenStore pattern) — only
 * the one R2 field these functions actually use, not the full Cloudflare.Env. */
export interface PropertyPhotoEnv extends SheetsEnv {
	PROPERTY_PHOTOS: R2Bucket;
}

export interface UploadPropertyPhotoInput {
	propertyId: string;
	file: File;
	caption?: string;
}

/**
 * Validates and stores one uploaded photo: bytes go to R2 (never the
 * Sheet), a metadata row goes to the PropertyPhotos tab. One file per call
 * — the API route loops over a multi-file selection, which is what makes
 * per-file progress/partial-failure handling trivial client-side.
 */
export async function uploadPropertyPhoto(env: PropertyPhotoEnv, input: UploadPropertyPhotoInput): Promise<PropertyPhoto> {
	const { propertyId, file, caption } = input;
	if (!propertyId) throw new InvalidPhotoError('propertyId is required');
	if (!file.type.startsWith('image/')) throw new InvalidPhotoError('Only image files are allowed');
	if (file.size > MAX_PHOTO_BYTES) throw new InvalidPhotoError('File exceeds the 15MB limit');

	const extension = EXTENSION_BY_CONTENT_TYPE[file.type] ?? 'bin';
	const photoId = crypto.randomUUID();
	const key = `properties/${propertyId}/${photoId}.${extension}`;

	await env.PROPERTY_PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

	return createRow(env, propertyPhotoConfig, {
		id: photoId,
		'Property ID': propertyId,
		'R2 Key': key,
		'Original Filename': file.name,
		'Content Type': file.type,
		'Size Bytes': String(file.size),
		Caption: caption ?? '',
	});
}

/** Active (non-archived) photos for one property. */
export async function listPropertyPhotos(env: SheetsEnv, propertyId: string): Promise<PropertyPhoto[]> {
	const rows = await listActiveRows(env, propertyPhotoConfig);
	return rows.filter((r) => r['Property ID'] === propertyId);
}

/** Soft-deletes the metadata row only — never calls R2 delete. Matches this
 * app's soft-delete-only convention everywhere else; the orphaned R2 object
 * is a harmless, tiny storage cost, never hard-deleted. */
export async function deletePropertyPhoto(env: SheetsEnv, photoId: string): Promise<void> {
	const photo = await findById(env, propertyPhotoConfig, photoId);
	if (!photo) throw new Error(`Photo "${photoId}" not found`);
	await softDeleteRow(env, propertyPhotoConfig, photoId);
}
