/**
 * Data root configuration types.
 *
 * A data root defines a source for Claude data:
 * - local root: local filesystem path
 * - ssh root: remote machine/profile + optional remote path override
 */

export const DEFAULT_LOCAL_ROOT_ID = 'default-local';

export interface LocalDataRoot {
  id: string;
  name: string;
  type: 'local';
  /** null means auto-detect local ~/.claude */
  claudeRootPath: string | null;
  order: number;
}

export interface SshDataRoot {
  id: string;
  name: string;
  type: 'ssh';
  /** References ssh.profiles[].id */
  sshProfileId: string;
  /** null means remote ~/.claude */
  remoteClaudeRootPath: string | null;
  order: number;
}

export type DataRoot = LocalDataRoot | SshDataRoot;
