import { listCreateRoutes } from '../../../lib/apiCrud';
import { clientConfig } from '../../../lib/models/client';

export const { GET, POST } = listCreateRoutes(clientConfig);
