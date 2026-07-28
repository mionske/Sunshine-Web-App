import { describe, expect, it } from 'vitest';
import {
	EMPTY_INVENTORY_MESSAGE,
	emptyInventory,
	hasAnyInventory,
	inventoryTotals,
	specialItemError,
	type SpecialItem,
	type WalkthroughInventory,
} from './inventory';

function special(overrides: Partial<SpecialItem> = {}): SpecialItem {
	return { id: crypto.randomUUID(), type: 'large_picture', quantity: 1, story: 'first', ...overrides };
}

function inventory(overrides: Partial<WalkthroughInventory> = {}): WalkthroughInventory {
	return { ...emptyInventory(), ...overrides };
}

describe('inventory totals', () => {
	it('1. sums standard windows across every floor', () => {
		const totals = inventoryTotals(
			inventory({ standardWindowsByStory: { first: 18, second: 20, third: 6, fourthPlus: 0 } })
		);
		expect(totals.standardWindowTotal).toBe(44);
		expect(totals.totalWindowUnits).toBe(44);
	});

	it('2. counts special units but excludes divided-light panes', () => {
		const totals = inventoryTotals(
			inventory({
				standardWindowsByStory: { first: 44, second: 0, third: 0, fourthPlus: 0 },
				specialItems: [
					special({ type: 'large_picture', quantity: 3 }),
					special({ type: 'sliding_glass_door', quantity: 2 }),
					special({ type: 'divided_light_panes', quantity: 18 }),
				],
			})
		);
		expect(totals.specialUnitTotal).toBe(5);
		expect(totals.dividedLightPaneTotal).toBe(18);
	});

	it('3. divided-light quantities never reach the window-unit total', () => {
		// One french door with eighteen lights is one opening to set up at,
		// not eighteen windows to walk to.
		const withPanes = inventoryTotals(
			inventory({
				standardWindowsByStory: { first: 44, second: 0, third: 0, fourthPlus: 0 },
				specialItems: [special({ type: 'divided_light_panes', quantity: 18 })],
			})
		);
		expect(withPanes.totalWindowUnits).toBe(44);
		expect(withPanes.dividedLightPaneTotal).toBe(18);
	});

	it('4. the glass pane total is whatever was counted, never derived or reconciled', () => {
		const totals = inventoryTotals(
			inventory({
				standardWindowsByStory: { first: 44, second: 0, third: 0, fourthPlus: 0 },
				specialItems: [special({ type: 'large_picture', quantity: 5 })],
				totalGlassPanes: 77,
			})
		);
		// 49 units, 77 panes — deliberately unrelated numbers, and no rule
		// anywhere tries to make one explain the other.
		expect(totals.totalWindowUnits).toBe(49);
		expect(totals.totalGlassPanes).toBe(77);
	});

	it('a pane total far below the unit count is still accepted as entered', () => {
		const totals = inventoryTotals(
			inventory({ standardWindowsByStory: { first: 40, second: 0, third: 0, fourthPlus: 0 }, totalGlassPanes: 5 })
		);
		expect(totals.totalGlassPanes).toBe(5);
		expect(totals.totalWindowUnits).toBe(40);
	});

	it('5. screens, tracks and solar panels come straight through', () => {
		const totals = inventoryTotals(inventory({ screens: 44, tracks: 44, solarPanels: 12 }));
		expect(totals.screens).toBe(44);
		expect(totals.tracks).toBe(44);
		expect(totals.solarPanels).toBe(12);
	});

	it('produces the summary from the spec end to end', () => {
		const totals = inventoryTotals(
			inventory({
				standardWindowsByStory: { first: 18, second: 20, third: 6, fourthPlus: 0 },
				specialItems: [
					special({ type: 'large_picture', quantity: 3 }),
					special({ type: 'skylight', quantity: 2, story: 'roof' }),
					special({ type: 'divided_light_panes', quantity: 18 }),
				],
				totalGlassPanes: 77,
				screens: 44,
				tracks: 44,
			})
		);
		expect(totals).toMatchObject({
			standardWindowTotal: 44,
			specialUnitTotal: 5,
			dividedLightPaneTotal: 18,
			totalWindowUnits: 49,
			totalGlassPanes: 77,
			screens: 44,
			tracks: 44,
		});
	});

	it('treats blank and negative entries as zero rather than breaking the sum', () => {
		const totals = inventoryTotals(
			inventory({
				standardWindowsByStory: { first: 10, second: NaN as unknown as number, third: -4, fourthPlus: 0 },
			})
		);
		expect(totals.standardWindowTotal).toBe(10);
	});
});

describe('inventory validation', () => {
	it('12. blocks continuing on a completely empty inventory', () => {
		expect(hasAnyInventory(emptyInventory())).toBe(false);
		expect(EMPTY_INVENTORY_MESSAGE).toContain('at least one');
	});

	it('11. allows continuing when only the glass pane total was entered', () => {
		// Someone who ran out of time and counted panes has still recorded
		// something real.
		expect(hasAnyInventory(inventory({ totalGlassPanes: 77 }))).toBe(true);
	});

	it('allows continuing on standard windows alone, or special items alone', () => {
		expect(hasAnyInventory(inventory({ standardWindowsByStory: { first: 1, second: 0, third: 0, fourthPlus: 0 } }))).toBe(true);
		expect(hasAnyInventory(inventory({ specialItems: [special()] }))).toBe(true);
	});

	it('a floor with zero windows is a fact, not an error', () => {
		expect(
			hasAnyInventory(inventory({ standardWindowsByStory: { first: 18, second: 0, third: 0, fourthPlus: 0 } }))
		).toBe(true);
	});

	it('6. a freshly added blank special row never shows an error', () => {
		// It is in progress, not wrong — and must be removable without ever
		// having complained.
		expect(specialItemError({ id: 'x', type: '' as never, quantity: 0, story: '' as never })).toBeNull();
	});

	it('flags a special row only once it has been partly filled in', () => {
		expect(specialItemError(special({ quantity: 0 }))).toContain('at least 1');
		expect(specialItemError(special({ story: '' as never }))).toContain('story');
		expect(specialItemError(special())).toBeNull();
	});

	it('never requires notes', () => {
		expect(specialItemError(special({ notes: undefined }))).toBeNull();
	});
});
