import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { findById } from '../../../../lib/sheets';
import { propertyPhotoConfig } from '../../../../lib/models/propertyPhoto';

// Streams the actual image bytes back from R2. No per-route auth code
// needed — this path isn't in src/middleware.ts's public-path allowlist,
// so it's already 401/redirect-gated like every other internal route.
export const GET: APIRoute = async ({ params }) => {
	const photo = await findById(env, propertyPhotoConfig, params.id!);
	if (!photo || photo['Archived At']) return new Response('Not found', { status: 404 });

	const object = await env.PROPERTY_PHOTOS.get(photo['R2 Key']);
	if (!object) return new Response('Not found', { status: 404 });

	return new Response(object.body, {
		headers: {
			'Content-Type': photo['Content Type'] || 'application/octet-stream',
			// Safe to cache forever — keys are UUID-per-upload and never overwritten.
			'Cache-Control': 'private, max-age=31536000, immutable',
		},
	});
};
