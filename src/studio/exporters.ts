import type { PlateLayout, SPEmblemsApi, SPPlateApi } from '../plate/engine';
import type { FrameSettings, MediaInfo, PlateMeta, TrimRange, VideoExportOptions } from '../types/studio';
import { buildPlateLayout } from './render';
import { PhotoGrader } from './grading';
import { exportVideo, type ExportProgress, type VideoExportResult } from '../export/videoExporter';
import { clampPlateSize, evenSize, plateEdgeCap } from '../export/codecs';
import type { GradeSettings } from '../types/studio';

export interface StillExportContext {
  plate: SPPlateApi;
  emblems: SPEmblemsApi | null;
  frame: FrameSettings;
  meta: PlateMeta;
  grade: GradeSettings;
  media: MediaInfo;
  image: CanvasImageSource | null;
  /** Up to four graded sources for the multi-cut plates. */
  photos?: { info: MediaInfo; image: CanvasImageSource | null }[];
  inputGuard?: 0 | 1;
}

export interface StillResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

/** A finished export, cached so the share sheet opens from the tap itself. */
export interface PreparedFile {
  file: File;
  filename: string;
  width: number;
  height: number;
  note?: string;
  mode?: 'webcodecs' | 'mediarecorder';
}

function paintTo(canvas: HTMLCanvasElement, plate: SPPlateApi, layout: PlateLayout): void {
  canvas.width = Math.max(1, Math.round(layout.W));
  canvas.height = Math.max(1, Math.round(layout.H));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  plate.paint(ctx, layout);
}

/** The framed export's counterpart: the graded picture, edge to edge. */
function paintPlain(canvas: HTMLCanvasElement, picture: CanvasImageSource | null, width: number, height: number): void {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
  ctx.clearRect(0, 0, width, height);
  if (!picture) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(picture, 0, 0, width, height);
}

function blobOf(canvas: HTMLCanvasElement, format: 'jpeg' | 'png', quality: number): Promise<Blob> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('이미지를 만들지 못했습니다.')), mime, quality);
  });
}

/** Full-resolution 1:1 plate of the current still. Frame off = the picture alone. */
export async function exportStill(context: StillExportContext, format: 'jpeg' | 'png', quality = 0.94): Promise<StillResult> {
  const grader = new PhotoGrader();
  try {
    const { media } = context;
    const stem = media.name.replace(/\.[^.]+$/, '') || 'plate';
    if (context.frame.enabled === false) {
      const graded = context.image && grader.available
        ? await grader.render({ source: context.image, grade: context.grade, width: media.width, height: media.height, inputGuard: context.inputGuard })
        : null;
      const canvas = document.createElement('canvas');
      paintPlain(canvas, graded ?? context.image, Math.max(2, Math.round(media.width)), Math.max(2, Math.round(media.height)));
      const blob = await blobOf(canvas, format, quality);
      return {
        blob,
        filename: `${stem}-Nordlys.${format === 'png' ? 'png' : 'jpg'}`,
        width: canvas.width,
        height: canvas.height,
      };
    }
    const graded = context.image
      ? await grader.render({ source: context.image, grade: context.grade, width: media.width, height: media.height, inputGuard: context.inputGuard })
      : null;
    let layout;
    if (context.frame.style === 'contact' || context.frame.style === 'fyra04') {
      const slots: { img: CanvasImageSource | null; w: number; h: number }[] = [];
      const photos = (context.photos ?? []).filter((item) => item.image).slice(0, 4);
      for (const photo of photos) {
        const slot = await grader.render({ source: photo.image!, grade: context.grade, width: photo.info.width, height: photo.info.height, inputGuard: context.inputGuard });
        const copy = document.createElement('canvas');
        copy.width = slot.width;
        copy.height = slot.height;
        copy.getContext('2d')?.drawImage(slot, 0, 0);
        slots.push({ img: copy, w: copy.width, h: copy.height });
      }
      while (slots.length < 4) slots.push({ img: null, w: 0, h: 0 });
      layout = buildPlateLayout({
        plate: context.plate, emblems: context.emblems, frame: context.frame, meta: context.meta,
        photo: { width: 1, height: 1 }, image: null, slots,
      });
    } else {
      layout = buildPlateLayout({
        plate: context.plate, emblems: context.emblems, frame: context.frame, meta: context.meta,
        photo: { width: media.width, height: media.height }, image: graded,
      });
    }
    const canvas = document.createElement('canvas');
    paintTo(canvas, context.plate, layout);
    const blob = await blobOf(canvas, format, quality);
    return {
      blob,
      filename: `${stem}-Nordlys.${format === 'png' ? 'png' : 'jpg'}`,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    grader.destroy();
  }
}

export interface MovieExportContext {
  plate: SPPlateApi;
  emblems: SPEmblemsApi | null;
  frame: FrameSettings;
  meta: PlateMeta;
  grade: GradeSettings;
  media: MediaInfo;
  file: File;
  trim: TrimRange;
  inputGuard?: 0 | 1;
}

export interface PlannedMoviePlate {
  photo: { width: number; height: number };
  width: number;
  height: number;
  /** null with the frame off: the film already is the picture. */
  layout: PlateLayout | null;
}

/** What the finished movie plate will be, before a single frame is encoded. */
export async function planMoviePlate(
  context: MovieExportContext,
  options: VideoExportOptions,
  grader: PhotoGrader,
): Promise<PlannedMoviePlate> {
  await grader.prepare(context.grade);
  const cap = plateEdgeCap(options.resolution, grader.maxTextureSize);
  const requested = {
    width: Math.max(2, context.media.width),
    height: Math.max(2, context.media.height),
  };
  const scale = Math.min(1, cap / Math.max(requested.width, requested.height));
  const scaled = {
    width: Math.max(2, Math.round(requested.width * scale)),
    height: Math.max(2, Math.round(requested.height * scale)),
  };

  // Frame off: the film's own frame, no margins and no band, still on the
  // encoder's even grid.
  if (context.frame.enabled === false) {
    const plain = clampPlateSize({
      photo: scaled,
      cap,
      minPhoto: 96,
      layoutFor: (photo) => ({ W: photo.width, H: photo.height }),
    });
    const width = evenSize(plain.photo.width);
    const height = evenSize(plain.photo.height);
    return { photo: { width, height }, width, height, layout: null };
  }

  const planned = clampPlateSize({
    photo: scaled,
    cap,
    layoutFor: (photo) => buildPlateLayout({
      plate: context.plate, emblems: context.emblems, frame: context.frame, meta: context.meta,
      photo, image: grader.canvas,
    }),
    minPhoto: 96,
  });
  // The encoder refuses an odd dimension, so the plate itself is set on the
  // even grid — 1081px of band becomes 1080px of band, nothing else moves.
  planned.layout.W = evenSize(planned.layout.W);
  planned.layout.H = evenSize(planned.layout.H);
  return { photo: planned.photo, width: planned.layout.W, height: planned.layout.H, layout: planned.layout };
}

/**
 * Export the trimmed clip: decode → grade → plate → encode. The plate geometry
 * is fixed from the first render so every frame lines up exactly, and it is
 * measured (and capped) *before* the encoder is probed.
 */
export async function exportMovie(
  context: MovieExportContext,
  options: VideoExportOptions,
  onProgress?: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<VideoExportResult> {
  const grader = new PhotoGrader();
  try {
    const planned = await planMoviePlate(context, options, grader);
    const layout = planned.layout;
    const photo = planned.photo;

    const renderFrame = async (source: CanvasImageSource | null, seconds: number, out: HTMLCanvasElement) => {
      if (source) {
        await grader.render({
          source, grade: context.grade, width: photo.width, height: photo.height,
          time: seconds, inputGuard: context.inputGuard,
        });
      }
      if (!layout) {
        // Frame off: the graded frame itself, at the clip's own ratio.
        if (source) paintPlain(out, grader.available ? grader.canvas : source, planned.width, planned.height);
        return;
      }
      if (out.width !== layout.W || out.height !== layout.H) {
        out.width = layout.W;
        out.height = layout.H;
      }
      paintTo(out, context.plate, layout);
    };

    return await exportVideo({
      file: context.file,
      range: context.trim,
      fps: options.fps,
      resolution: options.resolution,
      sourceWidth: context.media.width,
      sourceHeight: context.media.height,
      includeAudio: options.includeAudio,
      outputWidth: planned.width,
      outputHeight: planned.height,
      renderFrame,
      onProgress,
      signal,
    });
  } finally {
    grader.destroy();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toFile(blob: Blob, filename: string, type?: string): File {
  return new File([blob], filename, { type: type || blob.type || 'application/octet-stream' });
}

/** Can this browser hand a file to the OS share sheet (gallery, AirDrop, Kakao)? */
export function canShareFile(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    return nav.canShare ? nav.canShare({ files: [file] }) : false;
  } catch {
    return false;
  }
}

/**
 * Open the share sheet. This must be called straight from the tap — an `await`
 * anywhere before it burns the browser's transient activation and the sheet
 * silently turns into a download.
 */
export function shareFile(file: File, title: string): void {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || !nav.canShare?.({ files: [file] })) {
    downloadBlob(file, file.name);
    return;
  }
  try {
    void navigator.share({ files: [file], title }).catch(() => undefined);
  } catch {
    downloadBlob(file, file.name);
  }
}

export async function shareBlob(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = toFile(blob, filename);
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch {
      // The visitor closed the sheet: respect that and do not force a download.
      return 'shared';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
