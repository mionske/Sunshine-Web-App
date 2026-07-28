import { describe, expect, it } from 'vitest';
import { resolveLaborModel } from './config';
import { SEED_LABOR_CONFIG, SEED_WINDOW_PRODUCTION_PROFILES } from './seed';
import { adjustmentMinutes, type AdjustmentInput } from './adjustments';
import type { LaborConfig } from '../models/laborConfig';
import type { WindowProductionProfile } from '../models/windowProductionProfile';

const TIMESTAMPS = { 'Created At': '', 'Updated At': '', 'Archived At': '' };
const MODEL = resolveLaborModel(
	{ ...SEED_LABOR_CONFIG, ...TIMESTAMPS } as LaborConfig,
	SEED_WINDOW_PRODUCTION_PROFILES.map((p) => ({ ...p, ...TIMESTAMPS })) as WindowProductionProfile[]
);

function restoration(overrides: Partial<AdjustmentInput> = {}): AdjustmentInput {
	return { id: 'a', kind: 'Restoration', label: 'Paint Overspray', ...overrides };
}

function modifier(label: string): AdjustmentInput {
	return { id: 'm', kind: 'Modifier', label };
}

describe('restoration costs panes × severity', () => {
	it('prices the panes it was told about, at the severity it was told', () => {
		expect(adjustmentMinutes(MODEL, restoration({ affectedPanes: '12', severity: 'Heavy' }))).toBe(144);
		expect(adjustmentMinutes(MODEL, restoration({ affectedPanes: '12', severity: 'Moderate' }))).toBe(60);
		expect(adjustmentMinutes(MODEL, restoration({ affectedPanes: '12', severity: 'Light' }))).toBe(30);
	});

	it('scales with the pane count, not the property', () => {
		// A four-pane sunroom and a whole south elevation must not cost the
		// same — pricing restoration off a checkbox is how a restoration job
		// gets underquoted.
		const few = adjustmentMinutes(MODEL, restoration({ affectedPanes: '4', severity: 'Heavy' }));
		const many = adjustmentMinutes(MODEL, restoration({ affectedPanes: '40', severity: 'Heavy' }));
		expect(many).toBe(few * 10);
	});

	it('costs nothing until it has been described', () => {
		// Checked but not yet counted is a note to self, not a price.
		expect(adjustmentMinutes(MODEL, restoration())).toBe(0);
		expect(adjustmentMinutes(MODEL, restoration({ affectedPanes: '12' }))).toBe(0);
		expect(adjustmentMinutes(MODEL, restoration({ severity: 'Heavy' }))).toBe(0);
	});

	it('treats a nonsense pane count as zero rather than NaN', () => {
		expect(adjustmentMinutes(MODEL, restoration({ affectedPanes: '-5', severity: 'Heavy' }))).toBe(0);
		expect(adjustmentMinutes(MODEL, restoration({ affectedPanes: 'lots', severity: 'Heavy' }))).toBe(0);
	});

	it('ignores an unrecognized severity instead of guessing one', () => {
		expect(adjustmentMinutes(MODEL, restoration({ affectedPanes: '12', severity: 'Catastrophic' }))).toBe(0);
	});
});

describe('property modifiers cost a configured flat rate', () => {
	it('reads each modifier from its own configured value', () => {
		expect(adjustmentMinutes(MODEL, modifier('Long Equipment Carry'))).toBe(15);
		expect(adjustmentMinutes(MODEL, modifier('Furniture or Object Moving'))).toBe(25);
	});

	it('charges nothing for Other, which has no knowable cost', () => {
		// A default here would be a guess presented as a calculation.
		expect(adjustmentMinutes(MODEL, modifier('Other Modifier'))).toBe(0);
	});

	it('charges nothing for a label the configuration has never heard of', () => {
		expect(adjustmentMinutes(MODEL, modifier('Alligators'))).toBe(0);
	});

	it('does not depend on how many windows there are', () => {
		// These are whole-job costs. Nothing in this function can see the
		// inventory, which is the point.
		expect(adjustmentMinutes(MODEL, modifier('Multiple Setup Zones'))).toBe(20);
	});
});

describe('a hand-entered value still wins', () => {
	it('re-reads an older walkthrough at the number it was quoted at', () => {
		// Rows written before restoration was priced from panes × severity
		// carry the operator's own minutes. Re-pricing them from today's
		// config would quietly restate a past quote.
		const legacy = restoration({ affectedPanes: '12', severity: 'Heavy', additionalMinutes: '45' });
		expect(adjustmentMinutes(MODEL, legacy)).toBe(45);
	});

	it('applies to modifiers too', () => {
		expect(adjustmentMinutes(MODEL, { ...modifier('Long Equipment Carry'), additionalMinutes: '90' })).toBe(90);
	});

	it('treats a blank as absent rather than as zero', () => {
		const blank = restoration({ affectedPanes: '12', severity: 'Heavy', additionalMinutes: '' });
		expect(adjustmentMinutes(MODEL, blank)).toBe(144);
	});
});
