/**
 * Connection Slice - Manages SSH connection state.
 *
 * Tracks connection mode (local/ssh), connection state,
 * and provides SSH helpers that do not perform context switches.
 */

import { api } from '@renderer/api';

import type { AppState } from '../types';
import type {
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionState,
  SshLastConnection,
} from '@shared/types';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface ConnectionSlice {
  // State
  connectionMode: 'local' | 'ssh';
  connectionState: SshConnectionState;
  connectedHost: string | null;
  connectionError: string | null;
  sshConfigHosts: SshConfigHostEntry[];
  lastSshConfig: SshLastConnection | null;

  // Actions
  testConnection: (config: SshConnectionConfig) => Promise<{ success: boolean; error?: string }>;
  setConnectionStatus: (
    state: SshConnectionState,
    host: string | null,
    error: string | null
  ) => void;
  fetchSshConfigHosts: () => Promise<void>;
  resolveConfigHost: (alias: string) => Promise<SshConfigHostEntry | null>;
  loadLastConnection: () => Promise<void>;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createConnectionSlice: StateCreator<AppState, [], [], ConnectionSlice> = (
  set
) => ({
  // Initial state
  connectionMode: 'local',
  connectionState: 'disconnected',
  connectedHost: null,
  connectionError: null,
  sshConfigHosts: [],
  lastSshConfig: null,

  // Actions
  testConnection: async (
    config: SshConnectionConfig
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await api.ssh.test(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },

  setConnectionStatus: (
    state: SshConnectionState,
    host: string | null,
    error: string | null
  ): void => {
    set({
      connectionState: state,
      connectedHost: host,
      connectionError: error,
    });
  },

  fetchSshConfigHosts: async (): Promise<void> => {
    try {
      const hosts = await api.ssh.getConfigHosts();
      set({ sshConfigHosts: hosts });
    } catch {
      // Gracefully ignore - SSH config may not exist
      set({ sshConfigHosts: [] });
    }
  },

  resolveConfigHost: async (alias: string): Promise<SshConfigHostEntry | null> => {
    try {
      return await api.ssh.resolveHost(alias);
    } catch {
      return null;
    }
  },

  loadLastConnection: async (): Promise<void> => {
    try {
      const saved = await api.ssh.getLastConnection();
      set({ lastSshConfig: saved });
    } catch {
      // Gracefully ignore - no saved connection
    }
  },
});
