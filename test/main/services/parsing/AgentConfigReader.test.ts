import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { readAgentConfigs } from '@main/services/parsing/AgentConfigReader';

describe('readAgentConfigs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgent(filename: string, content: string): void {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, filename), content);
  }

  it('returns empty object when .claude/agents/ does not exist', async () => {
    const result = await readAgentConfigs(tmpDir);
    expect(result).toEqual({});
  });

  it('parses agent with name and color from frontmatter', async () => {
    writeAgent('test-agent.md', `---
name: test-agent
color: red
---
# Test agent
`);
    const result = await readAgentConfigs(tmpDir);
    expect(result).toEqual({
      'test-agent': { name: 'test-agent', color: 'red' },
    });
  });

  it('uses filename as name when frontmatter has no name field', async () => {
    writeAgent('my-agent.md', `---
color: blue
---
# My Agent
`);
    const result = await readAgentConfigs(tmpDir);
    expect(result['my-agent']).toBeDefined();
    expect(result['my-agent'].color).toBe('blue');
  });

  it('handles agents without color field', async () => {
    writeAgent('plain.md', `---
name: plain
description: "A plain agent"
---
Content
`);
    const result = await readAgentConfigs(tmpDir);
    expect(result.plain).toEqual({ name: 'plain' });
    expect(result.plain.color).toBeUndefined();
  });

  it('handles agents without frontmatter', async () => {
    writeAgent('no-front.md', '# Just markdown\nNo frontmatter here.');
    const result = await readAgentConfigs(tmpDir);
    expect(result['no-front']).toEqual({ name: 'no-front' });
  });

  it('reads multiple agents', async () => {
    writeAgent('a.md', `---\nname: a\ncolor: green\n---\n`);
    writeAgent('b.md', `---\nname: b\ncolor: purple\n---\n`);
    const result = await readAgentConfigs(tmpDir);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.a.color).toBe('green');
    expect(result.b.color).toBe('purple');
  });

  it('strips quotes from frontmatter values', async () => {
    writeAgent('quoted.md', `---\nname: "quoted-agent"\ncolor: 'cyan'\n---\n`);
    const result = await readAgentConfigs(tmpDir);
    expect(result['quoted-agent']).toEqual({ name: 'quoted-agent', color: 'cyan' });
  });

  it('ignores non-md files', async () => {
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'readme.txt'), 'not an agent');
    writeAgent('real.md', `---\nname: real\ncolor: red\n---\n`);
    const result = await readAgentConfigs(tmpDir);
    expect(Object.keys(result)).toEqual(['real']);
  });
});
