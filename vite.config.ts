import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/dist/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'wwwroot/app/react') },
    // Phase 6 perf: enforce single React copy across all code-split chunks.
    // Without dedupe, Vite can accidentally bundle a second React into a
    // lazy-loaded route chunk (e.g. app-RoutesPage.js), which trips the
    // "Invalid hook call" runtime error at first navigation.
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'https://localhost:5001', changeOrigin: true, secure: false },
    },
  },
  build: {
    outDir: 'wwwroot/dist',
    emptyOutDir: true,
    // Phase 6 perf: prod source maps disabled - they added ~2.1 MB to the
    // shipped dist folder and every deploy uploaded them to S3/CloudFront
    // for no in-browser benefit. Dev mode still gets sourcemaps via the
    // Vite dev server; only the `vite build` output drops them.
    sourcemap: process.env.NODE_ENV === 'production' ? false : true,
    rollupOptions: {
      input: path.resolve(__dirname, 'wwwroot/app/react/index.tsx'),
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app-[name].js',
        assetFileNames: (asset) => {
          if (asset.name && asset.name.endsWith('.css')) return 'app.css';
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
