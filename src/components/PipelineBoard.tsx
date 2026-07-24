import { useRef, useState, type FormEvent } from 'react';
import { googleMapsUrl } from '../lib/mapsLink';

export interface PipelineCard {
	id: string;
	stage: string;
	clientId: string;
	clientName: string;
	propertyAddress: string;
	estimatedValue: string;
	referralSource: string;
	nextFollowUpDate: string;
}

export interface PropertyOption {
	id: string;
	label: string;
	address: string;
}

export interface ClientOption {
	id: string;
	label: string;
}

interface Props {
	stages: readonly string[];
	cards: PipelineCard[];
	properties: PropertyOption[];
	clients: ClientOption[];
}

const CLOSED_STAGES = new Set(['Accepted', 'Lost']);

type OutcomeFilter = 'active' | 'won' | 'lost' | 'all';
type FollowUpFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
type FollowUpState = 'overdue' | 'today' | 'week' | 'later' | 'none';
type SortKey = 'client' | 'value' | 'followUp' | null;

function num(value: string): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number): string {
	return `$${n.toLocaleString()}`;
}

function daysUntil(iso: string): number | null {
	if (!iso) return null;
	const target = new Date(`${iso}T00:00:00`);
	if (Number.isNaN(target.getTime())) return null;
	const today = new Date(new Date().toDateString());
	return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function followUpState(iso: string): FollowUpState {
	const days = daysUntil(iso);
	if (days === null) return 'none';
	if (days < 0) return 'overdue';
	if (days === 0) return 'today';
	if (days <= 7) return 'week';
	return 'later';
}

function followUpLabel(iso: string, state: FollowUpState): string {
	if (state === 'none') return 'No follow-up set';
	if (state === 'today') return 'Due today';
	const d = new Date(`${iso}T00:00:00`);
	const formatted = `${d.getMonth() + 1}/${d.getDate()}`;
	return state === 'overdue' ? `Overdue · ${formatted}` : formatted;
}

// Only overdue/today/none get distinct colors (matches the redesign's own
// convention) — 'week'/'later' both render as a plain, unstyled date.
function followUpClass(state: FollowUpState): string {
	if (state === 'overdue') return 'followup-overdue';
	if (state === 'today') return 'followup-today';
	if (state === 'none') return 'followup-none';
	return '';
}

export default function PipelineBoard({ stages, cards: initialCards, properties, clients }: Props) {
	const [cards, setCards] = useState(initialCards);
	const [error, setError] = useState<string | null>(null);
	const [attachingId, setAttachingId] = useState<string | null>(null);

	const [view, setView] = useState<'board' | 'list'>('board');
	const [searchTerm, setSearchTerm] = useState('');
	const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('active');
	const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>('all');
	const [sortKey, setSortKey] = useState<SortKey>(null);
	const [sortDir, setSortDir] = useState(1);

	const [showDrawer, setShowDrawer] = useState(false);
	const [formClientId, setFormClientId] = useState(clients[0]?.id ?? '');
	const [formPropertyId, setFormPropertyId] = useState('');
	const [formValue, setFormValue] = useState('');
	const [formDate, setFormDate] = useState('');
	const [formReferral, setFormReferral] = useState('');
	const [creating, setCreating] = useState(false);
	const newButtonRef = useRef<HTMLButtonElement>(null);

	const activeStages = stages.filter((s) => !CLOSED_STAGES.has(s));

	async function moveCard(id: string, stage: string) {
		let lostReason: string | null = null;
		if (stage === 'Lost') {
			lostReason = window.prompt('Reason this opportunity was lost:');
			if (!lostReason) return;
		}

		const patch: Record<string, string> = { Stage: stage };
		if (lostReason) patch['Lost Reason'] = lostReason;

		const previous = cards;
		setCards((current) => current.map((c) => (c.id === id ? { ...c, stage } : c)));
		setError(null);

		const res = await fetch(`/api/pipeline/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ patch }),
		});

		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			setError(body.error ?? 'Failed to update stage');
			setCards(previous);
		}
	}

	async function attachProperty(id: string, propertyId: string, propertyAddress: string) {
		if (!propertyId) return;
		const previous = cards;
		setCards((current) => current.map((c) => (c.id === id ? { ...c, propertyAddress } : c)));
		setError(null);
		setAttachingId(null);

		const res = await fetch(`/api/pipeline/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ patch: { 'Property ID': propertyId } }),
		});

		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			setError(body.error ?? 'Failed to attach property');
			setCards(previous);
		}
	}

	function closeDrawer() {
		setShowDrawer(false);
		setFormPropertyId('');
		setFormValue('');
		setFormDate('');
		setFormReferral('');
		newButtonRef.current?.focus();
	}

	async function createOpportunity(e: FormEvent) {
		e.preventDefault();
		if (!formClientId || creating) return;
		setCreating(true);
		setError(null);
		try {
			const res = await fetch('/api/pipeline', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					'Client ID': formClientId,
					'Property ID': formPropertyId,
					Stage: 'New Lead',
					Status: 'Open',
					'Estimated Value': formValue,
					'Referral Source': formReferral,
					'Next Follow-up Date': formDate,
				}),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? 'Failed to create opportunity');
			}
			const body = (await res.json()) as { row: Record<string, string> };
			const client = clients.find((c) => c.id === formClientId);
			const property = properties.find((p) => p.id === formPropertyId);
			setCards((current) => [
				...current,
				{
					id: body.row['Opportunity ID'],
					stage: 'New Lead',
					clientId: formClientId,
					clientName: client?.label ?? formClientId,
					propertyAddress: property?.address ?? '',
					estimatedValue: formValue,
					referralSource: formReferral,
					nextFollowUpDate: formDate,
				},
			]);
			closeDrawer();
		} catch (createError) {
			setError((createError as Error).message);
		} finally {
			setCreating(false);
		}
	}

	function toggleSort(key: Exclude<SortKey, null>) {
		setSortDir((d) => (sortKey === key ? -d : key === 'value' ? -1 : 1));
		setSortKey(key);
	}

	// Metrics are a fixed business-health snapshot — computed from the full
	// card set restricted to the active-stage set, independent of whatever
	// search/outcome/follow-up filters are currently applied.
	const activeCards = cards.filter((c) => activeStages.includes(c.stage));
	const activeValue = activeCards.reduce((sum, c) => sum + num(c.estimatedValue), 0);
	const followUpsDue = activeCards.filter((c) => ['overdue', 'today'].includes(followUpState(c.nextFollowUpDate))).length;
	const wonCount = cards.filter((c) => c.stage === 'Accepted').length;

	// Search + follow-up filter apply to both views; outcome filter decides
	// which stage columns/rows are visible without altering any stored data.
	const term = searchTerm.trim().toLowerCase();
	const filtered = cards.filter((c) => {
		if (term && !(c.clientName.toLowerCase().includes(term) || c.propertyAddress.toLowerCase().includes(term))) return false;
		if (followUpFilter !== 'all' && followUpState(c.nextFollowUpDate) !== followUpFilter) return false;
		return true;
	});

	const visibleStages =
		outcomeFilter === 'active' ? activeStages : outcomeFilter === 'won' ? ['Accepted'] : outcomeFilter === 'lost' ? ['Lost'] : stages;

	const outcomeMatched = filtered.filter((c) => {
		if (outcomeFilter === 'active') return activeStages.includes(c.stage);
		if (outcomeFilter === 'won') return c.stage === 'Accepted';
		if (outcomeFilter === 'lost') return c.stage === 'Lost';
		return true;
	});

	const hasAnyVisible = visibleStages.some((stage) => outcomeMatched.some((c) => c.stage === stage));

	const listRows = [...outcomeMatched];
	if (sortKey) {
		listRows.sort((a, b) => {
			if (sortKey === 'client') return sortDir * a.clientName.localeCompare(b.clientName);
			if (sortKey === 'value') return sortDir * (num(a.estimatedValue) - num(b.estimatedValue));
			return sortDir * (a.nextFollowUpDate || '9999').localeCompare(b.nextFollowUpDate || '9999');
		});
	}

	return (
		<div>
			{error && <p role="alert">{error}</p>}

			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
				<div />
				<button ref={newButtonRef} type="button" onClick={() => setShowDrawer(true)}>
					+ New Opportunity
				</button>
			</div>

			<div className="pipeline-toolbar">
				<input
					type="text"
					placeholder="Search client, property..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
				/>
				<select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}>
					<option value="active">Active</option>
					<option value="won">Won</option>
					<option value="lost">Lost</option>
					<option value="all">All</option>
				</select>
				<select value={followUpFilter} onChange={(e) => setFollowUpFilter(e.target.value as FollowUpFilter)}>
					<option value="all">All follow-ups</option>
					<option value="overdue">Overdue</option>
					<option value="today">Due today</option>
					<option value="week">Due this week</option>
					<option value="none">No follow-up set</option>
				</select>
				<div className="view-toggle">
					<button type="button" className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>
						Board
					</button>
					<button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
						List
					</button>
				</div>
			</div>

			<div className="stats-grid">
				<div className="card">
					<span className="stat-label">Active opportunities</span>
					<div className="stat">{activeCards.length}</div>
				</div>
				<div className="card">
					<span className="stat-label">Active pipeline value</span>
					<div className="stat">{formatMoney(activeValue)}</div>
				</div>
				<div className="card">
					<span className="stat-label">Follow-ups due</span>
					<div className="stat" style={{ color: followUpsDue > 0 ? 'var(--color-red)' : undefined }}>
						{followUpsDue}
					</div>
				</div>
				<div className="card">
					<span className="stat-label">Won this month</span>
					<div className="stat">{wonCount}</div>
				</div>
			</div>

			{view === 'board' ? (
				hasAnyVisible ? (
					<div className="pipeline-board">
						{visibleStages.map((stage) => {
							const stageCards = outcomeMatched.filter((c) => c.stage === stage);
							const stageValue = stageCards.reduce((sum, c) => sum + num(c.estimatedValue), 0);
							return (
								<div
									key={stage}
									className="pipeline-column"
									onDragOver={(e) => e.preventDefault()}
									onDrop={(e) => {
										const id = e.dataTransfer.getData('text/plain');
										if (id) moveCard(id, stage);
									}}
								>
									<div className="pipeline-column-header">
										<h3>
											<span className={`badge${stage === 'Accepted' ? ' badge-accent' : ''}${stage === 'Lost' ? ' badge-lost' : ''}`}>
												{stage}
											</span>
										</h3>
										<span className="badge">{stageCards.length}</span>
									</div>
									<div className="pipeline-column-value">{formatMoney(stageValue)} estimated</div>

									{stageCards.map((c) => {
										const fs = followUpState(c.nextFollowUpDate);
										return (
											<div
												key={c.id}
												className="pipeline-card"
												draggable
												onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
											>
												<div className="pipeline-card-client">{c.clientName}</div>
												{c.propertyAddress ? (
													<div className="pipeline-card-address">
														<a href={googleMapsUrl(c.propertyAddress)} target="_blank" rel="noopener noreferrer">
															{c.propertyAddress}
														</a>
													</div>
												) : attachingId === c.id ? (
													<select
														autoFocus
														onBlur={() => setAttachingId(null)}
														onChange={(e) => {
															const selected = properties.find((p) => p.id === e.target.value);
															if (selected) attachProperty(c.id, selected.id, selected.address);
														}}
													>
														<option value="">Select a property…</option>
														{properties.map((p) => (
															<option key={p.id} value={p.id}>
																{p.label}
															</option>
														))}
													</select>
												) : (
													<button type="button" className="pipeline-card-add-property" onClick={() => setAttachingId(c.id)}>
														No property yet — add one
													</button>
												)}
												<div className="pipeline-card-footer">
													{num(c.estimatedValue) > 0 && <span className="pipeline-card-value">{formatMoney(num(c.estimatedValue))}</span>}
													<span className={followUpClass(fs)}>{followUpLabel(c.nextFollowUpDate, fs)}</span>
												</div>
											</div>
										);
									})}
									{stageCards.length === 0 && <div className="pipeline-empty-column">No opportunities</div>}
								</div>
							);
						})}
					</div>
				) : (
					<div className="pipeline-empty-board">
						<h3>No active opportunities</h3>
						<p>Create an opportunity when a new lead comes in, then move it through the pipeline as the job progresses.</p>
						<button type="button" onClick={() => setShowDrawer(true)}>
							+ New Opportunity
						</button>
					</div>
				)
			) : (
				<table>
					<thead>
						<tr>
							<th onClick={() => toggleSort('client')} style={{ cursor: 'pointer' }}>
								Client
							</th>
							<th>Property</th>
							<th>Stage</th>
							<th onClick={() => toggleSort('value')} style={{ cursor: 'pointer' }}>
								Value
							</th>
							<th onClick={() => toggleSort('followUp')} style={{ cursor: 'pointer' }}>
								Follow-up
							</th>
							<th>Referral</th>
						</tr>
					</thead>
					<tbody>
						{listRows.map((c) => {
							const fs = followUpState(c.nextFollowUpDate);
							return (
								<tr key={c.id}>
									<td>{c.clientName}</td>
									<td>{c.propertyAddress || '—'}</td>
									<td>
										<span className={`badge${c.stage === 'Accepted' ? ' badge-accent' : ''}${c.stage === 'Lost' ? ' badge-lost' : ''}`}>
											{c.stage}
										</span>
									</td>
									<td>{num(c.estimatedValue) > 0 ? formatMoney(num(c.estimatedValue)) : '—'}</td>
									<td className={followUpClass(fs)}>{followUpLabel(c.nextFollowUpDate, fs)}</td>
									<td>{c.referralSource || '—'}</td>
								</tr>
							);
						})}
						{listRows.length === 0 && (
							<tr>
								<td colSpan={6}>No opportunities match these filters.</td>
							</tr>
						)}
					</tbody>
				</table>
			)}

			{showDrawer && (
				<div
					className="drawer-scrim"
					onClick={closeDrawer}
					onKeyDown={(e) => {
						if (e.key === 'Escape') closeDrawer();
					}}
				>
					<form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={createOpportunity}>
						<div className="drawer-header">
							<h2 style={{ margin: 0 }}>New Opportunity</h2>
							<button type="button" className="drawer-close" aria-label="Close" onClick={closeDrawer}>
								×
							</button>
						</div>

						<label>
							Client
							<select value={formClientId} onChange={(e) => setFormClientId(e.target.value)} required>
								{clients.map((c) => (
									<option key={c.id} value={c.id}>
										{c.label}
									</option>
								))}
							</select>
						</label>

						<label>
							Property
							<select value={formPropertyId} onChange={(e) => setFormPropertyId(e.target.value)}>
								<option value="">— none yet —</option>
								{properties.map((p) => (
									<option key={p.id} value={p.id}>
										{p.label}
									</option>
								))}
							</select>
						</label>
						<span className="field-hint">A property can be attached later.</span>

						<div style={{ display: 'flex', gap: '0.75rem' }}>
							<label style={{ flex: 1 }}>
								Estimated value
								<input type="text" placeholder="$0" value={formValue} onChange={(e) => setFormValue(e.target.value)} />
							</label>
							<label style={{ flex: 1 }}>
								Next follow-up
								<input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
							</label>
						</div>

						<label>
							Referral source
							<input type="text" value={formReferral} onChange={(e) => setFormReferral(e.target.value)} />
						</label>

						<div className="drawer-footer">
							<button type="button" className="btn-secondary" onClick={closeDrawer}>
								Cancel
							</button>
							<button type="submit" disabled={creating}>
								{creating ? 'Creating…' : 'Create Opportunity'}
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
}
