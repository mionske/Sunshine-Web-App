import { describe, expect, it } from 'vitest';
import {
	hasLegacyInventoryDetails,
	migrateGroupsToInventory,
	migrationColumns,
	migrationItemRows,
	readLegacyInventoryDetails,
	type LegacyGroupRow,
} from './legacyInventory';

function group(overrides: Partial<LegacyGroupRow> = {}): LegacyGroupRow {
	return {
		'Walkthrough Item ID': crypto.randomUUID(),
		'Production Class': 'Standard Window',
		Quantity: '1',
		'Size Class': '',
		Story: 'First',
		'Interior Access': '',
		'Exterior Access': '',
		'Panes Per Unit': '',
		'Screens Per Unit': '',
		'Tracks Per Unit': '',
		'Specialty Description': '',
		Notes: '',
		...overrides,
	};
}

const NO_TOTALS = { glassPanes: '', screens: '', tracks: '' };

describe('4. conservative migration of legacy window groups', () => {
	it('places standard windows on the floor they were recorded on', () => {
		const result = migrateGroupsToInventory(
			[
				group({ Quantity: '24', Story: 'First' }),
				group({ Quantity: '14', Story: 'Second' }),
				group({ Quantity: '6', Story: 'Third' }),
			],
			NO_TOTALS
		);

		expect(result.inventory.standardWindowsByStory).toEqual({ first: 24, second: 14, third: 6, fourthPlus: 0 });
		expect(result.notes).toEqual([]);
	});

	it('maps only the special types whose reverse is unambiguous', () => {
		const result = migrateGroupsToInventory(
			[
				group({ 'Production Class': 'Large Picture Window', Quantity: '2' }),
				group({ 'Production Class': 'Large Picture Window', 'Size Class': 'Oversized', Quantity: '3' }),
				group({ 'Production Class': 'Sliding Door', Quantity: '2' }),
				group({ 'Production Class': 'Skylight', Quantity: '1', Story: 'Third' }),
			],
			NO_TOTALS
		);

		expect(result.inventory.specialItems.map((i) => [i.type, i.quantity])).toEqual([
			['large_picture', 2],
			['oversized_picture', 3],
			['sliding_glass_door', 2],
			['skylight', 1],
		]);
	});

	it('converts french-pane openings into panes using the recorded pane count', () => {
		const result = migrateGroupsToInventory([group({ 'Production Class': 'French Panes', Quantity: '3', 'Panes Per Unit': '6' })], NO_TOTALS);

		expect(result.inventory.specialItems[0]).toMatchObject({ type: 'divided_light_panes', quantity: 18 });
		expect(result.notes.join(' ')).toContain('became 18 panes');
	});

	it('falls back to the model pane factor, and refuses to invent one', () => {
		const withFactor = migrateGroupsToInventory(
			[group({ 'Production Class': 'French Panes', Quantity: '2' })],
			NO_TOTALS,
			{ 'French Panes': 9 }
		);
		expect(withFactor.inventory.specialItems[0].quantity).toBe(18);

		const withoutFactor = migrateGroupsToInventory([group({ 'Production Class': 'French Panes', Quantity: '2' })], NO_TOTALS);
		expect(withoutFactor.inventory.specialItems).toEqual([]);
		expect(withoutFactor.notes.join(' ')).toContain('re-enter them as panes');
	});

	it('never guesses a shape for a sized specialty group', () => {
		// large_triangle, small_triangle and bay_bow all map FORWARD onto
		// Specialty Shape, so mapping back would assert a shape nobody wrote
		// down.
		const result = migrateGroupsToInventory(
			[group({ 'Production Class': 'Specialty Shape', 'Size Class': 'Large', Quantity: '2', 'Specialty Description': 'Arched transom' })],
			NO_TOTALS
		);

		expect(result.inventory.specialItems[0].type).toBe('specialty_shape');
		expect(result.notes.join(' ')).toContain('rather than guessed');
		expect(result.unmapped.sizeClasses).toEqual([{ productionClass: 'Specialty Shape', sizeClass: 'Large', quantity: '2' }]);
	});

	it('keeps the unit count exact when a group has no story, and says so', () => {
		const result = migrateGroupsToInventory([group({ Quantity: '9', Story: '' })], NO_TOTALS);

		expect(result.inventory.standardWindowsByStory.first).toBe(9);
		expect(result.notes.join(' ')).toContain('no story recorded');
	});

	it('takes one access selection only when every group agreed', () => {
		const agreed = migrateGroupsToInventory(
			[group({ 'Exterior Access': 'Extended WFP' }), group({ 'Exterior Access': 'Extended WFP' })],
			NO_TOTALS
		);
		expect(agreed.access.exterior).toBe('Extended WFP');
		expect(agreed.notes).toEqual([]);

		const disagreed = migrateGroupsToInventory(
			[group({ 'Exterior Access': 'Extended WFP' }), group({ 'Exterior Access': 'Roof Access' })],
			NO_TOTALS
		);
		expect(disagreed.access.exterior).toBe('');
		expect(disagreed.notes.join(' ')).toContain('differed between groups');
	});

	it('reads accessories and panes from the totals the walkthrough already recorded', () => {
		const result = migrateGroupsToInventory([group({ Quantity: '44' })], { glassPanes: '77', screens: '44', tracks: '30' });

		expect(result.inventory.totalGlassPanes).toBe(77);
		expect(result.inventory.screens).toBe(44);
		expect(result.inventory.tracks).toBe(30);
	});

	it('biases every ambiguous case downward — a migration never quotes higher', () => {
		// A large specialty shape and an oversized standard window both lose
		// their size premium rather than gaining a guessed one.
		const result = migrateGroupsToInventory(
			[
				group({ 'Production Class': 'Specialty Shape', 'Size Class': 'Large', Quantity: '1' }),
				group({ 'Size Class': 'Oversized', Quantity: '4' }),
			],
			NO_TOTALS
		);

		expect(result.inventory.specialItems[0].type).toBe('specialty_shape');
		expect(result.inventory.standardWindowsByStory.first).toBe(4);
		expect(result.access).toEqual({ interior: '', exterior: '' });
	});

	it('charges no story logistics for a special item whose story does not map', () => {
		const result = migrateGroupsToInventory([group({ 'Production Class': 'Skylight', Quantity: '1', Story: '' })], NO_TOTALS);
		expect(result.inventory.specialItems[0].story).toBe('not_applicable');
	});
});

describe('5. preservation of unmapped legacy data', () => {
	const GROUPS = [
		group({
			'Production Class': 'Specialty Shape',
			'Size Class': 'Large',
			Quantity: '2',
			Story: 'Second',
			'Interior Access': 'Extension Ladder',
			'Exterior Access': 'Difficult Ladder Positioning',
			'Specialty Description': 'Arched transom over the entry',
			Notes: 'Reachable only from the landing.',
		}),
		group({
			Quantity: '10',
			'Interior Access': 'Floor Level',
			'Exterior Access': 'Standard WFP',
			'Screens Per Unit': '1',
			'Tracks Per Unit': '2',
			Notes: 'Storms come off first.',
		}),
	];

	const result = migrateGroupsToInventory(GROUPS, { glassPanes: '40', screens: '10', tracks: '20' });

	it('keeps every original group row verbatim', () => {
		// The guarantee that nothing the mapping decided can lose anything:
		// the input is still there to read, byte for byte.
		expect(result.unmapped.groups).toEqual(GROUPS);
	});

	it('keeps the per-group access selections the single property-level pair cannot hold', () => {
		expect(result.unmapped.perGroupAccess).toEqual([
			{ productionClass: 'Specialty Shape', interior: 'Extension Ladder', exterior: 'Difficult Ladder Positioning' },
			{ productionClass: 'Standard Window', interior: 'Floor Level', exterior: 'Standard WFP' },
		]);
	});

	it('keeps sizes, specialty descriptions and notes', () => {
		expect(result.unmapped.sizeClasses).toEqual([{ productionClass: 'Specialty Shape', sizeClass: 'Large', quantity: '2' }]);
		expect(result.unmapped.specialtyDescriptions).toEqual(['Arched transom over the entry']);
		expect(result.unmapped.notes).toEqual(['Reachable only from the landing.', 'Storms come off first.']);
	});

	it('survives a JSON round trip, which is how it is actually stored', () => {
		const stored = JSON.stringify({ unmapped: result.unmapped, notes: result.notes });
		const read = readLegacyInventoryDetails({ 'Legacy Window Group Data': stored });

		expect(read?.unmapped.groups).toEqual(GROUPS);
		expect(read?.notes).toEqual(result.notes);
	});

	it('omits empty sections rather than storing empty arrays', () => {
		const plain = migrateGroupsToInventory([group({ Quantity: '5' })], NO_TOTALS);
		expect(plain.unmapped.sizeClasses).toBeUndefined();
		expect(plain.unmapped.specialtyDescriptions).toBeUndefined();
		expect(plain.unmapped.notes).toBeUndefined();
		expect(plain.unmapped.perGroupAccess).toBeUndefined();
	});

	it('a group with a zero quantity still survives in the preserved rows', () => {
		// Skipped for pricing, never dropped from the record.
		const zero = group({ Quantity: '0', Notes: 'Removed by the owner before we quoted.' });
		const result = migrateGroupsToInventory([zero], NO_TOTALS);

		expect(result.inventory.standardWindowsByStory.first).toBe(0);
		expect(result.unmapped.groups).toEqual([zero]);
	});
});

describe('what a migration writes, and what it refuses to touch', () => {
	const migration = migrateGroupsToInventory(
		[
			group({ Quantity: '24', Story: 'First' }),
			group({ 'Production Class': 'Large Picture Window', 'Size Class': 'Oversized', Quantity: '3', Story: 'Third' }),
			group({ 'Production Class': 'French Panes', Quantity: '2', 'Panes Per Unit': '9' }),
		],
		{ glassPanes: '61', screens: '44', tracks: '' }
	);
	const columns = migrationColumns(migration, '29');

	it('writes the per-floor counts and the property-level access', () => {
		expect(columns).toMatchObject({
			'Standard Windows First': '24',
			'Standard Windows Second': '0',
			'Inventory Model': 'inventory-v3',
			'Count Entry Mode': 'inventory',
		});
	});

	it('recounts window units the v3 way, and keeps the old number', () => {
		// v2 counted a french door as a unit; v3 counts its panes as glass and
		// the opening as nothing. 24 standard + 3 oversized = 27, not 29.
		expect(columns['Total Window Units']).toBe('27');
		expect(JSON.parse(columns['Legacy Window Group Data']).unmapped.previousWindowUnits).toBe('29');
	});

	it('never writes an hours or price column', () => {
		// Those are the estimate that was actually made and quoted from.
		// Re-deriving a past price from today's logic is the one thing this
		// app never does.
		const forbidden = [
			'Productive Labor Minutes',
			'Scheduled Minutes',
			'Estimated On-Site Labor Hours',
			'Suggested Low Price',
			'Suggested Target Price',
			'Suggested High Price',
			'Owner Override Price',
			'Labor Breakdown (JSON)',
		];
		for (const column of forbidden) expect(columns).not.toHaveProperty(column);
	});

	it('never writes a WalkthroughItem column that belongs to a group row', () => {
		// The original rows have to survive the migration untouched, so the
		// new rows must be a different shape rather than an overwrite.
		const rows = migrationItemRows(migration, 'w1');
		for (const row of rows) {
			expect(row).not.toHaveProperty('Production Class');
			expect(row['Special Item Type']).toBeTruthy();
			expect(row['Walkthrough ID']).toBe('w1');
		}
	});

	it('writes one row per special item, with divided lights counted in panes', () => {
		const rows = migrationItemRows(migration, 'w1');
		expect(rows.map((r) => [r['Special Item Type'], r.Quantity])).toEqual([
			['oversized_picture', '3'],
			['divided_light_panes', '18'],
		]);
	});

	it('gives every new row its own id, so none can collide with an original', () => {
		const rows = migrationItemRows(migration, 'w1');
		expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
	});
});

describe('6. the legacy disclosure appears only on a migrated walkthrough', () => {
	it('shows for a walkthrough carrying preserved legacy data', () => {
		expect(hasLegacyInventoryDetails({ 'Legacy Window Group Data': '{"unmapped":{"groups":[]},"notes":[]}' })).toBe(true);
	});

	it('does not show for one entered in the simplified shape', () => {
		expect(hasLegacyInventoryDetails({ 'Legacy Window Group Data': '' })).toBe(false);
		expect(hasLegacyInventoryDetails({})).toBe(false);
	});

	it('does not show for a column holding only whitespace', () => {
		expect(hasLegacyInventoryDetails({ 'Legacy Window Group Data': '   ' })).toBe(false);
	});

	it('costs the disclosure, not the page, when the stored JSON is damaged', () => {
		expect(readLegacyInventoryDetails({ 'Legacy Window Group Data': '{not json' })).toBeNull();
	});

	it('tolerates a blob missing its sections', () => {
		const read = readLegacyInventoryDetails({ 'Legacy Window Group Data': '{}' });
		expect(read).toEqual({ unmapped: { groups: [] }, notes: [] });
	});
});
