// Guardrails for the simplification pass's core rule: QuickBooks is only
// ever contacted in response to an explicit button press by the owner.
//
// These are source-level tests rather than behavioural ones on purpose. The
// failure mode being guarded against is a *future* edit quietly reintroducing
// an automatic call — a page-load lookup, a sync-after-save, a webhook that
// applies events again. A behavioural test can only catch that if someone
// remembers to write one for the new code path; asserting on the import graph
// catches it no matter where it's added.
//
// The one thing that actually reaches QuickBooks is lib/qb/client.ts (all
// query/count calls) and lib/qb/oauth.ts (token exchange + refresh). So the
// rule is simply: nothing that runs during a page render may reach either.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Source with comments stripped — these files explain *why* the automatic
 * paths were removed, and those explanations naturally name the very
 * functions being asserted absent. Only real code should be matched. */
function source(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importsQBTransport(src: string): boolean {
	return /from '\.\/(client|oauth)'/.test(src) || /from '\.\.\/qb\/(client|oauth)'/.test(src) || /from '\.\.\/\.\.\/lib\/qb\/(client|oauth)'/.test(src);
}

describe('no automatic QuickBooks activity', () => {
	// Everything a page calls while rendering. If any of these could reach
	// QuickBooks, merely opening a page would produce API traffic.
	const RENDER_PATH_MODULES = ['./recordLinking.ts', './matching.ts', './mapping.ts', './tokens.ts'];

	for (const path of RENDER_PATH_MODULES) {
		it(`${path} never reaches the QuickBooks API`, () => {
			expect(importsQBTransport(source(path))).toBe(false);
		});
	}

	it('the webhook module cannot apply events (no sync import, parse/verify only)', () => {
		const src = source('./webhook.ts');
		expect(src).not.toMatch(/from '\.\/sync'/);
		expect(importsQBTransport(src)).toBe(false);
	});

	it('the webhook route logs receipt but never syncs', () => {
		const src = source('../../pages/api/qb/webhook.ts');
		expect(src).not.toMatch(/handleWebhookEvent/);
		expect(src).not.toMatch(/syncSingleEntity|runFullSync|deleteMirrorRow|mergeMirrorRow/);
		// Still verifies the signature — an unauthenticated caller must not be
		// able to write even a log line.
		expect(src).toMatch(/verifyWebhookSignature/);
	});

	it('syncing a QuickBooks estimate never touches Pipeline', () => {
		const src = source('./sync.ts');
		expect(src).not.toMatch(/pipelineSync|syncPipelineFromEstimates/);
		expect(src).not.toMatch(/pipelineConfig/);
	});

	it('the quote/job lifecycle never reaches QuickBooks', () => {
		for (const path of ['../pricing/jobLifecycle.ts', '../pricing/quotes.ts', '../clients.ts', '../properties.ts', '../leads.ts']) {
			expect(importsQBTransport(source(path)), path).toBe(false);
		}
	});

	it('the pipeline API routes never reach QuickBooks', () => {
		for (const path of ['../../pages/api/pipeline/index.ts', '../../pages/api/pipeline/[id].ts']) {
			expect(source(path)).not.toMatch(/\bqb\b|QuickBooks/i);
		}
	});

	// qb-settings.astro is the one page allowed to call QuickBooks, and only
	// from inside its POST handler. Every call site must therefore sit after
	// the `if (Astro.request.method === 'POST')` line.
	it('qb-settings only calls QuickBooks inside its POST handler', () => {
		const src = source('../../pages/qb-settings.astro');
		const postHandlerAt = src.indexOf("Astro.request.method === 'POST'");
		expect(postHandlerAt).toBeGreaterThan(-1);

		const frontmatterEnd = src.indexOf('\n---', 3);
		const readPhase = src.slice(0, postHandlerAt) + src.slice(src.indexOf('\n}', postHandlerAt), frontmatterEnd);
		for (const call of ['getCompanyName(', 'getRawEntityCount(', 'runFullSync(']) {
			expect(readPhase, `${call} must not run on page load`).not.toContain(call);
		}
	});
});
