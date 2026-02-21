import { describe, expect, it } from 'vitest';

import { extractOutputText } from '../../../src/renderer/components/chat/items/linkedTool/renderHelpers';

describe('extractOutputText', () => {
  it('should return plain string as-is', () => {
    expect(extractOutputText('hello world')).toBe('hello world');
  });

  it('should pretty-print a plain string that is valid JSON', () => {
    expect(extractOutputText('{"key":"value"}')).toBe(JSON.stringify({ key: 'value' }, null, 2));
  });

  it('should extract text from content blocks with plain text', () => {
    expect(extractOutputText([{ type: 'text', text: 'plain text' }])).toBe('plain text');
  });

  it('should extract and pretty-print JSON from content blocks', () => {
    expect(extractOutputText([{ type: 'text', text: '{"key":"value"}' }])).toBe(
      JSON.stringify({ key: 'value' }, null, 2),
    );
  });

  it('should concatenate multiple content blocks with newline', () => {
    expect(
      extractOutputText([
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ]),
    ).toBe('line one\nline two');
  });

  it('should fallback to stringify for blocks without text field', () => {
    const block = { type: 'image', url: 'http://example.com/img.png' };
    expect(extractOutputText([block])).toBe(JSON.stringify(block, null, 2));
  });
});
