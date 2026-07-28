import {
	PANE_COUNTED_TYPE,
	STANDARD_FLOORS,
	type SpecialItemStory,
	type SpecialItemType,
	type StandardFloor,
} from './types';

/**
 * What a walkthrough records about what's actually there.
 *
 * Deliberately shallow. The previous model asked for a production class, a
 * size, a story and two access levels on every group, which is more than a
 * 15-minute walkthrough can carry. Here a window is assumed ordinary unless
 * the operator says otherwise.
 */
export interface WalkthroughInventory {
	standardWindowsByStory: Record<StandardFloor, number>;
	specialItems: SpecialItem[];
	/** Counted directly, never derived — see totals() below. */
	totalGlassPanes: number;
	screens: number;
	tracks: number;
	solarPanels: number;
}

export interface SpecialItem {
	id: string;
	type: SpecialItemType;
	quantity: number;
	story: SpecialItemStory;
	notes?: string;
}

export interface InventoryTotals {
	standardWindowTotal: number;
	specialUnitTotal: number;
	dividedLightPaneTotal: number;
	totalWindowUnits: number;
	totalGlassPanes: number;
	screens: number;
	tracks: number;
	solarPanels: number;
}

export function emptyInventory(): WalkthroughInventory {
	return {
		standardWindowsByStory: { first: 0, second: 0, third: 0, fourthPlus: 0 },
		specialItems: [],
		totalGlassPanes: 0,
		screens: 0,
		tracks: 0,
		solarPanels: 0,
	};
}

function count(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Every derived number on the inventory step.
 *
 * Two rules do the work here, and both exist because the two counts measure
 * genuinely different things:
 *
 *  - Divided-light quantities are PANES, so they never reach
 *    totalWindowUnits. A french door with eighteen lights is one opening to
 *    set up at, not eighteen.
 *  - totalGlassPanes is whatever the operator counted, full stop. It is not
 *    derived from units and is never reconciled against them. A window unit
 *    is a subjective judgment of how much work an opening represents; a pane
 *    is an objective count of glass. Forcing them to agree would destroy the
 *    only independent measurement the walkthrough produces.
 */
export function inventoryTotals(inventory: WalkthroughInventory): InventoryTotals {
	const standardWindowTotal = STANDARD_FLOORS.reduce(
		(sum, floor) => sum + count(inventory.standardWindowsByStory[floor]),
		0
	);

	const specialUnitTotal = inventory.specialItems
		.filter((item) => item.type !== PANE_COUNTED_TYPE)
		.reduce((sum, item) => sum + count(item.quantity), 0);

	const dividedLightPaneTotal = inventory.specialItems
		.filter((item) => item.type === PANE_COUNTED_TYPE)
		.reduce((sum, item) => sum + count(item.quantity), 0);

	return {
		standardWindowTotal,
		specialUnitTotal,
		dividedLightPaneTotal,
		totalWindowUnits: standardWindowTotal + specialUnitTotal,
		totalGlassPanes: count(inventory.totalGlassPanes),
		screens: count(inventory.screens),
		tracks: count(inventory.tracks),
		solarPanels: count(inventory.solarPanels),
	};
}

/**
 * Whether there is enough here to move on.
 *
 * Deliberately permissive: a floor with no windows is a fact, not an error,
 * and someone who only had time to count panes has still recorded something
 * real. The only thing blocked is a completely empty inventory.
 */
export function hasAnyInventory(inventory: WalkthroughInventory): boolean {
	const totals = inventoryTotals(inventory);
	return totals.standardWindowTotal > 0 || inventory.specialItems.length > 0 || totals.totalGlassPanes > 0;
}

export const EMPTY_INVENTORY_MESSAGE = 'Enter at least one window count or the total glass pane count.';

/** A special row is only wrong once it has been given something — a freshly
 * added blank row is in progress, not in error, and must be removable without
 * ever having shown a complaint. */
export function specialItemError(item: SpecialItem): string | null {
	const untouched = !item.type && !item.quantity && !item.story;
	if (untouched) return null;
	if (!item.type) return 'Choose a type.';
	if (count(item.quantity) < 1) return 'Quantity must be at least 1.';
	if (!item.story) return 'Choose a story.';
	return null;
}
