/**
 * Process-wide accessor for the active SessionTailer.
 *
 * The tailer is owned and lifecycle-managed by the entry point (index.ts / standalone.ts)
 * and swapped on context switch. IPC handlers need to register streaming baselines but
 * must not import the entry point (that would create an import cycle), so they reach the
 * current tailer through this small decoupled holder instead.
 */

import type { SessionTailer } from './SessionTailer';

let active: SessionTailer | null = null;

/** Sets (or clears) the process-wide active SessionTailer. */
export function setActiveSessionTailer(tailer: SessionTailer | null): void {
  active = tailer;
}

/** Returns the active SessionTailer, or null before wiring / in headless assemblies. */
export function getActiveSessionTailer(): SessionTailer | null {
  return active;
}
