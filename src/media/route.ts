import type { MediaKind } from '../types/studio';

/**
 * One drop zone, one picker: whatever the visitor hands over goes to the right
 * pipeline. A clip wins when both arrive together — the studio can only grade
 * one kind at a time, and the stills can be added back through the slots.
 */
export type RoutedFiles =
  | { kind: 'video'; file: File; photos: File[] }
  | { kind: 'photos'; files: File[] };

const PHOTO_EXT = /\.(jpe?g|png|webp|avif|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|ogv)$/i;

export function kindOfFile(file: File): MediaKind | null {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'photo';
  if (type.startsWith('video/')) return 'video';
  const name = file.name || '';
  if (PHOTO_EXT.test(name)) return 'photo';
  if (VIDEO_EXT.test(name)) return 'video';
  return null;
}

export function routeFiles(files: File[], limit = 4): RoutedFiles | null {
  const list = files.filter(Boolean);
  if (!list.length) return null;
  const video = list.find((file) => kindOfFile(file) === 'video');
  const photos = list
    .filter((file) => kindOfFile(file) === 'photo')
    .slice(0, Math.max(1, limit));
  if (video) return { kind: 'video', file: video, photos };
  if (photos.length) return { kind: 'photos', files: photos };
  return null;
}
