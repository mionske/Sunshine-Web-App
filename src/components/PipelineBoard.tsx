import { useState } from 'react';
import { googleMapsUrl } from '../lib/mapsLink';

export interface PipelineCard {
	id: string;
	stage: string;
	clientName: string;
	propertyAddress: string;
	estimatedValue: string;
	nextFollowUpDate: string;
}

export interface PropertyOption {
	id: string;
	label: string;
	address: string;
}

interface Props {
	stages: readonly string[];
	cards: PipelineCard[];
	properties: PropertyOption[];
}

export default function PipelineBoard({ stages, cards: initialCards, properties }: Props) {
	const [cards, setCards] = useState(initialCards);
	const [error, setError] = useState<string | null>(null);
	const [attachingId, setAttachingId] = useState<string | null>(null);

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

	return (
		<div>
			{error && <p role="alert">{error}</p>}
			<div className="pipeline-board">
				{stages.map((stage) => (
					<div
						key={stage}
						className="pipeline-column"
						onDragOver={(e) => e.preventDefault()}
						onDrop={(e) => {
							const id = e.dataTransfer.getData('text/plain');
							if (id) moveCard(id, stage);
						}}
					>
						<h3>
							<span className={`badge${stage === 'Accepted' ? ' badge-accent' : ''}${stage === 'Lost' ? ' badge-lost' : ''}`}>
								{stage}
							</span>
						</h3>
						{cards
							.filter((c) => c.stage === stage)
							.map((c) => (
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
										<button type="button" onClick={() => setAttachingId(c.id)}>
											No property yet — add one
										</button>
									)}
									{c.estimatedValue && <div>${c.estimatedValue}</div>}
									{c.nextFollowUpDate && <div>Follow up: {c.nextFollowUpDate}</div>}
								</div>
							))}
					</div>
				))}
			</div>
		</div>
	);
}
