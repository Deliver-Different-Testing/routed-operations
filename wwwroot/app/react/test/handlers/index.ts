// Default MSW request handlers loaded by the server. Kept minimal here so
// Phase 1 seed tests can start clean; feature-specific handlers should live
// under wwwroot/app/react/test/handlers/<feature>.ts and re-export from
// here as they land.
import type { RequestHandler } from 'msw';

export const handlers: RequestHandler[] = [];
