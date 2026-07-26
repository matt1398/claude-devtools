import * as os from 'os';
import * as path from 'path';

/**
 * Utility functions for encoding/decoding Claude Code project directory names.
 *
 * Directory naming pattern:
 * - Path: /Users/username/projectname
 * - Encoded: -Users-username-projectname
 *
 * IMPORTANT: This encoding is LOSSY for paths containing dashes.
 * For accurate path resolution, use extractCwd() from jsonl.ts to read
 * the actual cwd from session files.
 */

// =============================================================================
// Core Encoding/Decoding
// =============================================================================

/**
 * Encodes an absolute path into Claude Code's directory naming format.
 * Replaces all path separators (/ and \) with dashes.
 *
 * @param absolutePath - The absolute path to encode (e.g., "/Users/username/projectname")
 * @returns The encoded directory name (e.g., "-Users-username-projectname")
 */
export function encodePath(absolutePath: string): string {
  if (!absolutePath) {
    return '';
  }

  const encoded = absolutePath.replace(/[/\\]/g, '-');

  // Ensure leading dash for absolute paths
  return encoded.startsWith('-') ? encoded : `-${encoded}`;
}

/**
 * Decodes a project directory name to its original path.
 * Note: This is a best-effort decode. Paths with dashes cannot be decoded accurately.
 *
 * @param encodedName - The encoded directory name (e.g., "-Users-username-projectname")
 * @returns The decoded path (e.g., "/Users/username/projectname")
 */
export function decodePath(encodedName: string): string {
  if (!encodedName) {
    return '';
  }

  // Legacy Windows format observed in some Claude installs: "C--Users-name-project"
  // (no leading dash, drive separator encoded as "--").
  const legacyWindowsRegex = /^([a-zA-Z])--(.+)$/;
  const legacyWindowsMatch = legacyWindowsRegex.exec(encodedName);
  if (legacyWindowsMatch) {
    const drive = legacyWindowsMatch[1].toUpperCase();
    const rest = legacyWindowsMatch[2].replace(/-/g, '/');
    return `${drive}:/${rest}`;
  }

  // Remove leading dash if present (indicates absolute path)
  const withoutLeadingDash = encodedName.startsWith('-') ? encodedName.slice(1) : encodedName;

  // Replace dashes with slashes
  const decodedPath = withoutLeadingDash.replace(/-/g, '/');

  // Windows paths may decode to "C:/..."
  if (/^[a-zA-Z]:\//.test(decodedPath)) {
    return decodedPath;
  }

  // Ensure leading slash for POSIX-style absolute paths
  const absolutePath = decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;

  // Translate WSL mount paths to Windows drive-letter paths on Windows
  return translateWslMountPath(absolutePath);
}

/**
 * Extract the project name (last path segment) from an encoded directory name.
 *
 * @param encodedName - The encoded directory name
 * @returns The project name
 */
export function extractProjectName(encodedName: string, cwdHint?: string): string {
  // Prefer cwdHint (actual filesystem path) since decodePath is lossy for
  // paths containing dashes (e.g., "claude-devtools" → "claude/code/context").
  if (cwdHint) {
    const segments = cwdHint.split(/[/\\]/).filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return last;
  }
  const decoded = decodePath(encodedName);
  const segments = decoded.split('/').filter(Boolean);
  return segments[segments.length - 1] || encodedName;
}

/**
 * Translate WSL mount paths (/mnt/X/...) to Windows drive-letter paths (X:/...)
 * when running on Windows. No-op on other platforms.
 */
export function translateWslMountPath(posixPath: string): string {
  if (process.platform !== 'win32') {
    return posixPath;
  }
  const match = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(posixPath);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2] ?? '';
    return `${drive}:${rest}`;
  }
  return posixPath;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validates if a directory name follows the Claude Code encoding pattern.
 *
 * @param encodedName - The directory name to validate
 * @returns true if valid, false otherwise
 */
export function isValidEncodedPath(encodedName: string): boolean {
  if (!encodedName) {
    return false;
  }

  // Support legacy Windows format: "C--Users-name-project"
  // (no leading dash, drive separator encoded as "--").
  if (/^[a-zA-Z]--[a-zA-Z0-9_.\s-]+$/.test(encodedName)) {
    return true;
  }

  // Must start with a dash (indicates absolute path)
  if (!encodedName.startsWith('-')) {
    return false;
  }

  // Allow only expected encoded characters:
  // - alphanumeric, underscores, dots, spaces, dashes
  // - optional ":" for Windows drive notation (e.g., -C:-Users-name-project)
  const validPattern = /^-[a-zA-Z0-9_.\s:-]+$/;
  if (!validPattern.test(encodedName)) {
    return false;
  }

  // Windows-style drive syntax is allowed only at the beginning after "-"
  // e.g. "-C:-Users-name-project". Reject stray ":" elsewhere.
  const firstColon = encodedName.indexOf(':');
  if (firstColon === -1) {
    return true;
  }

  if (!/^-[a-zA-Z]:/.test(encodedName)) {
    return false;
  }

  return !encodedName.includes(':', firstColon + 1);
}

/**
 * Validates a project ID that may be either a plain encoded path or
 * a composite subproject ID (`{encodedPath}::{8-char-hex}`).
 *
 * @param projectId - The project ID to validate
 * @returns true if valid
 */
export function isValidProjectId(projectId: string): boolean {
  if (!projectId) {
    return false;
  }

  const sep = projectId.indexOf('::');
  if (sep === -1) {
    // Plain encoded path
    return isValidEncodedPath(projectId);
  }

  // Composite ID: validate base part and hash suffix
  const basePart = projectId.slice(0, sep);
  const hashPart = projectId.slice(sep + 2);

  return isValidEncodedPath(basePart) && /^[a-f0-9]{8}$/.test(hashPart);
}

/**
 * Extract the base directory (encoded path) from a project ID.
 * For composite IDs (`{encoded}::{hash}`), returns the encoded part.
 * For plain IDs, returns the ID as-is.
 */
export function extractBaseDir(projectId: string): string {
  const sep = projectId.indexOf('::');
  if (sep !== -1) {
    return projectId.slice(0, sep);
  }
  return projectId;
}

// =============================================================================
// Session ID Extraction
// =============================================================================

/**
 * Extract session ID from a JSONL filename.
 *
 * @param filename - The filename (e.g., "abc123.jsonl")
 * @returns The session ID (e.g., "abc123")
 */
export function extractSessionId(filename: string): string {
  return filename.replace(/\.jsonl$/, '');
}

// =============================================================================
// Path Construction
// =============================================================================

/**
 * Construct the path to a session JSONL file.
 * Handles composite project IDs by extracting the base directory.
 */
export function buildSessionPath(basePath: string, projectId: string, sessionId: string): string {
  return path.join(basePath, extractBaseDir(projectId), `${sessionId}.jsonl`);
}

/**
 * Construct the path to a session's subagents directory.
 * Handles composite project IDs by extracting the base directory.
 */
export function buildSubagentsPath(basePath: string, projectId: string, sessionId: string): string {
  return path.join(basePath, extractBaseDir(projectId), sessionId, 'subagents');
}

/**
 * Construct the path to a task list file (stored in todos directory).
 */
export function buildTodoPath(claudeBasePath: string, sessionId: string): string {
  return path.join(claudeBasePath, 'todos', `${sessionId}.json`);
}

// =============================================================================
// Home Directory
// =============================================================================

/**
 * Get the user's home directory.
 */
function getHomeDir(): string {
  const windowsHome =
    process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : null;
  return process.env.HOME || process.env.USERPROFILE || windowsHome || os.homedir() || '/';
}

let claudeBasePathOverride: string | null = null;

function getDefaultClaudeBasePath(): string {
  return path.join(getHomeDir(), '.claude');
}

/**
 * Get the auto-detected Claude config base path (~/.claude) without considering overrides.
 */
export function getAutoDetectedClaudeBasePath(): string {
  return getDefaultClaudeBasePath();
}

function normalizeOverridePath(claudeBasePath: string): string | null {
  const trimmed = claudeBasePath.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = path.normalize(trimmed);
  if (!path.isAbsolute(normalized)) {
    return null;
  }

  const resolved = path.resolve(normalized);
  const root = path.parse(resolved).root;
  if (resolved === root) {
    return resolved;
  }
  let end = resolved.length;
  while (end > root.length) {
    const char = resolved[end - 1];
    if (char !== '/' && char !== '\\') {
      break;
    }
    end--;
  }

  return resolved.slice(0, end);
}

/**
 * Override the Claude config base path (~/.claude).
 * Pass null to return to auto-detection.
 */
export function setClaudeBasePathOverride(claudeBasePath: string | null | undefined): void {
  if (claudeBasePath == null) {
    claudeBasePathOverride = null;
    return;
  }

  claudeBasePathOverride = normalizeOverridePath(claudeBasePath);
}

/**
 * Get the Claude config base path (~/.claude).
 */
export function getClaudeBasePath(): string {
  return claudeBasePathOverride ?? getDefaultClaudeBasePath();
}

/**
 * Get the projects directory path (~/.claude/projects).
 */
export function getProjectsBasePath(): string {
  return path.join(getClaudeBasePath(), 'projects');
}

/**
 * Get the todos directory path (~/.claude/todos).
 */
export function getTodosBasePath(): string {
  return path.join(getClaudeBasePath(), 'todos');
}

/**
 * Get the devtools terminal-state directory path (~/.claude/devtools-state).
 * A sibling of projects/; an external hook writes one <sessionId>.json per live
 * session here. Derived from the same CLAUDE_ROOT base as projects/todos.
 */
export function getDevtoolsStateBasePath(): string {
  return path.join(getClaudeBasePath(), 'devtools-state');
}
