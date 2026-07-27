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
	status: 'uploading' | 'error';
}

export default function PropertyPhotos({ propertyId, photos: initialPhotos }: Props) {
	const [photos, setPhotos] = useState(initialPhotos);
	const [uploading, setUploading] = useState<InFlightUpload[]>([]);
	const [dragActive, setDragActive] = useState(false);

	async function uploadOne(file: File) {
		const tempId = crypto.randomUUID();
		setUploading((prev) => [...prev, { tempId, filename: file.name, status: 'uploading' }]);

		try {
			const formData = new FormData();
			formData.append('propertyId', propertyId);
			formData.append('file', file);
			const res = await fetch('/api/property-photos', { method: 'POST', body: formData });
			if (!res.ok) {
				const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(errorBody.error ?? 'Upload failed');
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
		} catch {
			setUploading((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, status: 'error' } : u)));
		}
	}

	function uploadFiles(fileList: FileList | File[]) {
		for (const file of Array.from(fileList)) {
			if (!file.type.startsWith('image/')) continue;
			uploadOne(file);
		}
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
							{u.status === 'uploading' ? (
								<span className="field-hint">Uploading…</span>
							) : (
								<span className="field-hint">{u.filename} — upload failed</span>
							)}
						</div>
					))}
				</div>
			)}
			{photos.length === 0 && uploading.length === 0 && <p className="field-hint">No photos yet.</p>}
		</div>
	);
}
