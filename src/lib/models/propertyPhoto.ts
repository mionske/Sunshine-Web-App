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
	'Created At': blank(),
	'Updated At': blank(),
	'Archived At': blank(),
});

export type PropertyPhoto = z.infer<typeof propertyPhotoSchema>;

export const propertyPhotoConfig: TabConfig<PropertyPhoto> = {
	tab: 'PropertyPhotos',
	idColumn: 'Photo ID',
	requiredColumns: Object.keys(propertyPhotoSchema.shape),
	schema: propertyPhotoSchema,
	entityType: 'PropertyPhoto',
};
