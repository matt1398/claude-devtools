import { type DataRoot,DEFAULT_LOCAL_ROOT_ID } from '@shared/types/roots';

import type { SshConnectionProfile } from '@shared/types';

export { DEFAULT_LOCAL_ROOT_ID };

function shortRootId(rootId: string): string {
  return rootId.slice(0, 8);
}

function normalizeHostForContextId(host: string): string {
  const trimmed = host.trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9._-]+/g, '-');
}

export function getLocalContextId(rootId: string): string {
  if (rootId === DEFAULT_LOCAL_ROOT_ID) {
    return 'local';
  }
  return `local-${shortRootId(rootId)}`;
}

export function getSshContextId(host: string, rootId: string): string {
  return `ssh-${normalizeHostForContextId(host)}-${shortRootId(rootId)}`;
}

export function getContextIdForRoot(
  root: DataRoot,
  sshProfiles: SshConnectionProfile[]
): string {
  if (root.type === 'local') {
    return getLocalContextId(root.id);
  }

  const profile = sshProfiles.find((item) => item.id === root.sshProfileId);
  if (!profile) {
    throw new Error(`SSH profile not found for root "${root.name}" (${root.id})`);
  }
  return getSshContextId(profile.host, root.id);
}

export function getRootIdForContextId(
  contextId: string,
  roots: DataRoot[],
  sshProfiles: SshConnectionProfile[]
): string | null {
  for (const root of roots) {
    try {
      if (getContextIdForRoot(root, sshProfiles) === contextId) {
        return root.id;
      }
    } catch {
      // Ignore invalid roots while matching existing context IDs.
    }
  }
  return null;
}
