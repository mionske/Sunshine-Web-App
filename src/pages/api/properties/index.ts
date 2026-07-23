import { listCreateRoutes } from '../../../lib/apiCrud';
import { propertyConfig } from '../../../lib/models/property';

export const { GET, POST } = listCreateRoutes(propertyConfig);
