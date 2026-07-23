import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createPublicEstimate } from '../../lib/pricing/publicEstimate';

// Public, unauthenticated (allowlisted in middleware.ts). This is the one
// place in the app that must never leak internal pricing detail — see the
// plan's "Public estimator — restricted response" section for the exact
// list of things this response must never contain (target rate, labor
// hours, PricingConfig IDs, calculator internals, margins, etc).
export const POST: APIRoute = async ({ request }) => {
	try {
		const form = await request.formData();
		const approxWindowCount = Number(form.get('approxWindowCount'));
		const stories = Number(form.get('stories')) as 1 | 2 | 3;

		if (!Number.isFinite(approxWindowCount) || approxWindowCount <= 0) {
			return json({ error: 'A valid window count is required.' }, 400);
		}
		if (![1, 2, 3].includes(stories)) {
			return json({ error: 'Stories must be 1, 2, or 3.' }, 400);
		}
		const firstName = String(form.get('firstName') ?? '').trim();
		const lastName = String(form.get('lastName') ?? '').trim();
		const streetAddress = String(form.get('streetAddress') ?? '').trim();
		if (!firstName || !lastName || !streetAddress) {
			return json({ error: 'Name and address are required.' }, 400);
		}

		const range = await createPublicEstimate(env, {
			approxWindowCount,
			stories,
			propertyType: String(form.get('propertyType') ?? ''),
			streetAddress,
			city: String(form.get('city') ?? ''),
			firstName,
			lastName,
			email: String(form.get('email') ?? ''),
			phone: String(form.get('phone') ?? ''),
			referralSource: String(form.get('referralSource') ?? ''),
		});

		// The entire, deliberately narrow, public response shape.
		return json({
			low: range.low,
			high: range.high,
			minimumApplied: range.minimumApplied,
			message: 'Final pricing is confirmed after reviewing the property.',
		});
	} catch {
		// Never leak internal error detail (stack traces, PricingConfig state,
		// etc.) to an unauthenticated caller.
		return json({ error: 'Unable to calculate an estimate right now. Please try again shortly.' }, 500);
	}
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
