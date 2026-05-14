import { getToolSummary } from './toolRendering/toolSummaryHelpers';
import { enhanceAIGroup } from './aiGroupEnhancer';

import type { LinkedToolItem, SessionConversation } from '@renderer/types/groups';

// =============================================================================
// Types
// =============================================================================

export type ExportItemType = 'user' | 'ai-text' | 'tool' | 'thinking' | 'compact';

export type ToolFieldKey = 'name' | 'summary' | 'input' | 'output';

export interface ToolExportFields {
  name: string;
  summary: string;
  input: string;
  output: string;
}

export interface ExportItem {
  id: string;
  type: ExportItemType;
  /** Which conversation turn this belongs to (for visual grouping) */
  turnIndex: number;
  /** Short label shown in the checkbox row */
  label: string;
  /** Markdown content written to clipboard when selected (non-tool items) */
  content: string;
  /** Whether this item is selected by default */
  selected: boolean;
  /** Structured sub-content for tool items; absent on other types */
  toolFields?: ToolExportFields;
}

// =============================================================================
// Helpers
// =============================================================================

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && typeof input.command === 'string') {
    return input.command;
  }
  return JSON.stringify(input, null, 2);
}

function getFullToolOutput(tool: LinkedToolItem): string {
  if (tool.isOrphaned) return 'No result received';
  if (!tool.result) return 'Completed';
  if (tool.result.isError) {
    const raw =
      typeof tool.result.content === 'string'
        ? tool.result.content
        : JSON.stringify(tool.result.content, null, 2);
    return `Error: ${raw}`;
  }
  if (!tool.result.content) return 'Completed successfully';
  return typeof tool.result.content === 'string'
    ? tool.result.content
    : JSON.stringify(tool.result.content, null, 2);
}

/**
 * Assemble the clipboard text for a tool item given which fields are enabled.
 * Called at copy-time so that field toggles take effect without rebuilding items.
 */
export function assembleToolContent(fields: ToolExportFields, enabled: Set<string>): string {
  const parts: string[] = [];
  const hasName = enabled.has('name');
  const hasSummary = enabled.has('summary');
  const hasInput = enabled.has('input');
  const hasOutput = enabled.has('output');

  if (hasName && hasSummary && fields.summary) {
    parts.push(`**Tool: ${fields.name}** — ${fields.summary}`);
  } else if (hasName) {
    parts.push(`**Tool: ${fields.name}**`);
  } else if (hasSummary && fields.summary) {
    parts.push(`*${fields.summary}*`);
  }

  if (hasInput && fields.input) {
    parts.push(`*Input:*\n\`\`\`\n${fields.input}\n\`\`\``);
  }

  if (hasOutput && fields.output) {
    parts.push(`*Output:*\n\`\`\`\n${fields.output}\n\`\`\``);
  }

  return parts.join('\n\n');
}

// =============================================================================
// Main export function
// =============================================================================

/**
 * Convert a SessionConversation into a flat list of ExportItems.
 *
 * Turn index increments on each user message so the modal can visually group
 * the user prompt with the AI response that follows it.
 */
export function extractExportItems(conversation: SessionConversation): ExportItem[] {
  const items: ExportItem[] = [];
  let turnIndex = 0;

  for (const chatItem of conversation.items) {
    if (chatItem.type === 'user') {
      const text =
        chatItem.group.content.text?.trim() ?? chatItem.group.content.rawText?.trim() ?? '';
      if (!text) continue;

      turnIndex++;
      items.push({
        id: `user-${chatItem.group.id}`,
        type: 'user',
        turnIndex,
        label: truncate(text, 80),
        content: `## You\n\n${text}`,
        selected: true,
      });
    } else if (chatItem.type === 'ai') {
      const enhanced = enhanceAIGroup(chatItem.group);

      // Intermediate display items (everything except the final output).
      // Use an extractable-only counter so IDs stay stable even when
      // non-extractable items (slash, subagent, etc.) appear in the list.
      let extractableIndex = 0;
      for (const item of enhanced.displayItems) {
        if (item.type === 'thinking') {
          items.push({
            id: `ai-${chatItem.group.id}-${extractableIndex++}`,
            type: 'thinking',
            turnIndex,
            label: `Thinking — ${truncate(item.content, 60)}`,
            content: `> *Thinking:*\n> ${item.content.replace(/\n/g, '\n> ')}`,
            selected: false,
          });
        } else if (item.type === 'output') {
          items.push({
            id: `ai-${chatItem.group.id}-${extractableIndex++}`,
            type: 'ai-text',
            turnIndex,
            label: `Claude — ${truncate(item.content, 60)}`,
            content: `## Claude\n\n${item.content}`,
            selected: true,
          });
        } else if (item.type === 'tool') {
          const tool = item.tool;
          const summary = getToolSummary(tool.name, tool.input);
          const inputStr = formatToolInput(tool.name, tool.input);
          const outputStr = getFullToolOutput(tool);
          const toolFields: ToolExportFields = {
            name: tool.name,
            summary,
            input: inputStr,
            output: outputStr,
          };
          items.push({
            id: `ai-${chatItem.group.id}-${extractableIndex++}`,
            type: 'tool',
            turnIndex,
            label: `${tool.name} — ${summary}`,
            content: assembleToolContent(toolFields, new Set(['name', 'summary', 'output'])),
            selected: true,
            toolFields,
          });
        }
        // subagent, slash, teammate_message, compact_boundary: skip
      }

      // Final output (not in displayItems — shown separately by LastOutputDisplay)
      const last = enhanced.lastOutput;
      if (last) {
        const lastId = `ai-last-${chatItem.group.id}`;
        if (last.type === 'text' && last.text) {
          items.push({
            id: lastId,
            type: 'ai-text',
            turnIndex,
            label: `Claude — ${truncate(last.text, 60)}`,
            content: `## Claude\n\n${last.text}`,
            selected: true,
          });
        } else if (last.type === 'tool_result' && last.toolResult) {
          const toolName = last.toolName ?? 'Tool';
          const toolFields: ToolExportFields = {
            name: toolName,
            summary: 'final result',
            input: '',
            output: last.isError ? `Error: ${last.toolResult}` : last.toolResult,
          };
          items.push({
            id: lastId,
            type: 'tool',
            turnIndex,
            label: `${toolName} — result`,
            content: assembleToolContent(toolFields, new Set(['name', 'summary', 'output'])),
            selected: true,
            toolFields,
          });
        } else if (last.type === 'plan_exit' && last.planContent) {
          items.push({
            id: lastId,
            type: 'ai-text',
            turnIndex,
            label: 'Claude — Plan ready for approval',
            content: `## Claude (Plan)\n\n${last.planContent}`,
            selected: true,
          });
        } else if (last.type === 'interruption') {
          items.push({
            id: lastId,
            type: 'ai-text',
            turnIndex,
            label: 'Request interrupted by user',
            content: '> *Request interrupted by user*',
            selected: true,
          });
        }
      }
    } else if (chatItem.type === 'compact') {
      items.push({
        id: `compact-${chatItem.group.id}`,
        type: 'compact',
        turnIndex,
        label: 'Context compacted',
        content: '\n---\n*[Context was compacted here — earlier messages summarized]*\n---\n',
        selected: true,
      });
    }
    // 'system' items: skip (command output isn't useful for session handoff)
  }

  return items;
}
