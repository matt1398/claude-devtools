/**
 * Store test utilities for creating isolated test store instances.
 */

import { create } from 'zustand';

import { createConfigSlice } from '../../../src/renderer/store/slices/configSlice';
import { createCombinedSessionsSlice } from '../../../src/renderer/store/slices/combinedSessionsSlice';
import { createConversationSlice } from '../../../src/renderer/store/slices/conversationSlice';
import { createNotificationSlice } from '../../../src/renderer/store/slices/notificationSlice';
import { createPaneSlice } from '../../../src/renderer/store/slices/paneSlice';
import { createProjectSlice } from '../../../src/renderer/store/slices/projectSlice';
import { createRepositorySlice } from '../../../src/renderer/store/slices/repositorySlice';
import { createSessionDetailSlice } from '../../../src/renderer/store/slices/sessionDetailSlice';
import { createSessionSlice } from '../../../src/renderer/store/slices/sessionSlice';
import { createSubagentSlice } from '../../../src/renderer/store/slices/subagentSlice';
import { createTabSlice } from '../../../src/renderer/store/slices/tabSlice';
import { createTabUISlice } from '../../../src/renderer/store/slices/tabUISlice';
import { createUISlice } from '../../../src/renderer/store/slices/uiSlice';

import type { AppState } from '../../../src/renderer/store/types';

/**
 * Create an isolated store instance for testing.
 * Each test gets a fresh store with no shared state.
 */
export function createTestStore() {
  return create<AppState>()((...args) => ({
    ...createProjectSlice(...args),
    ...createRepositorySlice(...args),
    ...createCombinedSessionsSlice(...args),
    ...createSessionSlice(...args),
    ...createSessionDetailSlice(...args),
    ...createSubagentSlice(...args),
    ...createConversationSlice(...args),
    ...createTabSlice(...args),
    ...createTabUISlice(...args),
    ...createPaneSlice(...args),
    ...createUISlice(...args),
    ...createNotificationSlice(...args),
    ...createConfigSlice(...args),
  }));
}

export type TestStore = ReturnType<typeof createTestStore>;
