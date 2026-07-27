import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetTokenCacheForTests } from '../sheets/googleAuth';
import { listEventsInRange } from './client';
import type { CalendarEnv } from './client';

function makeEnv(overrides: Partial<CalendarEnv> = {}): CalendarEnv {
	const { privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	return {
		SPREADSHEET_ID: 'fake-spreadsheet-id',
		CALENDAR_ID: 'info@example.com',
		GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fake@example.com', private_key: privateKey }),
		...overrides,
	};
}

function tokenResponse() {
	return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 });
}

describe('listEventsInRange', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		_resetTokenCacheForTests();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('fetches the calendar ID and date range, mapping events into the app shape', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('oauth2.googleapis.com')) return tokenResponse();
			expect(url).toContain('/calendars/info%40example.com/events');
			expect(url).toContain('timeMin=2026-01-01T00%3A00%3A00Z');
			expect(url).toContain('timeMax=2026-01-08T00%3A00%3A00Z');
			return new Response(
				JSON.stringify({
					items: [
						{
							id: 'evt-1',
							summary: 'Walkthrough — Jane Doe',
							location: '123 Main St',
							htmlLink: 'https://calendar.google.com/evt-1',
							start: { dateTime: '2026-01-02T15:00:00-07:00' },
							end: { dateTime: '2026-01-02T15:30:00-07:00' },
						},
						{ id: 'evt-2', summary: 'All-day reminder', start: { date: '2026-01-03' }, end: { date: '2026-01-04' } },
						{ id: 'evt-3', summary: 'Cancelled meeting', status: 'cancelled', start: { dateTime: '2026-01-02T10:00:00-07:00' } },
					],
				}),
				{ status: 200 }
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const events = await listEventsInRange(makeEnv(), '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');

		expect(events).toEqual([
			{
				id: 'evt-1',
				summary: 'Walkthrough — Jane Doe',
				location: '123 Main St',
				htmlLink: 'https://calendar.google.com/evt-1',
				start: '2026-01-02T15:00:00-07:00',
				end: '2026-01-02T15:30:00-07:00',
				allDay: false,
			},
			{
				id: 'evt-2',
				summary: 'All-day reminder',
				location: '',
				htmlLink: '',
				start: '2026-01-03',
				end: '2026-01-04',
				allDay: true,
			},
		]);
	});

	it('retries on a 429 rate-limit response and eventually succeeds', async () => {
		let calendarCalls = 0;
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('oauth2.googleapis.com')) return tokenResponse();
			calendarCalls += 1;
			if (calendarCalls === 1) return new Response('rate limited', { status: 429 });
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const events = await listEventsInRange(makeEnv(), '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');
		expect(events).toEqual([]);
		expect(calendarCalls).toBe(2);
	});

	it('surfaces a clear error for a non-retryable failure (e.g. calendar not shared)', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('oauth2.googleapis.com')) return tokenResponse();
			return new Response('Not Found', { status: 404 });
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await expect(listEventsInRange(makeEnv(), '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z')).rejects.toThrow(
			/Calendar API error 404/
		);
	});
});
