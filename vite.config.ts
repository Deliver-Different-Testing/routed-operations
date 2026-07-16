import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/dist/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'wwwroot/app/react') },
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
    sourcemap: true,
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
