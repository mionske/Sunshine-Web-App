/** Formats a US phone number as the user types: strips non-digits, caps at
 * 10, and inserts dashes (XXX-XXX-XXXX). Applied both client-side (live, on
 * input) and server-side (on save) so a stored number is always in this
 * shape regardless of whether client-side JS ran. */
export function formatPhoneDigits(raw: string): string {
	const digits = raw.replace(/\D/g, '').slice(0, 10);
	if (digits.length <= 3) return digits;
	if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
	return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
