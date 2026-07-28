// The vocabulary of the labor model, in one place.
//
// Every option set here is stored in Sheets as its display string (the same
// convention every other model in this app follows) — no separate code/label
// mapping to keep in sync, and a human reading the spreadsheet sees words
// rather than enum keys.

/**
 * How a group of windows is classified for labor purposes.
 *
 * Deliberately NOT architectural window type. A standard casement and a
 * standard double-hung take about the same time to clean, so asking which one
 * a window is would be field busywork that changes no number. A 5x8 picture
 * window, a sliding door, and a wall of french panes genuinely do differ — so
 * those get their own classes. This is the owner's own framing.
 */
export const PRODUCTION_CLASSES = [
	'Standard Window',
	'Large Picture Window',
	'Specialty Shape',
	'Sliding Door',
	'French Panes',
	'Skylight',
] as const;
export type ProductionClass = (typeof PRODUCTION_CLASSES)[number];

/** Short helper text shown under the class picker in the field. */
export const PRODUCTION_CLASS_HINTS: Record<ProductionClass, string> = {
	'Standard Window': 'Casements, double-hungs, sliders, awnings — anything ordinary-sized.',
	'Large Picture Window': 'Big fixed glass. A 5x8 picture window is a different job from a casement.',
	'Specialty Shape': 'Triangle, arch, trapezoid — shapes that slow down edge work.',
	'Sliding Door': 'Patio or comparable door-sized glass unit.',
	'French Panes': 'Divided-light units. Labor scales with the number of small panes.',
	Skylight: 'Roof or ceiling glass. Labor is driven mostly by how you reach it.',
};

/**
 * Optional. Left blank for the ordinary case — only set when a group is
 * meaningfully bigger or smaller than typical for its class, which is why
 * there is no 'Unknown' member and blank is a legitimate stored value.
 */
export const SIZE_CLASSES = ['Small', 'Standard', 'Large', 'Oversized'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/** Recorded for reporting and scheduling. Access, not story, is the labor driver. */
export const STORIES = ['First', 'Second', 'Third', 'Fourth+'] as const;
export type Story = (typeof STORIES)[number];

// --- Simplified inventory (v3) ----------------------------------------------
//
// A 15-to-20-minute walkthrough can't classify every opening. The v3 model
// assumes a window is ordinary unless the operator says otherwise: standard
// units are counted per floor, and only genuinely unusual windows and doors
// are described individually.
//
// The cost of that speed, stated plainly because it is a real trade: access
// is now chosen once for the property rather than per group, so a handful of
// awkward third-floor windows no longer stand apart from the easy ones.

/** The floors standard windows are counted on. */
export const STANDARD_FLOORS = ['first', 'second', 'third', 'fourthPlus'] as const;
export type StandardFloor = (typeof STANDARD_FLOORS)[number];

export const STANDARD_FLOOR_LABELS: Record<StandardFloor, string> = {
	first: 'First floor',
	second: 'Second floor',
	third: 'Third floor',
	fourthPlus: 'Fourth floor or higher',
};

/** Only things meaningfully different from a normal window belong here —
 * "Standard Window" is deliberately absent, since those are counted by floor. */
export const SPECIAL_ITEM_TYPES = [
	'large_picture',
	'oversized_picture',
	'sliding_glass_door',
	'divided_light_panes',
	'skylight',
	'large_triangle',
	'small_triangle',
	'specialty_shape',
	'bay_bow',
	'custom',
] as const;
export type SpecialItemType = (typeof SPECIAL_ITEM_TYPES)[number];

export const SPECIAL_ITEM_LABELS: Record<SpecialItemType, string> = {
	large_picture: 'Large picture window',
	oversized_picture: 'Oversized picture window',
	sliding_glass_door: 'Sliding glass door',
	divided_light_panes: 'French or divided-light panes',
	skylight: 'Skylight',
	large_triangle: 'Large triangular window',
	small_triangle: 'Small triangular window',
	specialty_shape: 'Specialty shape',
	bay_bow: 'Bay or bow window',
	custom: 'Custom',
};

/**
 * The one type whose quantity means panes rather than units.
 *
 * It is counted separately everywhere: divided-light quantities feed the pane
 * picture, never the window-unit total, because eighteen small panes in one
 * french door is one opening to set up at and eighteen pieces of glass to
 * clean.
 */
export const PANE_COUNTED_TYPE: SpecialItemType = 'divided_light_panes';

export function specialItemUnitLabel(type: SpecialItemType): string {
	return type === PANE_COUNTED_TYPE ? 'panes' : 'units';
}

/** Where a special item sits. Wider than STANDARD_FLOORS because a skylight
 * is on the roof and a bay window can span floors. */
export const SPECIAL_ITEM_STORIES = ['first', 'second', 'third', 'fourth_plus', 'roof', 'multiple', 'not_applicable'] as const;
export type SpecialItemStory = (typeof SPECIAL_ITEM_STORIES)[number];

export const SPECIAL_ITEM_STORY_LABELS: Record<SpecialItemStory, string> = {
	first: 'First floor',
	second: 'Second floor',
	third: 'Third floor',
	fourth_plus: 'Fourth floor or higher',
	roof: 'Roof',
	multiple: 'Multiple floors',
	not_applicable: 'Not applicable',
};

export const INTERIOR_ACCESS_LEVELS = [
	'Floor Level',
	'Step Ladder',
	'Extension Ladder',
	'Pole Work',
	'Vaulted or Obstructed',
	'Technical Interior Access',
] as const;
export type InteriorAccess = (typeof INTERIOR_ACCESS_LEVELS)[number];

export const EXTERIOR_ACCESS_LEVELS = [
	'Ground-Level Traditional',
	'Standard WFP',
	'Extended WFP',
	'Standard Ladder',
	'Difficult Ladder Positioning',
	'Roof Access',
	'Technical Exterior Access',
] as const;
export type ExteriorAccess = (typeof EXTERIOR_ACCESS_LEVELS)[number];

/**
 * One scale, applied per component. Deliberately the same four levels as
 * GLASS_CONDITION_LEVELS in models/walkthrough.ts — this is the same idea,
 * just now asked once per component rather than once per job.
 */
export const COMPONENT_CONDITIONS = ['Maintenance', 'Light Buildup', 'Moderate Buildup', 'Heavy Buildup'] as const;
export type ComponentCondition = (typeof COMPONENT_CONDITIONS)[number];

export const COMPONENT_CONDITION_HINTS: Record<ComponentCondition, string> = {
	Maintenance: 'Recently serviced or minimal buildup. Standard process.',
	'Light Buildup': 'Dust, fingerprints, pollen, minor debris. Little extra agitation.',
	'Moderate Buildup': 'Film, webs, organic debris, dirty edges. Extra agitation and detailing.',
	'Heavy Buildup': 'Thick soil, heavy organic debris, neglected components.',
};

/**
 * Restoration is specialized work beyond a standard cleaning — it supplements
 * the component condition ratings rather than replacing them. A two-year-old
 * house with construction residue is not "Heavy Buildup"; it is a light-dirt
 * job that also needs a razor.
 *
 * Stored one row per selected service in the WalkthroughLaborAdjustments tab,
 * each carrying its own affected counts and minutes — restoration rarely
 * applies to every window, and a checkbox alone can't say how much.
 */
export const RESTORATION_SERVICES = [
	'Construction Debris',
	'Stickers or Adhesive',
	'Paint Overspray',
	'Hard Water or Mineral Deposits',
	'Razor Scraping',
	'Steel Wool or Fine Abrasive',
	'Non-Scratch Pad Work',
	'Other Restoration',
] as const;
export type RestorationService = (typeof RESTORATION_SERVICES)[number];

/**
 * Whole-property labor that isn't attributable to any one window group.
 * Nothing here should duplicate work already covered by fixed job overhead
 * (arrival, setup, inspection, breakdown) — these are the exceptions, not the
 * routine.
 */
export const PROPERTY_MODIFIERS = [
	'Heavy Cobweb Removal',
	'Difficult Hose Routing',
	'Tight Landscaping',
	'Furniture or Object Moving',
	'Delicate Interior Surfaces',
	'Delicate Landscaping',
	'Multiple Setup Zones',
	'Long Equipment Carry',
	'Limited Water Access',
	'Condition Varies by Area',
	'Other Modifier',
] as const;
export type PropertyModifier = (typeof PROPERTY_MODIFIERS)[number];

/** Discriminator for the shared WalkthroughLaborAdjustments tab. */
export const ADJUSTMENT_KINDS = ['Restoration', 'Modifier'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const SCHEDULE_RECOMMENDATIONS = ['One-Day Job', 'Two-Day Job', 'Crew Recommended', 'Owner Decision'] as const;
export type ScheduleRecommendation = (typeof SCHEDULE_RECOMMENDATIONS)[number];

/**
 * Which inventory shape a walkthrough was recorded in. Blank reads as legacy:
 * every walkthrough written before the grouped model existed keeps its stored
 * numbers and its original pricing path untouched, and is labeled "Legacy
 * aggregate estimate" rather than being back-filled with invented window
 * classes, sizes, or component conditions.
 */
export const INVENTORY_MODELS = ['legacy-aggregate', 'grouped-v2'] as const;
export type InventoryModel = (typeof INVENTORY_MODELS)[number];
