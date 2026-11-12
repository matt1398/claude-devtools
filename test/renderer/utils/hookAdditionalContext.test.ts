import { describe, expect, it } from 'vitest';

import { extractHookAdditionalContexts } from '../../../src/renderer/utils/hookAdditionalContext';

import type { ParsedMessage } from '../../../src/renderer/types/data';

function createMessage(content: ParsedMessage['content']): ParsedMessage {
  return {
    uuid: 'message-1',
    parentUuid: null,
    type: 'user',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    content,
    isSidechain: false,
    isMeta: true,
    toolCalls: [],
    toolResults: [],
  };
}

describe('extractHookAdditionalContexts', () => {
  it('extracts hook context from system reminders on tool results and user messages', () => {
    const messages = [
      createMessage([
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'completed',
        },
        {
          type: 'text',
          text: '<system-reminder>\nPostToolUse:Bash hook additional context: Run the focused checks.\n</system-reminder>',
        },
      ]),
      createMessage(
        '<system-reminder>UserPromptSubmit hook additional context: Keep the answer concise.</system-reminder>'
      ),
    ];

    expect(extractHookAdditionalContexts(messages)).toEqual([
      { label: 'PostToolUse:Bash', text: 'Run the focused checks.' },
      { label: 'UserPromptSubmit', text: 'Keep the answer concise.' },
    ]);
  });

  it('ignores other system reminders and duplicate hook context', () => {
    const reminder = createMessage(
      '<system-reminder>Remember to use the task tools.</system-reminder>'
    );
    const hookContext = createMessage(
      '<system-reminder>SessionStart hook additional context: Work in the project root.</system-reminder>'
    );

    expect(extractHookAdditionalContexts([reminder, hookContext, hookContext])).toEqual([
      { label: 'SessionStart', text: 'Work in the project root.' },
    ]);
  });
});
