import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/routebuilder/',
  plugins: [react()],
  resolve: {
    // `@/…` is used by the vendored schedules module (Dane's admin-schedules-module)
    alias: { '@': path.resolve(__dirname, 'src/schedules') },
  },
  server: { port: 4595, host: '0.0.0.0' },
  build: { outDir: 'dist', emptyOutDir: true },
});
