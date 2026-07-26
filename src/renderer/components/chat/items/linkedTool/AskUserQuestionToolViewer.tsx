/**
 * AskUserQuestionToolViewer
 *
 * Renders AskUserQuestion tool calls readably: each question with its options,
 * and — parsed from the tool result — the answer the user actually selected or
 * typed, with the chosen option highlighted.
 */

import React from 'react';

import { COLOR_TEXT, COLOR_TEXT_MUTED } from '@renderer/constants/cssVariables';
import { Check } from 'lucide-react';

import { extractOutputText } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface AskUserQuestionToolViewerProps {
  linkedTool: LinkedToolItem;
}

/**
 * The AskUserQuestion result is a summary string of the form:
 *   Your questions have been answered: "<question>"="<answer>", "<q2>"="<a2>". ...
 * Parse it into a question -> answer map. Multi-select answers arrive as one
 * comma-joined string; "Other" answers arrive as the typed free text.
 */
function parseAnswers(resultText: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /"([^"]*)"\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(resultText)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

export const AskUserQuestionToolViewer: React.FC<AskUserQuestionToolViewerProps> = ({
  linkedTool,
}) => {
  const input = linkedTool.input as Record<string, unknown>;
  const questions = Array.isArray(input.questions)
    ? (input.questions as Array<Record<string, unknown>>)
    : [];

  const resultText = linkedTool.result ? extractOutputText(linkedTool.result.content) : '';
  const answers = parseAnswers(resultText);

  return (
    <div className="space-y-4" style={{ color: COLOR_TEXT }}>
      {questions.map((q, qi) => {
        const header = q.header as string | undefined;
        const question = (q.question as string | undefined) ?? '';
        const multiSelect = q.multiSelect === true;
        const options = Array.isArray(q.options)
          ? (q.options as Array<Record<string, unknown>>)
          : [];

        const answer = answers.get(question);
        // Multi-select answers are comma-joined; split into a set for matching.
        const selected = new Set(
          answer
            ? answer.split(',').map((s) => s.trim()).filter(Boolean)
            : []
        );
        const optionLabels = new Set(
          options.map((o) => (o.label as string | undefined) ?? '').filter(Boolean)
        );
        // Anything in the answer that isn't a known option label was typed ("Other").
        const typed = answer
          ? answer
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s && !optionLabels.has(s))
          : [];

        return (
          <div key={qi} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {header && (
                <span
                  className="rounded px-1.5 py-0.5 text-xs"
                  style={{
                    backgroundColor: 'var(--tag-bg)',
                    color: 'var(--tag-text)',
                    border: '1px solid var(--tag-border)',
                  }}
                >
                  {header}
                </span>
              )}
              {multiSelect && (
                <span className="text-xs" style={{ color: COLOR_TEXT_MUTED }}>
                  multi-select
                </span>
              )}
            </div>

            {question && <div className="text-sm font-medium">{question}</div>}

            {/* Prominent answer line */}
            {answer && (
              <div
                className="flex items-start gap-1.5 rounded px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: 'var(--tool-result-success-bg)',
                  border: '1px solid var(--tool-result-success-border)',
                  color: 'var(--tool-result-success-text)',
                }}
              >
                <Check className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="opacity-70">Answered: </span>
                  <span className="font-medium">{answer}</span>
                </span>
              </div>
            )}

            {options.length > 0 && (
              <ul className="space-y-1.5">
                {options.map((opt, oi) => {
                  const label = (opt.label as string | undefined) ?? '';
                  const description = opt.description as string | undefined;
                  const preview = opt.preview as string | undefined;
                  const isSelected = selected.has(label);
                  return (
                    <li
                      key={oi}
                      className="rounded px-2.5 py-1.5"
                      style={{
                        backgroundColor: isSelected
                          ? 'var(--tool-result-success-bg)'
                          : 'var(--code-bg)',
                        border: `1px solid ${
                          isSelected ? 'var(--tool-result-success-border)' : 'var(--code-border)'
                        }`,
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        {isSelected && (
                          <Check
                            className="size-4 shrink-0"
                            style={{ color: 'var(--tool-result-success-text)' }}
                          />
                        )}
                        {label && <div className="text-sm font-medium">{label}</div>}
                      </div>
                      {description && (
                        <div className="mt-0.5 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
                          {description}
                        </div>
                      )}
                      {preview && (
                        <pre
                          className="mt-1 whitespace-pre-wrap break-all rounded p-2 font-mono text-xs"
                          style={{ backgroundColor: 'var(--code-header-bg)', color: COLOR_TEXT }}
                        >
                          {preview}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Free-text ("Other") answers that didn't match any option */}
            {typed.map((t, ti) => (
              <div
                key={ti}
                className="rounded px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: 'var(--code-bg)',
                  border: '1px dashed var(--code-border)',
                }}
              >
                <span className="opacity-70" style={{ color: COLOR_TEXT_MUTED }}>
                  Typed:{' '}
                </span>
                <span className="font-medium">{t}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};
