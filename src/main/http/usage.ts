/**
 * HTTP route handler for Claude usage limits.
 *
 * Routes:
 * - GET /api/usage - Reads the usage cache written by an external collector at
 *   `/tmp/claude_usage_cache.json` and returns the weekly (seven_day) and
 *   session (five_hour) utilization windows.
 *
 * The cache file is already maintained by its writer, so this route performs no
 * caching of its own — it just reads on request. Missing/unreadable/malformed
 * files yield null windows (never an error), so the consumer can render a
 * "no data" state without special-casing HTTP failures.
 *
 * HTTP-only: this endpoint is Electron-mode-agnostic and has no IPC mirror; the
 * renderer consumes it over HTTP in browser/standalone mode.
 */

import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';

import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:usage');

const USAGE_CACHE_PATH = '/tmp/claude_usage_cache.json';

interface UsageWindow {
  utilization: number;
  resets_at: string;
}

interface UsageResponse {
  weekly: UsageWindow | null;
  session: UsageWindow | null;
}

/**
 * Extracts a { utilization, resets_at } window from an unknown value, returning
 * null unless both fields have the expected types.
 */
function parseWindow(raw: unknown): UsageWindow | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { utilization, resets_at: resetsAt } = raw as {
    utilization?: unknown;
    resets_at?: unknown;
  };
  if (typeof utilization === 'number' && typeof resetsAt === 'string') {
    return { utilization, resets_at: resetsAt };
  }
  return null;
}

export function registerUsageRoutes(app: FastifyInstance): void {
  app.get('/api/usage', async (): Promise<UsageResponse> => {
    try {
      const content = fs.readFileSync(USAGE_CACHE_PATH, 'utf8');
      const parsed = JSON.parse(content) as { data?: { five_hour?: unknown; seven_day?: unknown } };
      const data = parsed?.data;
      return {
        weekly: parseWindow(data?.seven_day),
        session: parseWindow(data?.five_hour),
      };
    } catch (error) {
      // Missing/unreadable/malformed cache is expected when the collector hasn't
      // run yet — return null windows rather than surfacing an error.
      logger.debug('Usage cache unavailable:', error);
      return { weekly: null, session: null };
    }
  });
}
