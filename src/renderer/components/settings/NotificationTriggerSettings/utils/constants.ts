/**
 * Constants for NotificationTriggerSettings.
 */

import { Activity, AlertCircle, Search } from 'lucide-react';

import type { ModeConfig } from '../types';
import type { TriggerContentType, TriggerToolName } from '@renderer/types/data';

/**
 * Content type options for dropdown.
 */
export const CONTENT_TYPE_OPTIONS: { value: TriggerContentType; label: string }[] = [
  { value: 'tool_result', label: 'Tool Result' },
  { value: 'tool_use', label: 'Tool Use' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'text', label: 'Text Output' },
];

/**
 * Tool name options for dropdown.
 */
export const TOOL_NAME_OPTIONS: { value: TriggerToolName; label: string }[] = [
  { value: '', label: 'Any Tool' },
  { value: 'Bash', label: 'Bash' },
  { value: 'Task', label: 'Task' },
  { value: 'Agent', label: 'Agent' },
  { value: 'Read', label: 'Read' },
  { value: 'Write', label: 'Write' },
  { value: 'Edit', label: 'Edit' },
  { value: 'Grep', label: 'Grep' },
  { value: 'Glob', label: 'Glob' },
  { value: 'WebFetch', label: 'WebFetch' },
  { value: 'WebSearch', label: 'WebSearch' },
  { value: 'LSP', label: 'LSP' },
  { value: 'TodoWrite', label: 'TodoWrite' },
  { value: 'Skill', label: 'Skill' },
  { value: 'NotebookEdit', label: 'NotebookEdit' },
  { value: 'AskUserQuestion', label: 'AskUserQuestion' },
  { value: 'KillShell', label: 'KillShell' },
  { value: 'TaskOutput', label: 'TaskOutput' },
  { value: 'AgentOutput', label: 'AgentOutput' },
];

/**
 * Mode options for the trigger mode selector.
 */
export const MODE_OPTIONS: ModeConfig[] = [
  { value: 'error_status', label: 'Execution Error', icon: AlertCircle },
  { value: 'content_match', label: 'Content Pattern', icon: Search },
  { value: 'token_threshold', label: 'High Token Usage', icon: Activity },
];
