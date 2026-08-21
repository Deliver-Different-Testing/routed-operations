// Vitest bootstrap. Loaded before every test file via vitest.config.ts
// setupFiles. Extends `expect` with @testing-library/jest-dom matchers,
// wires the MSW server lifecycle, and stubs the Razor-emitted
// window.__APP_USER__ blob so useAuth() has a sensible default.
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// Bump findBy* / waitFor default timeout from 1000ms to 5000ms.
// GitLab's shared runners are ~15x slower than local dev machines under
// load (measured 2026-08-21: local full suite ~28s, CI ~471s = 17x).
// The vitest.config.ts testTimeout=15000 catches the outer test hang,
// but per-assertion findBy* uses testing-library's own asyncUtilTimeout
// which defaults to 1s regardless of the vitest test cap. That default
// races routes-fetch -> selectedRouteId effect -> roster-fetch -> React
// re-render on CI and false-positive-fails tests that pass in <500ms
// locally. Real hangs still surface at 5s, well before the 15s outer
// vitest kill.
configure({ asyncUtilTimeout: 5000 });

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
