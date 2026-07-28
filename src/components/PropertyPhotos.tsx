import { useState } from 'react';

export interface PropertyPhotoDTO {
	id: string;
	filename: string;
	contentType: string;
	sizeBytes: string;
	caption: string;
	createdAt: string;
}

interface Props {
	propertyId: string;
	photos: PropertyPhotoDTO[];
}

interface InFlightUpload {
	tempId: string;
	filename: string;
	status: 'uploading' | 'queued' | 'error';
	error?: string;
	file?: File;
}

export default function PropertyPhotos({ propertyId, photos: initialPhotos }: Props) {
	const [photos, setPhotos] = useState(initialPhotos);
	const [uploading, setUploading] = useState<InFlightUpload[]>([]);
	const [dragActive, setDragActive] = useState(false);

	async function sendOne(tempId: string, file: File): Promise<boolean> {
		setUploading((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, status: 'uploading', error: undefined } : u)));
		try {
			const formData = new FormData();
			formData.append('propertyId', propertyId);
			formData.append('file', file);
			const res = await fetch('/api/property-photos', { method: 'POST', body: formData });
			if (!res.ok) {
				const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errorBody.error ?? `Upload failed (${res.status})`);
			}
			const body = (await res.json()) as { row: Record<string, string> };
			const row = body.row;
			setPhotos((prev) => [
				...prev,
				{
					id: row['Photo ID'],
					filename: row['Original Filename'],
					contentType: row['Content Type'],
					sizeBytes: row['Size Bytes'],
					caption: row.Caption,
					createdAt: row['Created At'],
				},
			]);
			setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
			return true;
		} catch (e) {
			const message = (e as Error).message || 'Upload failed';
			setUploading((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, status: 'error', error: message, file } : u)));
			return false;
		}
	}

	/** Uploads run ONE AT A TIME, deliberately.
	 *
	 * Each upload appends a row to a Google Sheet, and appending is a
	 * read-then-write: the server reads the sheet to find the first empty
	 * row, then writes there. Firing a whole camera roll off in parallel
	 * meant every request read the same sheet state, picked the same row,
	 * and overwrote the one before it — the image bytes all landed in R2 but
	 * most of their metadata rows were lost, so the photos came back as
	 * broken thumbnails. Sequential uploads also keep a big batch from
	 * tripping the Sheets per-minute read quota.
	 *
	 * A phone batch is a handful of files, so the wall-clock cost is small
	 * next to silently losing photos. */
	async function uploadFiles(fileList: FileList | File[]) {
		const images = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
		if (images.length === 0) return;

		const queued = images.map((file) => ({ tempId: crypto.randomUUID(), file }));
		setUploading((prev) => [...prev, ...queued.map((q) => ({ tempId: q.tempId, filename: q.file.name, status: 'queued' as const }))]);

		for (const { tempId, file } of queued) {
			await sendOne(tempId, file);
		}
	}

	async function retryUpload(tempId: string, file: File) {
		await sendOne(tempId, file);
	}

	async function deletePhoto(id: string) {
		const previous = photos;
		setPhotos((prev) => prev.filter((p) => p.id !== id));
		const res = await fetch(`/api/property-photos/${id}`, { method: 'DELETE' });
		if (!res.ok) setPhotos(previous);
	}

	return (
		<div>
			<div
				className={`photo-dropzone${dragActive ? ' photo-dropzone-active' : ''}`}
				onDragOver={(e) => {
					e.preventDefault();
					setDragActive(true);
				}}
				onDragLeave={() => setDragActive(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragActive(false);
					uploadFiles(e.dataTransfer.files);
				}}
			>
				<label className="photo-dropzone-label">
					Tap to choose photos or drag files here
					<input
						type="file"
						multiple
						accept="image/*"
						style={{ display: 'none' }}
						onChange={(e) => {
							if (e.target.files) uploadFiles(e.target.files);
							e.target.value = '';
						}}
					/>
				</label>
			</div>

			{(photos.length > 0 || uploading.length > 0) && (
				<div className="photo-grid">
					{photos.map((p) => (
						<div key={p.id} className="photo-tile">
							<img src={`/api/property-photos/${p.id}/file`} alt={p.caption || p.filename} loading="lazy" />
							<button type="button" className="photo-tile-delete" aria-label="Delete photo" onClick={() => deletePhoto(p.id)}>
								×
							</button>
						</div>
					))}
					{uploading.map((u) => (
						<div key={u.tempId} className="photo-tile photo-tile-pending">
							{u.status === 'uploading' && <span className="field-hint">Uploading {u.filename}…</span>}
							{u.status === 'queued' && <span className="field-hint">{u.filename} — waiting</span>}
							{u.status === 'error' && (
								<>
									<span className="field-hint">
										{u.filename} — {u.error ?? 'upload failed'}
									</span>
									{u.file && (
										<button type="button" className="btn-secondary" onClick={() => retryUpload(u.tempId, u.file!)}>
											Retry
										</button>
									)}
								</>
							)}
						</div>
					))}
				</div>
			)}
			{photos.length === 0 && uploading.length === 0 && <p className="field-hint">No photos yet.</p>}
		</div>
	);
}
