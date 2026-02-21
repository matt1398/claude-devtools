/**
 * Render Helpers
 *
 * Shared rendering functions for tool input and output.
 */

import React from 'react';

import {
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  DIFF_ADDED_TEXT,
  DIFF_REMOVED_TEXT,
} from '@renderer/constants/cssVariables';

/**
 * Renders the input section based on tool type with theme-aware styling.
 */
export function renderInput(toolName: string, input: Record<string, unknown>): React.ReactElement {
  // Special rendering for Edit tool - show diff-like format
  if (toolName === 'Edit') {
    const filePath = input.file_path as string | undefined;
    const oldString = input.old_string as string | undefined;
    const newString = input.new_string as string | undefined;
    const replaceAll = input.replace_all as boolean | undefined;

    return (
      <div className="space-y-2">
        {filePath && (
          <div className="mb-2 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
            {filePath}
            {replaceAll && (
              <span className="ml-2" style={{ color: COLOR_TEXT_MUTED }}>
                (replace all)
              </span>
            )}
          </div>
        )}
        {oldString && (
          <div className="whitespace-pre-wrap break-all" style={{ color: DIFF_REMOVED_TEXT }}>
            {oldString.split('\n').map((line, i) => (
              <div key={i}>- {line}</div>
            ))}
          </div>
        )}
        {newString && (
          <div className="whitespace-pre-wrap break-all" style={{ color: DIFF_ADDED_TEXT }}>
            {newString.split('\n').map((line, i) => (
              <div key={i}>+ {line}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Special rendering for Bash tool
  if (toolName === 'Bash') {
    const command = input.command as string | undefined;
    const description = input.description as string | undefined;

    return (
      <div className="space-y-2">
        {description && (
          <div className="mb-1 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
            {description}
          </div>
        )}
        {command && (
          <code className="whitespace-pre-wrap break-all" style={{ color: COLOR_TEXT }}>
            {command}
          </code>
        )}
      </div>
    );
  }

  // Special rendering for Read tool
  if (toolName === 'Read') {
    const filePath = input.file_path as string | undefined;
    const offset = input.offset as number | undefined;
    const limit = input.limit as number | undefined;

    return (
      <div style={{ color: COLOR_TEXT }}>
        <div>{filePath}</div>
        {(offset !== undefined || limit !== undefined) && (
          <div className="mt-1 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
            {offset !== undefined && `offset: ${offset}`}
            {offset !== undefined && limit !== undefined && ', '}
            {limit !== undefined && `limit: ${limit}`}
          </div>
        )}
      </div>
    );
  }

  // Default: key-value format with readable string values
  return (
    <div className="space-y-2" style={{ color: COLOR_TEXT }}>
      {Object.entries(input).map(([key, value]) => (
        <div key={key}>
          <div className="text-xs" style={{ color: COLOR_TEXT_MUTED }}>
            {key}
          </div>
          <pre className="whitespace-pre-wrap break-all">{formatInputValue(value)}</pre>
        </div>
      ))}
    </div>
  );
}

function formatInputValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Renders the output section with theme-aware styling.
 */
/**
 * Extracts display text from tool output content.
 * Handles content block arrays from the API by extracting text fields
 * and pretty-printing JSON when possible.
 */
export function extractOutputText(content: string | unknown[]): string {
  let displayText: string;

  // Normalize: if content is a string that parses to an array of content blocks, treat as array
  let normalizedContent: string | unknown[] = content;
  if (typeof content === 'string') {
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0 && isContentBlock(parsed[0])) {
        normalizedContent = parsed as unknown[];
      }
    } catch {
      // Not JSON, keep as string
    }
  }

  if (typeof normalizedContent === 'string') {
    displayText = normalizedContent;
  } else if (Array.isArray(normalizedContent)) {
    // Extract text from content blocks (e.g. [{"type":"text","text":"..."}])
    displayText = normalizedContent
      .map((block) =>
        typeof block === 'object' && block !== null && 'text' in block
          ? (block as { text: string }).text
          : JSON.stringify(block, null, 2),
      )
      .join('\n');
  } else {
    displayText = JSON.stringify(normalizedContent, null, 2);
  }

  // Try to pretty-print if the extracted text is valid JSON
  try {
    const parsed: unknown = JSON.parse(displayText);
    displayText = JSON.stringify(parsed, null, 2);
  } catch {
    // Not JSON, use as-is
  }

  return displayText;
}

function isContentBlock(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Record<string, unknown>).type === 'string'
  );
}

export function renderOutput(content: string | unknown[]): React.ReactElement {
  const displayText = extractOutputText(content);
  return (
    <pre className="whitespace-pre-wrap break-all" style={{ color: COLOR_TEXT }}>
      {displayText}
    </pre>
  );
}
