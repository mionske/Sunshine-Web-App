import { describe, expect, it } from 'vitest';
import { formatPhoneDigits } from './phoneFormat';

describe('formatPhoneDigits', () => {
	it('leaves short digit runs unformatted', () => {
		expect(formatPhoneDigits('3')).toBe('3');
		expect(formatPhoneDigits('303')).toBe('303');
	});

	it('inserts a dash after the area code once a 4th digit is typed', () => {
		expect(formatPhoneDigits('3039')).toBe('303-9');
		expect(formatPhoneDigits('303931')).toBe('303-931');
	});

	it('inserts the second dash once a 7th digit is typed', () => {
		expect(formatPhoneDigits('3039313')).toBe('303-931-3');
		expect(formatPhoneDigits('3039313903')).toBe('303-931-3903');
	});

	it('leaves a run well past 10 digits unformatted rather than silently truncating it', () => {
		expect(formatPhoneDigits('30393139035551234')).toBe('30393139035551234');
	});

	it('strips non-digit characters before formatting', () => {
		expect(formatPhoneDigits('(303) 931-3903')).toBe('303-931-3903');
		expect(formatPhoneDigits('303.931.3903')).toBe('303-931-3903');
	});

	it('handles an empty string', () => {
		expect(formatPhoneDigits('')).toBe('');
	});

	it('drops a leading US country code (11 digits starting with 1)', () => {
		expect(formatPhoneDigits('1-303-931-3903')).toBe('303-931-3903');
		expect(formatPhoneDigits('13039313903')).toBe('303-931-3903');
	});

	it('does not truncate or misgroup a non-US-country-code number over 10 digits', () => {
		// A genuine 11-digit number NOT starting with 1 (e.g. international)
		// must never be silently cut down to a fake-looking 10-digit US number.
		expect(formatPhoneDigits('44207946095')).toBe('44207946095');
	});

	it('leaves an international number with a + prefix as plain digits', () => {
		expect(formatPhoneDigits('+44 20 7946 0958')).toBe('442079460958');
	});
});
