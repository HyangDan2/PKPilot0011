import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PKPilot0011 is published under a GitHub Pages project sub-path.
export default defineConfig({
  base: '/PKPilot0011/',
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true, strictPort: true },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
