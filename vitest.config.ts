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
      // Phase 4 baseline (measured 2026-08-13): set the floor at the current
      // measurement so accidental regressions fail CI. Kevin's Option A target
      // is 100% raw; the floor rises as coverage backfills. Reviewer bumps
      // these numbers when a follow-up MR pushes coverage higher.
      thresholds: {
        // Ratcheted 2026-08-14 after the ToastContext CI fix settled the
        // run at statements/lines 88.35% / branches 81.14% / functions
        // 75.14%. Floors sit ~2pt below the measured baseline so
        // accidental regressions fail CI but small dips do not. Kevin's
        // Option A target is 100% raw; bump floor upward every MR that
        // meaningfully raises coverage.
        lines: 86,
        statements: 86,
        branches: 79,
        functions: 73,
      },
    },
  },
});
