/**
 * Subagent-dispatch tool names.
 *
 * Claude Code renamed the subagent-dispatch tool from `Task` to `Agent` (the
 * tool_use `input` still carries `subagent_type`). Both names refer to the same
 * concept, so every place that special-cases the tool name must treat them as
 * aliases. Use these helpers instead of comparing against a bare `'Task'`.
 */

/** Tool names that dispatch a subagent (`Task` = legacy, `Agent` = current). */
export const SUBAGENT_TOOL_NAMES = new Set(['Task', 'Agent']);

/** Result-side counterpart tool names for subagent dispatch. */
export const SUBAGENT_OUTPUT_TOOL_NAMES = new Set(['TaskOutput', 'AgentOutput']);

/** True when `name` is a subagent-dispatch tool (`Task` or `Agent`). */
export function isSubagentDispatchTool(name: string): boolean {
  return SUBAGENT_TOOL_NAMES.has(name);
}

/** True when `name` is a subagent-dispatch output tool (`TaskOutput` or `AgentOutput`). */
export function isSubagentOutputTool(name: string): boolean {
  return SUBAGENT_OUTPUT_TOOL_NAMES.has(name);
}
