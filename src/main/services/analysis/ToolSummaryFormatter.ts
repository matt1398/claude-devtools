/**
 * ToolSummaryFormatter service - Formats tool information for display.
 *
 * Provides utilities for:
 * - Extracting filenames from paths
 * - Truncating long strings
 * - Formatting token counts
 * - Generating human-readable tool summaries
 */

import { formatTokens } from '@shared/utils/tokenFormatting';
import * as path from 'path';

// Re-export for backwards compatibility
export { formatTokens };

// =============================================================================
// String Utilities
// =============================================================================

/**
 * Extracts filename from a file path.
 */
function getFileName(filePath: string): string {
  return path.basename(filePath) || filePath;
}

/**
 * Truncates a string to a maximum length with ellipsis.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

// =============================================================================
// Tool Summary Generation
// =============================================================================

/**
 * Generates a human-readable summary for a tool call.
 * Simplified version of LinkedToolItem's getToolSummary.
 */
export function getToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Edit':
    case 'Read':
    case 'Write': {
      const filePath = input.file_path as string | undefined;
      if (filePath) return getFileName(filePath);
      return toolName;
    }

    case 'Bash': {
      const description = input.description as string | undefined;
      const command = input.command as string | undefined;
      if (description) return truncate(description, 50);
      if (command) return truncate(command, 50);
      return 'Bash';
    }

    case 'Grep':
    case 'Glob': {
      const pattern = input.pattern as string | undefined;
      if (pattern) return `"${truncate(pattern, 30)}"`;
      return toolName;
    }

    case 'Task':
    case 'Agent': {
      const description = input.description as string | undefined;
      const prompt = input.prompt as string | undefined;
      const subagentType = input.subagent_type as string | undefined;
      const desc = description ?? prompt;
      const typeStr = subagentType ? `${subagentType} - ` : '';
      if (desc) return `${typeStr}${truncate(desc, 40)}`;
      return subagentType ?? 'Task';
    }

    case 'Skill': {
      const skill = input.skill as string | undefined;
      if (skill) return skill;
      return 'Skill';
    }

    case 'WebFetch': {
      const url = input.url as string | undefined;
      if (url) {
        try {
          const urlObj = new URL(url);
          return truncate(urlObj.hostname + urlObj.pathname, 50);
        } catch {
          return truncate(url, 50);
        }
      }
      return 'WebFetch';
    }

    case 'WebSearch': {
      const query = input.query as string | undefined;
      if (query) return `"${truncate(query, 40)}"`;
      return 'WebSearch';
    }

    default: {
      // Try common parameter names
      const nameField = input.name ?? input.path ?? input.file ?? input.query ?? input.command;
      if (typeof nameField === 'string') {
        return truncate(nameField, 50);
      }
      return toolName;
    }
  }
}
