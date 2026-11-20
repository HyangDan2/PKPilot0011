import { kindOfFile } from './route';
import type { MediaKind } from '../types/studio';

/**
 * A workspace is a folder the visitor pointed at: photo and video files kept
 * as they arrived, opened one at a time. Nothing is decoded until an entry is
 * opened, so a folder of four hundred clips is still a list, not a load.
 */
export interface WorkspaceFile {
  id: string;
  /** The file's own name, printed on the card. */
  name: string;
  /** Path inside the folder, without the folder itself: `day2/IMG_0042.jpg`. */
  path: string;
  kind: MediaKind;
  size: number;
  file: File;
}

export type WorkspaceSort = 'name' | 'reverse' | 'kind';
export type WorkspaceFilter = 'all' | 'photo' | 'video';

export interface WorkspaceScan {
  /** The folder's own name, shown in the strip header. */
  name: string;
  entries: WorkspaceFile[];
}

/** The still formats the studio can actually open (see `loadPhoto`). */
const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;
/** The clip formats the studio can actually open (see `loadVideo`). */
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm']);

/** Only formats both pipelines accept: a listed file must be an openable file. */
export function workspaceKind(file: File): MediaKind | null {
  const name = file.name || '';
  if (VIDEO_EXT.test(name)) return 'video';
  if (PHOTO_EXT.test(name)) return 'photo';
  // A name with an extension the studio cannot open stays out even when the
  // MIME type looks familiar: a .dng or a .heic would only fail later.
  if (/\.[a-z0-9]{1,6}$/i.test(name)) return null;
  const type = (file.type || '').toLowerCase();
  if (VIDEO_TYPES.has(type) || type.startsWith('video/')) return kindOfFile(file);
  if (PHOTO_TYPES.has(type) || type.startsWith('image/')) return kindOfFile(file);
  return null;
}

function rawPath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath || file.name;
}

/** `Root/day2/a.jpg` → `day2/a.jpg`; a loose file keeps its own name. */
export function relativePathOf(file: File): string {
  const parts = rawPath(file).split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : parts[0] ?? file.name;
}

/** `Root/day2/a.jpg` → `Root`; loose files have no folder, so they share one name. */
function rootNameOf(files: File[]): string {
  for (const file of files) {
    const parts = rawPath(file).split('/').filter(Boolean);
    if (parts.length > 1) return parts[0];
  }
  return '사진 · 동영상';
}

export function entryId(path: string, file: File): string {
  return `${path}#${file.size}#${file.lastModified}`;
}

/**
 * The files a folder picker or a `<input webkitdirectory>` handed over, as
 * workspace entries. `recursive: false` keeps only the folder's own files.
 */
export function entriesFromFiles(
  files: File[],
  options: { recursive?: boolean; name?: string } = {},
): WorkspaceScan {
  const recursive = options.recursive ?? true;
  const seen = new Set<string>();
  const entries: WorkspaceFile[] = [];
  for (const file of files) {
    const kind = workspaceKind(file);
    if (!kind) continue;
    const path = relativePathOf(file);
    if (!recursive && path.includes('/')) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    entries.push({
      id: entryId(path, file),
      name: file.name,
      path,
      kind,
      size: file.size,
      file,
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path, 'ko', { numeric: true }));
  return { name: options.name?.trim() || rootNameOf(files), entries };
}

function byPath(a: WorkspaceFile, b: WorkspaceFile): number {
  return a.path.localeCompare(b.path, 'ko', { numeric: true });
}

export function sortWorkspace(entries: WorkspaceFile[], sort: WorkspaceSort): WorkspaceFile[] {
  const copy = [...entries];
  if (sort === 'reverse') copy.sort((a, b) => byPath(b, a));
  else if (sort === 'kind') copy.sort((a, b) => (a.kind === b.kind ? byPath(a, b) : a.kind === 'photo' ? -1 : 1));
  else copy.sort(byPath);
  return copy;
}

export function filterWorkspace(entries: WorkspaceFile[], filter: WorkspaceFilter): WorkspaceFile[] {
  if (filter === 'all') return [...entries];
  return entries.filter((entry) => entry.kind === filter);
}

/** What the strip shows, in the order the ← / → keys walk it. */
export function visibleWorkspace(
  entries: WorkspaceFile[],
  sort: WorkspaceSort,
  filter: WorkspaceFilter,
): WorkspaceFile[] {
  return sortWorkspace(filterWorkspace(entries, filter), sort);
}

/** `6.2` → `0:06`; a clip of a minute or more keeps its minutes. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function workspaceSummary(entries: WorkspaceFile[]): string {
  const photos = entries.filter((entry) => entry.kind === 'photo').length;
  const videos = entries.length - photos;
  if (!videos) return `사진 ${photos}장`;
  if (!photos) return `영상 ${videos}개`;
  return `사진 ${photos}장 · 영상 ${videos}개`;
}

/* ── the directory picker ────────────────────────────────────────────────
   Chrome, Edge and Samsung Internet hand out a real directory handle;
   Safari and Firefox do not, so the caller falls back to a
   `<input webkitdirectory>` and the same entry list is built from the files
   it returns. */

export interface FsFileHandle {
  kind?: 'file';
  name: string;
  getFile: () => Promise<File>;
}

export interface FsDirectoryHandle {
  kind?: 'directory';
  name: string;
  values: () => AsyncIterable<FsFileHandle | FsDirectoryHandle>;
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirectoryHandle>;
}

export function hasDirectoryPicker(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as unknown as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FsDirectoryHandle> {
  const picker = (window as unknown as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('이 브라우저는 폴더 선택을 지원하지 않습니다.');
  return picker.call(window, { mode: 'read' });
}

export interface ScanOptions {
  recursive: boolean;
  signal?: { cancelled: boolean };
  /** Called every so often so a large folder fills the strip while it scans. */
  onBatch?: (batch: WorkspaceFile[]) => void;
  batchSize?: number;
}

/**
 * Walk a directory handle, collecting the files the studio can open.
 *
 * The walk is breadth-first and yields in batches: a folder with a thousand
 * photographs shows its first cards long before the last folder is read. Any
 * error on one file (a permission, a name the OS rejects) skips that file
 * rather than ending the scan.
 */
export async function scanDirectory(handle: FsDirectoryHandle, options: ScanOptions): Promise<WorkspaceFile[]> {
  const batchSize = options.batchSize ?? 24;
  const entries: WorkspaceFile[] = [];
  const seen = new Set<string>();
  let pending: WorkspaceFile[] = [];

  const flush = (force = false) => {
    if (!pending.length) return;
    if (!force && pending.length < batchSize) return;
    const batch = pending;
    pending = [];
    options.onBatch?.(batch);
  };

  const walk = async (directory: FsDirectoryHandle, prefix: string): Promise<void> => {
    const children: (FsFileHandle | FsDirectoryHandle)[] = [];
    for await (const child of directory.values()) {
      if (options.signal?.cancelled) return;
      children.push(child);
    }
    children.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
    const folders: FsDirectoryHandle[] = [];
    for (const child of children) {
      if (options.signal?.cancelled) return;
      if (!child.kind || child.kind === 'file') {
        try {
          const file = await (child as FsFileHandle).getFile();
          const kind = workspaceKind(file);
          if (!kind) continue;
          const path = prefix ? `${prefix}/${child.name}` : child.name;
          if (seen.has(path)) continue;
          seen.add(path);
          const entry: WorkspaceFile = {
            id: entryId(path, file),
            name: file.name || child.name,
            path,
            kind,
            size: file.size,
            file,
          };
          entries.push(entry);
          pending.push(entry);
          flush();
        } catch {
          /* one unreadable file must not end the scan */
        }
      } else {
        folders.push(child as FsDirectoryHandle);
      }
    }
    if (!options.recursive) return;
    for (const folder of folders) {
      if (options.signal?.cancelled) return;
      await walk(folder, prefix ? `${prefix}/${folder.name}` : folder.name);
    }
  };

  await walk(handle, '');
  flush(true);
  entries.sort(byPath);
  return entries;
}
