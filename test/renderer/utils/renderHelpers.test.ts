import { describe, expect, it } from 'vitest';

import { extractOutputText } from '../../../src/renderer/components/chat/items/linkedTool/renderHelpers';

describe('renderHelpers', () => {
  describe('extractOutputText', () => {
    it('should return plain string content as-is', () => {
      expect(extractOutputText('hello world')).toBe('hello world');
    });

    it('should pretty-print string content that is valid JSON', () => {
      const json = '{"name":"test","value":42}';
      expect(extractOutputText(json)).toBe('{\n  "name": "test",\n  "value": 42\n}');
    });

    it('should extract text from content block arrays', () => {
      const content = [{ type: 'text', text: 'hello world' }];
      expect(extractOutputText(content)).toBe('hello world');
    });

    it('should extract and pretty-print JSON from content block arrays', () => {
      const inner = { teams: [{ id: '1', name: 'Test' }] };
      const content = [{ type: 'text', text: JSON.stringify(inner) }];
      expect(extractOutputText(content)).toBe(JSON.stringify(inner, null, 2));
    });

    it('should handle serialized content block arrays (string wrapping content blocks)', () => {
      // This is what SemanticStepExtractor produces when content is an array
      const inner = { teams: [{ id: '1', name: 'Test' }] };
      const contentBlocks = [{ type: 'text', text: JSON.stringify(inner) }];
      const serialized = JSON.stringify(contentBlocks);

      const result = extractOutputText(serialized);
      expect(result).toBe(JSON.stringify(inner, null, 2));
    });

    it('should handle serialized content blocks with plain text', () => {
      const contentBlocks = [{ type: 'text', text: 'Some plain text\nwith newlines' }];
      const serialized = JSON.stringify(contentBlocks);

      const result = extractOutputText(serialized);
      expect(result).toBe('Some plain text\nwith newlines');
    });

    it('should join multiple content blocks with newlines', () => {
      const content = [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ];
      expect(extractOutputText(content)).toBe('first\nsecond');
    });

    it('should stringify non-text content blocks', () => {
      const content = [{ type: 'image', url: 'http://example.com/img.png' }];
      const result = extractOutputText(content);
      expect(result).toContain('"type": "image"');
    });
  });
});
