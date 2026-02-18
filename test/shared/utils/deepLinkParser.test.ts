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
      expect(parseDeepLinkUrl('').success).toBe(false);
    });

    it('handles whitespace-padded URLs', () => {
      const result = parseDeepLinkUrl('  claude-devtools://projects  ');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects' });
    });

    // projects – bare
    it('parses bare projects URL', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects' });
    });

    it('parses projects URL with search query', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects?q=dotfiles');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects', query: 'dotfiles' });
    });

    it('URL-decodes projects search query', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects?q=my%20project');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects', query: 'my project' });
    });

    it('treats empty q param as absent (no query field)', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects?q=');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects' });
    });

    // projects/{name}
    it('parses projects URL with project name', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects/dotfiles');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects', projectName: 'dotfiles' });
    });

    it('URL-decodes project name with spaces', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects/my%20project');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects', projectName: 'my project' });
    });

    it('parses projects/{name}?q= URL', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects/dotfiles?q=clock');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'projects',
        projectName: 'dotfiles',
        query: 'clock',
      });
    });

    it('URL-decodes project search query', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects/dotfiles?q=hello%20world');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'projects',
        projectName: 'dotfiles',
        query: 'hello world',
      });
    });

    // projects/{name}/sessions/{id}
    it('parses projects/{name}/sessions/{id}', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects/dotfiles/sessions/abc-123');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'session',
        projectName: 'dotfiles',
        sessionId: 'abc-123',
      });
    });

    it('parses projects/{name}/sessions/{id}/subagents/{aid}', () => {
      const result = parseDeepLinkUrl(
        'claude-devtools://projects/dotfiles/sessions/abc-123/subagents/sub-456'
      );
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'session',
        projectName: 'dotfiles',
        sessionId: 'abc-123',
        subagentId: 'sub-456',
      });
    });

    it('rejects session URL without sessionId', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects/dotfiles/sessions');
      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId');
    });

    it('URL-decodes project name in session URL', () => {
      const result = parseDeepLinkUrl('claude-devtools://projects/my%20project/sessions/abc-123');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({
        type: 'session',
        projectName: 'my project',
        sessionId: 'abc-123',
      });
    });

    // notifications
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

    // settings
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

    // unknown / dropped routes
    it('returns unknown for unrecognized routes', () => {
      const result = parseDeepLinkUrl('claude-devtools://unknown-route');
      expect(result.success).toBe(false);
      expect(result.navigation.type).toBe('unknown');
    });

    it('returns unknown for old dashboard route', () => {
      const result = parseDeepLinkUrl('claude-devtools://dashboard');
      expect(result.success).toBe(false);
    });

    it('returns unknown for old search route', () => {
      const result = parseDeepLinkUrl('claude-devtools://search?q=hello');
      expect(result.success).toBe(false);
    });

    it('returns unknown for old session route', () => {
      const result = parseDeepLinkUrl('claude-devtools://session/-Users-name-project/abc-123');
      expect(result.success).toBe(false);
    });

    it('handles case-insensitive route names', () => {
      const result = parseDeepLinkUrl('claude-devtools://Projects');
      expect(result.success).toBe(true);
      expect(result.navigation).toEqual({ type: 'projects' });
    });
  });
});
