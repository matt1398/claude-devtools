/**
 * useUsage - polls the backend's `GET /api/usage` endpoint for Claude usage
 * limits (weekly + current-session utilization and reset times).
 *
 * The endpoint returns:
 *   { weekly: { utilization, resets_at } | null,
 *     session: { utilization, resets_at } | null }
 * where `utilization` is a 0–100 percentage and `resets_at` is an ISO string.
 *
 * Base URL resolution mirrors the app's HTTP client (`api/index.ts`
 * `getHttpBaseUrl`): honor an explicit `?port=` (Electron "server mode"),
 * otherwise use `window.location.origin` (standalone/Docker). In Electron IPC
 * mode there is no HTTP origin for this endpoint, so the fetch simply fails and
 * the hook returns null (callers hide the usage segments).
 *
 * Polls every `pollMs` (default 30s) and cleans up the interval on unmount.
 */

import { useEffect, useState } from 'react';

/** One usage window (weekly or current session). */
export interface UsageWindow {
  /** Utilization as a 0–100 percentage. */
  utilization: number;
  /** ISO 8601 timestamp when this window resets. */
  resets_at: string;
}

/** Shape of `GET /api/usage`. */
export interface UsageData {
  weekly: UsageWindow | null;
  session: UsageWindow | null;
}

/** Resolve the HTTP base URL the same way `api/index.ts` does. */
function getUsageBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicitPort = params.get('port');
  if (explicitPort) {
    return `http://127.0.0.1:${parseInt(explicitPort, 10)}`;
  }
  return window.location.origin;
}

/**
 * Fetch + poll Claude usage limits. Returns `null` until the first successful
 * response (and stays `null` if the endpoint is unavailable, e.g. Electron IPC
 * mode), so callers should treat null / null segments as "hide".
 */
export function useUsage(pollMs = 30_000): UsageData | null {
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const base = getUsageBaseUrl();

    const fetchUsage = async (): Promise<void> => {
      try {
        const res = await fetch(`${base}/api/usage`);
        if (!res.ok) return;
        const data = (await res.json()) as UsageData;
        if (!cancelled) setUsage(data);
      } catch {
        // Network/endpoint unavailable — keep the last known value (or null).
      }
    };

    void fetchUsage();
    const id = setInterval(() => void fetchUsage(), pollMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  return usage;
}
