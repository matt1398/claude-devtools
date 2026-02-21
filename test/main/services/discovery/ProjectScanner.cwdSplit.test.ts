import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectScanner } from '../../../../src/main/services/discovery/ProjectScanner';
import { subprojectRegistry } from '../../../../src/main/services/discovery/SubprojectRegistry';

function createSessionLine(opts: { cwd?: string; type?: string }): string {
  return JSON.stringify({
    uuid: 'test-uuid',
    type: opts.type ?? 'user',
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    message: { role: 'user', content: 'hello' },
    timestamp: new Date().toISOString(),
  });
}

describe('ProjectScanner cwd split logic', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    subprojectRegistry.clear();
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Ignore cleanup failures
      }
    }
    tempDirs.length = 0;
  });

  it('does not split when sessions have a single cwd mixed with sessions without cwd', async () => {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-'));
    tempDirs.push(projectsDir);

    // Create a project directory with encoded name
    const encodedName = '-Users-test-myproject';
    const projectDir = path.join(projectsDir, encodedName);
    fs.mkdirSync(projectDir);

    // Session WITH cwd
    fs.writeFileSync(
      path.join(projectDir, 'session-with-cwd.jsonl'),
      createSessionLine({ cwd: '/Users/test/myproject' }) + '\n'
    );

    // Session WITHOUT cwd (older format)
    fs.writeFileSync(
      path.join(projectDir, 'session-no-cwd.jsonl'),
      createSessionLine({ type: 'system' }) +
        '\n' +
        createSessionLine({ type: 'user' }) +
        '\n'
    );

    const scanner = new ProjectScanner(projectsDir);
    const projects = await scanner.scan();

    // Should produce 1 project, not 2 subprojects
    const myProjects = projects.filter((p) => p.id.includes('myproject'));
    expect(myProjects).toHaveLength(1);

    // Should use the plain encoded name, not a composite ID
    expect(myProjects[0].id).toBe(encodedName);

    // Should include both sessions
    expect(myProjects[0].sessions).toHaveLength(2);
  });

  it('splits when sessions have multiple distinct cwds', async () => {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-'));
    tempDirs.push(projectsDir);

    const encodedName = '-Users-test-myproject';
    const projectDir = path.join(projectsDir, encodedName);
    fs.mkdirSync(projectDir);

    // Session with cwd A
    fs.writeFileSync(
      path.join(projectDir, 'session-a.jsonl'),
      createSessionLine({ cwd: '/Users/test/myproject' }) + '\n'
    );

    // Session with cwd B (different)
    fs.writeFileSync(
      path.join(projectDir, 'session-b.jsonl'),
      createSessionLine({ cwd: '/Users/test/other-project' }) + '\n'
    );

    const scanner = new ProjectScanner(projectsDir);
    const projects = await scanner.scan();

    // Should produce 2 subprojects with composite IDs
    const myProjects = projects.filter((p) => p.id.includes('myproject'));
    expect(myProjects).toHaveLength(2);

    // Both should be composite IDs
    for (const proj of myProjects) {
      expect(proj.id).toContain('::');
    }
  });
});
