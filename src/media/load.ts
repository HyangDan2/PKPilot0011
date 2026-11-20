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
      hasAudio: false,
      size: file.size,
      meta: meta,
    },
    drawable: image,
  };
}

export interface VideoLoadOptions {
  /** How long the element may take to offer a usable frame before we give up. */
  timeoutMs?: number;
  /** How long the container probe may take; it never holds the stage. */
  probeTimeoutMs?: number;
}

/** How the clip element is parked in the page while it feeds the stage. */
const SOURCE_VIDEO_CLASS = 'source-video';

/**
 * Park the element in the document before a single byte is awaited. Android
 * Chrome only spins up its hardware decoder for a video that is actually in
 * the page; a detached one can sit at readyState 0 forever, which is what left
 * the stage analysing a clip that had long since arrived.
 */
function mountSourceVideo(video: HTMLVideoElement): void {
  video.className = SOURCE_VIDEO_CLASS;
  video.setAttribute('aria-hidden', 'true');
  if (typeof document !== 'undefined' && document.body && !video.parentNode) {
    document.body.appendChild(video);
  }
}

/** Give the element, its listeners and its object URL back. */
function disposeSourceVideo(video: HTMLVideoElement, url: string): void {
  video.remove();
  URL.revokeObjectURL(url);
}

/** The decoder either painted a frame or only handed us the metadata. */
export type SourceStage = 'decoded' | 'metadata';

/**
 * Wait for a clip to become usable, with a deadline that always decides.
 *
 * `loadeddata` / `canplay` mean a frame exists. `loadedmetadata` alone is
 * enough to open the stage: the playback loop decodes the first frame on the
 * visitor's play or seek, so a slow phone must not be made to wait for one.
 * Whatever happens, the element is judged at the deadline — readyState 0 or a
 * 0×0 geometry is an error, never an endless "영상을 분석하는 중…".
 */
export function waitForSourceFrame(
  video: HTMLVideoElement,
  timeoutMs = 7000,
  label = '영상',
): Promise<SourceStage> {
  return new Promise<SourceStage>((resolve, reject) => {
    let settled = false;
    let nudged = false;
    let timer = 0;
    const bound: [string, EventListener][] = [];

    const on = (name: string, handler: EventListener) => {
      bound.push([name, handler]);
      video.addEventListener(name, handler);
    };
    const cleanup = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      for (const [name, handler] of bound) video.removeEventListener(name, handler);
      bound.length = 0;
    };
    const settle = (stage: SourceStage) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(stage);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const hasGeometry = () => video.videoWidth > 0 && video.videoHeight > 0;

    // A decoded frame is the strongest signal there is: the stage can paint it.
    const onFrame = () => {
      if (video.readyState >= 2) settle('decoded');
    };
    // Metadata only means the geometry is known; nudge the decoder once so the
    // first frame arrives on its own, then let the deadline judge.
    const onMetadata = () => {
      if (!hasGeometry() || nudged) return;
      nudged = true;
      const span = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.2;
      try {
        video.currentTime = Math.min(0.05, span / 2);
      } catch {
        /* The element refused the seek; the deadline still decides. */
      }
    };

    on('loadeddata', onFrame);
    on('canplay', onFrame);
    on('loadedmetadata', onMetadata);
    on('error', () => fail(`영상을 열 수 없습니다: ${label} (파일이 손상되었거나 지원하지 않는 형식입니다)`));

    timer = window.setTimeout(() => {
      if (video.readyState >= 1 && hasGeometry()) {
        settle('metadata');
        return;
      }
      fail(video.readyState === 0
        ? `영상 데이터를 읽지 못했습니다: ${label} (파일이 손상되었거나 지원하지 않는 형식입니다)`
        : `영상 크기를 읽지 못했습니다: ${label} (다른 형식으로 다시 시도해 주세요)`);
    }, timeoutMs);

    // An element that decoded before the listeners existed still counts.
    onFrame();
  });
}

export async function loadVideo(file: File, options: VideoLoadOptions = {}): Promise<LoadedVideo> {
  const timeoutMs = options.timeoutMs ?? 7000;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  // Autoplay has to start silent; the stage's sound toggle unmutes it as soon
  // as the visitor asks for sound.
  video.muted = true;
  video.loop = false;
  video.playsInline = true;
  // Metadata only: the stage streams and decodes live, so a phone no longer
  // has to pull the whole clip in before it can show the first frame.
  video.preload = 'metadata';
  // A blob: URL is same-origin by definition. Asking for anonymous CORS on it
  // makes Android build a request path it does not need — and on some phones
  // that path is the one that ends up with no audio track at all. Only a
  // remote source is asked for CORS.
  if (!url.startsWith('blob:')) video.crossOrigin = 'anonymous';
  video.src = url;
  mountSourceVideo(video);

  try {
    await waitForSourceFrame(video, timeoutMs, file.name);

    // A rotated phone clip reports 0×0 until its metadata is applied; exporting
    // such a plate is what crashed the encoder, so refuse it here instead.
    if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) {
      throw new Error(`영상 크기를 읽지 못했습니다: ${file.name} (다른 형식으로 다시 시도해 주세요)`);
    }
    // The nudge above parked the playhead a frame in; the head is where a
    // freshly opened clip belongs.
    if (video.currentTime > 0 && video.currentTime <= 0.1) {
      try { video.currentTime = 0; } catch { /* not fatal: the loop clamps it */ }
    }
  } catch (error) {
    disposeSourceVideo(video, url);
    throw error;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const probe = await probeClip(file, options.probeTimeoutMs);
  return {
    info: {
      kind: 'video',
      name: file.name,
      url,
      width,
      height,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      fps: probe.fps,
      // A clip with no audio track must not offer a sound button that can only
      // fail. A container we could not read is assumed to have sound: the
      // element still knows, and the button is better than a hidden one.
      hasAudio: probe.hasAudio,
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

export interface ClipProbe {
  /** Frames per second as the container reports it (30 when unknown). */
  fps: number;
  /** False only when the container positively showed no audio track. */
  hasAudio: boolean;
}

/**
 * Frame rate and sound presence in one pass over the container. A phone clip
 * that was recorded with sound muted, or a screen recording with no track at
 * all, used to offer a sound button that could only ever fail.
 */
export async function probeClip(file: Blob, timeoutMs = 1500): Promise<ClipProbe> {
  const work = (async (): Promise<ClipProbe> => {
    try {
      const { Input, ALL_FORMATS, BlobSource } = await import('mediabunny');
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
      try {
        let fps = 30;
        const track = await input.getPrimaryVideoTrack();
        if (track) {
          const metrics = await track.computeFrameRateMetrics({ targetPacketCount: 60 });
          const rate = metrics.underlyingFrameRate ?? metrics.bestGuessFrameRate ?? metrics.medianFrameRate;
          if (Number.isFinite(rate) && rate > 0) fps = Math.min(120, Math.round(rate * 100) / 100);
        }
        const audioTrack = await input.getPrimaryAudioTrack();
        return { fps, hasAudio: audioTrack !== null };
      } finally {
        input.dispose();
      }
    } catch {
      // A container that will not be read is not a container without sound.
      return { fps: 30, hasAudio: true };
    }
  })();
  // Probing is a nicety: a container that stalls must not hold the stage.
  let timer = 0;
  const guard = new Promise<ClipProbe>((resolve) => {
    timer = window.setTimeout(() => resolve({ fps: 30, hasAudio: true }), timeoutMs);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    window.clearTimeout(timer);
  }
}

/** Exact-ish frame rate from the container; falls back to a sane 30. */
export async function probeFrameRate(file: Blob, timeoutMs = 1500): Promise<number> {
  return (await probeClip(file, timeoutMs)).fps;
}

export function releaseMedia(info: MediaInfo | null): void {
  if (!info) return;
  if (info.url.startsWith('blob:')) URL.revokeObjectURL(info.url);
}
