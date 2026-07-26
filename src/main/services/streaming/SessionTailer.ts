/**
 * SessionTailer - streams newly-appended JSONL entries for currently-open sessions.
 *
 * The FileWatcher already detects per-file changes and emits `file-change`. That
 * event tells the renderer "something changed"; historically the renderer reacted by
 * re-fetching and re-parsing the WHOLE session file. SessionTailer makes updates truly
 * incremental: for a session the user currently has open (one with a registered
 * baseline byte-offset), it reads only the bytes appended since the last emission,
 * parses the complete lines, and emits a `session-append` delta.
 *
 * Baseline registration ties into `getSessionDetail`: when that route reads a session
 * file to establish the renderer's initial view, it calls `setBaseline(sessionId, path,
 * byteLength)` so streaming begins exactly where the initial load ended.
 *
 * Only baselined (open) sessions are tailed. Background sessions fall through to the
 * existing `file-change` flow, which keeps memory bounded (soft LRU cap) and avoids
 * streaming for sessions nobody is watching.
 */

import {
  type ChatHistoryEntry,
  type FileChangeEvent,
  type ParsedMessage,
  type Process,
  type SessionAppendEvent,
} from '@main/types';
import { parseChatHistoryEntries, parseJsonlFile } from '@main/utils/jsonl';
import { createLogger } from '@shared/utils/logger';
import { EventEmitter } from 'events';

import { ChunkBuilder } from '../analysis/ChunkBuilder';

import type { FileSystemProvider } from '../infrastructure/FileSystemProvider';

const logger = createLogger('Service:SessionTailer');

/** Soft cap on tracked open sessions; oldest (LRU) is evicted past this. */
const MAX_TRACKED_SESSIONS = 8;

export type { SessionAppendEvent };

/** Per-session tail state. */
interface TailState {
  path: string;
  projectId?: string;
  /** Total bytes read from the file so far (== last observed size we consumed to). */
  offset: number;
  /** Buffered incomplete trailing line (bytes read but not yet a complete line). */
  partial: string;
  /** Birthtime fingerprint to detect file replacement/rewrite (inode not exposed by provider). */
  birthtimeMs: number;
  /**
   * Cached parsed-message list for this open session — the full message history seen
   * so far. Seeded by `primeMessages` (from `getSessionDetail`, which already parsed
   * them) and grown by appending each delta's parsed entries. Rebuilding chunks from
   * this in-memory list is the win: no disk read, no re-JSON.parse of old entries.
   * `undefined` until seeded or lazily reconstructed on first append.
   */
  messages?: ParsedMessage[];
  /**
   * Resolved subagents for the session, reused when rebuilding chunks. Subagents
   * discovered mid-stream are NOT re-resolved here (that needs disk reads); they
   * surface on the next full `getSessionDetail`. Empty on the lazy-reconstruct path.
   */
  subagents: Process[];
}

export class SessionTailer extends EventEmitter {
  /** Insertion-ordered map used as an LRU (most-recently-baselined last). */
  private readonly sessions = new Map<string, TailState>();
  private fsProvider: FileSystemProvider;
  /** Stateless: `buildChunks(messages, subagents)` uses no fs/instance state. */
  private readonly chunkBuilder = new ChunkBuilder();

  constructor(fsProvider: FileSystemProvider) {
    super();
    this.fsProvider = fsProvider;
  }

  /**
   * Swaps the filesystem provider (e.g. on local <-> SSH context switch). Callers
   * should also `clear()` baselines, since offsets from one context don't apply to another.
   */
  setFileSystemProvider(provider: FileSystemProvider): void {
    this.fsProvider = provider;
  }

  /**
   * Registers (or refreshes) the streaming baseline for a session. Called from the
   * `getSessionDetail` path with the byte length that was read to build the initial
   * view, so the first `session-append` starts exactly where that load ended.
   */
  setBaseline(sessionId: string, filePath: string, byteLength: number, projectId?: string): void {
    const existing = this.sessions.get(sessionId);
    // Re-insert to move to the MRU end of the LRU map.
    this.sessions.delete(sessionId);

    // Preserve the parsed-message cache across a re-arm (cache-hit / fingerprint-match
    // re-baseline) when it still describes the same file at the same offset. A moved
    // offset means the cache is stale relative to the new baseline, so drop it and let
    // the next append re-seed (via primeMessages) or lazily reconstruct.
    const preserve =
      existing !== undefined && existing.path === filePath && existing.offset === byteLength;

    // stat is async; baseline just needs the offset. Birthtime is captured lazily on the
    // first change instead of blocking this call — a 0 sentinel means "not yet captured".
    this.sessions.set(sessionId, {
      path: filePath,
      projectId,
      offset: byteLength,
      partial: preserve ? existing.partial : '',
      birthtimeMs: preserve ? existing.birthtimeMs : 0,
      messages: preserve ? existing.messages : undefined,
      subagents: preserve ? existing.subagents : [],
    });

    this.evictIfNeeded();
    logger.info(`SessionTailer: baseline set for ${sessionId} at offset ${byteLength}`);
  }

  /**
   * Seeds the parsed-message cache for a baselined session from the messages
   * `getSessionDetail` already parsed. This lets the first (and every) append rebuild
   * chunks purely in-memory — no disk read, no re-JSON.parse. No-op if the session
   * isn't currently baselined (nothing to attach the cache to).
   */
  primeMessages(sessionId: string, messages: ParsedMessage[], subagents: Process[]): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }
    // Copy so later mutation (appending deltas) can't leak into caller-owned arrays.
    state.messages = [...messages];
    state.subagents = subagents;
  }

  /** Drops a session's tail state (e.g. on unlink or when the user closes it). */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Drops all tail state (e.g. on context switch). */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Processes a FileWatcher `file-change` event. For a baselined, non-subagent session
   * file that grew, emits a `session-append` delta. On truncation/rewrite it re-anchors
   * and emits nothing (the still-broadcast `file-change` is the renderer's reload signal).
   * Non-baselined sessions are ignored.
   */
  async handleFileChange(event: FileChangeEvent): Promise<void> {
    const { sessionId, isSubagent, type } = event;
    if (!sessionId || isSubagent) {
      return;
    }

    // Unlink: forget the session; the file-change already tells the renderer.
    if (type === 'unlink') {
      this.sessions.delete(sessionId);
      return;
    }

    const state = this.sessions.get(sessionId);
    if (!state) {
      // Not an open/baselined session — let the normal file-change flow handle it.
      return;
    }

    try {
      const stats = await this.fsProvider.stat(event.path);
      const size = stats.size;

      // Detect file replacement/rewrite via birthtime change (inode unavailable through
      // the provider). Also treat a shrink as truncation. Either way: re-anchor, no delta.
      const birthChanged =
        state.birthtimeMs !== 0 &&
        typeof stats.birthtimeMs === 'number' &&
        stats.birthtimeMs !== state.birthtimeMs;

      if (size < state.offset || birthChanged) {
        // Re-anchor to the current end so we don't spew the whole file as a delta in the
        // window before the renderer refetches (it will, off the broadcast file-change).
        state.offset = size;
        state.partial = '';
        state.birthtimeMs =
          typeof stats.birthtimeMs === 'number' ? stats.birthtimeMs : state.birthtimeMs;
        logger.info(`SessionTailer: truncation/rewrite on ${sessionId}; re-anchored at ${size}`);
        return;
      }

      // First change after baseline: capture the birthtime fingerprint.
      if (state.birthtimeMs === 0 && typeof stats.birthtimeMs === 'number') {
        state.birthtimeMs = stats.birthtimeMs;
      }

      if (size <= state.offset) {
        // No new bytes (e.g. a metadata-only touch).
        return;
      }

      const baseOffset = state.offset - Buffer.byteLength(state.partial, 'utf8');
      const { entries, partial } = await this.readAppended(event.path, state.offset, state.partial);

      state.offset = size;
      state.partial = partial;

      if (entries.length === 0) {
        // Only a partial (incomplete) line arrived; wait for it to complete.
        return;
      }

      const tailOffset = state.offset - Buffer.byteLength(state.partial, 'utf8');

      // Grow the in-memory message list, then rebuild chunks from it. This is the
      // whole point: chunks are produced WITHOUT re-reading the file and WITHOUT
      // re-JSON.parsing already-seen entries.
      const chunks = await this.rebuildChunks(state, entries);

      const payload: SessionAppendEvent = {
        sessionId,
        projectId: state.projectId ?? event.projectId,
        entries,
        chunks,
        baseOffset,
        tailOffset,
      };
      this.emit('session-append', payload);
      logger.info(
        `SessionTailer: ${entries.length} appended ${entries.length === 1 ? 'entry' : 'entries'} for ${sessionId} (${baseOffset}->${tailOffset})`
      );
    } catch (err) {
      logger.error(`SessionTailer: error tailing ${sessionId}:`, err);
    }
  }

  /**
   * Reads bytes [startOffset, EOF), prepends the buffered partial line, splits on '\n',
   * and JSON-parses each complete line. The trailing element (if the buffer didn't end in
   * a newline) becomes the new partial. Malformed/blank lines are skipped.
   */
  private async readAppended(
    filePath: string,
    startOffset: number,
    priorPartial: string
  ): Promise<{ entries: ChatHistoryEntry[]; partial: string }> {
    const stream = this.fsProvider.createReadStream(filePath, {
      start: startOffset,
      encoding: 'utf8',
    });

    let buffer = priorPartial;
    const entries: ChatHistoryEntry[] = [];

    for await (const chunk of stream) {
      buffer += chunk;
      const lines = buffer.split('\n');
      // Last element is an incomplete line (or '' if the chunk ended on a newline).
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line.trim()) {
          continue;
        }
        try {
          entries.push(JSON.parse(line) as ChatHistoryEntry);
        } catch {
          // Malformed appended line; skip. A later full refetch recovers if needed.
        }
      }
    }

    return { entries, partial: buffer };
  }

  /**
   * Grows the session's cached parsed-message list with `newEntries` and rebuilds the
   * full chunk array from it — the same `EnhancedChunk[]` shape `getSessionDetail`
   * returns, so the renderer applies both identically.
   *
   * Fast path (seeded via `primeMessages`): parse only the new entries in-memory and
   * append them, then rebuild chunks. No disk IO, no re-parse of prior entries.
   *
   * Fallback (never seeded, or LRU-evicted then re-armed): reconstruct the message list
   * once by reading+parsing the whole file. This full parse happens at most once per
   * (re)baseline — subsequent appends are back on the fast path. Subagents are unknown
   * on this path (empty), so mid-stream subagent links appear only on the next full
   * fetch; correctness degrades to today's behavior, never worse.
   */
  private async rebuildChunks(
    state: TailState,
    newEntries: ChatHistoryEntry[]
  ): Promise<ReturnType<ChunkBuilder['buildChunks']>> {
    if (!state.messages) {
      // Reading to EOF already includes newEntries — this replaces the list wholesale.
      state.messages = await parseJsonlFile(state.path, this.fsProvider);
    } else {
      // Append-only, exactly mirroring parseJsonlFile: every complete new line becomes a
      // message (no uuid dedup — streaming updates append same-uuid lines that the full
      // parse also keeps, and exact byte-offset tracking guarantees no line is re-read).
      state.messages.push(...parseChatHistoryEntries(newEntries));
    }

    return this.chunkBuilder.buildChunks(state.messages, state.subagents);
  }

  /** Evicts the least-recently-baselined session past the soft cap. */
  private evictIfNeeded(): void {
    while (this.sessions.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.sessions.delete(oldest);
    }
  }
}
