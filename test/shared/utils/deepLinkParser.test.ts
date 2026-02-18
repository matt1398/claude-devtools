import { describe, expect, it } from 'vitest';

import { parseDeepLinkUrl } from '@shared/utils/deepLinkParser';

describe('deepLinkParser', () => {
  describe('parseDeepLinkUrl', () => {
    // Protocol validation
    it('rejects URLs without claude-devtools:// scheme', () => {
      const result = parseDeepLinkUrl('https://example.com');
      expect(result.success).toBe(false);
      expect(result.navigation.type).toBe('unknown');
    });

    it('rejects empty string', () => {
      const result = parseDeepLinkUrl('');
      expect(result.success).toBe(false);
    });

    it('handles whitespace-padded URLs', () => {
      const result = parseDeepLinkUrl('  claude-devtools://dashboard  ');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'dashboard' });
    });

    // Dashboard
    it('parses dashboard URL', () => {
      const result = parseDeepLinkUrl('claude-devtools://dashboard');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'dashboard' });
    });

    // Session
    it('parses session URL with projectId and sessionId', () => {
      const result = parseDeepLinkUrl('claude-devtools://session/-Users-name-project/abc-123');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'session',
        projectId: '-Users-name-project',
        sessionId: 'abc-123',
      });
    });

    it('parses session URL with subagent', () => {
      const result = parseDeepLinkUrl(
        'claude-devtools://session/-Users-name-project/abc-123/subagent/sub-456'
      );
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'session',
        projectId: '-Users-name-project',
        sessionId: 'abc-123',
        subagentId: 'sub-456',
      });
    });

    it('rejects session URL without sessionId', () => {
      const result = parseDeepLinkUrl('claude-devtools://session/-Users-name-project');
      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId');
    });

    it('rejects session URL with no params', () => {
      const result = parseDeepLinkUrl('claude-devtools://session');
      expect(result.success).toBe(false);
    });

    it('handles URL-encoded projectId', () => {
      const result = parseDeepLinkUrl('claude-devtools://session/-Users-name-my%20project/abc-123');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'session',
        projectId: '-Users-name-my project',
        sessionId: 'abc-123',
      });
    });

    // Notifications
    it('parses notifications URL', () => {
      const result = parseDeepLinkUrl('claude-devtools://notifications');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'notifications' });
    });

    it('parses notifications URL with filter', () => {
      const result = parseDeepLinkUrl('claude-devtools://notifications?filter=errors');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'notifications', filter: 'errors' });
    });

    // Settings
    it('parses settings URL without section (defaults to general)', () => {
      const result = parseDeepLinkUrl('claude-devtools://settings');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'settings', section: 'general' });
    });

    it('parses settings URL with valid section', () => {
      const sections = ['general', 'connection', 'workspace', 'notifications', 'advanced'] as const;
      for (const section of sections) {
        const result = parseDeepLinkUrl(`claude-devtools://settings/${section}`);
        expect(result.success).toBe(true);
        expect(result.navigation).toEqual({ type: 'settings', section });
      }
    });

    it('defaults to general for invalid settings section', () => {
      const result = parseDeepLinkUrl('claude-devtools://settings/nonexistent');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'settings', section: 'general' });
    });

    it('handles case-insensitive settings section', () => {
      const result = parseDeepLinkUrl('claude-devtools://settings/Connection');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'settings', section: 'connection' });
    });

    // Search
    it('parses search URL with query', () => {
      const result = parseDeepLinkUrl('claude-devtools://search?q=hello%20world');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'search', query: 'hello world' });
    });

    it('parses search URL without query', () => {
      const result = parseDeepLinkUrl('claude-devtools://search');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'search', query: '' });
    });

    // Unknown routes
    it('returns unknown for unrecognized routes', () => {
      const result = parseDeepLinkUrl('claude-devtools://unknown-route');
      expect(result.success).toBe(false);
      expect(result.navigation.type).toBe('unknown');
    });

    // Case insensitive routes
    it('handles case-insensitive route names', () => {
      const result = parseDeepLinkUrl('claude-devtools://Dashboard');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'dashboard' });
    });
  });
});
