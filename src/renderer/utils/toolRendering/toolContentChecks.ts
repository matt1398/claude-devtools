/**
 * Tool Content Check Helpers
 *
 * Utilities for checking if tool items have specific types of content.
 */

import type { LinkedToolItem } from '@renderer/types/groups';

/**
 * Checks if a Skill tool has skill instructions.
 */
export function hasSkillInstructions(linkedTool: LinkedToolItem): boolean {
  return !!linkedTool.skillInstructions;
}

/**
 * Checks if a Read tool has content to display.
 */
export function hasReadContent(linkedTool: LinkedToolItem): boolean {
  if (!linkedTool.result) return false;

  const toolUseResult = linkedTool.result.toolUseResult as Record<string, unknown> | undefined;
  const fileData = toolUseResult?.file as { content?: string } | undefined;
  if (fileData?.content) return true;

  if (linkedTool.result.content != null) {
    if (typeof linkedTool.result.content === 'string' && linkedTool.result.content.length > 0)
      return true;
    if (Array.isArray(linkedTool.result.content) && linkedTool.result.content.length > 0)
      return true;
  }

  return false;
}

/**
 * Checks if an Edit tool has content to display.
 */
export function hasEditContent(linkedTool: LinkedToolItem): boolean {
  if (linkedTool.input.old_string != null) return true;

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult?.oldString != null || toolUseResult?.newString != null) return true;

  return false;
}

/**
 * Checks if a Write tool has content to display.
 */
export function hasWriteContent(linkedTool: LinkedToolItem): boolean {
  if (linkedTool.input.content != null || linkedTool.input.file_path != null) return true;

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult?.content != null || toolUseResult?.filePath != null) return true;

  return false;
}

/**
 * Checks if a Bash tool has a command to display.
 */
export function hasBashContent(linkedTool: LinkedToolItem): boolean {
  const command = linkedTool.input?.command;
  return typeof command === 'string' && command.trim().length > 0;
}
