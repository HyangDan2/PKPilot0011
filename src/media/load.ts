import type { MediaInfo } from '../types/studio';
import { EMPTY_META } from '../types/studio';
import { formatDateTime, readPhotoMeta } from './metadata';
import { kindOfFile } from './route';

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

export { kindOfFile };

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
  // Autoplay has to start silent; the stage's sound toggle unmutes it as soon
  // as the visitor asks for sound.
  video.muted = true;
  video.loop = false;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  try {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => resolve();
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('error', () => reject(new Error(`영상을 열 수 없습니다: ${file.name}`)), { once: true });
      // Some browsers only fire `loadeddata` after a nudge.
      setTimeout(() => {
        if (video.readyState >= 2) resolve();
      }, 4000);
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    video.remove();
    throw error;
  }

  // A rotated phone clip reports 0×0 until its metadata is applied; exporting
  // such a plate is what crashed the encoder, so refuse it here instead.
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!(width > 0) || !(height > 0)) {
    URL.revokeObjectURL(url);
    video.remove();
    throw new Error(`영상 크기를 읽지 못했습니다: ${file.name} (다른 형식으로 다시 시도해 주세요)`);
  }

  const fps = await probeFrameRate(file);
  return {
    info: {
      kind: 'video',
      name: file.name,
      url,
      width,
      height,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      fps,
      size: file.size,
      meta: {
        ...EMPTY_META,
        // A clip has no EXIF: the file name becomes the caption and the file's
        // own timestamp the shooting date, both editable on the plate. The
        // resolution / rate / length are filled by withSpecFallback so the spec
        // row is never blank.
        caption: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
        datetime: formatDateTime(new Date(file.lastModified || Date.now())),
      },
    },
    video,
  };
}

/** Exact-ish frame rate from the container; falls back to a sane 30. */
export async function probeFrameRate(file: Blob, timeoutMs = 1500): Promise<number> {
  const work = (async () => {
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
  })();
  // Probing is a nicety: a container that stalls must not hold the stage.
  let timer = 0;
  const guard = new Promise<number>((resolve) => {
    timer = window.setTimeout(() => resolve(30), timeoutMs);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    window.clearTimeout(timer);
  }
}

export function releaseMedia(info: MediaInfo | null): void {
  if (!info) return;
  if (info.url.startsWith('blob:')) URL.revokeObjectURL(info.url);
}
