import { describe, expect, it } from 'vitest';

import { buildResumeCommand } from '../../../src/renderer/utils/resumeCommand';

describe('buildResumeCommand', () => {
  it('returns the bare resume command when no working directory is known', () => {
    expect(buildResumeCommand('abc-123')).toBe("claude --resume 'abc-123'");
  });

  it('prefixes a cd into the session working directory when it is known', () => {
    expect(buildResumeCommand('abc-123', '/Users/me/project')).toBe(
      "cd '/Users/me/project' && claude --resume 'abc-123'"
    );
  });

  it('quotes working directories that contain spaces', () => {
    expect(buildResumeCommand('abc-123', '/Users/me/my project')).toBe(
      "cd '/Users/me/my project' && claude --resume 'abc-123'"
    );
  });

  it('falls back to the bare command for an empty working directory', () => {
    expect(buildResumeCommand('abc-123', '')).toBe("claude --resume 'abc-123'");
  });

  it('normalizes Windows backslashes, including a trailing separator', () => {
    expect(buildResumeCommand('abc-123', 'C:\\Users\\me\\project\\')).toBe(
      "cd 'C:/Users/me/project/' && claude --resume 'abc-123'"
    );
  });

  it('shell-quotes the working directory and session ID', () => {
    expect(buildResumeCommand("abc'; echo injected", "/Users/me/$HOME's project")).toBe(
      "cd '/Users/me/$HOME'\\''s project' && claude --resume 'abc'\\''; echo injected'"
    );
  });
});
