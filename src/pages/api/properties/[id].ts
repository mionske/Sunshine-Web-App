import { itemRoutes } from '../../../lib/apiCrud';
import { propertyConfig } from '../../../lib/models/property';

export const { GET, PATCH, DELETE } = itemRoutes(propertyConfig);
