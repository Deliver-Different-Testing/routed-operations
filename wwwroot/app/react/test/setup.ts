// Vitest bootstrap. Loaded before every test file via vitest.config.ts
// setupFiles. Extends `expect` with @testing-library/jest-dom matchers,
// wires the MSW server lifecycle, and stubs the Razor-emitted
// window.__APP_USER__ blob so useAuth() has a sensible default.
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// MSW server lifecycle. Any handler declared per-test via
// server.use(...) is reset after each test so state doesn't leak.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Default AppUser bootstrap. Individual tests can override by re-assigning
// window.__APP_USER__ before rendering a component under test.
(globalThis as any).window ??= globalThis;
(window as any).__APP_USER__ = {
  currentTenantId: 1,
  fullName: 'Test User',
  email: 'test@example.com',
  timeZone: 'Pacific/Auckland',
  countryCode: 'NZ',
  isUsTenant: false,
  isInternal: false,
  hereMapsApiKey: null,
  googleMapsKey: null,
  isNetworkPartner: false,
  npAgentId: null,
  clientTypeId: null,
  contactId: null,
  clientId: null,
  clientCount: null,
  clientString: null,
  despatchWebBaseUrl: null,
};
