/**
 * Fixture for advisor tool block tests.
 * Shapes verified from session 01c3ae09-6366-4303-902e-19b864e0a76c.
 * Do not re-grep the raw .jsonl — use these exports.
 */

import type { ParsedMessage } from '../../src/main/types/messages';

export const ADVISOR_CALL_ID = 'srvtoolu_01Eiz79KF8odGzUWVppYmN2q';
export const ADVISOR_MODEL = 'claude-opus-4-8';
export const ADVISOR_TEXT =
  'Your guard edit is sound — make it. Two confirmations: first, the guard correctly narrows the type; second, the existing tests will pass without modification.';

/**
 * Assistant message containing the advisor server_tool_use CALL block.
 * entry.advisorModel is the entry-level field (not message.model).
 * Cast needed until M2 adds advisorModel to ParsedMessage.
 */
export const advisorCallMessage = {
  uuid: 'advisor-call-msg-uuid',
  parentUuid: null,
  type: 'assistant',
  timestamp: new Date('2026-06-06T10:00:00Z'),
  role: 'assistant',
  advisorModel: ADVISOR_MODEL,
  model: undefined,
  isMeta: false,
  isSidechain: false,
  toolCalls: [],
  toolResults: [],
  content: [
    {
      type: 'server_tool_use',
      id: ADVISOR_CALL_ID,
      name: 'advisor',
      // advisor takes no input parameters
    },
  ],
} as unknown as ParsedMessage;

/**
 * Assistant message containing the advisor_tool_result block.
 * Rides an assistant entry (not a user entry like normal tool results).
 */
export const advisorResultMessage = {
  uuid: 'advisor-result-msg-uuid',
  parentUuid: 'advisor-call-msg-uuid',
  type: 'assistant',
  timestamp: new Date('2026-06-06T10:00:11Z'),
  role: 'assistant',
  advisorModel: ADVISOR_MODEL,
  model: undefined,
  isMeta: false,
  isSidechain: false,
  toolCalls: [],
  toolResults: [],
  content: [
    {
      type: 'advisor_tool_result',
      tool_use_id: ADVISOR_CALL_ID,
      content: {
        type: 'advisor_result',
        text: ADVISOR_TEXT,
      },
    },
  ],
} as unknown as ParsedMessage;
