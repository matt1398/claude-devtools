import * as path from 'path';

export interface RemoteWorkspacePaths {
  remoteProjectsPath?: string;
  remoteTodosPath?: string;
}

export function resolveRemoteWorkspacePaths(
  remoteClaudeRootPath: string | null | undefined,
  detectedRemoteProjectsPath: string | null
): RemoteWorkspacePaths {
  const remoteProjectsPath =
    remoteClaudeRootPath != null
      ? path.posix.join(remoteClaudeRootPath, 'projects')
      : (detectedRemoteProjectsPath ?? undefined);

  const remoteTodosPath = remoteProjectsPath
    ? remoteClaudeRootPath != null
      ? path.posix.join(remoteClaudeRootPath, 'todos')
      : path.posix.join(path.posix.dirname(remoteProjectsPath), 'todos')
    : undefined;

  return {
    remoteProjectsPath,
    remoteTodosPath,
  };
}
