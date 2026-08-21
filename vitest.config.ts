import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vitest config for the React SPA. Kept separate from vite.config.ts because
// (a) the app's Vite config sets base='/dist/' + proxy which don't apply in
// tests, and (b) the aliases + coverage settings vary. Path aliases must
// match tsconfig.json 'paths' so tests import via the same '@/...' spec the
// production bundle uses.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'wwwroot/app/react') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./wwwroot/app/react/test/setup.ts'],
    include: ['wwwroot/app/react/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'wwwroot/dist/**'],
    // CI shared runners are ~10x slower than local dev machines under
    // load (jsdom + msw + React Query + coverage instrumentation stack
    // up). Tests that pass in <500ms locally can push past the default
    // 5s cap in CI, surfacing as false-positive timeouts. Bumped to 15s
    // so real hangs still surface reasonably fast while giving CI enough
    // headroom for the slow-path tests (NewImportWizard walkthrough,
    // ScanManager 150-row pagination, etc). Local runs are unaffected.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      // CI-lean reporters: `text-summary` feeds the GitLab MR coverage
      // regex (`^Lines : XX%`), `cobertura` is the uploaded artifact,
      // `json-summary` is small and consumed by any future dashboard.
      // Dropped `text` (verbose per-file dump - noise on 1942 tests) and
      // `html` (writes ~6 MB of per-file pages that CI never renders).
      // Devs can regenerate the html locally with
      //   `vitest run --coverage --coverage.reporter=html`
      // when they want to inspect uncovered lines in a browser.
      reporter: ['text-summary', 'cobertura', 'json-summary'],
      include: ['wwwroot/app/react/**/*.{ts,tsx}'],
      exclude: [
        'wwwroot/app/react/**/*.{test,spec}.{ts,tsx}',
        'wwwroot/app/react/**/*.testHelpers.{ts,tsx}',
        'wwwroot/app/react/test/**',
        'wwwroot/app/react/index.tsx',
      ],
      // No coverage floor. Kevin's 2026-08-21 call: the 100% coverage
      // goal produced 1942 tests where 30-40% are integration-shaped
      // MSW+full-render+multi-step tests that only reliably run on a
      // developer's local machine (CI slowness turns them into
      // false-positive-fails, see the 4-iteration debug cycle on
      // fix/routeviewer-runs-kms-cast). Removing the threshold means
      // coverage still gets measured + reported to the GitLab MR
      // widget, but a small dip no longer blocks a merge. Devs write
      // tests when they add value, not to feed the number.
      //
      // If a team member wants to re-add a floor as a soft guide (not
      // a hard gate), re-introduce here with realistic numbers and
      // couple with a separate `test:frontend:unit:coverage` job that
      // only fires on merge-to-master (see .gitlab-ci.yml).
    },
  },
});
