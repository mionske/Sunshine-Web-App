/// <reference types="astro/client" />

// Astro v6 (via @astrojs/cloudflare) removed Astro.locals.runtime.env —
// bindings/secrets are read via `import { env } from 'cloudflare:workers'`
// instead. This declaration merge is how a project extends the ambient
// `Cloudflare.Env` type that module's `env` export is typed against
// (mirrors what `wrangler types` would generate).
declare namespace Cloudflare {
	interface Env {
		GOOGLE_SERVICE_ACCOUNT_JSON: string;
		SPREADSHEET_ID: string;
		// Dashboard "Today"/"This Week" calendar view — the calendar the
		// service account was shared with (view-only), e.g.
		// "info@sunshinewindowworks.com". See lib/calendar/client.ts.
		CALENDAR_ID: string;
		AUTH_PASSWORD: string;
		SESSION_SIGNING_SECRET: string;
		// Phase 14: QuickBooks one-way sync. QB_TOKENS is a dedicated KV
		// namespace (not the Sheet) since it holds secrets/session state,
		// not business records — see lib/qb/tokens.ts.
		QB_TOKENS: KVNamespace;
		QB_CLIENT_ID: string;
		QB_CLIENT_SECRET: string;
		QB_WEBHOOK_VERIFIER_TOKEN: string;
		QB_REDIRECT_URI: string;
	}
}
