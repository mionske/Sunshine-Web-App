## Development

Node.js isn't on PATH by default on this machine. Prepend the local install
before any npm/astro/wrangler command:

```
export PATH="$HOME/.local/node/bin:$PATH"
```

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and
`astro dev logs`.

## Architecture

See `~/.claude/plans/imperative-sauteeing-clock.md` for the full plan this
app is built from, and `docs/data-dictionary.md` for the spreadsheet schema
reference. Core rule: `PricingConfig` controls what's charged today;
historical job calibration is informational only and never auto-changes
pricing.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
