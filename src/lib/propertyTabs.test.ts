import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDIT_GROUPS, PROPERTY_TABS, resolvePropertyView } from './propertyTabs';

function view(query: string) {
	return resolvePropertyView(new URLSearchParams(query));
}

describe('property tab state', () => {
	it('1. defaults to Overview', () => {
		expect(view('').tab).toBe('overview');
	});

	it('2. a tab in the URL survives a reload', () => {
		// Nothing here is stateful — the URL IS the state, which is what makes
		// reload, back, and a shared link all behave the same.
		for (const tab of PROPERTY_TABS) {
			expect(view(`tab=${tab.key}`).tab).toBe(tab.key);
		}
	});

	it('3. an unrecognised tab falls back to Overview', () => {
		expect(view('tab=bogus').tab).toBe('overview');
		expect(view('tab=').tab).toBe('overview');
		expect(view('tab=OVERVIEW').tab).toBe('overview');
	});

	it('keeps the whole-record fallback form reachable but off the rail', () => {
		expect(view('tab=edit').tab).toBe('edit');
		expect(PROPERTY_TABS.some((t) => (t.key as string) === 'edit')).toBe(false);
	});

	it('4. only one group can be editing', () => {
		const state = view('tab=access&edit=water');
		expect(state.editingGroup).toBe('water');
		// There is exactly one place a group name can come from, so "two cards
		// editing at once" isn't a state this can produce.
		expect(typeof state.editingGroup).toBe('string');
	});

	it('ignores an edit group that belongs to another tab', () => {
		// Otherwise ?tab=notes&edit=water renders a form on a panel that never
		// shows it: present in the DOM, unreachable, and with no working Cancel.
		expect(view('tab=notes&edit=water').editingGroup).toBe('');
		expect(view('tab=access&edit=inventory').editingGroup).toBe('');
		expect(view('edit=record').editingGroup).toBe('record');
	});

	it('rests with nothing editing', () => {
		expect(view('tab=access').editingGroup).toBe('');
		expect(view('tab=access&edit=nonsense').editingGroup).toBe('');
	});

	it('every edit group belongs to a real tab', () => {
		for (const [group, tab] of Object.entries(EDIT_GROUPS)) {
			expect(PROPERTY_TABS.some((t) => t.key === tab), `${group} -> ${tab}`).toBe(true);
		}
	});
});

/**
 * Source-level guards for the property page.
 *
 * These assert things about the page that can't be reached through a unit
 * test — an Astro page renders inside the Cloudflare runtime with live Sheets
 * behind it. They follow the same approach as qb/noAutoSync.test.ts: read the
 * source, strip comments so a rule can be *described* without tripping its own
 * check, and assert on what's left.
 */
function source(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '')
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
}

describe('property detail page invariants', () => {
	const page = source('src/pages/properties/[id].astro');

	it('7. the property heading is not a self-link', () => {
		// A heading that links to the page you're already on is a dead control
		// that teaches people the h1 is clickable.
		expect(page).toMatch(/<h1>\{property\['Street Address'\]/);
		expect(page).not.toMatch(/<a[^>]*>\s*<h1/);
		expect(page).not.toMatch(/<h1>\s*<a/);
	});

	it('8. permanent property condition is never written from walkthrough condition', () => {
		// Condition describes a visit, not a building. The Property columns for
		// it are deprecated and must never be written again.
		//
		// Scoped to writes aimed at propertyConfig specifically. The page does
		// write these column names — onto a WALKTHROUGH, in the one-time
		// legacy-migration action, which is the whole point of that action:
		// moving the data to the record it actually belongs to.
		const propertyWrites = [...page.matchAll(/updateRow\(env, propertyConfig[\s\S]*?\n\t*\}\)/g)]
			.map((m) => m[0])
			.join('\n');
		const groupPatches = page.slice(page.indexOf('const GROUP_PATCHES'), page.indexOf('const patch = GROUP_PATCHES'));
		const allPropertyWrites = `${propertyWrites}\n${groupPatches}`;

		expect(allPropertyWrites.length).toBeGreaterThan(200);
		for (const column of [
			'Window Condition',
			'Hard Water History',
			'Construction Debris',
			'Heavy Interior Residue',
			'Oxidized Frames Or Screens',
			'Condition Notes',
			'Condition Varies By Area',
		]) {
			expect(allPropertyWrites, `${column} must not be written to Property`).not.toContain(column);
		}
	});

	it('11. the activity timeline appears only under History', () => {
		const historyStart = page.indexOf("activeTab === 'history'");
		expect(historyStart).toBeGreaterThan(-1);
		// visibleTimeline is the only thing that renders timeline entries, and
		// it must be referenced inside the history panel and nowhere earlier.
		expect(page.indexOf('visibleTimeline.map')).toBeGreaterThan(historyStart);
		expect(page.slice(0, historyStart)).not.toContain('visibleTimeline.map');
	});

	it('15. QuickBooks is never touched by rendering a property', () => {
		expect(page).not.toMatch(/from '.*qb\/client'/);
		expect(page).not.toMatch(/from '.*qb\/oauth'/);
		expect(page).not.toContain('syncSingleEntity');
		expect(page).not.toContain('runFullSync');
	});

	it('18. walkthrough counts are read from the walkthrough, not the property', () => {
		// The Inventory tab shows both, and they must come from different
		// records — that separation is the entire point of the two count sets.
		expect(page).toContain("latestWalkthrough['Total Window Units']");
		expect(page).toContain("property['Total Window Units']");
	});

	it('13. Before the Truck Leaves is ordered first on phones', () => {
		const css = source('src/styles/global.css');
		expect(page).toContain('pcard porder-first');
		expect(css).toMatch(/\.porder-first\s*\{\s*order:\s*-1/);
	});

	it('12. the rail becomes a scrolling strip below 900px', () => {
		const css = source('src/styles/global.css');
		const mobile = css.slice(css.indexOf('@media (max-width: 900px)'));
		expect(mobile).toMatch(/\.property-shell\s*\{\s*grid-template-columns:\s*1fr/);
		expect(mobile).toMatch(/flex-direction:\s*row/);
		expect(mobile).toMatch(/overflow-x:\s*auto/);
	});

	it('each save action writes only its own group', () => {
		// The patch map is the whole safety story for per-group editing: a key
		// listed under the wrong group would silently overwrite a field the
		// operator never saw.
		const patches = page.slice(page.indexOf('const GROUP_PATCHES'), page.indexOf("const patch = GROUP_PATCHES"));
		expect(patches).toContain("'save-water': () => ({");
		// Water writes water and nothing else.
		const water = patches.slice(patches.indexOf("'save-water'"), patches.indexOf("'save-parking'"));
		expect(water).toContain("'Water Access Method'");
		expect(water).toContain("'Water Supply'");
		expect(water).not.toContain("'Street Address'");
		expect(water).not.toContain("'Total Window Units'");
	});
});
