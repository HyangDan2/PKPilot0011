import type { MediaInfo, PlateMeta } from '../types/studio';

function seconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value >= 1 ? `${(Math.round(value * 10) / 10).toFixed(1)}s` : `${Math.round(value * 1000)}ms`;
}

/**
 * The spec rows a plate prints even when the file carries no EXIF — the
 * resolution and, for a clip, its rate and length. `specParts()` prints
 * focal · aperture · shutter · iso, so these land in the same row the camera
 * would have used and a frame never prints an empty line.
 */
export function specFields(info: Pick<MediaInfo, 'kind' | 'width' | 'height' | 'fps' | 'duration'>): Partial<PlateMeta> {
  const size = `${Math.round(info.width)}×${Math.round(info.height)}`;
  if (info.kind === 'video') {
    const rate = Number.isFinite(info.fps) && info.fps > 0 ? `${Math.round(info.fps * 100) / 100}fps` : '';
    return {
      model: size,
      focal: rate,
      shutter: seconds(info.duration),
      aperture: '',
      iso: '',
    };
  }
  return { model: size, focal: '', aperture: '', shutter: '', iso: '' };
}

/**
 * A plate always has something to print: real EXIF when the file had it, the
 * file's own numbers where it did not.
 */
export function withSpecFallback(info: MediaInfo | null): PlateMeta {
  const base = info?.meta ?? {
    make: '', model: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '', caption: '',
  };
  if (!info) return base;
  const empty = !base.make && !base.model && !base.focal && !base.aperture && !base.shutter && !base.iso;
  if (!empty) return base;
  return { ...base, ...specFields(info) };
}
