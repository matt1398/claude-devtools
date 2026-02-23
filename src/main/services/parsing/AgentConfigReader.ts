/**
 * Agent Config Reader
 *
 * Reads `.claude/agents/*.md` files from a project directory and extracts
 * frontmatter metadata (name, color) for use in subagent visualization.
 */

import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

import type { AgentConfig } from '@shared/types/api';

const logger = createLogger('AgentConfigReader');

/**
 * Parse simple YAML frontmatter from markdown content.
 * Only extracts top-level scalar key: value pairs between --- delimiters.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Read agent config files from a project's `.claude/agents/` directory.
 * Returns a map of agent name → config (with optional color).
 */
export async function readAgentConfigs(
  projectRoot: string
): Promise<Record<string, AgentConfig>> {
  const agentsDir = path.join(projectRoot, '.claude', 'agents');
  const result: Record<string, AgentConfig> = {};

  try {
    const entries = await fs.promises.readdir(agentsDir);
    const mdFiles = entries.filter((f) => f.endsWith('.md'));

    await Promise.all(
      mdFiles.map(async (filename) => {
        try {
          const content = await fs.promises.readFile(path.join(agentsDir, filename), 'utf8');
          const frontmatter = parseFrontmatter(content);
          const name = frontmatter.name || filename.replace(/\.md$/, '');
          const config: AgentConfig = { name };
          if (frontmatter.color) {
            config.color = frontmatter.color;
          }
          result[name] = config;
        } catch {
          // Skip unreadable files
        }
      })
    );
  } catch {
    // Directory doesn't exist or unreadable — normal for projects without custom agents
    logger.debug(`No agents directory at ${agentsDir}`);
  }

  return result;
}
