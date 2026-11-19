import type { SPEmblemsApi, SPPlateApi } from '../plate/engine';
import type { FrameSettings, MediaInfo, PlateMeta, TrimRange, VideoExportOptions } from '../types/studio';
import { buildPlateLayout } from './render';
import { PhotoGrader } from './grading';
import { exportVideo, type ExportProgress, type VideoExportResult } from '../export/videoExporter';
import { exportDimensions } from '../export/codecs';
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

function paintTo(canvas: HTMLCanvasElement, plate: SPPlateApi, layout: ReturnType<typeof buildPlateLayout>): void {
  canvas.width = Math.max(1, Math.round(layout.W));
  canvas.height = Math.max(1, Math.round(layout.H));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  plate.paint(ctx, layout);
}

/** Full-resolution 1:1 plate of the current still. */
export async function exportStill(context: StillExportContext, format: 'jpeg' | 'png', quality = 0.94): Promise<StillResult> {
  const grader = new PhotoGrader();
  try {
    const { media } = context;
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
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('이미지를 만들지 못했습니다.')), mime, quality);
    });
    const stem = media.name.replace(/\.[^.]+$/, '') || 'plate';
    return {
      blob,
      filename: `${stem}-HD2Lab.${format === 'png' ? 'png' : 'jpg'}`,
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

/**
 * Export the trimmed clip: decode → grade → plate → encode. The plate geometry
 * is fixed from the first render so every frame lines up exactly.
 */
export async function exportMovie(
  context: MovieExportContext,
  options: VideoExportOptions,
  onProgress?: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<VideoExportResult> {
  const grader = new PhotoGrader();
  const target = exportDimensions(options.resolution, context.media.width, context.media.height);
  let layout: ReturnType<typeof buildPlateLayout> | null = null;

  const renderFrame = async (source: CanvasImageSource | null, seconds: number, out: HTMLCanvasElement) => {
    if (source) {
      await grader.render({ source, grade: context.grade, width: target.width, height: target.height, time: seconds, inputGuard: context.inputGuard });
    }
    if (!layout) {
      layout = buildPlateLayout({
        plate: context.plate, emblems: context.emblems, frame: context.frame, meta: context.meta,
        photo: { width: target.width, height: target.height },
        image: grader.canvas,
      });
      out.width = Math.max(1, Math.round(layout.W));
      out.height = Math.max(1, Math.round(layout.H));
    }
    paintTo(out, context.plate, layout);
  };

  try {
    return await exportVideo({
      file: context.file,
      range: context.trim,
      fps: options.fps,
      resolution: options.resolution,
      sourceWidth: context.media.width,
      sourceHeight: context.media.height,
      includeAudio: options.includeAudio,
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

export async function shareBlob(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (navigator.share && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch {
      /* the visitor dismissed the sheet — fall through to a download */
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
