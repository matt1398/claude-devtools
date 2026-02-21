import type { DataRoot } from '@shared/types';

export interface RootLifecycleCallbacks {
  onRootAdded?: (root: DataRoot) => Promise<void> | void;
  onRootUpdated?: (root: DataRoot) => Promise<void> | void;
  onRootRemoved?: (rootId: string) => Promise<void> | void;
  onRootActivated?: (rootId: string) => Promise<void> | void;
}

interface RootConfigSnapshot {
  roots: {
    items: DataRoot[];
    activeRootId: string;
  };
}

function areRootsEqual(left: DataRoot, right: DataRoot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function applyRootLifecycleCallbacks(
  previousConfig: RootConfigSnapshot,
  updatedConfig: RootConfigSnapshot,
  callbacks: RootLifecycleCallbacks
): Promise<void> {
  const previousRootsById = new Map(previousConfig.roots.items.map((root) => [root.id, root]));
  const updatedRootsById = new Map(updatedConfig.roots.items.map((root) => [root.id, root]));

  if (callbacks.onRootRemoved) {
    for (const previousRoot of previousConfig.roots.items) {
      if (!updatedRootsById.has(previousRoot.id)) {
        await callbacks.onRootRemoved(previousRoot.id);
      }
    }
  }

  for (const root of updatedConfig.roots.items) {
    const previousRoot = previousRootsById.get(root.id);
    if (!previousRoot) {
      if (callbacks.onRootAdded) {
        await callbacks.onRootAdded(root);
      }
      continue;
    }
    if (!areRootsEqual(previousRoot, root) && callbacks.onRootUpdated) {
      await callbacks.onRootUpdated(root);
    }
  }

  if (
    previousConfig.roots.activeRootId !== updatedConfig.roots.activeRootId &&
    callbacks.onRootActivated
  ) {
    await callbacks.onRootActivated(updatedConfig.roots.activeRootId);
  }
}
