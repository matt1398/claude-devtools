/**
 * SkillToolViewer
 *
 * Renders the Skill tool with its instructions in a code block viewer style.
 */

import React from 'react';

import { CodeBlockViewer } from '@renderer/components/chat/viewers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface SkillToolViewerProps {
  linkedTool: LinkedToolItem;
}

export const SkillToolViewer: React.FC<SkillToolViewerProps> = React.memo(({ linkedTool }) => {
  const skillInstructions = linkedTool.skillInstructions;
  const skillName = (linkedTool.input.skill as string) || 'Unknown Skill';

  const resultContent = linkedTool.result?.content;
  const resultText =
    typeof resultContent === 'string'
      ? resultContent
      : Array.isArray(resultContent)
        ? resultContent
            .map((item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item)))
            .join('\n')
        : '';

  return (
    <div className="space-y-3">
      {/* Initial result */}
      {resultText && (
        <div>
          <div className="mb-1 text-xs" style={{ color: 'var(--tool-item-muted)' }}>
            Result
          </div>
          <div
            className="overflow-x-auto rounded p-3 font-mono text-xs"
            style={{
              backgroundColor: 'var(--code-bg)',
              border: '1px solid var(--code-border)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {resultText}
          </div>
        </div>
      )}

      {/* Skill instructions */}
      {skillInstructions && (
        <div>
          <div className="mb-1 text-xs" style={{ color: 'var(--tool-item-muted)' }}>
            Skill Instructions
          </div>
          <CodeBlockViewer
            fileName={`${skillName} skill`}
            content={skillInstructions}
            startLine={1}
          />
        </div>
      )}
    </div>
  );
});
