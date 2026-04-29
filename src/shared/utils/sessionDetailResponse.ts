/**
 * Helpers for the `getSessionDetail` IPC contract.
 *
 * The handler can return either a full `SessionDetail` or a lightweight
 * `SessionDetailUnchanged` sentinel when the renderer's cached fingerprint
 * matches the file on disk. The sentinel lets the renderer skip
 * transformation and re-render entirely on no-op refreshes.
 *
 * Lives in `shared/` so the wire format stays in one place — if anyone
 * changes the discriminator, this is the file (and its test) they touch.
 */

import type { SessionDetail, SessionDetailUnchanged } from '@main/types';

/**
 * Type guard for the `unchanged` IPC sentinel.
 *
 * Discriminates on the literal `unchanged: true` flag. `SessionDetail` has
 * no such field, so a present `unchanged` uniquely identifies the sentinel.
 */
export function isSessionDetailUnchanged(
  response: SessionDetail | SessionDetailUnchanged | null | undefined
): response is SessionDetailUnchanged {
  return (
    !!response &&
    typeof response === 'object' &&
    'unchanged' in response &&
    (response as { unchanged: unknown }).unchanged === true
  );
}
