// Default MSW request handlers loaded by the server. Kept minimal here so
// Phase 1 seed tests can start clean; feature-specific handlers should live
// under wwwroot/app/react/test/handlers/<feature>.ts and re-export from
// here as they land.
import { http, HttpResponse, type RequestHandler } from 'msw';
import { driverSchedulingHandlers } from './driverScheduling';

export const handlers: RequestHandler[] = [
  // AuthProvider mounts a tenant-drift guard that pings /api/session/current
  // on mount and window focus (see AuthContext.tsx). Echo back the same
  // tenant id + email the test bootstrap seeded into window.__APP_USER__
  // so the guard sees no drift and doesn't try to reload the test tab.
  // Individual tests can override via server.use(...) to simulate drift.
  http.get('/api/session/current', () =>
    HttpResponse.json({ currentTenantId: 1, email: 'test@example.com' })),
  ...driverSchedulingHandlers,
];
