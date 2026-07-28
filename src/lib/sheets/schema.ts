// Every tab's name + header row, used to bootstrap brand-new tabs. Never
// touches Jobs — that tab predates this app and is extended separately, under
// its own preservation protocol.
//
// Header lists are DERIVED from each tab's zod schema rather than spelled out
// again here. They used to be hand-maintained copies, and they drifted: the
// Walkthroughs list was ~25 columns behind its model by the time anyone
// looked. Since every read and write in this app goes by header name and
// bootstrapping only ever creates a tab that doesn't exist yet, key order is
// the only thing this determines — so the model can simply be the one source
// of truth. A new column now reaches a fresh environment automatically.
import { z } from 'zod';
import { addSheetTab, ensureGridSize, listSheetTitles, updateValues } from './client';
import { columnLetterAt, readHeaders } from './rows';
import type { SheetsEnv } from './types';
import { clientSchema } from '../models/client';
import { propertySchema } from '../models/property';
import { propertyPhotoSchema } from '../models/propertyPhoto';
import { leadSchema } from '../models/lead';
import { pipelineSchema } from '../models/pipeline';
import { quoteSchema } from '../models/quote';
import { quoteItemSchema } from '../models/quoteItem';
import { serviceSchema } from '../models/service';
import { pricingConfigSchema } from '../models/pricingConfig';
import { laborConfigSchema } from '../models/laborConfig';
import { windowProductionProfileSchema } from '../models/windowProductionProfile';
import { calibrationSnapshotSchema } from '../models/calibrationSnapshot';
import { walkthroughSchema } from '../models/walkthrough';
import { walkthroughItemSchema } from '../models/walkthroughItem';
import { walkthroughAdjustmentSchema } from '../models/walkthroughAdjustment';
import { jobTimeEntrySchema } from '../models/jobTimeEntry';
import { qbCustomerSchema } from '../models/qbCustomer';
import { qbEstimateSchema } from '../models/qbEstimate';
import { qbInvoiceSchema } from '../models/qbInvoice';
import { qbPaymentSchema } from '../models/qbPayment';

function headersFor(schema: z.ZodObject<z.ZodRawShape>): string[] {
	return Object.keys(schema.shape);
}

export const TAB_SCHEMAS: Record<string, string[]> = {
	Clients: headersFor(clientSchema),
	Properties: headersFor(propertySchema),
	PropertyPhotos: headersFor(propertyPhotoSchema),
	Leads: headersFor(leadSchema),
	Pipeline: headersFor(pipelineSchema),
	Quotes: headersFor(quoteSchema),
	QuoteItems: headersFor(quoteItemSchema),
	Services: headersFor(serviceSchema),
	PricingConfig: headersFor(pricingConfigSchema),
	// The labor model's own configuration: one versioned row of assumptions,
	// plus one profile row per production class. See lib/labor/estimate.ts.
	LaborConfig: headersFor(laborConfigSchema),
	WindowProductionProfiles: headersFor(windowProductionProfileSchema),
	CalibrationSnapshot: headersFor(calibrationSnapshotSchema),
	Walkthroughs: headersFor(walkthroughSchema),
	WalkthroughItems: headersFor(walkthroughItemSchema),
	// Restoration services and property-level labor modifiers, one row each.
	WalkthroughLaborAdjustments: headersFor(walkthroughAdjustmentSchema),
	JobTimeEntries: headersFor(jobTimeEntrySchema),
	QBCustomers: headersFor(qbCustomerSchema),
	QBEstimates: headersFor(qbEstimateSchema),
	QBInvoices: headersFor(qbInvoiceSchema),
	QBPayments: headersFor(qbPaymentSchema),
	// The one tab with no model file of its own — activityLog.ts writes it
	// directly, so its header list is spelled out here.
	ActivityLog: [
		'Activity ID',
		'Entity Type',
		'Entity ID',
		'Action',
		'Previous Value',
		'New Value',
		'User',
		'Timestamp',
		'Request ID',
		'Notes',
	],
};

/** Creates any tab from TAB_SCHEMAS that doesn't exist yet, with its header
 * row. Never touches Jobs or SystemTest — both are managed separately. Safe
 * to call repeatedly; a no-op for tabs that already exist. */
export async function bootstrapMissingTabs(env: SheetsEnv): Promise<{ created: string[] }> {
	const existing = new Set(await listSheetTitles(env));
	const created: string[] = [];

	for (const [tab, headers] of Object.entries(TAB_SCHEMAS)) {
		if (existing.has(tab)) continue;
		await addSheetTab(env, tab);
		await updateValues(env, `'${tab}'!A1:${columnLetterAt(headers.length)}1`, [headers]);
		created.push(tab);
	}

	return { created };
}

/** Appends a single new column to an app-owned tab's header row if it isn't
 * already present — for adding a field to a tab this app fully controls
 * (never for Jobs, which has its own preservation protocol and a much more
 * careful placement process; see extend-jobs-tab.ts). Column order doesn't
 * matter functionally (every read/write goes by header name), so this is
 * always a safe plain append at the end. */
export async function ensureColumn(env: SheetsEnv, tab: string, columnName: string): Promise<boolean> {
	const added = await ensureColumns(env, tab, [columnName]);
	return added.length > 0;
}

/** The same thing for a batch, in one read and one write regardless of how
 * many columns are being added. A schema change that adds thirty columns
 * across a few tabs is otherwise sixty-odd header reads, which is most of the
 * Sheets API's 60-reads-per-minute budget spent on bookkeeping. Returns the
 * names actually appended, so a re-run reports an empty list rather than
 * failing. */
export async function ensureColumns(env: SheetsEnv, tab: string, columnNames: string[]): Promise<string[]> {
	const headers = await readHeaders(env, tab, { fresh: true });
	const existing = new Set(headers);
	const missing: string[] = [];
	for (const name of columnNames) {
		// Deduplicates within the request too — asking for the same column
		// twice must not append it twice.
		if (existing.has(name)) continue;
		existing.add(name);
		missing.push(name);
	}
	if (missing.length === 0) return [];

	const firstCol = headers.length + 1;
	await ensureGridSize(env, tab, { minColumns: headers.length + missing.length });
	await updateValues(env, `'${tab}'!${columnLetterAt(firstCol)}1`, [missing]);
	// Refreshes the in-process header cache immediately — otherwise any
	// code that reads this tab's headers without {fresh: true} afterward
	// (the normal, non-admin path) would keep seeing the pre-append header
	// list until something else happens to force a fresh read.
	await readHeaders(env, tab, { fresh: true });
	return missing;
}
