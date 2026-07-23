import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
	checkPassword,
	clearLoginAttempts,
	createSessionToken,
	isRateLimited,
	recordLoginAttempt,
	verifySessionToken,
} from './auth';

describe('checkPassword', () => {
	it('accepts the correct password', () => {
		expect(checkPassword('correct-horse', 'correct-horse')).toBe(true);
	});

	it('rejects a wrong password', () => {
		expect(checkPassword('wrong', 'correct-horse')).toBe(false);
	});

	it('rejects a different-length password without throwing', () => {
		expect(checkPassword('short', 'a-much-longer-password')).toBe(false);
	});
});

describe('session tokens', () => {
	const SECRET = 'test-signing-secret';

	it('round-trips a freshly created token', async () => {
		const token = await createSessionToken(SECRET);
		const payload = await verifySessionToken(token, SECRET);
		expect(payload).not.toBeNull();
		expect(payload!.exp).toBeGreaterThan(payload!.iat);
	});

	it('rejects a token signed with a different secret', async () => {
		const token = await createSessionToken(SECRET);
		const payload = await verifySessionToken(token, 'a-different-secret');
		expect(payload).toBeNull();
	});

	it('rejects malformed tokens', async () => {
		expect(await verifySessionToken('not-a-real-token', SECRET)).toBeNull();
		expect(await verifySessionToken('', SECRET)).toBeNull();
		expect(await verifySessionToken(null, SECRET)).toBeNull();
		expect(await verifySessionToken(undefined, SECRET)).toBeNull();
	});

	it('rejects an expired token', async () => {
		vi.useFakeTimers();
		const token = await createSessionToken(SECRET);
		vi.advanceTimersByTime(13 * 60 * 60 * 1000); // 13h, past the 12h TTL
		const payload = await verifySessionToken(token, SECRET);
		expect(payload).toBeNull();
		vi.useRealTimers();
	});
});

describe('login rate limiting', () => {
	beforeEach(() => {
		clearLoginAttempts('client-a');
		clearLoginAttempts('client-b');
	});

	it('is not rate-limited before any recorded attempts', () => {
		expect(isRateLimited('client-a')).toBe(false);
	});

	it('rate-limits after 5 recorded attempts', () => {
		for (let i = 0; i < 5; i++) recordLoginAttempt('client-a');
		expect(isRateLimited('client-a')).toBe(true);
	});

	it('tracks attempts per client key independently', () => {
		for (let i = 0; i < 5; i++) recordLoginAttempt('client-a');
		expect(isRateLimited('client-b')).toBe(false);
	});

	it('clearing attempts lifts the rate limit', () => {
		for (let i = 0; i < 5; i++) recordLoginAttempt('client-a');
		clearLoginAttempts('client-a');
		expect(isRateLimited('client-a')).toBe(false);
	});
});
