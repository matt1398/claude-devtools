/**
 * Metadata extraction utilities for parsing first messages and session context from JSONL files.
 */

import { isCommandOutputContent, sanitizeDisplayContent } from '@shared/utils/contentSanitizer';
import { createLogger } from '@shared/utils/logger';
import * as readline from 'readline';

import { LocalFileSystemProvider } from '../services/infrastructure/LocalFileSystemProvider';
import { type ChatHistoryEntry, isTextContent, type UserEntry } from '../types';

import type { FileSystemProvider } from '../services/infrastructure/FileSystemProvider';

const logger = createLogger('Util:metadataExtraction');

const defaultProvider = new LocalFileSystemProvider();

interface MessagePreview {
  text: string;
  timestamp: string;
  isCommand: boolean;
}

/**
 * Extract CWD (current working directory) from the first entry.
 * Used to get the actual project path from encoded directory names.
 */
export async function extractCwd(
  filePath: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<string | null> {
  if (!(await fsProvider.exists(filePath))) {
    return null;
  }

  const fileStream = fsProvider.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      const entry = JSON.parse(line) as ChatHistoryEntry;
      // Only conversational entries have cwd
      if ('cwd' in entry && entry.cwd) {
        rl.close();
        fileStream.destroy();
        return entry.cwd;
      }
    }
  } catch (error) {
    logger.error(`Error extracting cwd from ${filePath}:`, error);
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return null;
}

/**
 * Extract a lightweight title preview from the first user message.
 * For command-style sessions, falls back to a slash-command label.
 */
export async function extractFirstUserMessagePreview(
  filePath: string,
  fsProvider: FileSystemProvider = defaultProvider,
  maxLines: number = 200
): Promise<{ text: string; timestamp: string; sessionName?: string } | null> {
  const safeMaxLines = Math.max(1, maxLines);
  const fileStream = fsProvider.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let commandFallback: { text: string; timestamp: string } | null = null;
  let sessionName: string | undefined;
  let linesRead = 0;

  try {
    for await (const line of rl) {
      if (linesRead++ >= safeMaxLines) {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      let entry: ChatHistoryEntry;
      try {
        entry = JSON.parse(trimmed) as ChatHistoryEntry;
      } catch {
        continue;
      }

      // Detect custom-title entries (written at top of file by /rename)
      const rawEntry = entry as unknown as { type: string; customTitle?: string };
      if (rawEntry.type === 'custom-title' && typeof rawEntry.customTitle === 'string') {
        const title = rawEntry.customTitle.trim();
        if (title) sessionName = title;
        continue;
      }

      if (entry.type !== 'user') {
        continue;
      }

      const preview = extractPreviewFromUserEntry(entry);
      if (!preview) {
        continue;
      }

      if (!preview.isCommand) {
        return { text: preview.text, timestamp: preview.timestamp, sessionName };
      }

      if (!commandFallback) {
        commandFallback = { text: preview.text, timestamp: preview.timestamp };
      }
    }
  } catch (error) {
    logger.debug(`Error extracting first user preview from ${filePath}:`, error);
    throw error;
  } finally {
    rl.close();
    fileStream.destroy();
  }

  if (commandFallback) {
    return { ...commandFallback, sessionName };
  }

  // Session may only have custom-title but no user messages
  if (sessionName) {
    return { text: sessionName, sessionName };
  }

  return null;
}

/**
 * Extract session name from custom-title entries in the file.
 * These can appear at the top (new sessions) or be appended (mid-session renames).
 * Scans the full file but only parses lines containing "custom-title".
 */
export async function extractSessionName(
  filePath: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<string | undefined> {
  if (!(await fsProvider.exists(filePath))) {
    return undefined;
  }

  const fileStream = fsProvider.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let sessionName: string | undefined;

  try {
    for await (const line of rl) {
      // Fast string check before JSON parsing
      if (!line.includes('"custom-title"')) continue;

      try {
        const entry = JSON.parse(line.trim()) as { type: string; customTitle?: string };
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
          const title = entry.customTitle.trim();
          if (title) sessionName = title;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return sessionName;
}

function extractPreviewFromUserEntry(entry: UserEntry): MessagePreview | null {
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const message = entry.message;
  if (!message) {
    return null;
  }

  const content = message.content;
  if (typeof content === 'string') {
    if (isCommandOutputContent(content) || content.startsWith('[Request interrupted by user')) {
      return null;
    }

    if (content.startsWith('<command-name>')) {
      return {
        text: extractCommandName(content),
        timestamp,
        isCommand: true,
      };
    }

    const sanitized = sanitizeDisplayContent(content).trim();
    if (!sanitized) {
      return null;
    }

    return {
      text: sanitized.substring(0, 500),
      timestamp,
      isCommand: false,
    };
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textContent = content
    .filter(isTextContent)
    .map((block) => block.text)
    .join(' ')
    .trim();
  if (!textContent || textContent.startsWith('[Request interrupted by user')) {
    return null;
  }

  if (textContent.startsWith('<command-name>')) {
    return {
      text: extractCommandName(textContent),
      timestamp,
      isCommand: true,
    };
  }

  const sanitized = sanitizeDisplayContent(textContent).trim();
  if (!sanitized) {
    return null;
  }

  return {
    text: sanitized.substring(0, 500),
    timestamp,
    isCommand: false,
  };
}

function extractCommandName(content: string): string {
  const commandMatch = /<command-name>\/([^<]+)<\/command-name>/.exec(content);
  return commandMatch ? `/${commandMatch[1]}` : '/command';
}
