import { defineConfig, devices } from '@playwright/test';

// Playwright config for the Route Viewer E2E suite. Boots vite dev on
// port 5173 (which auto-injects a Dev User via index.html), then routes
// intercept every /api/* request so no real backend or DB is required.
//
// Setup (one-time per clone):
//   npm install
//   npx playwright install chromium
//
// Run:
//   npm run test:e2e
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    // vite.config.ts sets base='/dist/' for the ASP.NET static-files
    // hosting model - override to '/' for E2E so react-router paths
    // like /route-viewer resolve without a /dist prefix that the
    // in-app router does not know about.
    command: 'npx vite --base=/ --port=5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
