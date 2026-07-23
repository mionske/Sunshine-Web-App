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
		AUTH_PASSWORD: string;
		SESSION_SIGNING_SECRET: string;
	}
}
