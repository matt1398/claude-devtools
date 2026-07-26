// Browser dev server for the renderer (fast HMR loop, no Electron, WSL-friendly).
//
// Usage:
//   1) Have an API server running on :3456 that reads your ~/.claude. Easiest is
//      the Docker container (docker compose up -d). NOTE: `pnpm standalone` (tsx)
//      currently fails outside Electron — NotificationManager imports `electron`
//      at module load — so use the Docker container (or `pnpm standalone:build &&
//      pnpm standalone:start`) as the API source.
//   2) pnpm web                                          # renderer HMR on :5174
// Then open:  http://localhost:5174/?port=3456
//
// The `?port=3456` tells the renderer's API client (src/renderer/api/index.ts
// getHttpBaseUrl) to hit http://127.0.0.1:3456 directly; the server sends
// permissive CORS (verified: allows the :5174 origin), so no proxy is required.
// Only renderer edits HMR here; main-process/API changes need the API server
// rebuilt/restarted.
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
