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

	it('caps at 10 digits, ignoring anything typed after', () => {
		expect(formatPhoneDigits('30393139035551234')).toBe('303-931-3903');
	});

	it('strips non-digit characters before formatting', () => {
		expect(formatPhoneDigits('(303) 931-3903')).toBe('303-931-3903');
		expect(formatPhoneDigits('303.931.3903')).toBe('303-931-3903');
	});

	it('handles an empty string', () => {
		expect(formatPhoneDigits('')).toBe('');
	});
});
