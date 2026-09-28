import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { ScratchpadReader } from '../../../../src/main/services/discovery/ScratchpadReader';

const PROJECT_ID = '-Users-test-proj';
const SESSION_ID = '5b345536-76de-41e2-8b92-b5f7e0aeff36';

describe('ScratchpadReader', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function setup(files: Record<string, string | Buffer> = {}): {
    tmpRoot: string;
    scratchpad: string;
    reader: ScratchpadReader;
  } {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scratchpad-reader-'));
    tempDirs.push(tmpRoot);
    const scratchpad = path.join(tmpRoot, PROJECT_ID, SESSION_ID, 'scratchpad');
    fs.mkdirSync(scratchpad, { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(scratchpad, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return { tmpRoot, scratchpad, reader: new ScratchpadReader([tmpRoot]) };
  }

  it('reports a missing scratchpad without throwing', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scratchpad-reader-'));
    tempDirs.push(tmpRoot);
    const reader = new ScratchpadReader([tmpRoot]);

    const listing = await reader.list(PROJECT_ID, SESSION_ID, '');

    expect(listing.exists).toBe(false);
    expect(listing.entries).toEqual([]);
    expect(listing.rootPath).toBe(path.join(tmpRoot, PROJECT_ID, SESSION_ID, 'scratchpad'));
  });

  it('uses the base dir of a composite project id', () => {
    const { reader, scratchpad } = setup();

    expect(reader.getRootPath(`${PROJECT_ID}::abcd1234`, SESSION_ID)).toBe(scratchpad);
  });

  it('picks the first candidate root that holds the session', () => {
    const { tmpRoot, scratchpad } = setup();
    const reader = new ScratchpadReader([path.join(tmpRoot, 'absent'), tmpRoot]);

    expect(reader.getRootPath(PROJECT_ID, SESSION_ID)).toBe(scratchpad);
  });

  it('lists one level, directories first, with posix relative paths', async () => {
    const { reader } = setup({
      'b.txt': 'b',
      'a.md': '# a',
      'sub/inner/deep.json': '{}',
      'sub/file10.txt': 'x',
      'sub/file2.txt': 'y',
    });

    const root = await reader.list(PROJECT_ID, SESSION_ID, '');
    expect(root.exists).toBe(true);
    expect(root.entries.map((e) => [e.name, e.isDirectory])).toEqual([
      ['sub', true],
      ['a.md', false],
      ['b.txt', false],
    ]);

    const sub = await reader.list(PROJECT_ID, SESSION_ID, 'sub');
    expect(sub.entries.map((e) => e.relativePath)).toEqual([
      'sub/inner',
      'sub/file2.txt',
      'sub/file10.txt',
    ]);
  });

  it('rejects paths that escape the scratchpad', async () => {
    const { reader, tmpRoot } = setup({ 'ok.txt': 'ok' });
    fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), 'secret');

    await expect(reader.readFile(PROJECT_ID, SESSION_ID, '../../../secret.txt')).rejects.toThrow(
      /escapes/
    );
    await expect(
      reader.readFile(PROJECT_ID, SESSION_ID, path.join(tmpRoot, 'secret.txt'))
    ).rejects.toThrow(/relative/);
    await expect(reader.list(PROJECT_ID, SESSION_ID, '..')).rejects.toThrow(/escapes/);
  });

  it('rejects symlinks that point outside the scratchpad', async () => {
    const { reader, tmpRoot, scratchpad } = setup();
    fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), 'secret');
    fs.symlinkSync(path.join(tmpRoot, 'secret.txt'), path.join(scratchpad, 'link.txt'));

    await expect(reader.readFile(PROJECT_ID, SESSION_ID, 'link.txt')).rejects.toThrow(/escapes/);
  });

  it('reads text files', async () => {
    const { reader } = setup({ 'notes/plan.md': '# Plan\n\nstep one' });

    const { file } = await reader.readFile(PROJECT_ID, SESSION_ID, 'notes/plan.md');

    expect(file).toMatchObject({ kind: 'text', content: '# Plan\n\nstep one', truncated: false });
  });

  it('truncates large text files', async () => {
    const { reader } = setup({ 'big.log': 'x'.repeat(600 * 1024) });

    const { file } = await reader.readFile(PROJECT_ID, SESSION_ID, 'big.log');

    expect(file.kind).toBe('text');
    if (file.kind !== 'text') return;
    expect(file.truncated).toBe(true);
    expect(file.content.length).toBe(512 * 1024);
    expect(file.size).toBe(600 * 1024);
  });

  it('flags binary files instead of decoding them', async () => {
    const { reader } = setup({ 'data.bin': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]) });

    const { file } = await reader.readFile(PROJECT_ID, SESSION_ID, 'data.bin');

    expect(file).toMatchObject({ kind: 'binary', size: 6 });
  });

  it('returns images as data URLs', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { reader } = setup({ 'shot.png': png });

    const { file } = await reader.readFile(PROJECT_ID, SESSION_ID, 'shot.png');

    expect(file).toMatchObject({
      kind: 'image',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    });
  });

  it('reports a missing file plainly', async () => {
    const { reader } = setup();

    await expect(reader.readFile(PROJECT_ID, SESSION_ID, 'gone.md')).rejects.toThrow(
      'No longer exists: gone.md'
    );
  });

  it('refuses to read a directory as a file', async () => {
    const { reader } = setup({ 'sub/x.txt': 'x' });

    await expect(reader.readFile(PROJECT_ID, SESSION_ID, 'sub')).rejects.toThrow(/Not a file/);
  });
});
