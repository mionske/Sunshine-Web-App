import { emptyInventory, type SpecialItem, type WalkthroughInventory } from './inventory';
import type { ExteriorAccess, InteriorAccess, ProductionClass, SpecialItemType, StandardFloor } from './types';

/**
 * Reading a grouped (v2) walkthrough as a simplified (v3) inventory.
 *
 * The governing rule is conservative, and it is the whole design: map only
 * what a v3 field can hold exactly, and keep everything else verbatim rather
 * than approximating it. Nothing is discarded — not a note, not an access
 * selection, not a quantity, not a size.
 *
 * Three consequences worth stating plainly, because each is a place where a
 * cleverer migration would have guessed:
 *
 *  - The original WalkthroughItem rows are never rewritten. This function is
 *    pure and returns a new inventory; the group rows stay exactly as the
 *    operator entered them and remain the record of what was actually seen.
 *  - Where v3 has no equivalent — a Large specialty shape, an oversized
 *    standard window, per-group access that differs between groups — the
 *    value goes into `unmapped` and the v3 field is left at its plainest
 *    setting. That biases every ambiguous case DOWNWARD in price, so a
 *    migrated walkthrough never silently quotes higher than it did.
 *  - Every such case produces a human-readable line in `notes`, which is what
 *    the "Previous inventory details" disclosure shows. A migration the
 *    operator can't see is a migration they can't correct.
 */

/** The subset of a WalkthroughItem row a window group actually uses. */
export interface LegacyGroupRow {
	'Walkthrough Item ID'?: string;
	'Production Class': string;
	Quantity: string;
	'Size Class': string;
	Story: string;
	'Interior Access': string;
	'Exterior Access': string;
	'Panes Per Unit': string;
	'Screens Per Unit': string;
	'Tracks Per Unit': string;
	'Specialty Description': string;
	Notes: string;
}

/** Totals the walkthrough row already recorded. Used directly rather than
 * re-derived from the groups: they were computed by the estimator at save
 * time and are exact, where re-deriving would need per-class defaults this
 * module deliberately doesn't know. */
export interface LegacyRecordedTotals {
	glassPanes: string;
	screens: string;
	tracks: string;
}

export interface LegacyMigration {
	inventory: WalkthroughInventory;
	/** One selection each, and only when every group agreed. */
	access: { interior: InteriorAccess | ''; exterior: ExteriorAccess | '' };
	/** Everything v3 has no field for, verbatim. Persisted as JSON. */
	unmapped: {
		groups: LegacyGroupRow[];
		perGroupAccess?: { productionClass: string; interior: string; exterior: string }[];
		sizeClasses?: { productionClass: string; sizeClass: string; quantity: string }[];
		specialtyDescriptions?: string[];
		notes?: string[];
	};
	/** What the disclosure shows, in plain language. */
	notes: string[];
}

/** Exact reverse of SPECIAL_PROFILE in inventoryEstimate.ts, and only where
 * the reverse is genuinely unambiguous. Specialty Shape is absent on purpose:
 * large_triangle/small_triangle/bay_bow all map FORWARD onto it, so mapping
 * back would assert a shape nobody recorded. */
const EXACT_SPECIAL: Record<string, SpecialItemType> = {
	'Large Picture Window': 'large_picture',
	'Sliding Door': 'sliding_glass_door',
	Skylight: 'skylight',
	'French Panes': 'divided_light_panes',
};

const STORY_TO_FLOOR: Record<string, StandardFloor> = {
	First: 'first',
	Second: 'second',
	Third: 'third',
	'Fourth+': 'fourthPlus',
};

const STORY_TO_SPECIAL_STORY: Record<string, SpecialItem['story']> = {
	First: 'first',
	Second: 'second',
	Third: 'third',
	'Fourth+': 'fourth_plus',
};

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

/**
 * @param paneFactors The `defaultPaneFactor` of each production class, from
 *   the labor model. Needed only for French Panes, where a v2 group counted
 *   openings and v3 counts panes — without it the conversion would be a
 *   guess, which is exactly what this module refuses to do.
 */
export function migrateGroupsToInventory(
	groups: LegacyGroupRow[],
	totals: LegacyRecordedTotals,
	paneFactors: Partial<Record<ProductionClass, number>> = {}
): LegacyMigration {
	const inventory = emptyInventory();
	const notes: string[] = [];
	const sizeClasses: LegacyMigration['unmapped']['sizeClasses'] = [];
	const specialtyDescriptions: string[] = [];
	const groupNotes: string[] = [];

	for (const group of groups) {
		const quantity = num(group.Quantity);
		if (quantity === 0) continue;

		const productionClass = group['Production Class'];
		const size = group['Size Class'];
		if (size && size !== 'Standard') {
			sizeClasses.push({ productionClass, sizeClass: size, quantity: group.Quantity });
		}
		if (group['Specialty Description']) specialtyDescriptions.push(group['Specialty Description']);
		if (group.Notes) groupNotes.push(group.Notes);

		// --- Standard windows: counted per floor ---------------------------
		if (productionClass === 'Standard Window') {
			const floor = STORY_TO_FLOOR[group.Story];
			if (!floor) {
				// The count is certain; only the floor isn't. Placing them on
				// the first floor keeps the unit total exact and understates
				// only Story Logistics — a few minutes — rather than inventing
				// a floor the operator never recorded.
				inventory.standardWindowsByStory.first += quantity;
				notes.push(`${quantity} standard windows had no story recorded — counted on the first floor.`);
			} else {
				inventory.standardWindowsByStory[floor] += quantity;
			}
			if (size && size !== 'Standard') {
				notes.push(
					`${quantity} standard windows were marked ${size}. The simplified inventory has no size for a standard window, so they are counted as ordinary — add them as special items if the size mattered.`
				);
			}
			continue;
		}

		// --- Oversized picture windows: the one size that maps exactly -----
		if (productionClass === 'Large Picture Window' && size === 'Oversized') {
			inventory.specialItems.push(specialItem(group, 'oversized_picture', quantity));
			continue;
		}

		// --- French panes: v2 counted openings, v3 counts panes -------------
		if (productionClass === 'French Panes') {
			const perUnit = num(group['Panes Per Unit']) || paneFactors['French Panes'] || 0;
			if (perUnit === 0) {
				notes.push(
					`${quantity} french-pane units had no pane count, and none could be derived. They are recorded below but not counted — re-enter them as panes.`
				);
				continue;
			}
			const panes = quantity * perUnit;
			inventory.specialItems.push(specialItem(group, 'divided_light_panes', panes));
			notes.push(
				`${quantity} french-pane units × ${perUnit} panes each became ${panes} panes — the simplified inventory counts divided lights as glass, not openings.`
			);
			continue;
		}

		// --- Everything else with an exact reverse mapping ------------------
		const exact = EXACT_SPECIAL[productionClass];
		if (exact) {
			inventory.specialItems.push(specialItem(group, exact, quantity));
			if (size && size !== 'Standard') {
				notes.push(`${quantity} ${productionClass.toLowerCase()} were marked ${size}; that size has no simplified equivalent and was not applied.`);
			}
			continue;
		}

		// --- Specialty Shape: deliberately not guessed ----------------------
		if (productionClass === 'Specialty Shape') {
			inventory.specialItems.push(specialItem(group, 'specialty_shape', quantity));
			if (size && size !== 'Standard') {
				notes.push(
					`${quantity} specialty shapes were marked ${size}. A ${size.toLowerCase()} specialty shape could be a triangle, an arch or a trapezoid, so it was left as a plain specialty shape rather than guessed — change the type if you know which.`
				);
			}
			continue;
		}

		// An unrecognized class. Kept verbatim below; never invented into
		// something priceable.
		notes.push(`${quantity} items of an unrecognized class "${productionClass}" were not mapped. They are recorded below.`);
	}

	// --- Accessories and panes: taken from what was already recorded -------
	inventory.totalGlassPanes = num(totals.glassPanes);
	inventory.screens = num(totals.screens);
	inventory.tracks = num(totals.tracks);

	// --- Access: one property-level selection, only if the groups agreed ---
	const interiorValues = unique(groups.map((g) => g['Interior Access']));
	const exteriorValues = unique(groups.map((g) => g['Exterior Access']));
	const access: LegacyMigration['access'] = {
		interior: interiorValues.length === 1 ? (interiorValues[0] as InteriorAccess) : '',
		exterior: exteriorValues.length === 1 ? (exteriorValues[0] as ExteriorAccess) : '',
	};
	if (interiorValues.length > 1) {
		notes.push(
			`Interior access differed between groups (${interiorValues.join(', ')}). The simplified inventory takes one selection for the whole property, so it was left unset rather than picking one — choose the one that fits.`
		);
	}
	if (exteriorValues.length > 1) {
		notes.push(
			`Exterior access differed between groups (${exteriorValues.join(', ')}). Left unset for the same reason — choose the one that fits.`
		);
	}

	const perGroupAccess = groups
		.filter((g) => g['Interior Access'] || g['Exterior Access'])
		.map((g) => ({
			productionClass: g['Production Class'],
			interior: g['Interior Access'],
			exterior: g['Exterior Access'],
		}));

	return {
		inventory,
		access,
		unmapped: {
			// The original rows, verbatim. This is the guarantee that nothing
			// above can lose anything: whatever the mapping decided, the input
			// is still here to read.
			groups,
			...(perGroupAccess.length > 0 ? { perGroupAccess } : {}),
			...(sizeClasses.length > 0 ? { sizeClasses } : {}),
			...(specialtyDescriptions.length > 0 ? { specialtyDescriptions } : {}),
			...(groupNotes.length > 0 ? { notes: groupNotes } : {}),
		},
		notes,
	};
}

function specialItem(group: LegacyGroupRow, type: SpecialItemType, quantity: number): SpecialItem {
	return {
		id: group['Walkthrough Item ID'] || crypto.randomUUID(),
		type,
		quantity,
		// 'not_applicable' rather than a guessed floor: it charges no story
		// logistics, which is the conservative direction.
		story: STORY_TO_SPECIAL_STORY[group.Story] ?? 'not_applicable',
		notes: group.Notes || undefined,
	};
}

/**
 * The Walkthrough columns a migration writes.
 *
 * Two things it deliberately does NOT touch:
 *
 *  - The original group rows. They stay exactly as the operator entered them
 *    and remain the record of what was actually seen; the migration adds a v3
 *    reading alongside rather than replacing one.
 *  - The stored labor breakdown, hours and price. Those are the estimate that
 *    was actually made and quoted from. Re-deriving a past price from current
 *    logic and calling it the truth is the one thing this app never does.
 *
 * `Total Window Units` IS rewritten, because the two shapes genuinely disagree
 * about what a unit is — v2 counted a french door as one unit, v3 counts its
 * panes as glass and the opening as nothing. Leaving the old number would put
 * a total on the page that the inventory below it visibly contradicts. The
 * previous value is preserved in the legacy blob.
 */
export function migrationColumns(migration: LegacyMigration, previousWindowUnits: string): Record<string, string> {
	const { inventory, access } = migration;
	const standard = Object.values(inventory.standardWindowsByStory).reduce((a, b) => a + b, 0);
	const specialUnits = inventory.specialItems
		.filter((i) => i.type !== 'divided_light_panes')
		.reduce((sum, i) => sum + i.quantity, 0);

	return {
		'Standard Windows First': String(inventory.standardWindowsByStory.first),
		'Standard Windows Second': String(inventory.standardWindowsByStory.second),
		'Standard Windows Third': String(inventory.standardWindowsByStory.third),
		'Standard Windows Fourth Plus': String(inventory.standardWindowsByStory.fourthPlus),
		'Total Window Units': String(standard + specialUnits),
		'Total Solar Panels': String(inventory.solarPanels),
		'Interior Access': access.interior,
		'Exterior Access': access.exterior,
		'Inventory Model': 'inventory-v3',
		'Count Entry Mode': 'inventory',
		'Legacy Window Group Data': JSON.stringify({
			unmapped: { ...migration.unmapped, previousWindowUnits },
			notes: migration.notes,
		}),
	};
}

/** The special items as WalkthroughItem rows. Written alongside the original
 * group rows, never instead of them — after a migration the tab holds both,
 * and the two shapes are told apart by which column is filled. */
export function migrationItemRows(migration: LegacyMigration, walkthroughId: string): Record<string, string>[] {
	return migration.inventory.specialItems.map((item, index) => ({
		id: crypto.randomUUID(),
		'Walkthrough ID': walkthroughId,
		'Special Item Type': item.type,
		Quantity: String(item.quantity),
		Story: item.story,
		Notes: item.notes ?? '',
		'Sort Order': String(index),
	}));
}

/** True when this walkthrough carries preserved legacy inventory — i.e. it
 * was migrated rather than recorded in the simplified shape. Drives the
 * "Previous inventory details" disclosure, which must never appear on a
 * walkthrough that was simply entered the new way. */
export function hasLegacyInventoryDetails(walkthrough: { 'Legacy Window Group Data'?: string }): boolean {
	return Boolean(walkthrough['Legacy Window Group Data']?.trim());
}

export interface StoredLegacyInventory {
	unmapped: LegacyMigration['unmapped'];
	notes: string[];
}

/** Reads the stored blob back. Returns null rather than throwing on damaged
 * JSON: a disclosure that can't render should cost the disclosure, not the
 * whole walkthrough page. */
export function readLegacyInventoryDetails(walkthrough: { 'Legacy Window Group Data'?: string }): StoredLegacyInventory | null {
	const raw = walkthrough['Legacy Window Group Data']?.trim();
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as StoredLegacyInventory;
		return { unmapped: parsed.unmapped ?? { groups: [] }, notes: parsed.notes ?? [] };
	} catch {
		return null;
	}
}
