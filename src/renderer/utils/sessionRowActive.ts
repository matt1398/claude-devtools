import type { Session } from '@renderer/types/data';

export interface ActiveSessionIdentity {
  selectedSessionId: string | null;
  selectedProjectId: string | null;
  activeProjectId: string | null;
  activeContextId: string;
  combinedModeEnabled: boolean;
}

export function isSessionRowActive(
  session: Pick<Session, 'id' | 'projectId' | 'contextId'>,
  identity: ActiveSessionIdentity
): boolean {
  if (identity.selectedSessionId !== session.id) {
    return false;
  }
  if (!identity.combinedModeEnabled) {
    return true;
  }

  const selectedProject = identity.selectedProjectId ?? identity.activeProjectId;
  if (selectedProject && session.projectId !== selectedProject) {
    return false;
  }

  // In combined mode, sessions without contextId can't be reliably matched —
  // two sessions with the same id from different contexts would both highlight.
  if (!session.contextId || session.contextId !== identity.activeContextId) {
    return false;
  }

  return true;
}
