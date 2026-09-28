/**
 * ScratchpadReader - Reads a Claude Code session's scratchpad directory.
 *
 * Claude Code gives every session a private scratch directory:
 *   <tmp>/claude-<uid>/<encoded-project-id>/<session-id>/scratchpad/
 *
 * where <tmp> is `CLAUDE_CODE_TMPDIR` when set, otherwise `/tmp`. The
 * <encoded-project-id> segment matches the directory name under
 * ~/.claude/projects, so it is taken from the project ID verbatim.
 *
 * The directory can be large and deeply nested, so it is listed one level at
 * a time. Every read is resolved against the real path of the scratchpad root
 * and rejected if it escapes it (including via symlinks).
 */

import { extractBaseDir } from '@main/utils/pathDecoder';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ScratchpadEntry, ScratchpadFileContent } from '@shared/types';

const SCRATCHPAD_DIR_NAME = 'scratchpad';
const MAX_DIR_ENTRIES = 1000;
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

export interface ScratchpadDirListing {
  rootPath: string;
  exists: boolean;
  entries: ScratchpadEntry[];
  truncated: boolean;
}

/**
 * Candidate per-uid temp directories, in the order Claude Code prefers them.
 */
export function getClaudeTmpRoots(): string[] {
  const uid = process.getuid?.() ?? 0;
  const bases = [process.env.CLAUDE_CODE_TMPDIR, '/tmp', os.tmpdir()].filter(
    (base): base is string => typeof base === 'string' && base.length > 0
  );
  return [...new Set(bases.map((base) => path.join(base, `claude-${uid}`)))];
}

export class ScratchpadReader {
  private readonly tmpRoots: string[];

  constructor(tmpRoots?: string[]) {
    this.tmpRoots = tmpRoots ?? getClaudeTmpRoots();
  }

  /**
   * Absolute scratchpad path for a session. Falls back to the preferred
   * location when the directory does not exist under any candidate root.
   */
  getRootPath(projectId: string, sessionId: string): string {
    const candidates = this.tmpRoots.map((root) =>
      path.join(root, extractBaseDir(projectId), sessionId, SCRATCHPAD_DIR_NAME)
    );
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
  }

  async list(
    projectId: string,
    sessionId: string,
    relativeDir: string
  ): Promise<ScratchpadDirListing> {
    const rootPath = this.getRootPath(projectId, sessionId);
    if (!fs.existsSync(rootPath)) {
      return { rootPath, exists: false, entries: [], truncated: false };
    }

    const dirPath = await this.resolveInside(rootPath, relativeDir);
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const truncated = dirents.length > MAX_DIR_ENTRIES;
    const prefix = toPosix(path.relative(await fs.promises.realpath(rootPath), dirPath));

    const entries = await Promise.all(
      dirents.slice(0, MAX_DIR_ENTRIES).map(async (dirent): Promise<ScratchpadEntry> => {
        const relativePath = prefix ? `${prefix}/${dirent.name}` : dirent.name;
        try {
          const stats = await fs.promises.stat(path.join(dirPath, dirent.name));
          return {
            name: dirent.name,
            relativePath,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          };
        } catch {
          return {
            name: dirent.name,
            relativePath,
            isDirectory: dirent.isDirectory(),
            size: 0,
            mtimeMs: 0,
          };
        }
      })
    );

    entries.sort((a, b) =>
      a.isDirectory === b.isDirectory
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        : a.isDirectory
          ? -1
          : 1
    );

    return { rootPath, exists: true, entries, truncated };
  }

  async readFile(
    projectId: string,
    sessionId: string,
    relativePath: string
  ): Promise<{ path: string; file: ScratchpadFileContent }> {
    const rootPath = this.getRootPath(projectId, sessionId);
    const filePath = await this.resolveInside(rootPath, relativePath);
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${relativePath}`);
    }
    const { size, mtimeMs } = stats;

    const mimeType = IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()];
    if (mimeType && size <= MAX_IMAGE_BYTES) {
      const data = await fs.promises.readFile(filePath);
      return {
        path: filePath,
        file: {
          kind: 'image',
          dataUrl: `data:${mimeType};base64,${data.toString('base64')}`,
          size,
          mtimeMs,
        },
      };
    }

    const head = await readHead(filePath, Math.min(size, MAX_TEXT_BYTES));
    if (mimeType || head.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { path: filePath, file: { kind: 'binary', size, mtimeMs } };
    }

    return {
      path: filePath,
      file: {
        kind: 'text',
        content: head.toString('utf8'),
        size,
        mtimeMs,
        truncated: size > MAX_TEXT_BYTES,
      },
    };
  }

  /**
   * Resolve a relative path against the scratchpad root, returning its real
   * path. Throws if the target (or anything it links to) lies outside the root.
   */
  async resolveInside(rootPath: string, relativePath: string): Promise<string> {
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Scratchpad path must be relative: ${relativePath}`);
    }
    const realRoot = await fs.promises.realpath(rootPath);
    const realTarget = await fs.promises
      .realpath(path.resolve(realRoot, relativePath || '.'))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new Error(`No longer exists: ${relativePath}`);
        throw error;
      });
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new Error(`Path escapes the scratchpad directory: ${relativePath}`);
    }
    return realTarget;
  }
}

async function readHead(filePath: string, length: number): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export const scratchpadReader = new ScratchpadReader();
