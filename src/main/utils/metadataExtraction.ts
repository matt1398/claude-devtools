/**
 * Metadata extraction utilities for parsing first messages and session context from JSONL files.
 */

import { isCommandOutputContent, sanitizeDisplayContent } from '@shared/utils/contentSanitizer';
import { createLogger } from '@shared/utils/logger';
import * as readline from 'readline';

import { LocalFileSystemProvider } from '../services/infrastructure/LocalFileSystemProvider';
import { type ChatHistoryEntry, isTextContent, type UserEntry } from '../types';

import { translateWslMountPath } from './pathDecoder';

import type { FileSystemProvider } from '../services/infrastructure/FileSystemProvider';

const logger = createLogger('Util:metadataExtraction');

/**
 * Normalize Windows drive letter to uppercase for consistent path comparison.
 * CLI uses uppercase (C:\...) while VS Code extension uses lowercase (c:\...).
 */
function normalizeDriveLetter(p: string): string {
  if (p.length >= 2 && p[1] === ':') {
    return p[0].toUpperCase() + p.slice(1);
  }
  return p;
}

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
        return normalizeDriveLetter(translateWslMountPath(entry.cwd));
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
): Promise<{ text: string; timestamp: string } | null> {
  const safeMaxLines = Math.max(1, maxLines);
  const fileStream = fsProvider.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let commandFallback: { text: string; timestamp: string } | null = null;
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

      if (entry.type !== 'user') {
        continue;
      }

      const preview = extractPreviewFromUserEntry(entry);
      if (!preview) {
        continue;
      }

      if (!preview.isCommand) {
        return { text: preview.text, timestamp: preview.timestamp };
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

  return commandFallback;
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

/**
 * Extract the last custom title from a session JSONL file.
 * Scans the full file but only JSON-parses lines containing "custom-title",
 * so the cost is minimal even for large files.
 */
export async function extractCustomTitle(
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

  let customTitle: string | undefined;

  try {
    for await (const line of rl) {
      // Fast string check — skip JSON parse for non-matching lines
      if (!line.includes('"custom-title"')) continue;

      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
          customTitle = entry.customTitle;
        }
      } catch {
        // Malformed line, skip
      }
    }
  } catch (error) {
    logger.debug(`Error extracting custom title from ${filePath}:`, error);
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return customTitle;
}
