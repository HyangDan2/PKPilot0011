import { ColorEngine } from '../engine/renderer/ColorEngine';
import { loadCubeLut, type ParsedLut3D } from '../engine/color/lutLoader';
import { filmProfile } from '../filters/catalog';
import type { GradeSettings } from '../types/studio';

const lutCache = new Map<string, ParsedLut3D>();
const lutPending = new Map<string, Promise<ParsedLut3D>>();

export async function lutForFilm(filmId: string): Promise<ParsedLut3D> {
  const profile = filmProfile(filmId);
  const file = profile?.lutFile ?? 'luts/identity.cube';
  const cached = lutCache.get(file);
  if (cached) return cached;
  const pending = lutPending.get(file);
  if (pending) return pending;
  const promise = loadCubeLut(file).then((lut) => {
    lutCache.set(file, lut);
    lutPending.delete(file);
    return lut;
  }, (error) => {
    lutPending.delete(file);
    throw error;
  });
  lutPending.set(file, promise);
  return promise;
}

export function isLutReady(filmId: string): boolean {
  const profile = filmProfile(filmId);
  return lutCache.has(profile?.lutFile ?? 'luts/identity.cube');
}

export interface GradeRequest {
  source: CanvasImageSource;
  grade: GradeSettings;
  width: number;
  height: number;
  time?: number;
  inputGuard?: 0 | 1;
  /** 'original' bypasses the grade and paints the source pixels. */
  compareMode?: 'none' | 'original';
}

/**
 * One WebGL canvas reused for every still grade: the live video frame, the
 * frame-modal miniatures and the full-resolution export all grade here, one
 * after another, so the app never holds more than a couple of GL contexts.
 */
export class PhotoGrader {
  readonly canvas: HTMLCanvasElement;
  private engine: ColorEngine;
  private lutId: string | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.engine = new ColorEngine(this.canvas);
  }

  get available(): boolean {
    return this.engine.isReady();
  }

  /** The GPU's own texture ceiling; the export cap never exceeds it. */
  get maxTextureSize(): number {
    const gl = this.engine.getContext();
    const value = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 0;
    return Number.isFinite(value) && value > 0 ? value : 4096;
  }

  /** True once the LUT for this film is uploaded and a synchronous frame is safe. */
  isPrepared(grade: GradeSettings): boolean {
    if (!this.engine.isReady()) return false;
    return this.lutId === grade.filmId;
  }

  /** Synchronous grade for the playback loop; returns null until prepare() ran. */
  renderNow(request: GradeRequest, grade: GradeSettings): HTMLCanvasElement | null {
    if (!this.isPrepared(grade)) return null;
    const width = Math.max(1, Math.round(request.width));
    const height = Math.max(1, Math.round(request.height));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.engine.setSource(request.source as unknown as TexImageSource);
    this.engine.render({
      adjustments: grade.adjustments,
      filmId: grade.filmId,
      camera: grade.camera,
      curves: grade.curves,
      colorMixer: grade.colorMixer,
      sharpening: grade.sharpening,
      time: request.time ?? 0,
      inputGuard: request.inputGuard ?? 0,
      compareMode: request.compareMode ?? 'none',
    });
    return this.canvas;
  }

  async prepare(grade: GradeSettings): Promise<boolean> {
    if (!this.engine.isReady()) return false;
    if (this.lutId !== grade.filmId) {
      const lut = await lutForFilm(grade.filmId);
      this.engine.setLut(lut);
      this.lutId = grade.filmId;
    }
    return true;
  }

  /** Grades into the internal canvas and returns it. */
  async render(request: GradeRequest): Promise<HTMLCanvasElement> {
    const width = Math.max(1, Math.round(request.width));
    const height = Math.max(1, Math.round(request.height));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ready = await this.prepare(request.grade);
    if (!ready) return this.canvas;
    this.engine.setSource(request.source as unknown as TexImageSource);
    this.engine.render({
      adjustments: request.grade.adjustments,
      filmId: request.grade.filmId,
      camera: request.grade.camera,
      curves: request.grade.curves,
      colorMixer: request.grade.colorMixer,
      sharpening: request.grade.sharpening,
      time: request.time ?? 0,
      inputGuard: request.inputGuard ?? 0,
      compareMode: request.compareMode ?? 'none',
    });
    return this.canvas;
  }

  /** Grades and copies the result, so the caller owns the pixels. */
  async renderCopy(request: GradeRequest): Promise<HTMLCanvasElement> {
    const graded = await this.render(request);
    const copy = document.createElement('canvas');
    copy.width = graded.width;
    copy.height = graded.height;
    const ctx = copy.getContext('2d');
    if (ctx) ctx.drawImage(graded, 0, 0);
    return copy;
  }

  destroy(): void {
    this.engine.destroy();
  }
}

/** Draw the current video frame into a 2D canvas at a bounded size. */
export function captureVideoFrame(video: HTMLVideoElement, maxEdge = 720): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth || 1, video.videoHeight || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((video.videoWidth || 2) * scale));
  canvas.height = Math.max(1, Math.round((video.videoHeight || 2) * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** Snapshot of the current photo/video frame used by the filter modal. */
export function thumbnailSource(
  source: { kind: 'photo' | 'video'; drawable?: CanvasImageSource | null; video?: HTMLVideoElement | null },
  maxEdge = 480,
): CanvasImageSource | null {
  if (source.kind === 'photo') return source.drawable ?? null;
  if (source.video && source.video.readyState >= 2) return captureVideoFrame(source.video, maxEdge);
  return null;
}
