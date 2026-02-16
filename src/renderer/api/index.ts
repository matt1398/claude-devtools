/**
 * Unified API adapter.
 *
 * When running inside Electron, the preload script exposes `window.electronAPI`.
 * When running in a browser (e.g. via the HTTP server), we fall back to an
 * HTTP+SSE client that implements the same interface.
 *
 * All renderer code should import `api` from this module instead of
 * accessing `window.electronAPI` directly.
 *
 * The instance is resolved lazily on first property access so that test code
 * can install mocks on `window.electronAPI` before the adapter resolves.
 */

import { HttpAPIClient } from './httpClient';

import type { ElectronAPI } from '@shared/types/api';

/**
 * Resolves the base URL for the HTTP API client.
 *
 * - Electron "server mode" (browser opened via ?port=XXXX): use explicit port on 127.0.0.1
 * - Standalone/Docker (page served by the same server): use window.location.origin
 *   to avoid cross-origin issues (localhost vs 127.0.0.1)
 */
function getHttpBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicitPort = params.get('port');
  if (explicitPort) {
    return `http://127.0.0.1:${parseInt(explicitPort, 10)}`;
  }
  return window.location.origin;
}

let httpClient: HttpAPIClient | null = null;

function getImpl(): ElectronAPI {
  if (window.electronAPI) return window.electronAPI;
  // Lazily create the HTTP client only when actually needed (browser mode).
  // Caching avoids creating multiple EventSource connections.
  if (!httpClient) {
    httpClient = new HttpAPIClient(getHttpBaseUrl());
  }
  return httpClient;
}

/**
 * Proxy that lazily resolves the underlying ElectronAPI on first property access.
 * In Electron: delegates to `window.electronAPI` (set by preload).
 * In browser: delegates to `HttpAPIClient` (created on first use).
 * In tests: delegates to whatever mock is installed on `window.electronAPI`.
 */
/**
 * Whether the app is running inside Electron (true) or in a browser via HTTP server (false).
 * Use this to hide Electron-only UI (settings, traffic lights, etc.) in browser mode.
 */
export const isElectronMode = (): boolean => !!window.electronAPI;

export const api: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop, receiver) {
    const impl = getImpl();
    const value = Reflect.get(impl, prop, receiver) as unknown;
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(impl);
    }
    return value;
  },
});
