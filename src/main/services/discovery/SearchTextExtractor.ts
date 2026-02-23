/**
 * SearchTextExtractor - Lightweight text extraction for search.
 *
 * Mirrors ChunkBuilder's classification loop (classifyMessages → buffer flush)
 * but only extracts searchable text + metadata, skipping all expensive operations:
 * - No tool execution building
 * - No semantic step extraction
 * - No subagent linking
 * - No timeline gap filling
 * - No metrics calculation
 */

import { classifyMessages } from '@main/services/parsing/MessageClassifier';
import { sanitizeDisplayContent } from '@shared/utils/contentSanitizer';

import type { ParsedMessage } from '@main/types';

/**
 * A lightweight entry containing only the data needed for search matching.
 */
export interface SearchableEntry {
  text: string;
  groupId: string;
  messageType: 'user' | 'assistant';
  itemType: 'user' | 'ai';
  timestamp: number;
  messageUuid: string;
}

/**
 * Result of extracting searchable text from a session's messages.
 */
export interface SearchTextResult {
  entries: SearchableEntry[];
  sessionTitle: string | undefined;
}

/**
 * Extract searchable text entries from parsed messages.
 *
 * Algorithm mirrors ChunkBuilder.buildChunks() lines 78-151:
 * - Filter to main thread (!m.isSidechain)
 * - classifyMessages() — cheap type guard checks
 * - Walk classified messages with an aiBuffer:
 *   - hardNoise → skip
 *   - compact / system / user → flush AI buffer, then handle
 *   - ai → push to buffer
 * - Flush remaining buffer at end
 */
export function extractSearchableEntries(messages: ParsedMessage[]): SearchTextResult {
  const entries: SearchableEntry[] = [];
  let sessionTitle: string | undefined;

  // Filter to main thread messages (non-sidechain) — same as ChunkBuilder line 82
  const mainMessages = messages.filter((m) => !m.isSidechain);
  const classified = classifyMessages(mainMessages);

  let aiBuffer: ParsedMessage[] = [];

  for (const { message, category } of classified) {
    switch (category) {
      case 'hardNoise':
        // Skip — filtered out
        break;

      case 'compact':
      case 'system':
        // Flush AI buffer, but compact/system messages have no searchable text
        if (aiBuffer.length > 0) {
          const aiEntry = extractAIEntry(aiBuffer);
          if (aiEntry) entries.push(aiEntry);
          aiBuffer = [];
        }
        break;

      case 'user': {
        // Flush AI buffer
        if (aiBuffer.length > 0) {
          const aiEntry = extractAIEntry(aiBuffer);
          if (aiEntry) entries.push(aiEntry);
          aiBuffer = [];
        }
        // Extract user text
        const userText = extractUserText(message);
        if (userText) {
          if (!sessionTitle) {
            sessionTitle = userText.slice(0, 100);
          }
          entries.push({
            text: userText,
            groupId: `user-${message.uuid}`,
            messageType: 'user',
            itemType: 'user',
            timestamp: message.timestamp.getTime(),
            messageUuid: message.uuid,
          });
        }
        break;
      }

      case 'ai':
        aiBuffer.push(message);
        break;
    }
  }

  // Flush remaining AI buffer
  if (aiBuffer.length > 0) {
    const aiEntry = extractAIEntry(aiBuffer);
    if (aiEntry) entries.push(aiEntry);
  }

  return { entries, sessionTitle };
}

/**
 * Extract the last text output from an AI message buffer.
 * Scans backward for the last assistant message with a text content block.
 */
function extractAIEntry(buffer: ParsedMessage[]): SearchableEntry | null {
  // Scan backward for last assistant message with text content
  for (let i = buffer.length - 1; i >= 0; i--) {
    const msg = buffer[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

    // Find the last text block in this message
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j];
      if (block.type === 'text' && block.text) {
        return {
          text: block.text,
          groupId: `ai-${buffer[0].uuid}`,
          messageType: 'assistant',
          itemType: 'ai',
          timestamp: msg.timestamp.getTime(),
          messageUuid: msg.uuid,
        };
      }
    }
  }
  return null;
}

/**
 * Extract searchable text from a user message.
 * Shared logic previously in SessionSearcher.extractUserSearchableText().
 */
export function extractUserText(message: ParsedMessage): string {
  let rawText = '';
  if (typeof message.content === 'string') {
    rawText = message.content;
  } else if (Array.isArray(message.content)) {
    rawText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
  return sanitizeDisplayContent(rawText);
}
