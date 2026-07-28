import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

// Photo bytes live in R2 (see lib/propertyPhotos.ts), never in the Sheet —
// this tab only ever holds metadata pointing at an R2 object. 'Photo ID' is
// reused as the R2 key's filename component too, so the two are trivially
// cross-referenceable.
export const propertyPhotoSchema = z.object({
	'Photo ID': z.string().min(1),
	'Property ID': blank(),
	'R2 Key': blank(),
	'Original Filename': blank(),
	'Content Type': blank(),
	'Size Bytes': blank(),
	Caption: blank(),
	// PHOTO_CATEGORIES below. Optional — a photo with no category is still a
	// useful photo, and forcing a choice at upload time would slow down the
	// one moment when the phone is already out and the truck is still there.
	Category: blank(),
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

// The things you actually want to look at again before driving out: which
// elevation, how you reach the roof, where the spigot is, which windows are
// going to be a problem.
export const PHOTO_CATEGORIES = [
	'Front Elevation',
	'Rear Elevation',
	'Left Elevation',
	'Right Elevation',
	'Roof Access',
	'Water Access',
	'Difficult Windows',
	'Interior Access',
	'Other',
] as const;

export type PropertyPhoto = z.infer<typeof propertyPhotoSchema>;

export const propertyPhotoConfig: TabConfig<PropertyPhoto> = {
	tab: 'PropertyPhotos',
	idColumn: 'Photo ID',
	requiredColumns: Object.keys(propertyPhotoSchema.shape),
	schema: propertyPhotoSchema,
	entityType: 'PropertyPhoto',
};
