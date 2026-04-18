/**
 * useSubagentMessages — lazy-loads a subagent's full message body.
 *
 * Used by SubagentItem on inline expansion. The worker output now ships
 * subagents with `messages: []` to bound memory; this hook pulls the body
 * over IPC the first time it's needed and caches it in the renderer-side
 * `subagentMessageCacheSlice`.
 *
 * Returns a small status object the component can use to render:
 * skeleton during load, error message on failure, or the parsed messages.
 *
 * Usage:
 *   const { messages, isLoading, error } = useSubagentMessages(
 *     enabled, projectId, sessionId, subagentId
 *   );
 *
 * Pass `enabled=false` to defer the fetch until the user actually expands
 * the subagent — avoids spamming IPC for collapsed cards.
 */

import { useEffect } from 'react';

import { useStore } from '@renderer/store';

import type { ParsedMessage } from '@renderer/types/data';

export interface UseSubagentMessagesResult {
  messages: ParsedMessage[] | null;
  isLoading: boolean;
  error: string | null;
}

export function useSubagentMessages(
  enabled: boolean,
  projectId: string | null,
  sessionId: string | null,
  subagentId: string
): UseSubagentMessagesResult {
  // Subscribe narrowly so unrelated cache mutations don't re-render us.
  const messages = useStore((s) => s.subagentMessageCache.get(subagentId)?.messages ?? null);
  const isLoading = useStore((s) => s.loadingSubagentIds.has(subagentId));
  const error = useStore((s) => s.subagentMessageErrors.get(subagentId) ?? null);
  const loadSubagentMessages = useStore((s) => s.loadSubagentMessages);

  useEffect(() => {
    if (!enabled) return;
    if (!projectId || !sessionId) return;
    if (messages !== null) return; // already cached
    if (isLoading) return; // already in flight
    void loadSubagentMessages(projectId, sessionId, subagentId);
  }, [enabled, projectId, sessionId, subagentId, messages, isLoading, loadSubagentMessages]);

  return { messages, isLoading, error };
}
