import { itemRoutes } from '../../../lib/apiCrud';
import { clientConfig } from '../../../lib/models/client';

export const { GET, PATCH, DELETE } = itemRoutes(clientConfig);
