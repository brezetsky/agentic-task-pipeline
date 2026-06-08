import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api (incl. the SSE stream) to the backend so the SPA and
// API share an origin. In production the API serves the built SPA directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
