import type { LaborModel } from './config';
import type { AdjustmentKind, PropertyModifier, Severity } from './types';

/**
 * Restoration issues and property-level factors, as a form produces them.
 *
 * This lives in its own module rather than beside the save path because the
 * wizard imports it: the review screen recalculates on every keystroke, and
 * anything it pulls in gets bundled into the browser. walkthroughLabor.ts
 * imports the Sheets client, so importing the resolver from there would ship
 * the whole server data layer to a phone.
 */
export interface AdjustmentInput {
	id: string;
	kind: AdjustmentKind;
	label: string;
	affectedUnits?: string;
	/** Restoration only — how many panes the issue is on. */
	affectedPanes?: string;
	/** Restoration only — how bad it is on those panes. */
	severity?: string;
	notes?: string;
	/**
	 * Legacy: minutes the operator typed in by hand, before restoration was
	 * priced from panes × severity and modifiers from configured flat costs.
	 * Still honoured when present.
	 */
	additionalMinutes?: string;
}

/**
 * What an adjustment costs.
 *
 * Restoration is per affected pane at the recorded severity. It's a rate
 * rather than a multiplier on the glass time because razoring overspray off a
 * pane costs what it costs, whether that pane was otherwise clean or filthy.
 *
 * Property modifiers are a configured flat cost each. Asking someone on a
 * ladder to estimate the minute cost of a long hose run produced a number
 * nobody trusted, so the cost moved to configuration where it can be tuned
 * once against real jobs instead of guessed once per job.
 *
 * A hand-entered value still wins where one exists. That is what keeps a
 * walkthrough recorded under the old form re-reading at the number it was
 * actually quoted at, rather than being silently re-priced by today's rates.
 */
export function adjustmentMinutes(model: LaborModel, adjustment: AdjustmentInput): number {
	const manual = adjustment.additionalMinutes;
	if (manual !== undefined && manual !== '') {
		const value = Number(manual);
		return Number.isFinite(value) && value > 0 ? value : 0;
	}

	if (adjustment.kind === 'Restoration') {
		const panes = Number(adjustment.affectedPanes);
		const rate = model.restorationMinutesPerPane[adjustment.severity as Severity] ?? 0;
		return Number.isFinite(panes) && panes > 0 ? panes * rate : 0;
	}

	return model.propertyModifierMinutes[adjustment.label as PropertyModifier] ?? 0;
}
