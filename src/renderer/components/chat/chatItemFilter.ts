/**
 * Chat item type filtering.
 *
 * Maps the granular AIGroupDisplayItem / tool-name space (~25 tools) down to a small,
 * stable set of user-facing filter categories used by the always-visible ChatFilterBar.
 *
 * The mapping is driven off the existing discriminated-union `type` field and the tool
 * `name` field — never by parsing rendered strings — so it stays in lock-step with the
 * data model.
 */

import type { AIGroupDisplayItem, AIGroupLastOutput, EnhancedAIGroup } from '@renderer/types/groups';

/**
 * User-facing filter categories. One chip per entry in the filter bar.
 * `other` is the catch-all for tools/items that don't map to a dedicated chip.
 */
export type FilterType =
  | 'output'
  | 'thinking'
  | 'bash'
  | 'read'
  | 'edit'
  | 'write'
  | 'task'
  | 'webfetch'
  | 'websearch'
  | 'toolsearch'
  | 'todowrite'
  | 'grepglob'
  | 'askuserquestion'
  | 'skill'
  | 'other';

/** Ordered chip definitions (label + type). Order controls display order in the bar. */
export const FILTER_DEFS: ReadonlyArray<{ type: FilterType; label: string }> = [
  { type: 'output', label: 'Output' },
  { type: 'thinking', label: 'Thinking' },
  { type: 'bash', label: 'Bash' },
  { type: 'read', label: 'Read' },
  { type: 'edit', label: 'Edit' },
  { type: 'write', label: 'Write' },
  { type: 'task', label: 'Agent' },
  { type: 'webfetch', label: 'WebFetch' },
  { type: 'websearch', label: 'WebSearch' },
  { type: 'toolsearch', label: 'ToolSearch' },
  { type: 'todowrite', label: 'TodoWrite' },
  { type: 'grepglob', label: 'Grep/Glob' },
  { type: 'askuserquestion', label: 'AskUserQuestion' },
  { type: 'skill', label: 'Skill' },
  { type: 'other', label: 'Other tools' },
];

export const ALL_FILTER_TYPES: readonly FilterType[] = FILTER_DEFS.map((d) => d.type);

/**
 * Item types that DEFAULT to collapsed (Task, WebFetch, Read, Bash, ToolSearch).
 * Every other type defaults to expanded. A user's explicit expand/collapse always
 * overrides this default (tracked per-tab in the tabUISlice).
 */
export const DEFAULT_COLLAPSED_TYPES: ReadonlySet<FilterType> = new Set<FilterType>([
  'task',
  'webfetch',
  'read',
  'bash',
  'toolsearch',
]);

/**
 * Maps a tool `name` to its filter category.
 */
export function toolNameToFilterType(name: string): FilterType {
  switch (name) {
    case 'Bash':
    case 'KillShell':
      return 'bash';
    case 'Read':
      return 'read';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit';
    case 'Write':
      return 'write';
    case 'Task':
    case 'Agent':
    case 'TaskOutput':
    case 'AgentOutput':
      return 'task';
    case 'WebFetch':
      return 'webfetch';
    case 'WebSearch':
      return 'websearch';
    case 'ToolSearch':
      return 'toolsearch';
    case 'TodoWrite':
      return 'todowrite';
    case 'Grep':
    case 'Glob':
      return 'grepglob';
    case 'AskUserQuestion':
      return 'askuserquestion';
    case 'Skill':
      return 'skill';
    default:
      return 'other';
  }
}

/**
 * Maps a single display item to its filter category.
 */
export function displayItemFilterType(item: AIGroupDisplayItem): FilterType {
  switch (item.type) {
    case 'output':
      return 'output';
    case 'thinking':
      return 'thinking';
    case 'tool':
      return toolNameToFilterType(item.tool.name);
    case 'subagent':
    case 'subagent_input':
      return 'task';
    default:
      // slash, teammate_message, compact_boundary → catch-all
      return 'other';
  }
}

/**
 * True if a display item's type defaults to COLLAPSED (see DEFAULT_COLLAPSED_TYPES).
 * Reuses the existing type mapping so classification stays in lock-step with the data model.
 */
export function isItemDefaultCollapsed(item: AIGroupDisplayItem): boolean {
  return DEFAULT_COLLAPSED_TYPES.has(displayItemFilterType(item));
}

/**
 * Maps the always-visible "last output" to a filter category.
 * Returns null for outputs that should never be hidden (interruptions, ongoing state).
 */
export function lastOutputFilterType(
  lastOutput: AIGroupLastOutput | null | undefined
): FilterType | null {
  if (!lastOutput) return null;
  switch (lastOutput.type) {
    case 'text':
    case 'plan_exit':
      return 'output';
    case 'tool_result':
      return lastOutput.toolName ? toolNameToFilterType(lastOutput.toolName) : 'other';
    default:
      // interruption, ongoing → always visible
      return null;
  }
}

/**
 * Computes the set of filter categories present in an enhanced AI group
 * (across its display items and its last output). Used to decide whether an
 * AI group row is visible under the current filter.
 */
export function getAIGroupFilterTypes(enhanced: EnhancedAIGroup): Set<FilterType> {
  const set = new Set<FilterType>();
  for (const item of enhanced.displayItems) {
    set.add(displayItemFilterType(item));
  }
  const lastType = lastOutputFilterType(enhanced.lastOutput);
  if (lastType) set.add(lastType);
  return set;
}

/**
 * True if any of the group's present types is currently enabled (not hidden).
 * A group with no categorizable content (empty set) stays visible.
 */
export function isAIGroupVisible(
  presentTypes: Set<FilterType>,
  hidden: ReadonlySet<string>
): boolean {
  if (presentTypes.size === 0) return true;
  for (const t of presentTypes) {
    if (!hidden.has(t)) return true;
  }
  return false;
}
