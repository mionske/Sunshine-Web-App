/**
 * Tab and edit-group state for the property workspace.
 *
 * Lives here rather than inline in the page so it can be tested: URL state
 * that silently falls back to the wrong panel, or that lets two cards edit at
 * once, is exactly the kind of thing that looks fine until someone loses a
 * form's worth of typing.
 */

export const PROPERTY_TABS = [
	{ key: 'overview', label: 'Overview' },
	{ key: 'access', label: 'Access & Setup' },
	{ key: 'inventory', label: 'Inventory' },
	{ key: 'photos', label: 'Photos' },
	{ key: 'notes', label: 'Notes' },
	{ key: 'walkthroughs', label: 'Walkthroughs' },
	{ key: 'quotes', label: 'Quotes' },
	{ key: 'jobs', label: 'Jobs' },
	{ key: 'history', label: 'History' },
] as const;

export type PropertyTabKey = (typeof PROPERTY_TABS)[number]['key'];

/** The whole-record form, kept as a fallback while per-group editing beds
 * in. Deliberately not in PROPERTY_TABS — it has no rail entry. */
export const FALLBACK_EDIT_TAB = 'edit';

/** Which groups can be in edit mode, and which tab each belongs to. A group
 * requested from the wrong tab is ignored rather than rendered orphaned. */
export const EDIT_GROUPS: Record<string, PropertyTabKey> = {
	record: 'overview',
	access: 'access',
	considerations: 'access',
	water: 'access',
	parking: 'access',
	'access-notes': 'access',
	inventory: 'inventory',
	notes: 'notes',
};

export interface PropertyViewState {
	tab: PropertyTabKey | typeof FALLBACK_EDIT_TAB;
	/** Empty string means nothing is editing — the resting state. */
	editingGroup: string;
}

/**
 * Resolves `?tab=` and `?edit=` into the state the page renders.
 *
 * Both fall back rather than error: a stale bookmark, a hand-typed URL or a
 * link from an older version of the app should land somewhere sensible, not
 * on an empty panel.
 */
export function resolvePropertyView(params: URLSearchParams): PropertyViewState {
	const requestedTab = params.get('tab') ?? '';
	const tab: PropertyViewState['tab'] =
		requestedTab === FALLBACK_EDIT_TAB
			? FALLBACK_EDIT_TAB
			: (PROPERTY_TABS.find((t) => t.key === requestedTab)?.key ?? 'overview');

	// An edit group only counts on its own tab. Without this, ?tab=notes&
	// edit=water would put the Water card into edit mode on a panel that
	// doesn't render it — the form would exist, be unreachable, and quietly
	// swallow the Cancel link's job.
	const requestedGroup = params.get('edit') ?? '';
	const editingGroup = EDIT_GROUPS[requestedGroup] === tab ? requestedGroup : '';

	return { tab, editingGroup };
}
