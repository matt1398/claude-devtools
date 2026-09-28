import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  Notification: class MockNotification {
    static isSupported = vi.fn().mockReturnValue(true);
    show = vi.fn();
    on = vi.fn();
  },
}));

vi.mock('../../../../src/main/services/discovery/ProjectPathResolver', () => ({
  projectPathResolver: {
    resolveProjectPath: vi.fn().mockResolvedValue('/mock/path'),
    invalidateProject: vi.fn(),
  },
}));

vi.mock('../../../../src/main/services/parsing/GitIdentityResolver', () => ({
  gitIdentityResolver: {
    resolveIdentity: vi.fn().mockResolvedValue(null),
  },
}));

import { NotificationManager, type DetectedError } from '../../../../src/main/services/infrastructure/NotificationManager';
import { ConfigManager } from '../../../../src/main/services/infrastructure/ConfigManager';

function createSampleError(overrides: Partial<DetectedError> = {}): DetectedError {
  return {
    id: 'test-error-id',
    timestamp: Date.now(),
    sessionId: 'session-test',
    projectId: 'project-test',
    filePath: '/path/to/session.jsonl',
    source: 'tool_result',
    message: 'Command failed with exit code 1',
    isRead: false,
    createdAt: Date.now(),
    context: {
      projectName: 'test-project',
    },
    ...overrides,
  };
}

describe('NotificationManager', () => {
  let tempConfigDir: string;
  let configManager: ConfigManager;

  beforeEach(() => {
    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-test-'));
    const configPath = path.join(tempConfigDir, 'config.json');
    configManager = new ConfigManager(configPath);
  });

  afterEach(() => {
    fs.rmSync(tempConfigDir, { recursive: true, force: true });
    NotificationManager.resetInstance();
    vi.restoreAllMocks();
  });

  it('rejects historical errors occurring before manager start time', async () => {
    const manager = new NotificationManager(configManager);
    const baselineTime = Date.now();
    manager.setStartTime(baselineTime);

    // Error from 1 hour ago
    const historicalError = createSampleError({
      timestamp: baselineTime - 3600 * 1000,
      message: 'Old bash tool failure',
    });

    const result = await manager.addError(historicalError);

    // Should be dropped
    expect(result).toBeNull();
    const notifications = await manager.getNotifications({ limit: 10 });
    expect(notifications.notifications.length).toBe(0);
  });

  it('accepts new errors occurring after manager start time', async () => {
    const manager = new NotificationManager(configManager);
    const baselineTime = Date.now();
    manager.setStartTime(baselineTime);

    // New error from now
    const newError = createSampleError({
      timestamp: baselineTime + 100,
      message: 'Fresh bash tool failure',
    });

    const result = await manager.addError(newError);

    expect(result).not.toBeNull();
    expect(result?.message).toBe('Fresh bash tool failure');
    const notifications = await manager.getNotifications({ limit: 10 });
    expect(notifications.notifications.length).toBe(1);
    expect(notifications.notifications[0].message).toBe('Fresh bash tool failure');
  });

  it('supports getting and setting start time', () => {
    const manager = new NotificationManager(configManager);
    const customTime = 1234567890;
    manager.setStartTime(customTime);
    expect(manager.getStartTime()).toBe(customTime);
  });
});
