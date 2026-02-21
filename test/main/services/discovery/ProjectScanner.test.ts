import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectScanner } from '../../../../src/main/services/discovery/ProjectScanner';

interface DecodedCursor {
  timestamp: number;
  sessionId: string;
  projectId?: string;
}

function decodeCursor(cursor: string): DecodedCursor {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as DecodedCursor;
}

describe('ProjectScanner listRecentSessionsGlobal', () => {
  let rootDir = '';
  let projectsDir = '';
  let todosDir = '';
  let scanner: ProjectScanner;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'claude-devtools-project-scanner-'));
    projectsDir = join(rootDir, 'projects');
    todosDir = join(rootDir, 'todos');
    await mkdir(projectsDir, { recursive: true });
    await mkdir(todosDir, { recursive: true });
    scanner = new ProjectScanner(projectsDir, todosDir);
  });

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  async function createSessionFile(
    projectId: string,
    sessionId: string,
    mtimeMs: number,
    text: string
  ): Promise<void> {
    const projectPath = join(projectsDir, projectId);
    await mkdir(projectPath, { recursive: true });
    const timestamp = new Date(mtimeMs).toISOString();
    const content = `${JSON.stringify({
      uuid: `${sessionId}-msg-1`,
      type: 'user',
      timestamp,
      message: {
        role: 'user',
        content: text,
      },
      isMeta: false,
    })}\n`;
    const filePath = join(projectPath, `${sessionId}.jsonl`);
    await writeFile(filePath, content, 'utf8');
    await utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
  }

  async function createNoiseOnlySessionFile(
    projectId: string,
    sessionId: string,
    mtimeMs: number
  ): Promise<void> {
    const projectPath = join(projectsDir, projectId);
    await mkdir(projectPath, { recursive: true });
    const timestamp = new Date(mtimeMs).toISOString();
    const content = `${JSON.stringify({
      uuid: `${sessionId}-summary-1`,
      type: 'summary',
      timestamp,
      summary: 'noise-only summary',
    })}\n`;
    const filePath = join(projectPath, `${sessionId}.jsonl`);
    await writeFile(filePath, content, 'utf8');
    await utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
  }

  it('merges across projects with deterministic order and cursor paging', async () => {
    const projectA = '-Users-test-alpha';
    const projectB = '-Users-test-beta';
    const newer = Date.UTC(2025, 0, 15, 10, 30, 0);
    const older = Date.UTC(2025, 0, 15, 10, 29, 0);

    await createSessionFile(projectA, 'session-a', newer, 'alpha newest');
    await createSessionFile(projectB, 'session-b', newer, 'beta newest');
    await createSessionFile(projectA, 'session-c', older, 'alpha older');

    const page1 = await scanner.listRecentSessionsGlobal(null, 2, 'light');

    expect(page1.sessions.map((session) => `${session.projectId}/${session.id}`)).toEqual([
      `${projectA}/session-a`,
      `${projectB}/session-b`,
    ]);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.totalCount).toBe(3);

    expect(page1.sessions[0]?.createdAt).toBe(newer);
    expect(page1.sessions[1]?.createdAt).toBe(newer);

    const page2 = await scanner.listRecentSessionsGlobal(page1.nextCursor, 2, 'light');
    expect(page2.sessions.map((session) => `${session.projectId}/${session.id}`)).toEqual([
      `${projectA}/session-c`,
    ]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
    expect(page2.totalCount).toBe(3);
  });

  it('includes projectId in cursor for same-sessionId collisions across projects', async () => {
    const projectA = '-Users-test-alpha';
    const projectB = '-Users-test-beta';
    const sameTimestamp = Date.UTC(2025, 0, 15, 10, 30, 0);

    await createSessionFile(projectA, 'same-session', sameTimestamp, 'alpha');
    await createSessionFile(projectB, 'same-session', sameTimestamp, 'beta');

    const firstPage = await scanner.listRecentSessionsGlobal(null, 1, 'light');
    expect(firstPage.sessions).toHaveLength(1);
    expect(firstPage.sessions[0]?.projectId).toBe(projectA);
    expect(firstPage.nextCursor).toBeTruthy();

    const decoded = decodeCursor(firstPage.nextCursor!);
    expect(decoded.projectId).toBe(projectA);
    expect(decoded.sessionId).toBe('same-session');
    expect(decoded.timestamp).toBe(sameTimestamp);

    const secondPage = await scanner.listRecentSessionsGlobal(firstPage.nextCursor, 1, 'light');
    expect(secondPage.sessions).toHaveLength(1);
    expect(secondPage.sessions[0]?.projectId).toBe(projectB);
    expect(secondPage.sessions[0]?.id).toBe('same-session');
  });

  it('returns sorted global session file infos with limit applied', async () => {
    const projectA = '-Users-test-alpha';
    const projectB = '-Users-test-beta';
    const newer = Date.UTC(2025, 0, 15, 10, 30, 0);
    const older = Date.UTC(2025, 0, 15, 10, 29, 0);

    await createSessionFile(projectA, 'session-a', newer, 'alpha newest');
    await createSessionFile(projectB, 'session-b', newer, 'beta newest');
    await createSessionFile(projectA, 'session-c', older, 'alpha older');

    const infos = await scanner.listRecentSessionFileInfosGlobal(2);

    expect(infos).toHaveLength(2);
    expect(infos.map((info) => `${info.projectId}/${info.sessionId}`)).toEqual([
      `${projectA}/session-a`,
      `${projectB}/session-b`,
    ]);
  });

  it('preserves sub-millisecond cursor precision for synthesized global cursors', async () => {
    const project = '-Users-test-alpha';
    const base = Date.UTC(2025, 0, 15, 10, 30, 0);
    const newestMtime = base + 900.75;
    const olderSameSecondMtime = base + 900.25;

    await createSessionFile(project, 'session-a', newestMtime, 'alpha newest');
    await createSessionFile(project, 'session-b', olderSameSecondMtime, 'alpha older');

    const sessionAPath = join(projectsDir, project, 'session-a.jsonl');
    const sessionBPath = join(projectsDir, project, 'session-b.jsonl');
    const [sessionAStats, sessionBStats] = await Promise.all([stat(sessionAPath), stat(sessionBPath)]);

    const prefetchedFileInfos = [
      {
        projectId: project,
        sessionId: 'session-a',
        filePath: sessionAPath,
        mtimeMs: newestMtime,
        birthtimeMs: newestMtime,
        size: sessionAStats.size,
      },
      {
        projectId: project,
        sessionId: 'session-b',
        filePath: sessionBPath,
        mtimeMs: olderSameSecondMtime,
        birthtimeMs: olderSameSecondMtime,
        size: sessionBStats.size,
      },
    ];

    const firstPage = await scanner.listRecentSessionsGlobal(null, 1, 'light', prefetchedFileInfos);
    expect(firstPage.sessions).toHaveLength(1);
    expect(firstPage.sessions[0]?.id).toBe('session-a');

    // Combined IPC synthesizes per-context cursors from returned session metadata.
    const syntheticCursor = Buffer.from(
      JSON.stringify({
        timestamp: firstPage.sessions[0]!.createdAt,
        sessionId: firstPage.sessions[0]!.id,
        projectId: firstPage.sessions[0]!.projectId,
      })
    ).toString('base64');

    const secondPage = await scanner.listRecentSessionsGlobal(
      syntheticCursor,
      1,
      'light',
      prefetchedFileInfos
    );

    expect(secondPage.sessions).toHaveLength(1);
    expect(secondPage.sessions[0]?.id).toBe('session-b');
  });

  it('filters noise-only sessions from global listing', async () => {
    const project = '-Users-test-alpha';
    const newer = Date.UTC(2025, 0, 15, 10, 30, 0);
    const older = Date.UTC(2025, 0, 15, 10, 29, 0);

    await createNoiseOnlySessionFile(project, 'noise-session', newer);
    await createSessionFile(project, 'real-session', older, 'real user content');

    const page = await scanner.listRecentSessionsGlobal(null, 20, 'light');

    expect(page.sessions.map((session) => session.id)).toEqual(['real-session']);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('propagates global listing failures so callers can treat them as transient', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error');
    const transientError = new Error('transient-global-scan-failure');
    (
      scanner as unknown as {
        collectGlobalSessionFileInfos: () => Promise<never>;
      }
    ).collectGlobalSessionFileInfos = async () => {
      throw transientError;
    };

    await expect(scanner.listRecentSessionsGlobal(null, 20, 'light')).rejects.toThrow(
      'transient-global-scan-failure'
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockClear();
  });
});
