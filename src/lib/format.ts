/** Human-readable rendering for the raw ISO timestamps Sheets stores
 * (e.g. "2026-07-24T15:03:19.558Z" -> "Jul 24, 2026 at 9:03 AM"). Display
 * only — every stored timestamp stays exactly as written; this never
 * touches the underlying data. Uses the browser/Worker's local timezone
 * consistently (no separate app-timezone concept exists in this app). */
export function formatTimestamp(iso: string): string {
	if (!iso) return '';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	return `${datePart} at ${timePart}`;
}
