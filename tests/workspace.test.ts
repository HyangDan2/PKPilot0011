import { describe, expect, it, vi } from 'vitest';
import {
  entriesFromFiles,
  filterWorkspace,
  formatDuration,
  scanDirectory,
  sortWorkspace,
  visibleWorkspace,
  workspaceKind,
  workspaceSummary,
  type FsDirectoryHandle,
  type FsFileHandle,
} from '../src/media/workspace';

function file(name: string, type = 'image/jpeg', size = 8, path?: string): File {
  const created = new File([new Uint8Array(size)], name, { type });
  if (path) Object.defineProperty(created, 'webkitRelativePath', { value: path });
  return created;
}

describe('workspace entries', () => {
  it('keeps only the formats the studio can open', () => {
    expect(workspaceKind(file('a.jpg'))).toBe('photo');
    expect(workspaceKind(file('a.PNG'))).toBe('photo');
    expect(workspaceKind(file('a.webp'))).toBe('photo');
    expect(workspaceKind(file('clip.mp4'))).toBe('video');
    expect(workspaceKind(file('clip.MOV'))).toBe('video');
    expect(workspaceKind(file('notes.txt'))).toBeNull();
    expect(workspaceKind(file('raw.dng'))).toBeNull();
    // No usable extension: the file's own MIME type decides.
    expect(workspaceKind(file('IMG_0001', 'image/jpeg'))).toBe('photo');
    expect(workspaceKind(file('IMG_0002', 'video/webm'))).toBe('video');
  });

  it('drops the folder itself from every path and names the workspace after it', () => {
    const scan = entriesFromFiles([
      file('a.jpg', 'image/jpeg', 8, 'Trip/a.jpg'),
      file('b.jpg', 'image/jpeg', 8, 'Trip/day2/b.jpg'),
      file('c.txt', 'text/plain', 8, 'Trip/day2/c.txt'),
    ]);
    expect(scan.name).toBe('Trip');
    expect(scan.entries.map((entry) => entry.path)).toEqual(['a.jpg', 'day2/b.jpg']);
  });

  it('keeps only the folder\'s own files when subfolders are excluded', () => {
    const scan = entriesFromFiles(
      [file('a.jpg', 'image/jpeg', 8, 'Trip/a.jpg'), file('b.jpg', 'image/jpeg', 8, 'Trip/day2/b.jpg')],
      { recursive: false },
    );
    expect(scan.entries.map((entry) => entry.path)).toEqual(['a.jpg']);
  });

  it('gives loose files one shared name', () => {
    const scan = entriesFromFiles([file('a.jpg'), file('b.mp4', 'video/mp4')]);
    expect(scan.name).toBe('사진 · 동영상');
    expect(scan.entries).toHaveLength(2);
  });

  it('sorts naturally by path, by kind, and in reverse', () => {
    const scan = entriesFromFiles([
      file('IMG_10.jpg', 'image/jpeg', 8, 'R/IMG_10.jpg'),
      file('IMG_2.jpg', 'image/jpeg', 8, 'R/IMG_2.jpg'),
      file('clip.mp4', 'video/mp4', 8, 'R/clip.mp4'),
    ]);
    expect(sortWorkspace(scan.entries, 'name').map((entry) => entry.name)).toEqual(['clip.mp4', 'IMG_2.jpg', 'IMG_10.jpg']);
    expect(sortWorkspace(scan.entries, 'reverse').map((entry) => entry.name)).toEqual(['IMG_10.jpg', 'IMG_2.jpg', 'clip.mp4']);
    expect(sortWorkspace(scan.entries, 'kind')[0].kind).toBe('photo');
    expect(visibleWorkspace(scan.entries, 'name', 'video').map((entry) => entry.name)).toEqual(['clip.mp4']);
    expect(filterWorkspace(scan.entries, 'photo')).toHaveLength(2);
  });

  it('prints a clip length as minutes and seconds', () => {
    expect(formatDuration(6.2)).toBe('0:06');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.4)).toBe('1:05');
  });

  it('summarises stills and clips in one line', () => {
    const scan = entriesFromFiles([
      file('a.jpg'), file('b.jpg', 'image/jpeg'), file('c.mp4', 'video/mp4'),
    ]);
    expect(workspaceSummary(scan.entries)).toBe('사진 2장 · 영상 1개');
  });
});

describe('scanDirectory', () => {
  const fileHandle = (name: string, type = 'image/jpeg'): FsFileHandle => ({
    kind: 'file',
    name,
    getFile: async () => file(name, type, 16, undefined),
  });

  const directory = (name: string, children: (FsFileHandle | FsDirectoryHandle)[]): FsDirectoryHandle => ({
    kind: 'directory',
    name,
    values: async function* () { for (const child of children) yield child; } as unknown as FsDirectoryHandle['values'],
  });

  it('walks nested folders and reports them in batches', async () => {
    const handle = directory('Trip', [
      fileHandle('b.jpg'),
      directory('day2', [fileHandle('c.jpg'), fileHandle('clip.mp4', 'video/mp4')]),
    ]);
    const onBatch = vi.fn();
    const entries = await scanDirectory(handle, { recursive: true, onBatch, batchSize: 1 });
    expect(entries.map((entry) => entry.path)).toEqual(['b.jpg', 'day2/c.jpg', 'day2/clip.mp4']);
    expect(onBatch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stays in the top folder when subfolders are excluded', async () => {
    const handle = directory('Trip', [
      fileHandle('b.jpg'),
      directory('day2', [fileHandle('c.jpg')]),
    ]);
    const entries = await scanDirectory(handle, { recursive: false });
    expect(entries.map((entry) => entry.path)).toEqual(['b.jpg']);
  });

  it('skips a file the browser refuses to read', async () => {
    const broken: FsFileHandle = { kind: 'file', name: 'locked.jpg', getFile: async () => { throw new Error('denied'); } };
    const handle = directory('Trip', [broken, fileHandle('b.jpg')]);
    const entries = await scanDirectory(handle, { recursive: true });
    expect(entries.map((entry) => entry.name)).toEqual(['b.jpg']);
  });

  it('stops when the scan is cancelled', async () => {
    const handle = directory('Trip', [fileHandle('b.jpg'), directory('day2', [fileHandle('c.jpg')])]);
    const signal = { cancelled: true };
    const entries = await scanDirectory(handle, { recursive: true, signal });
    expect(entries).toHaveLength(0);
  });
});
