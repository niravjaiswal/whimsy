import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    // API_PROXY lets the dev UI run against a deployed backend.
    proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:8787', changeOrigin: true } },
  },
});
