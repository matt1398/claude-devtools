import type { ParsedMessage } from '../types/data';

export interface HookAdditionalContext {
  label: string;
  text: string;
}

const SYSTEM_REMINDER_OPEN = '<system-reminder>';
const SYSTEM_REMINDER_CLOSE = '</system-reminder>';
const HOOK_CONTEXT_MARKER = ' hook additional context:';

/** Extracts hook additionalContext values from transcript system-reminder blocks. */
export function extractHookAdditionalContexts(
  messages: (ParsedMessage | undefined)[]
): HookAdditionalContext[] {
  const found = new Map<string, HookAdditionalContext>();

  for (const message of messages) {
    if (!message) continue;
    for (const text of getMessageText(message.content)) {
      let nextOpen = text.indexOf(SYSTEM_REMINDER_OPEN);
      while (nextOpen !== -1) {
        const contentStart = nextOpen + SYSTEM_REMINDER_OPEN.length;
        const close = text.indexOf(SYSTEM_REMINDER_CLOSE, contentStart);
        if (close === -1) break;

        const reminder = text.slice(contentStart, close).trim();
        const markerIndex = reminder.toLowerCase().indexOf(HOOK_CONTEXT_MARKER);
        if (markerIndex >= 0) {
          const label = reminder.slice(0, markerIndex).trim();
          const context = reminder.slice(markerIndex + HOOK_CONTEXT_MARKER.length).trim();
          if (label && context) {
            found.set(`${label}\n${context}`, { label, text: context });
          }
        }

        nextOpen = text.indexOf(SYSTEM_REMINDER_OPEN, close + SYSTEM_REMINDER_CLOSE.length);
      }
    }
  }

  return [...found.values()];
}

function getMessageText(content: ParsedMessage['content']): string[] {
  if (typeof content === 'string') return [content];

  const texts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      texts.push(block.text);
    } else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') {
        texts.push(block.content);
      } else {
        texts.push(...getMessageText(block.content));
      }
    }
  }
  return texts;
}
