#!/usr/bin/env node
/**
 * leak-check — block environment-specific and secret material from being committed.
 *
 * This repo is a viewer for Claude Code sessions, so working copies sit next to
 * real session data, real ticket IDs and real credentials. Nothing about the
 * machine it was developed on belongs in the published history.
 *
 * The rules below are deliberately generic: no usernames, hostnames, project
 * names or ticket prefixes are hardcoded, so the check behaves identically for
 * every contributor.
 *
 * Usage:
 *   node scripts/leak-check.mjs              # staged changes (what the pre-commit hook runs)
 *   node scripts/leak-check.mjs --all        # every tracked file
 *   node scripts/leak-check.mjs --range A..B # lines added between two revisions
 *
 * Suppressing a false positive:
 *   - append  leak-check-ignore  to the offending line, or
 *   - add an `allow` / `path` entry to .leakcheckignore (see that file).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const INLINE_SUPPRESSION = 'leak-check-ignore';

/** Placeholder home-directory names that are examples, not real accounts. */
const PLACEHOLDER_USERS = new Set([
  'user',
  'username',
  'users',
  'you',
  'youruser',
  'me',
  'name',
  'yourname',
  'someone',
  'test',
  'testuser',
  'example',
  'foo',
  'bar',
  'baz',
  'alice',
  'bob',
  'x',
  'xxx',
  'dev',
  'developer',
  'runner',
  'root',
  'home',
]);

/**
 * Uppercase prefixes that look like issue keys but are standards, algorithms or
 * model names. Extend via `allow` lines in .leakcheckignore rather than here.
 */
const NON_TICKET_PREFIXES = new Set([
  'UTF',
  'UTF8',
  'ISO',
  'RFC',
  'SHA',
  'MD',
  'AES',
  'RSA',
  'EC',
  'CWE',
  'CVE',
  'CVSS',
  'HTTP',
  'HTTPS',
  'TLS',
  'SSL',
  'IPV',
  'BASE',
  'GPT',
  'OPUS',
  'SONNET',
  'HAIKU',
  'FABLE',
  'CLAUDE',
  'GB',
  'MB',
  'KB',
  'PROJ',
  'ABC',
  'XYZ',
  'TODO',
  'FIXME',
  'EXAMPLE',
  'SAMPLE',
  'DEMO',
  'TEST',
]);

/**
 * Each rule gets a matched substring; `check` may further validate it and
 * return false to drop the hit.
 */
const RULES = [
  {
    id: 'private-key',
    message: 'Private key material',
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  },
  {
    id: 'anthropic-key',
    message: 'Anthropic API key',
    pattern: /sk-ant-[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: 'openai-key',
    message: 'OpenAI API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g,
  },
  {
    id: 'stripe-key',
    message: 'Stripe secret key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  },
  {
    id: 'aws-key',
    message: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-token',
    message: 'GitHub token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  },
  {
    id: 'google-key',
    message: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: 'slack-token',
    message: 'Slack token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: 'npm-token',
    message: 'npm token',
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: 'connection-string',
    message: 'Connection string with inline credentials',
    // scheme://user:secret@host — flags real passwords, not user@host or empty passwords
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{3,}@[^\s/]+/gi,
    check: (m) => !/:(?:password|pass|secret|changeme|xxx+|\*+|<[^>]*>|\$\{[^}]*\})@/i.test(m),
  },
  {
    id: 'assigned-secret',
    message: 'Hardcoded secret assignment',
    // API_KEY = "…" / password: '…' with a non-placeholder literal
    pattern:
      /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi,
    check: (_m, groups) => {
      const value = groups[0] ?? '';
      if (/^[\s]*$/.test(value)) return false;
      // placeholders, env lookups, templates, format strings, types
      if (/^(?:\$\{|process\.env|import\.meta|<|\{\{|%[sd]|\*+$)/.test(value)) return false;
      // prose placeholders like "your-api-key"; the separator is required so a
      // real secret starting with one of these letters is not skipped
      if (/^(?:your|my|the|some|a)[-_ ]/i.test(value)) return false;
      if (
        /^(?:x{3,}|\.{3,}|placeholder|redacted|changeme|dummy|example|sample|test|fake|none|null|undefined|string|number|boolean)$/i.test(
          value
        )
      )
        return false;
      // needs a digit or mixed case to look like a real credential rather than prose
      return /\d/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));
    },
  },
  {
    id: 'home-path',
    message: 'Absolute path containing a real account name',
    pattern: /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)/g,
    check: (_m, groups) => {
      const name = (groups[0] ?? '').toLowerCase();
      if (PLACEHOLDER_USERS.has(name)) return false;
      // documentation ellipses: /Users/.../foo
      if (/^\.+$/.test(name)) return false;
      // template placeholders written without braces, e.g. /home/USERNAME
      if (/^[<{$]/.test(name)) return false;
      return true;
    },
  },
  {
    id: 'ticket-id',
    message: 'Issue-tracker key (may name a private project)',
    // Two or more leading letters keeps regex character classes ([A-Z0-9]) and
    // UUID fragments (A716-…) from matching.
    pattern: /\b([A-Z]{2,12})-(\d{1,6})\b/g,
    check: (_m, groups) => {
      const prefix = groups[0] ?? '';
      if (NON_TICKET_PREFIXES.has(prefix)) return false;
      return true;
    },
  },
];

/** Files that must never be committed, matched on path. */
const FORBIDDEN_PATHS = [
  { pattern: /\.jsonl$/i, message: 'Claude Code session transcript' },
  { pattern: /(^|\/)\.env(\.|$)/i, message: 'Environment file' },
  { pattern: /(^|\/)docker-compose\.override\.ya?ml$/i, message: 'Local compose override' },
  { pattern: /(^|\/)\.claude\/settings\.local\.json$/i, message: 'Local Claude settings' },
  { pattern: /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/i, message: 'SSH private key' },
  { pattern: /\.(?:pem|p12|pfx|keystore)$/i, message: 'Key or certificate store' },
];

/** Binary/vendored paths that are never worth scanning. */
const SKIP_PATHS =
  /(^|\/)(node_modules|dist|dist-electron|dist-standalone|out|release|coverage|pnpm-lock\.yaml)(\/|$)|\.(png|jpe?g|gif|svg|ico|icns|webp|woff2?|ttf|eot|mp4|zip|gz|lock)$/i;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel']).trim();
}

/** Parse .leakcheckignore into { allow: string[], paths: RegExp[] }. */
function loadIgnores(root) {
  const file = resolve(root, '.leakcheckignore');
  const result = { allow: [], paths: [] };
  if (!existsSync(file)) return result;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('allow ')) {
      result.allow.push(line.slice(6).trim());
    } else if (line.startsWith('path ')) {
      const glob = line.slice(5).trim();
      const rx = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*');
      result.paths.push(new RegExp(`^${rx}$`));
    }
  }
  return result;
}

/**
 * Collect the content to scan as { file, line, text } records.
 * Staged and range modes look only at ADDED lines, so pre-existing content in
 * an untouched file never blocks an unrelated commit.
 */
function collectAddedLines(diffArgs) {
  const out = git(diffArgs);
  const records = [];
  let file = null;
  let lineNo = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (file) records.push({ file, line: lineNo, text: line.slice(1) });
      lineNo++;
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      lineNo++;
    }
  }
  return records;
}

function collectTrackedFiles(root) {
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const records = [];
  for (const file of files) {
    if (SKIP_PATHS.test(file)) continue;
    let content;
    try {
      content = readFileSync(resolve(root, file), 'utf8');
    } catch {
      continue; // unreadable or binary
    }
    if (content.includes('\u0000')) continue;
    content.split('\n').forEach((text, i) => records.push({ file, line: i + 1, text }));
  }
  return records;
}

function changedPaths(mode, range) {
  const args =
    mode === 'staged'
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
      : mode === 'range'
        ? ['diff', '--name-only', '--diff-filter=ACMR', '-z', range]
        : ['ls-files', '-z'];
  return git(args).split('\0').filter(Boolean);
}

function main() {
  const argv = process.argv.slice(2);
  const rangeIdx = argv.indexOf('--range');
  const mode = argv.includes('--all') ? 'all' : rangeIdx !== -1 ? 'range' : 'staged';
  const range = rangeIdx !== -1 ? argv[rangeIdx + 1] : null;
  if (mode === 'range' && !range) {
    console.error('leak-check: --range needs a revision range, e.g. --range main..HEAD');
    process.exit(2);
  }

  const root = repoRoot();
  const ignores = loadIgnores(root);
  const findings = [];

  // 1. Forbidden file paths
  for (const file of changedPaths(mode, range)) {
    if (ignores.paths.some((rx) => rx.test(file))) continue;
    const hit = FORBIDDEN_PATHS.find((f) => f.pattern.test(file));
    if (hit)
      findings.push({ file, line: 0, rule: 'forbidden-file', message: hit.message, match: file });
  }

  // 2. Content rules
  const records =
    mode === 'all'
      ? collectTrackedFiles(root)
      : collectAddedLines(
          mode === 'staged'
            ? ['diff', '--cached', '--unified=0', '--diff-filter=ACMR']
            : ['diff', '--unified=0', '--diff-filter=ACMR', range]
        );

  for (const { file, line, text } of records) {
    if (SKIP_PATHS.test(file)) continue;
    if (ignores.paths.some((rx) => rx.test(file))) continue;
    if (text.includes(INLINE_SUPPRESSION)) continue;
    // Very long lines are almost always minified or encoded payloads.
    if (text.length > 2000) continue;

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(text)) !== null) {
        const matched = m[0];
        if (ignores.allow.some((a) => matched.includes(a))) continue;
        if (rule.check && !rule.check(matched, m.slice(1))) continue;
        findings.push({ file, line, rule: rule.id, message: rule.message, match: matched });
      }
    }
  }

  if (findings.length === 0) {
    const scope = mode === 'all' ? 'tracked files' : mode === 'range' ? range : 'staged changes';
    console.log(`leak-check: clean (${scope})`);
    return;
  }

  console.error(`\nleak-check: ${findings.length} potential leak(s) found\n`);
  for (const f of findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    console.error(`  ${where}\n    [${f.rule}] ${f.message}: ${truncate(f.match)}`);
  }
  console.error(`
Nothing above should reach a public history. Fix by replacing the value with a
placeholder, or — if it is genuinely safe — suppress it:

  • append  ${INLINE_SUPPRESSION}  to that line
  • or add an 'allow <text>' / 'path <glob>' entry to .leakcheckignore

To bypass the hook entirely (discouraged): git commit --no-verify
`);
  process.exit(1);
}

function truncate(s) {
  const flat = s.replace(/\s+/g, ' ');
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

main();
