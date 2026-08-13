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
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'text-summary', 'html', 'cobertura', 'json-summary'],
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
        // Baseline measured 2026-08-13 after Wave 5 ceiling-file push
        // landed 1,676 tests: statements/lines 86.79% / branches 80.81% /
        // functions 74.58%. Floors set below the baseline with a small
        // safety margin so accidental regressions fail CI but small dips
        // do not. Kevin's Option A target is 100% raw; bump floor upward
        // every MR that meaningfully raises coverage.
        lines: 82,
        statements: 82,
        branches: 76,
        functions: 70,
      },
    },
  },
});
