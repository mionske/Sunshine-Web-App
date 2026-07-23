export interface SheetsEnv {
	GOOGLE_SERVICE_ACCOUNT_JSON: string;
	SPREADSHEET_ID: string;
}

/** Internal-only handle for locating a row to update. Never expose this as
 * a business identifier — the plan requires stable UUIDs for that. */
export interface RowHandle {
	rowNumber: number;
}

export class SheetsSchemaError extends Error {
	constructor(tab: string, missing: string[], found: string[]) {
		super(
			`Tab "${tab}" is missing expected column(s): ${missing.join(', ')}. ` +
				`Actual headers found: ${found.join(', ') || '(empty)'}`
		);
		this.name = 'SheetsSchemaError';
	}
}

export class SheetsConcurrencyError extends Error {
	constructor(tab: string, id: string) {
		super(
			`Row "${id}" in tab "${tab}" was modified since it was last read — refusing to ` +
				`overwrite. Reload and retry.`
		);
		this.name = 'SheetsConcurrencyError';
	}
}

export class SheetsWriteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SheetsWriteError';
	}
}

export class SheetsNotFoundError extends Error {
	constructor(tab: string, id: string) {
		super(`Row "${id}" not found in tab "${tab}"`);
		this.name = 'SheetsNotFoundError';
	}
}
