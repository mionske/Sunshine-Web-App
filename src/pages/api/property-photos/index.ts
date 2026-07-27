import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guarded, json } from '../../../lib/apiCrud';
import { uploadPropertyPhoto, listPropertyPhotos, InvalidPhotoError } from '../../../lib/propertyPhotos';

export const GET: APIRoute = ({ url }) =>
	guarded(async () => {
		const propertyId = url.searchParams.get('propertyId');
		if (!propertyId) return json({ ok: false, error: 'propertyId is required' }, 400);
		const rows = await listPropertyPhotos(env, propertyId);
		return json({ ok: true, rows });
	});

// Not the generic listCreateRoutes() shape — this reads a single-file
// multipart upload (request.formData()), not a JSON body.
export const POST: APIRoute = async ({ request }) => {
	try {
		const form = await request.formData();
		const propertyId = String(form.get('propertyId') ?? '');
		const caption = String(form.get('caption') ?? '');
		const file = form.get('file');
		if (!(file instanceof File)) {
			return json({ ok: false, error: 'file is required' }, 400);
		}
		const row = await uploadPropertyPhoto(env, { propertyId, file, caption });
		return json({ ok: true, row }, 201);
	} catch (error) {
		if (error instanceof InvalidPhotoError) return json({ ok: false, error: error.message }, 400);
		return json({ ok: false, error: (error as Error).message }, 500);
	}
};
