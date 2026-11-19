import type { MediaInfo } from '../types/studio';
import { EMPTY_META } from '../types/studio';
import { formatDateTime, readPhotoMeta } from './metadata';

export interface LoadedPhoto {
  info: MediaInfo;
  drawable: HTMLImageElement;
}

export interface LoadedVideo {
  info: MediaInfo;
  video: HTMLVideoElement;
}

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

export function kindOfFile(file: File): 'photo' | 'video' | null {
  const type = (file.type || '').toLowerCase();
  if (PHOTO_TYPES.includes(type)) return 'photo';
  if (VIDEO_TYPES.includes(type)) return 'video';
  const name = file.name.toLowerCase();
  if (/\.(jpe?g|png|webp)$/.test(name)) return 'photo';
  if (/\.(mp4|mov|m4v|webm)$/.test(name)) return 'video';
  return null;
}

export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  const [meta, url] = await Promise.all([readPhotoMeta(file), Promise.resolve(URL.createObjectURL(file))]);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`사진을 열 수 없습니다: ${file.name}`));
    img.src = url;
  });
  return {
    info: {
      kind: 'photo',
      name: file.name,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
      duration: 0,
      fps: 0,
      size: file.size,
      meta: meta,
    },
    drawable: image,
  };
}

export async function loadVideo(file: File): Promise<LoadedVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.loop = false;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    const onReady = () => resolve();
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', () => reject(new Error(`영상을 열 수 없습니다: ${file.name}`)), { once: true });
    // Some browsers only fire `loadeddata` after a nudge.
    setTimeout(() => {
      if (video.readyState >= 2) resolve();
    }, 4000);
  });

  const fps = await probeFrameRate(file);
  return {
    info: {
      kind: 'video',
      name: file.name,
      url,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      fps,
      size: file.size,
      meta: {
        ...EMPTY_META,
        // A clip has no EXIF: the file name becomes the caption and the file's
        // own timestamp the shooting date, both editable on the plate.
        caption: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
        datetime: formatDateTime(new Date(file.lastModified || Date.now())),
      },
    },
    video,
  };
}

/** Exact-ish frame rate from the container; falls back to a sane 30. */
export async function probeFrameRate(file: Blob): Promise<number> {
  try {
    const { Input, ALL_FORMATS, BlobSource } = await import('mediabunny');
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) return 30;
      const metrics = await track.computeFrameRateMetrics({ targetPacketCount: 60 });
      const rate = metrics.underlyingFrameRate ?? metrics.bestGuessFrameRate ?? metrics.medianFrameRate;
      return Number.isFinite(rate) && rate > 0 ? Math.min(120, Math.round(rate * 100) / 100) : 30;
    } finally {
      input.dispose();
    }
  } catch {
    return 30;
  }
}

export function releaseMedia(info: MediaInfo | null): void {
  if (!info) return;
  if (info.url.startsWith('blob:')) URL.revokeObjectURL(info.url);
}
