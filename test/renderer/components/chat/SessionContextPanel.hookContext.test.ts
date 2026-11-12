import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SessionContextPanel } from '../../../../src/renderer/components/chat/SessionContextPanel';

import type { HookContextInjection } from '../../../../src/renderer/types/contextInjection';

describe('SessionContextPanel hook context', () => {
  it('renders hook-provided context in the expanded context panel', () => {
    const injection: HookContextInjection = {
      id: 'hook-context-ai-0',
      category: 'hook-context',
      turnIndex: 0,
      aiGroupId: 'ai-0',
      estimatedTokens: 12,
      breakdown: [
        {
          label: 'PostToolUse:Bash',
          text: 'Run the focused checks before the next tool call.',
          tokenCount: 12,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(SessionContextPanel, {
        injections: [injection],
        selectedPhase: null,
        onPhaseChange: () => undefined,
      })
    );

    expect(markup).toContain('Hook Context');
    expect(markup).toContain('PostToolUse:Bash');
    expect(markup).toContain('Run the focused checks before the next tool call.');
  });
});
