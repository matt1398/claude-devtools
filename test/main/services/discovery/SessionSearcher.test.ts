import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionSearcher } from '../../../../src/main/services/discovery/SessionSearcher';

describe('SessionSearcher', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('searches only user text and AI last text output, returning every match occurrence', async () => {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-searcher-'));
    tempDirs.push(projectsDir);

    const projectId = 'project-1';
    const sessionId = 'session-1';
    const projectPath = path.join(projectsDir, projectId);
    fs.mkdirSync(projectPath, { recursive: true });

    const sessionPath = path.join(projectPath, `${sessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        uuid: 'user-1',
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'alpha intro alpha' },
        isMeta: false,
      }),
      JSON.stringify({
        uuid: 'asst-1',
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'older alpha that should be ignored' }],
        },
      }),
      JSON.stringify({
        uuid: 'asst-2',
        type: 'assistant',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'alpha in thinking should not be matched' },
            { type: 'text', text: 'latest alpha alpha output' },
          ],
        },
      }),
    ];
    fs.writeFileSync(sessionPath, `${lines.join('\n')}\n`, 'utf8');

    const searcher = new SessionSearcher(projectsDir);
    const result = await searcher.searchSessions(projectId, 'alpha', 50);

    expect(result.totalMatches).toBe(4);
    expect(result.results).toHaveLength(4);

    const userResults = result.results.filter((entry) => entry.groupId === 'user-user-1');
    const aiResults = result.results.filter((entry) => entry.groupId === 'ai-asst-1');

    expect(userResults).toHaveLength(2);
    expect(aiResults).toHaveLength(2);
    expect(userResults.map((entry) => entry.matchIndexInItem)).toEqual([0, 1]);
    expect(aiResults.map((entry) => entry.matchIndexInItem)).toEqual([0, 1]);
    expect(result.results.some((entry) => entry.context.includes('ignored'))).toBe(false);
    expect(
      result.results.every((entry) => entry.itemType === 'user' || entry.itemType === 'ai')
    ).toBe(true);
  });

  it('matches text in code fences with plain text search', async () => {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-searcher-md-'));
    tempDirs.push(projectsDir);

    const projectId = 'project-2';
    const sessionId = 'session-2';
    const projectPath = path.join(projectsDir, projectId);
    fs.mkdirSync(projectPath, { recursive: true });

    const sessionPath = path.join(projectPath, `${sessionId}.jsonl`);
    const codeBlock = '```tsx\nconst x = 1;\n```';
    const lines = [
      JSON.stringify({
        uuid: 'user-md-1',
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'Show me tsx code' },
        isMeta: false,
      }),
      JSON.stringify({
        uuid: 'asst-md-1',
        type: 'assistant',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `Here is a code block:\n\n${codeBlock}` }],
        },
      }),
    ];
    fs.writeFileSync(sessionPath, `${lines.join('\n')}\n`, 'utf8');

    const searcher = new SessionSearcher(projectsDir);
    const result = await searcher.searchSessions(projectId, 'tsx', 50);

    // Plain text search: "tsx" matches in user text AND in the code fence identifier
    const userResults = result.results.filter((r) => r.itemType === 'user');
    const aiResults = result.results.filter((r) => r.itemType === 'ai');

    expect(userResults).toHaveLength(1);
    expect(aiResults).toHaveLength(1);
  });
});
