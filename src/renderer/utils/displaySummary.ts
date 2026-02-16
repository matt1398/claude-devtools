/**
 * Display Summary - Build human-readable summaries of display items
 *
 * Creates formatted summary strings for AI Group display item counts.
 */

import type { AIGroupDisplayItem } from '../types/groups';

/**
 * Build a human-readable summary of display items.
 *
 * Strategy:
 * 1. Count items by type (thinking, tool, output, subagent, slash)
 * 2. Format as "X thinking, Y tool calls, Z messages, N subagents, M slashes"
 * 3. Skip counts that are zero
 * 4. Return formatted string
 *
 * @param items - Display items to summarize
 * @returns Formatted summary string
 */
export function buildSummary(items: AIGroupDisplayItem[]): string {
  const counts = {
    thinking: 0,
    tool: 0,
    output: 0,
    subagent: 0,
    slash: 0,
    teammate_message: 0,
    subagent_input: 0,
    compact_boundary: 0,
  };
  const teammateNames = new Set<string>();

  for (const item of items) {
    if (item.type === 'subagent' && item.subagent.team) {
      teammateNames.add(item.subagent.team.memberName);
    } else {
      counts[item.type]++;
    }
  }

  const parts: string[] = [];

  if (counts.thinking > 0) {
    parts.push(`${counts.thinking} thinking`);
  }
  if (counts.tool > 0) {
    parts.push(`${counts.tool} tool ${counts.tool === 1 ? 'call' : 'calls'}`);
  }
  if (counts.output > 0) {
    parts.push(`${counts.output} ${counts.output === 1 ? 'message' : 'messages'}`);
  }
  if (teammateNames.size > 0) {
    parts.push(`${teammateNames.size} ${teammateNames.size === 1 ? 'teammate' : 'teammates'}`);
  }
  if (counts.subagent > 0) {
    parts.push(`${counts.subagent} ${counts.subagent === 1 ? 'subagent' : 'subagents'}`);
  }
  if (counts.slash > 0) {
    parts.push(`${counts.slash} ${counts.slash === 1 ? 'slash' : 'slashes'}`);
  }
  if (counts.teammate_message > 0) {
    parts.push(
      `${counts.teammate_message} teammate ${counts.teammate_message === 1 ? 'message' : 'messages'}`
    );
  }
  if (counts.compact_boundary > 0) {
    parts.push(
      `${counts.compact_boundary} ${counts.compact_boundary === 1 ? 'compaction' : 'compactions'}`
    );
  }

  return parts.length > 0 ? parts.join(', ') : 'No items';
}
