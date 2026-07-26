/**
 * MessageClassifier service - Classifies messages into categories for chunk building.
 *
 * Categories:
 * - User: Genuine user input (creates UserChunk, renders RIGHT)
 * - System: Command output <local-command-stdout> (creates SystemChunk, renders LEFT)
 * - Compact: Summary messages from conversation compaction
 * - Hard Noise: Filtered out entirely (system metadata, caveats, reminders)
 * - AI: All other messages grouped into AIChunks (renders LEFT)
 */

import {
  isParsedCompactMessage,
  isParsedHardNoiseMessage,
  isParsedShellMessage,
  isParsedSystemChunkMessage,
  isParsedTaskNotificationMessage,
  isParsedUserChunkMessage,
  type MessageCategory,
  type ParsedMessage,
} from '@main/types';

/**
 * Result of classifying a message.
 */
export interface ClassifiedMessage {
  message: ParsedMessage;
  category: MessageCategory;
}

/**
 * Classify all messages into categories.
 */
export function classifyMessages(messages: ParsedMessage[]): ClassifiedMessage[] {
  return messages.map((message) => ({
    message,
    category: categorizeMessage(message),
  }));
}

/**
 * Categorize a single message into one of five categories.
 */
function categorizeMessage(message: ParsedMessage): MessageCategory {
  // Check hard noise first (filtered out)
  if (isParsedHardNoiseMessage(message)) {
    return 'hardNoise';
  }

  // Check compact summary (before system/user to catch it early)
  if (isParsedCompactMessage(message)) {
    return 'compact';
  }

  // Check auto-injected background-task notifications (before user, so they are
  // never mistaken for a "You" bubble)
  if (isParsedTaskNotificationMessage(message)) {
    return 'notification';
  }

  // Check interactive `!` shell commands and their output (before user, so they
  // are never mistaken for a "You" bubble)
  if (isParsedShellMessage(message)) {
    return 'shell';
  }

  // Check system (command output)
  if (isParsedSystemChunkMessage(message)) {
    return 'system';
  }

  // Check user (real user input)
  if (isParsedUserChunkMessage(message)) {
    return 'user';
  }

  // Everything else is AI (assistant messages, tool results, etc.)
  return 'ai';
}
