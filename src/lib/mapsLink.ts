// Builds a Google Maps search URL for an address. Pure/dependency-free so
// it's safe to import from both server-rendered .astro pages and client
// React islands (e.g. PipelineBoard).
export function googleMapsUrl(address: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Joins a Property's address fields into one string for a maps query —
 * more reliable than the street alone. Takes the actual Property field
 * names ('Street Address', City, State, Zip), not a separate shape, so
 * every call site can just pass the Property object it already has. */
export function fullAddress(property: { 'Street Address'?: string; City?: string; State?: string; Zip?: string }): string {
	return [property['Street Address'], property.City, property.State, property.Zip].filter(Boolean).join(', ');
}
