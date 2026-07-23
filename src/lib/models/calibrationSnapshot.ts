import { z } from 'zod';
import type { TabConfig } from '../sheets';

const blank = () => z.coerce.string().default('');

export const CONFIDENCE_LEVELS = [
	'Insufficient data',
	'Early directional data',
	'Moderate confidence',
	'Strong internal benchmark',
] as const;

export const calibrationSnapshotSchema = z.object({
	'Calibration Snapshot ID': z.string().min(1),
	'Generated At': blank(),
	'Calculator Version': blank(),
	'Completed Job Count': blank(),
	'Comparable Job Count': blank(),
	'Observed Revenue Per Hour': blank(),
	'Median Revenue Per Hour': blank(),
	'Average Estimate Variance': blank(),
	'Median Estimate Variance': blank(),
	'Average Minutes Per Pane': blank(),
	'Average Minutes Per Window': blank(),
	'Average Windows-to-Panes Ratio': blank(),
	'Confidence Level': z.enum(CONFIDENCE_LEVELS).default('Insufficient data'),
	'Date Range Start': blank(),
	'Date Range End': blank(),
	Notes: blank(),
});

export type CalibrationSnapshot = z.infer<typeof calibrationSnapshotSchema>;

export const calibrationSnapshotConfig: TabConfig<CalibrationSnapshot> = {
	tab: 'CalibrationSnapshot',
	idColumn: 'Calibration Snapshot ID',
	requiredColumns: Object.keys(calibrationSnapshotSchema.shape),
	schema: calibrationSnapshotSchema,
	entityType: 'CalibrationSnapshot',
};
