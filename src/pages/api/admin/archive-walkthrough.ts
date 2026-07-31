import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { batchUpdateValues, columnLetterAt, readHeaders, readRows, softDeleteRow } from '../../../lib/sheets';
import type { SheetsEnv, TabConfig } from '../../../lib/sheets';
import { walkthroughConfig } from '../../../lib/models/walkthrough';
import { walkthroughItemConfig } from '../../../lib/models/walkthroughItem';
import { walkthroughAdjustmentConfig } from '../../../lib/models/walkthroughAdjustment';

// Internal-only. Soft-deletes (Archived At, never hard-deleted) a Walkthrough
// row and everything hanging off it — same purpose as archive-job.ts /
// archive-property.ts. There is no delete action anywhere in the walkthrough
// UI, so a mistaken or test walkthrough would otherwise sit on the
// Walkthroughs list permanently.

/**
 * Archives a walkthrough's child rows in one batched write per tab.
 *
 * Batched rather than a softDeleteRow() per row because each of those does its
 * own header read, full-tab read, write and activity-log append, and
 * Cloudflare caps the subrequests one incoming request may make. A walkthrough
 * with a dozen special items could push the sequential version over that cap
 * and fail with an opaque 500. Same reasoning and shape as archiveQuoteItems()
 * in lib/pricing/quotes.ts.
 */
async function archiveChildren<T extends Record<string, never>>(
	config: TabConfig<T>,
	walkthroughId: string,
	timestamp: string
): Promise<number> {
	const headers = await readHeaders(env as SheetsEnv, config.tab);
	const archivedAtColumn = columnLetterAt(headers.indexOf('Archived At') + 1);
	const rows = await readRows(env as SheetsEnv, config.tab, { idColumn: config.idColumn });
	const toArchive = rows.filter((r) => r.data['Walkthrough ID'] === walkthroughId && !r.data['Archived At']);
	if (toArchive.length === 0) return 0;

	await batchUpdateValues(
		env as SheetsEnv,
		toArchive.map((r) => ({
			range: `'${config.tab}'!${archivedAtColumn}${r.rowNumber}:${archivedAtColumn}${r.rowNumber}`,
			values: [[timestamp]],
		}))
	);
	return toArchive.length;
}

export const POST: APIRoute = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) {
		return new Response(JSON.stringify({ ok: false, error: 'id required' }), { status: 400 });
	}
	try {
		// One timestamp for the parent and every child, so a later restore can
		// tell which children belong to this archive rather than to an earlier
		// edit — the same match archiveQuoteItems()/restoreQuote() rely on.
		const now = new Date().toISOString();
		const archived = await softDeleteRow(env, walkthroughConfig, id);
		const items = await archiveChildren(walkthroughItemConfig as never, id, now);
		const adjustments = await archiveChildren(walkthroughAdjustmentConfig as never, id, now);

		return new Response(JSON.stringify({ ok: true, archived, childRowsArchived: { items, adjustments } }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ ok: false, error: (error as Error).message }), { status: 502 });
	}
};
