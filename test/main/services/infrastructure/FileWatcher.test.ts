import { EventEmitter } from 'events';
import type * as FsType from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    watch: vi.fn(),
    // Stash the real existsSync so tests can delegate to it for real file I/O
    __realExistsSync: actual.existsSync,
  };
});

vi.mock('../../../../src/main/services/error/ErrorDetector', () => ({
  errorDetector: {
    detectErrors: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../../src/main/services/infrastructure/ConfigManager', () => ({
  ConfigManager: {
    getInstance: () => ({
      getConfig: () => ({
        notifications: { includeSubagentErrors: true, triggers: [] },
      }),
    }),
  },
}));

vi.mock('../../../../src/main/services/discovery/ProjectPathResolver', () => ({
  projectPathResolver: {
    invalidateProject: vi.fn(),
  },
}));

import * as fs from 'fs';

import { errorDetector } from '../../../../src/main/services/error/ErrorDetector';
import { DataCache } from '../../../../src/main/services/infrastructure/DataCache';
import { FileWatcher } from '../../../../src/main/services/infrastructure/FileWatcher';

function createFakeWatcher(): FsType.FSWatcher {
  const emitter = new EventEmitter() as EventEmitter & { close: () => void };
  emitter.close = vi.fn(() => {
    emitter.emit('close');
  });
  return emitter as unknown as FsType.FSWatcher;
}

/** Make existsSync delegate to the real implementation (needed for tests with real temp files) */
function useRealExistsSync() {
  const realFn = (fs as unknown as { __realExistsSync: typeof fs.existsSync }).__realExistsSync;
  vi.mocked(fs.existsSync).mockImplementation((p) => realFn(p));
}

function createMockNotificationManager() {
  return {
    addError: vi.fn().mockResolvedValue(null),
  } as unknown as Parameters<FileWatcher['setNotificationManager']>[0];
}

/** Helper to write a valid JSONL line */
function jsonlLine(uuid: string, text: string): string {
  return (
    JSON.stringify({
      type: 'assistant',
      uuid,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    }) + '\n'
  );
}

describe('FileWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries and starts watchers when directories appear later', () => {
    const dataCache = new DataCache(50, 10, false);
    let dirsAvailable = false;

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockImplementation((targetPath) => {
      if (targetPath === '/tmp/projects' || targetPath === '/tmp/todos') {
        return dirsAvailable;
      }
      return false;
    });

    const watchMock = vi.mocked(fs.watch);
    watchMock.mockImplementation(() => createFakeWatcher());

    const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');
    watcher.start();

    expect(watchMock).toHaveBeenCalledTimes(0);

    dirsAvailable = true;
    vi.advanceTimersByTime(2000);

    expect(watchMock).toHaveBeenCalledTimes(2);
    watcher.stop();
  });

  it('recovers from watcher errors by re-registering affected watcher', () => {
    const dataCache = new DataCache(50, 10, false);
    const projectWatcher = createFakeWatcher();
    const todoWatcher = createFakeWatcher();
    const replacementProjectWatcher = createFakeWatcher();

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockImplementation((targetPath) => {
      return targetPath === '/tmp/projects' || targetPath === '/tmp/todos';
    });

    const watchMock = vi.mocked(fs.watch);
    watchMock
      .mockImplementationOnce(() => projectWatcher)
      .mockImplementationOnce(() => todoWatcher)
      .mockImplementationOnce(() => replacementProjectWatcher);

    const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');
    watcher.start();
    expect(watchMock).toHaveBeenCalledTimes(2);

    (projectWatcher as unknown as EventEmitter).emit('error', new Error('watch failed'));
    vi.advanceTimersByTime(2000);

    expect(watchMock).toHaveBeenCalledTimes(3);
    watcher.stop();
  });

  it('keeps append offset pinned for partial trailing lines until completed', async () => {
    vi.useRealTimers();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-'));
    const filePath = path.join(tempDir, 'session.jsonl');
    const firstLine = jsonlLine('a1', 'hi');
    fs.writeFileSync(filePath, firstLine, 'utf8');

    const dataCache = new DataCache(50, 10, false);
    const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');

    const firstPass = await (
      watcher as unknown as {
        parseAppendedMessages: (
          targetPath: string,
          startOffset: number
        ) => Promise<{ parsedLineCount: number; consumedBytes: number }>;
      }
    ).parseAppendedMessages(filePath, 0);
    expect(firstPass.parsedLineCount).toBe(1);
    expect(firstPass.consumedBytes).toBe(Buffer.byteLength(firstLine, 'utf8'));

    const partialSuffix =
      '{"type":"assistant","uuid":"a2","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"partial"';
    fs.appendFileSync(filePath, partialSuffix, 'utf8');

    const partialPass = await (
      watcher as unknown as {
        parseAppendedMessages: (
          targetPath: string,
          startOffset: number
        ) => Promise<{ parsedLineCount: number; consumedBytes: number }>;
      }
    ).parseAppendedMessages(filePath, firstPass.consumedBytes);
    expect(partialPass.parsedLineCount).toBe(0);
    expect(partialPass.consumedBytes).toBe(0);

    const completion = '}]}}\n';
    fs.appendFileSync(filePath, completion, 'utf8');

    const completedPass = await (
      watcher as unknown as {
        parseAppendedMessages: (
          targetPath: string,
          startOffset: number
        ) => Promise<{ parsedLineCount: number; consumedBytes: number }>;
      }
    ).parseAppendedMessages(filePath, firstPass.consumedBytes);
    expect(completedPass.parsedLineCount).toBe(1);
    expect(completedPass.consumedBytes).toBeGreaterThan(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Catch-Up Scan Tests
  // ===========================================================================

  describe('catch-up scan', () => {
    it('detects file growth missed by fs.watch', async () => {
      vi.useRealTimers();
      useRealExistsSync();
      vi.mocked(errorDetector.detectErrors).mockResolvedValue([]);

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-catchup-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      const line1 = jsonlLine('u1', 'hello');
      fs.writeFileSync(filePath, line1, 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      // Simulate having previously processed the file by directly setting tracking state
      const watcherAny = watcher as unknown as {
        lastProcessedLineCount: Map<string, number>;
        lastProcessedSize: Map<string, number>;
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        runCatchUpScan: () => Promise<void>;
      };
      const initialSize = fs.statSync(filePath).size;
      watcherAny.lastProcessedLineCount.set(filePath, 1);
      watcherAny.lastProcessedSize.set(filePath, initialSize);
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'session-1',
      });

      // Append new data WITHOUT triggering fs.watch (simulating a missed event)
      const line2 = jsonlLine('u2', 'world');
      fs.appendFileSync(filePath, line2, 'utf8');

      // Run catch-up scan manually
      await watcherAny.runCatchUpScan();

      // The error detector should have been called with the new message
      expect(errorDetector.detectErrors).toHaveBeenCalled();
      const calls = vi.mocked(errorDetector.detectErrors).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toBe('session-1');
      expect(lastCall[2]).toBe('test-project');

      // Verify tracking state was updated
      expect(watcherAny.lastProcessedLineCount.get(filePath)).toBe(2);
      expect(watcherAny.lastProcessedSize.get(filePath)).toBeGreaterThan(initialSize);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('skips files with no size change', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-noop-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      const line1 = jsonlLine('u1', 'hello');
      fs.writeFileSync(filePath, line1, 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      const watcherAny = watcher as unknown as {
        lastProcessedLineCount: Map<string, number>;
        lastProcessedSize: Map<string, number>;
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        runCatchUpScan: () => Promise<void>;
      };
      const currentSize = fs.statSync(filePath).size;
      watcherAny.lastProcessedLineCount.set(filePath, 1);
      watcherAny.lastProcessedSize.set(filePath, currentSize);
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'session-1',
      });

      vi.mocked(errorDetector.detectErrors).mockClear();

      // Run catch-up scan without any file changes
      await watcherAny.runCatchUpScan();

      // Error detector should NOT have been called since file hasn't changed
      expect(errorDetector.detectErrors).not.toHaveBeenCalled();

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('removes stale files older than 1 hour from active tracking', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-stale-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'old-session.jsonl');
      fs.writeFileSync(filePath, jsonlLine('u1', 'old'), 'utf8');

      // Set file mtime to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      const watcherAny = watcher as unknown as {
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        lastProcessedSize: Map<string, number>;
        runCatchUpScan: () => Promise<void>;
      };
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'old-session',
      });
      watcherAny.lastProcessedSize.set(filePath, 0);

      await watcherAny.runCatchUpScan();

      // Stale file should be removed from active tracking
      expect(watcherAny.activeSessionFiles.has(filePath)).toBe(false);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('handles deleted files gracefully during catch-up scan', async () => {
      vi.useRealTimers();

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');
      watcher.setNotificationManager(notificationManager);

      const filePath = '/tmp/projects/test-project/nonexistent.jsonl';

      const watcherAny = watcher as unknown as {
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        lastProcessedSize: Map<string, number>;
        lastProcessedLineCount: Map<string, number>;
        runCatchUpScan: () => Promise<void>;
      };
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'nonexistent',
      });
      watcherAny.lastProcessedSize.set(filePath, 100);
      watcherAny.lastProcessedLineCount.set(filePath, 5);

      // Should not throw
      await watcherAny.runCatchUpScan();

      // Deleted file should be cleaned up
      expect(watcherAny.activeSessionFiles.has(filePath)).toBe(false);
      expect(watcherAny.lastProcessedSize.has(filePath)).toBe(false);
      expect(watcherAny.lastProcessedLineCount.has(filePath)).toBe(false);

      watcher.stop();
    });
  });

  // ===========================================================================
  // Concurrency Guard Tests
  // ===========================================================================

  describe('concurrency guard', () => {
    it('prevents concurrent processing of the same file', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-concurrent-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      fs.writeFileSync(filePath, jsonlLine('u1', 'hello'), 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      // Make detectErrors slow to simulate long processing
      let detectResolve: () => void;
      const detectPromise = new Promise<void>((resolve) => {
        detectResolve = resolve;
      });
      vi.mocked(errorDetector.detectErrors).mockImplementation(
        () =>
          new Promise((resolve) => {
            detectPromise.then(() => resolve([]));
          })
      );

      const watcherAny = watcher as unknown as {
        detectErrorsInSessionFile: (
          projectId: string,
          sessionId: string,
          filePath: string
        ) => Promise<void>;
        processingInProgress: Set<string>;
        pendingReprocess: Set<string>;
      };

      // Start first call (will block on detectErrors)
      const first = watcherAny.detectErrorsInSessionFile('test-project', 'session-1', filePath);

      // Wait a tick so the first call enters the processing block and reaches detectErrors
      await new Promise((r) => setTimeout(r, 50));

      // Verify the file is marked as processing
      expect(watcherAny.processingInProgress.has(filePath)).toBe(true);

      // Second call should be deferred (returns immediately)
      const second = watcherAny.detectErrorsInSessionFile('test-project', 'session-1', filePath);
      await second;

      // Verify pending reprocess was set
      expect(watcherAny.pendingReprocess.has(filePath)).toBe(true);

      // Resolve the slow detectErrors
      detectResolve!();
      await first;

      // After first completes, pending reprocess triggers a re-run
      // Wait for the re-run to complete
      await new Promise((r) => setTimeout(r, 100));

      // pendingReprocess should be cleared after reprocessing
      expect(watcherAny.pendingReprocess.has(filePath)).toBe(false);
      expect(watcherAny.processingInProgress.has(filePath)).toBe(false);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  // ===========================================================================
  // Fallback Size Tracking Tests
  // ===========================================================================

  describe('lastProcessedSize in fallback path', () => {
    it('re-stats file after full parse to capture concurrent writes', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-size-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      const line1 = jsonlLine('u1', 'hello');
      fs.writeFileSync(filePath, line1, 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      vi.mocked(errorDetector.detectErrors).mockResolvedValue([]);

      const watcherAny = watcher as unknown as {
        detectErrorsInSessionFile: (
          projectId: string,
          sessionId: string,
          filePath: string
        ) => Promise<void>;
        lastProcessedSize: Map<string, number>;
        lastProcessedLineCount: Map<string, number>;
      };

      // First call - fallback path (no lastProcessedLineCount)
      await watcherAny.detectErrorsInSessionFile('test-project', 'session-1', filePath);

      // The lastProcessedSize should match the actual file size on disk
      const actualSize = fs.statSync(filePath).size;
      expect(watcherAny.lastProcessedSize.get(filePath)).toBe(actualSize);
      expect(watcherAny.lastProcessedLineCount.get(filePath)).toBe(1);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  // ===========================================================================
  // Timer Lifecycle Tests
  // ===========================================================================

  describe('timer lifecycle', () => {
    it('starts catch-up timer on start() and clears on stop()', () => {
      const dataCache = new DataCache(50, 10, false);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.watch).mockImplementation(() => createFakeWatcher());

      const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');

      const watcherAny = watcher as unknown as {
        catchUpTimer: NodeJS.Timeout | null;
      };

      expect(watcherAny.catchUpTimer).toBeNull();

      watcher.start();
      expect(watcherAny.catchUpTimer).not.toBeNull();

      watcher.stop();
      expect(watcherAny.catchUpTimer).toBeNull();
    });

    it('clears all tracking state on stop()', () => {
      const dataCache = new DataCache(50, 10, false);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.watch).mockImplementation(() => createFakeWatcher());

      const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');

      const watcherAny = watcher as unknown as {
        activeSessionFiles: Map<string, unknown>;
        processingInProgress: Set<string>;
        pendingReprocess: Set<string>;
      };

      watcher.start();

      // Add some tracking state
      watcherAny.activeSessionFiles.set('/tmp/file.jsonl', {
        projectId: 'p',
        sessionId: 's',
      });
      watcherAny.processingInProgress.add('/tmp/file.jsonl');
      watcherAny.pendingReprocess.add('/tmp/file.jsonl');

      watcher.stop();

      expect(watcherAny.activeSessionFiles.size).toBe(0);
      expect(watcherAny.processingInProgress.size).toBe(0);
      expect(watcherAny.pendingReprocess.size).toBe(0);
    });
  });

  describe('terminal-state watcher', () => {
    /**
     * Builds a watcher over a real temp tree with a devtools-state dir, and returns
     * the raw `handleStateChange` entry point plus collected emissions.
     */
    function setupStateWatcher() {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-state-'));
      const projectsDir = path.join(tempDir, 'projects');
      const stateDir = path.join(tempDir, 'devtools-state');
      fs.mkdirSync(projectsDir, { recursive: true });
      fs.mkdirSync(stateDir, { recursive: true });

      const watcher = new FileWatcher(
        new DataCache(50, 10, false),
        projectsDir,
        path.join(tempDir, 'todos')
      );

      const terminalEvents: unknown[] = [];
      const fileEvents: unknown[] = [];
      watcher.on('terminal-state-change', (e) => terminalEvents.push(e));
      watcher.on('file-change', (e) => fileEvents.push(e));

      const handleStateChange = (eventType: string, filename: string): void =>
        (
          watcher as unknown as { handleStateChange: (t: string, f: string) => void }
        ).handleStateChange(eventType, filename);

      const cleanup = (): void => {
        watcher.stop();
        fs.rmSync(tempDir, { recursive: true, force: true });
      };

      return { stateDir, handleStateChange, terminalEvents, fileEvents, cleanup };
    }

    /** Wait past the 100ms debounce plus the async file read inside it. */
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 250));

    it('emits terminal-state-change with the state inline, not file-change', async () => {
      const s = setupStateWatcher();
      const payload = { state: 'working', ts: 1_700_000_000, cwd: '/repo' };
      fs.writeFileSync(path.join(s.stateDir, 'session-1.json'), JSON.stringify(payload), 'utf8');

      s.handleStateChange('change', 'session-1.json');
      await settle();

      expect(s.terminalEvents).toEqual([{ sessionId: 'session-1', state: payload }]);
      // Routing these through file-change is what made the sidebar refetch its page
      // on every prompt submit and tool call.
      expect(s.fileEvents).toHaveLength(0);

      s.cleanup();
    });

    it('ignores statusline snapshots', async () => {
      const s = setupStateWatcher();
      fs.writeFileSync(
        path.join(s.stateDir, 'session-1.statusline.json'),
        JSON.stringify({ model: 'opus' }),
        'utf8'
      );

      s.handleStateChange('change', 'session-1.statusline.json');
      await settle();

      // Would otherwise emit a bogus sessionId of "session-1.statusline".
      expect(s.terminalEvents).toHaveLength(0);
      expect(s.fileEvents).toHaveLength(0);

      s.cleanup();
    });

    it('emits an undefined state when the file is removed', async () => {
      const s = setupStateWatcher();

      s.handleStateChange('rename', 'session-gone.json');
      await settle();

      expect(s.terminalEvents).toEqual([{ sessionId: 'session-gone', state: undefined }]);

      s.cleanup();
    });

    // An unreadable file must not emit AT ALL. `state: undefined` on the wire means
    // "removed", and the renderer clears the session's live state when it sees it —
    // so emitting on a torn read would blank a working session's indicator mid-turn.
    it('stays silent on malformed JSON rather than reporting a cleared state', async () => {
      const s = setupStateWatcher();
      // The hook writes non-atomically, so a read can land mid-write.
      fs.writeFileSync(path.join(s.stateDir, 'session-1.json'), '{"state":"wor', 'utf8');

      s.handleStateChange('change', 'session-1.json');
      await settle();

      expect(s.terminalEvents).toHaveLength(0);

      s.cleanup();
    });

    it('stays silent when the payload has the wrong shape', async () => {
      const s = setupStateWatcher();
      // Valid JSON, but `ts` is an ISO string instead of unix seconds.
      fs.writeFileSync(
        path.join(s.stateDir, 'session-1.json'),
        JSON.stringify({ state: 'working', ts: '2026-07-25T00:00:00Z' }),
        'utf8'
      );

      s.handleStateChange('change', 'session-1.json');
      await settle();

      expect(s.terminalEvents).toHaveLength(0);

      s.cleanup();
    });

    it('drops a non-string cwd instead of passing it through', async () => {
      const s = setupStateWatcher();
      fs.writeFileSync(
        path.join(s.stateDir, 'session-1.json'),
        JSON.stringify({ state: 'working', ts: 1_700_000_000, cwd: 42 }),
        'utf8'
      );

      s.handleStateChange('change', 'session-1.json');
      await settle();

      expect(s.terminalEvents).toEqual([
        { sessionId: 'session-1', state: { state: 'working', ts: 1_700_000_000, cwd: undefined } },
      ]);

      s.cleanup();
    });
  });

  describe('session-file throttling', () => {
    // A trailing debounce resets on every event, so a file appended faster than the
    // window never fires until writes STOP — the "nothing updates until Claude is
    // done" behaviour. The throttle bounds the delay instead.
    it('fires within the window even under continuous writes', () => {
      vi.useFakeTimers();
      const watcher = new FileWatcher(new DataCache(50, 10, false), '/tmp/projects', '/tmp/todos');
      const watcherAny = watcher as unknown as {
        handleProjectsChange: (t: string, f: string) => void;
        processProjectsChange: (t: string, f: string) => Promise<void>;
      };

      const process = vi
        .spyOn(watcherAny, 'processProjectsChange')
        .mockResolvedValue(undefined as never);

      // Events arriving every 50ms, i.e. faster than the 100ms window.
      for (let i = 0; i < 6; i++) {
        watcherAny.handleProjectsChange('change', 'proj/session-1.jsonl');
        vi.advanceTimersByTime(50);
      }

      // A resetting debounce would still have fired zero times here.
      expect(process).toHaveBeenCalled();

      watcher.stop();
    });

    it('coalesces a burst into a single call', () => {
      vi.useFakeTimers();
      const watcher = new FileWatcher(new DataCache(50, 10, false), '/tmp/projects', '/tmp/todos');
      const watcherAny = watcher as unknown as {
        handleProjectsChange: (t: string, f: string) => void;
        processProjectsChange: (t: string, f: string) => Promise<void>;
      };
      const process = vi
        .spyOn(watcherAny, 'processProjectsChange')
        .mockResolvedValue(undefined as never);

      for (let i = 0; i < 10; i++) {
        watcherAny.handleProjectsChange('change', 'proj/session-1.jsonl');
      }
      vi.advanceTimersByTime(150);

      expect(process).toHaveBeenCalledTimes(1);

      watcher.stop();
    });

    // Throttling must not mean "first event wins". `changeType` only self-corrects
    // for `rename`; a leading `change` hard-codes type 'change', so a delete
    // arriving mid-window would be emitted as a modification — skipping the
    // project-wide cache sweep and error-tracking cleanup, and never telling the
    // renderer to drop the row.
    it('runs the LAST callback of a burst, not the first', () => {
      vi.useFakeTimers();
      const watcher = new FileWatcher(new DataCache(50, 10, false), '/tmp/projects', '/tmp/todos');
      const watcherAny = watcher as unknown as {
        handleProjectsChange: (t: string, f: string) => void;
        processProjectsChange: (t: string, f: string) => Promise<void>;
      };
      const process = vi
        .spyOn(watcherAny, 'processProjectsChange')
        .mockResolvedValue(undefined as never);

      watcherAny.handleProjectsChange('change', 'proj/session-1.jsonl');
      watcherAny.handleProjectsChange('rename', 'proj/session-1.jsonl');
      vi.advanceTimersByTime(150);

      expect(process).toHaveBeenCalledTimes(1);
      expect(process).toHaveBeenCalledWith('rename', 'proj/session-1.jsonl');

      watcher.stop();
    });
  });
});
