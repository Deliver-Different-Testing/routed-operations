import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/routebuilder/',
  plugins: [react()],
  server: { port: 4595, host: '0.0.0.0' },
  build: { outDir: 'dist', emptyOutDir: true },
});
