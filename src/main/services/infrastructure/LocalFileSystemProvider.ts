/**
 * LocalFileSystemProvider - FileSystemProvider backed by Node's fs module.
 *
 * Thin wrapper around Node.js filesystem APIs.
 * This is the default provider used when operating in local mode.
 */

import * as fs from 'fs';

import type {
  FileSystemProvider,
  FsDirent,
  FsStatResult,
  ReadStreamOptions,
} from './FileSystemProvider';

export class LocalFileSystemProvider implements FileSystemProvider {
  readonly type = 'local' as const;

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    return fs.promises.readFile(filePath, encoding);
  }

  async stat(filePath: string): Promise<FsStatResult> {
    const stats = await fs.promises.stat(filePath);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      birthtimeMs: stats.birthtimeMs,
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory(),
    };
  }

  async readdir(dirPath: string): Promise<FsDirent[]> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    // Stat all entries concurrently to populate mtimeMs, used by SessionSearcher's
    // mtime-based cache invalidation. Failures are silently ignored (mtimeMs stays undefined).
    return Promise.all(
      entries.map(async (entry) => {
        let mtimeMs: number | undefined;
        try {
          const stat = await fs.promises.stat(`${dirPath}/${entry.name}`);
          mtimeMs = stat.mtimeMs;
        } catch {
          // ignore
        }
        return {
          name: entry.name,
          mtimeMs,
          isFile: () => entry.isFile(),
          isDirectory: () => entry.isDirectory(),
        };
      })
    );
  }

  createReadStream(filePath: string, opts?: ReadStreamOptions): fs.ReadStream {
    return fs.createReadStream(filePath, {
      start: opts?.start,
      encoding: opts?.encoding,
    });
  }

  dispose(): void {
    // No resources to clean up for local fs
  }
}
