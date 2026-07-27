// Read-only Google Calendar access for the Dashboard's "Today"/"This Week"
// views — reuses the same service account already used for Sheets (see
// lib/sheets/googleAuth.ts), just with the Calendar readonly scope instead.
// No OAuth screen, no token storage: the business shares its calendar with
// the service account's own email (view-only), same setup shape as sharing
// the spreadsheet itself. Never writes to the calendar.
import { getAccessToken } from '../sheets/googleAuth';
import type { SheetsEnv } from '../sheets/types';

export interface CalendarEnv extends SheetsEnv {
	CALENDAR_ID: string;
}

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CalendarEvent {
	id: string;
	summary: string;
	location: string;
	htmlLink: string;
	/** ISO datetime for timed events, or a bare "YYYY-MM-DD" for all-day events. */
	start: string;
	end: string;
	/** True for an all-day event (Calendar's `start.date` instead of `start.dateTime`). */
	allDay: boolean;
}

interface RawCalendarEvent {
	id: string;
	summary?: string;
	location?: string;
	htmlLink?: string;
	status?: string;
	start?: { date?: string; dateTime?: string };
	end?: { date?: string; dateTime?: string };
}

/** Same retry shape as sheets/client.ts's sheetsFetch — 429/5xx are worth a
 * short backoff, anything else (auth/config errors) fails immediately so
 * a bad CALENDAR_ID or missing share surfaces clearly instead of retrying
 * a request that will never succeed. */
async function calendarFetch(env: CalendarEnv, url: string, attempt = 0): Promise<Response> {
	const accessToken = await getAccessToken(env, CALENDAR_SCOPE);
	const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
	if (!response.ok) {
		if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
			await sleep(300 * 2 ** attempt);
			return calendarFetch(env, url, attempt + 1);
		}
		const body = await response.text();
		throw new Error(`Calendar API error ${response.status} for ${url}: ${body}`);
	}
	return response;
}

/** Every event starting within [timeMinISO, timeMaxISO), expanded (recurring
 * events become individual instances) and sorted by start time — exactly
 * what a "what's on today/this week" view needs, nothing more. */
export async function listEventsInRange(env: CalendarEnv, timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]> {
	const url =
		`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events` +
		`?timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}` +
		`&singleEvents=true&orderBy=startTime`;
	const response = await calendarFetch(env, url);
	const data = (await response.json()) as { items?: RawCalendarEvent[] };
	return (data.items ?? [])
		.filter((e) => e.status !== 'cancelled')
		.map((e) => ({
			id: e.id,
			summary: e.summary || '(no title)',
			location: e.location ?? '',
			htmlLink: e.htmlLink ?? '',
			start: e.start?.dateTime ?? e.start?.date ?? '',
			end: e.end?.dateTime ?? e.end?.date ?? '',
			allDay: !e.start?.dateTime,
		}));
}
