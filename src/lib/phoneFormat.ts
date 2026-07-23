/** Formats a US phone number as the user types: strips non-digits and
 * inserts dashes (XXX-XXX-XXXX). Applied both client-side (live, on input)
 * and server-side (on save) so a stored number is always in this shape
 * regardless of whether client-side JS ran.
 *
 * A leading "1" is dropped only when it's exactly the 11-digit US
 * country-code case (e.g. "1-303-931-3903"), since that's the one
 * ambiguity this business actually sees. Anything else with more than 10
 * digits — a genuine international number, a typo, a paste with extra
 * digits — is left as plain digits rather than force-fit into XXX-XXX-XXXX,
 * which would silently drop/misgroup digits and store a wrong number. */
export function formatPhoneDigits(raw: string): string {
	const allDigits = raw.replace(/\D/g, '');
	const digits = allDigits.length === 11 && allDigits.startsWith('1') ? allDigits.slice(1) : allDigits;
	if (digits.length > 10) return allDigits;
	if (digits.length <= 3) return digits;
	if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
	return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
