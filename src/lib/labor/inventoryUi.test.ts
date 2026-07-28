import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guards for the inventory step.
 *
 * These assert things a unit test can't reach: the wizard is a React island
 * that only renders inside the app, and the rules below are about what the
 * markup does NOT contain. Same approach as propertyTabs.test.ts and
 * qb/noAutoSync.test.ts — read the source, strip comments so a rule can be
 * described without tripping its own check, and assert on what's left.
 */
function source(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '')
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
}

describe('9. totals are live, with no Update Totals button', () => {
	const wizard = source('src/components/WalkthroughWizard.tsx');

	it('has no update-totals control anywhere', () => {
		// A number you have to ask for is a number people stop trusting, and
		// the old button also meant the summary could sit silently stale while
		// the operator kept typing.
		expect(wizard).not.toMatch(/Update totals/i);
	});

	it('computes the summary during render rather than from fetched state', () => {
		expect(wizard).toMatch(/const totals = inventoryTotals\(toInventory\(inventory\)\)/);
	});

	it('coerces through the same function the server uses', () => {
		// Two copies of "what does a blank mean" would drift, and the number on
		// screen would stop being the number that gets saved.
		expect(wizard).toMatch(/toInventory[\s\S]*from '\.\.\/lib\/labor\/inventory'/);
		expect(source('src/lib/labor/walkthroughLabor.ts')).toMatch(/toInventory\(input\.inventory\)/);
	});

	it('never blocks the step on a preview request', () => {
		expect(wizard).toMatch(/disabled=\{!inventoryValid\}/);
		expect(wizard).not.toMatch(/disabled=\{loadingPreview \|\| !inventoryValid\}/);
	});
});

describe('the review step is a decision screen, not a form', () => {
	const wizard = source('src/components/WalkthroughWizard.tsx');

	it('has no recalculate button — the numbers are simply always current', () => {
		expect(wizard).not.toMatch(/Recalculate/i);
		expect(wizard).not.toMatch(/loadPreview/);
		expect(wizard).not.toMatch(/'preview-labor'/);
	});

	it('computes the estimate, schedule and price during render', () => {
		expect(wizard).toMatch(/const estimate = estimateInventoryLabor\(laborModel/);
		expect(wizard).toMatch(/const schedule = suggestSchedule\(laborModel/);
		expect(wizard).toMatch(/const band = suggestPriceBand\(pricingConfig/);
	});

	it('never pulls the Sheets layer into the browser bundle', () => {
		// walkthroughLabor.ts imports the Sheets client, so importing the
		// adjustment resolver from there would ship the whole server data
		// layer to a phone. It lives in its own pure module for that reason.
		expect(wizard).toMatch(/from '\.\.\/lib\/labor\/adjustments'/);
		expect(wizard).not.toMatch(/from '\.\.\/lib\/labor\/walkthroughLabor'/);
		expect(source('src/lib/labor/adjustments.ts')).not.toMatch(/from '\.\.\/sheets'/);
	});

	it('derives the hourly rates from the price on screen', () => {
		expect(wizard).toMatch(/perProductiveHour = productiveHours > 0/);
		expect(wizard).toMatch(/perScheduledHour = scheduledHours > 0/);
	});

	it('calls the note field Pricing notes', () => {
		expect(wizard).toMatch(/Pricing notes/);
		expect(wizard).not.toMatch(/Reason \(optional\)/);
	});

	it('leads with the recommendation and keeps the range secondary', () => {
		expect(wizard).toMatch(/className="price-headline"/);
		expect(wizard).toMatch(/Recommended range \$\{band\.low\} to \$\{band\.high\}/);
	});
});

describe('the inventory step asks nothing it does not need', () => {
	const wizard = source('src/components/WalkthroughWizard.tsx');

	it('no longer asks for a production class or size per group', () => {
		// The v2 step asked for class, size, story and two access levels on
		// every group. That is more than a 15-minute walkthrough can carry,
		// and it is why the step went unfinished in the field.
		expect(wizard).not.toMatch(/PRODUCTION_CLASSES/);
		expect(wizard).not.toMatch(/SIZE_CLASSES/);
	});

	it('asks for access once, at the property level', () => {
		expect(wizard).toMatch(/name="exterior-access"/);
		expect(wizard).toMatch(/name="interior-access"/);
		expect(wizard).not.toMatch(/ext-access-\$\{group\.id\}/);
	});
});

describe('7 & 8. the step is usable on a phone', () => {
	const wizard = source('src/components/WalkthroughWizard.tsx');
	const css = source('src/styles/global.css');

	it('every number field opens a keypad rather than a full keyboard', () => {
		// Counts get "numeric"; hours and prices get "decimal", which is the
		// same keypad plus a decimal point. Either is right — a full QWERTY
		// keyboard for a number is not.
		const numberInputs = wizard.match(/type="number"/g) ?? [];
		const keypads = wizard.match(/inputMode="(numeric|decimal)"/g) ?? [];
		expect(numberInputs.length).toBeGreaterThan(0);
		expect(keypads.length).toBe(numberInputs.length);
	});

	it('count fields stack in one column on a phone', () => {
		// A 100px minimum fit two columns at 375px, halving every field's
		// width and its tap target with it.
		expect(css).toMatch(/\.count-grid \{[^}]*grid-template-columns: 1fr;/);
		expect(css).toMatch(/@media \(min-width: 480px\) \{\s*\.count-grid \{/);
	});

	it('fields, buttons and segmented pills all clear a 44px touch target', () => {
		expect(css).toMatch(/input,\s*select,\s*textarea \{[^}]*min-height: 44px;/);
		expect(css).toMatch(/button,\s*\.btn \{[^}]*min-height: 44px;/);
		expect(css).toMatch(/\.segmented label \{[^}]*min-height: 44px;/);
	});

	it('exempts checkboxes and radios from that floor', () => {
		// Their target is the surrounding label; forcing it here would stretch
		// the box itself and wreck every checkbox grid in the app.
		expect(css).toMatch(/input\[type='checkbox'\],\s*input\[type='radio'\] \{[^}]*min-height: revert;/);
	});

	it('uses no fixed pixel widths that could force sideways scrolling', () => {
		const step = wizard.slice(wizard.indexOf('state.step === 1 &&'), wizard.indexOf('state.step === 2 &&'));
		expect(step).not.toMatch(/width:\s*\d{3,}px/);
		expect(step).not.toMatch(/minWidth:/);
	});
});

describe('6. the legacy disclosure is gated on migrated data, not on age', () => {
	const page = source('src/pages/walkthroughs/[id].astro');

	it('renders only when preserved legacy data is actually present', () => {
		expect(page).toMatch(/hasLegacyInventoryDetails\(walkthrough\)/);
		expect(page).toMatch(/\{legacyInventory && \(/);
	});

	it('shows the original rows rather than a re-derivation of them', () => {
		expect(page).toMatch(/legacyInventory\.unmapped\.groups\.map/);
	});
});
