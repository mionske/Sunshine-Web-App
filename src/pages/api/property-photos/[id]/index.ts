import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guarded, json } from '../../../../lib/apiCrud';
import { deletePropertyPhoto } from '../../../../lib/propertyPhotos';

// DELETE only — soft-deletes the metadata row, never the R2 object (see
// lib/propertyPhotos.ts). Nested under an [id] directory (not a sibling
// [id].ts file) so it can coexist with file.ts's byte-serving route —
// Astro's file routing can't have both a [id].ts file and an [id]/
// directory in the same folder.
export const DELETE: APIRoute = ({ params }) =>
	guarded(async () => {
		await deletePropertyPhoto(env, params.id!);
		return json({ ok: true });
	});
