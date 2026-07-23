// Plain `new Date().toISOString()` can return the same value for two writes
// that land in the same millisecond, which would silently defeat
// optimistic-concurrency checks that compare `Updated At` values. This
// guarantees each call returns a strictly later timestamp than the last,
// per isolate — the same category of per-isolate module state already used
// for the access-token cache and login rate limiter elsewhere in this app.
let lastIssuedMs = 0;

export function nowIso(): string {
	let now = Date.now();
	if (now <= lastIssuedMs) now = lastIssuedMs + 1;
	lastIssuedMs = now;
	return new Date(now).toISOString();
}
