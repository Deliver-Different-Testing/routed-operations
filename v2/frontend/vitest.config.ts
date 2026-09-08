import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src/schedules') } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'], exclude: ['**/node_modules/**', 'src/schedules/features/import-export/__tests__/**', 'src/schedules/features/import-export/engine/__tests__/**'] },
});
