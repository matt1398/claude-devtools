/**
 * Native JSONL reader wrapper with graceful fallback.
 *
 * Uses the Rust napi-rs module for fast I/O (memory-mapped file read + line
 * splitting), then pipes raw JSON strings through the existing JS
 * `parseJsonlLine()` for field mapping. This keeps the semantic parsing
 * logic in one place while getting ~5-10x faster file I/O.
 */

import { createLogger } from '@shared/utils/logger';
import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

import { parseJsonlLine } from './jsonl';

import type { ParsedMessage } from '../types';

const logger = createLogger('Util:nativeJsonl');

// ---------------------------------------------------------------------------
// Dynamic native module loading
// ---------------------------------------------------------------------------

interface NativeSessionChunksResult {
  chunks: Record<string, unknown>[];
  metrics: Record<string, unknown>;
  messageCount: number;
}

interface NativeModule {
  readJsonlLines: (path: string) => string[];
  readJsonlLinesIncremental: (
    path: string,
    byteOffset: number
  ) => { lines: string[]; newOffset: number };
  buildSessionChunks: (path: string) => NativeSessionChunksResult;
}

let nativeModule: NativeModule | null = null;
let loadAttempted = false;

function tryLoadNativeModule(): NativeModule | null {
  if (loadAttempted) return nativeModule;
  loadAttempted = true;

  const platform = process.platform;
  const arch = process.arch;
  const abi = platform === 'linux' ? 'gnu' : '';
  const nodeName = `index.${platform}-${arch}${abi ? '-' + abi : ''}.node`;

  const candidates: string[] = [];
  if (app.isPackaged) {
    const basePath = app.getAppPath();
    candidates.push(
      join(basePath, '..', 'app.asar.unpacked', 'dist-electron', nodeName),
      join(basePath, 'dist-electron', nodeName)
    );
  } else {
    candidates.push(
      join(__dirname, '..', nodeName),
      join(process.cwd(), 'dist-electron', nodeName)
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, security/detect-non-literal-require -- native .node modules must use dynamic require
        const mod = require(candidate) as NativeModule;
        logger.info(`Native JSONL reader loaded from ${candidate}`);
        nativeModule = mod;
        return mod;
      } catch (err) {
        logger.warn(`Failed to load native module from ${candidate}:`, err);
      }
    }
  }

  logger.info('Native JSONL reader not available — using JS fallback');
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Whether the native reader is available on this platform. */
export function isNativeAvailable(): boolean {
  return tryLoadNativeModule() !== null;
}

// ---------------------------------------------------------------------------
// Post-processing: convert Rust output to match JS type expectations
// ---------------------------------------------------------------------------

/** Convert ISO-8601 timestamp string to Date object. */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return new Date();
}

/** Return a copy of a ParsedMessage-shaped object with timestamp as Date. */
function withFixedTimestamp(msg: Record<string, unknown>): Record<string, unknown> {
  if (msg && typeof msg === 'object' && 'timestamp' in msg) {
    return { ...msg, timestamp: toDate(msg.timestamp) };
  }
  return msg;
}

/** Convert a Rust Chunk to match the JS EnhancedChunk interface. */
function convertChunk(raw: Record<string, unknown>): Record<string, unknown> {
  const chunk: Record<string, unknown> = {
    ...raw,
    startTime: toDate(raw.startTime),
    endTime: toDate(raw.endTime),
  };

  // Convert nested ParsedMessage timestamps
  if (chunk.userMessage && typeof chunk.userMessage === 'object') {
    chunk.userMessage = withFixedTimestamp(chunk.userMessage as Record<string, unknown>);
  }
  if (chunk.message && typeof chunk.message === 'object') {
    chunk.message = withFixedTimestamp(chunk.message as Record<string, unknown>);
  }
  if (Array.isArray(chunk.responses)) {
    chunk.responses = (chunk.responses as Record<string, unknown>[]).map((r) =>
      r && typeof r === 'object' ? withFixedTimestamp(r) : r
    );
  }
  if (Array.isArray(chunk.sidechainMessages)) {
    chunk.sidechainMessages = (chunk.sidechainMessages as Record<string, unknown>[]).map((m) =>
      m && typeof m === 'object' ? withFixedTimestamp(m) : m
    );
  }

  // Convert semantic step timestamps (field names already correct from serde)
  if (Array.isArray(chunk.semanticSteps)) {
    chunk.semanticSteps = (chunk.semanticSteps as Record<string, unknown>[]).map((step) => ({
      ...step,
      ...(step.startTime ? { startTime: toDate(step.startTime) } : {}),
      ...(step.endTime ? { endTime: toDate(step.endTime) } : {}),
    }));
  }

  // Convert tool execution timestamps
  if (Array.isArray(chunk.toolExecutions)) {
    chunk.toolExecutions = (chunk.toolExecutions as Record<string, unknown>[]).map((te) => ({
      ...te,
      ...(te.startTime ? { startTime: toDate(te.startTime) } : {}),
      ...(te.endTime ? { endTime: toDate(te.endTime) } : {}),
    }));
  }

  return chunk;
}

// Metrics field names are now correct from serde — no conversion needed.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface ConvertedSessionChunks {
  chunks: unknown[];
  metrics: unknown;
  messageCount: number;
}

/**
 * Build session chunks entirely in Rust (Phase 2) with JS post-processing.
 *
 * Rust handles: JSONL read → classify → chunk → tool executions → semantic steps.
 * JS post-processing converts: string timestamps → Date objects, field name fixes.
 *
 * Returns null if the native module is unavailable or the call fails.
 */
export function buildSessionChunksNative(filePath: string): ConvertedSessionChunks | null {
  const mod = tryLoadNativeModule();
  if (!mod) return null;

  try {
    const raw = mod.buildSessionChunks(filePath);
    if (!raw || !Array.isArray(raw.chunks)) return null;

    // Post-process: convert timestamp strings → Date objects
    // (field names are already correct from serde — no renaming needed)
    const chunks = raw.chunks.map(convertChunk);

    return { chunks, metrics: raw.metrics, messageCount: raw.messageCount };
  } catch (err) {
    logger.warn('Native buildSessionChunks failed, falling back to JS:', err);
    return null;
  }
}

/**
 * Parse a JSONL file using native I/O + JS field mapping.
 *
 * Rust reads the file via mmap and splits lines (~5-10x faster than readline).
 * Each raw JSON line is then parsed by the existing `parseJsonlLine()` which
 * handles all the ChatHistoryEntry → ParsedMessage conversion.
 *
 * Returns null if the native module is unavailable.
 */
export function parseJsonlFileNative(filePath: string): ParsedMessage[] | null {
  const mod = tryLoadNativeModule();
  if (!mod) return null;

  try {
    const rawLines = mod.readJsonlLines(filePath);
    const messages: ParsedMessage[] = [];

    for (const line of rawLines) {
      try {
        const parsed = parseJsonlLine(line);
        if (parsed) {
          messages.push(parsed);
        }
      } catch {
        // Skip malformed lines (same as JS fallback)
      }
    }

    return messages;
  } catch (err) {
    logger.warn('Native read failed, returning null for JS fallback:', err);
    return null;
  }
}

/**
 * Read JSONL lines incrementally from a byte offset using native I/O.
 *
 * Returns the raw JSON strings and the new byte offset, or null if the
 * native module is unavailable or there are no new lines.
 */
export function readJsonlLinesIncremental(
  filePath: string,
  byteOffset: number
): { lines: string[]; newOffset: number } | null {
  const mod = tryLoadNativeModule();
  if (!mod) return null;

  try {
    const result = mod.readJsonlLinesIncremental(filePath, byteOffset);
    if (!result || result.lines.length === 0) return null;
    return result;
  } catch (err) {
    logger.warn('Native incremental read failed:', err);
    return null;
  }
}
