import { listCreateRoutes } from '../../../lib/apiCrud';
import { pipelineConfig } from '../../../lib/models/pipeline';

export const { GET, POST } = listCreateRoutes(pipelineConfig);
