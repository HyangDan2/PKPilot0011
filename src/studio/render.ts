import type { PlateLayout, PlateImage, SPEmblemsApi, SPPlateApi } from '../plate/engine';
import { emblemForMake } from '../plate/engine';
import type { FrameSettings, PlateMeta } from '../types/studio';
import { isMultiFrame } from '../types/studio';

export interface StageBox {
  width: number;
  height: number;
}

/** Contain a photo box in the stage, then shrink it once more if the frame's
 *  own margins push the plate past the stage. */
export function fitPhotoBox(stage: StageBox, media: { width: number; height: number }): { width: number; height: number } {
  const mediaW = Math.max(1, media.width);
  const mediaH = Math.max(1, media.height);
  const scale = Math.min(stage.width / mediaW, stage.height / mediaH);
  return { width: Math.max(1, Math.floor(mediaW * scale)), height: Math.max(1, Math.floor(mediaH * scale)) };
}

/**
 * The box a plate is designed at, independent of how big the stage happens to
 * be. Designing the plate at the phone's ~350px stage quantised every row down
 * to a few pixels of type; keeping the geometry at a real print size and
 * scaling the finished canvas to the stage keeps the plate's own proportions.
 */
export function virtualPhotoBox(
  media: { width: number; height: number },
  minLongEdge = 1200,
  maxLongEdge = 1600,
): { width: number; height: number; scale: number } {
  const w = Math.max(1, Math.round(media.width) || 1);
  const h = Math.max(1, Math.round(media.height) || 1);
  const long = Math.max(w, h);
  const target = Math.min(maxLongEdge, Math.max(minLongEdge, long));
  const scale = target / long;
  return {
    width: Math.max(2, Math.round(w * scale)),
    height: Math.max(2, Math.round(h * scale)),
    scale,
  };
}

/**
 * The frame's smallest row (about `u * 11`, or `band * 0.078`, whichever is
 * tighter) has to stay legible once the plate is scaled down to the stage.
 * A phone shows the print at roughly a third of its size, where that row fell
 * to three screen pixels; a desktop shows it at more than half, where it is
 * already comfortable.
 */
export const STAGE_TYPE_TARGET_CSS = 5.4;
/**
 * The cap is what keeps the frame slim: the boost grows the band with the type,
 * so an uncapped 2.6× turned Classic Gallery's 15.6% band into a 35% card. At
 * 1.6 the band lands near 23% — still a frame, and the copy reads at arm's
 * length. The 1:1 export never asks for a boost, so a print keeps the frame's
 * designed proportions.
 */
export const STAGE_MAX_TYPE_BOOST = 1.6;

/**
 * How much the plate's type has to grow for this display to read it. Returns 1
 * when the smallest row already lands above the target (every desktop stage),
 * otherwise the factor the plate should be laid out with, capped at
 * `STAGE_MAX_TYPE_BOOST` so the band never balloons.
 */
export function stageTypeBoost(input: {
  u: number;
  band: number;
  cssScale: number;
  targetCssPx?: number;
  maxBoost?: number;
}): number {
  const target = input.targetCssPx ?? STAGE_TYPE_TARGET_CSS;
  const max = input.maxBoost ?? STAGE_MAX_TYPE_BOOST;
  const cssScale = Math.min(1, Math.max(0.01, input.cssScale));
  const smallestRow = Math.max(0.01, Math.min(input.u * 11, input.band * 0.078));
  const onScreen = smallestRow * cssScale;
  if (onScreen >= target) return 1;
  const boost = Math.ceil((target / onScreen) * 100) / 100;
  return Math.min(max, Math.max(1, boost));
}

/**
 * Resolves the frame's emblem: the visitor's choice, or the maker's own mark.
 */
export function resolveEmblem(frame: FrameSettings, meta: PlateMeta, emblems?: SPEmblemsApi | null): string {
  if (frame.emblem === 'none') return 'none';
  if (frame.emblem === 'auto') return emblemForMake(meta.make, emblems);
  return frame.emblem;
}

export interface PlateRequest {
  plate: SPPlateApi;
  emblems?: SPEmblemsApi | null;
  frame: FrameSettings;
  meta: PlateMeta;
  /** Photo box in plate pixels (single-cut). */
  photo: { width: number; height: number };
  image: CanvasImageSource | null;
  /** Up to four graded images for the multi-cut plates. */
  slots?: PlateImage[];
  /** Stage-only legibility compensation, passed through to the engine. */
  typeBoost?: number;
}

export function buildPlateLayout(request: PlateRequest): PlateLayout {
  const { plate, frame, meta } = request;
  const emblem = resolveEmblem(frame, meta, request.emblems);
  const base = {
    emblem,
    emblemMono: frame.emblemMono,
    fields: meta,
    padPct: frame.padPct,
    extraPct: frame.extraPct,
  };
  if (isMultiFrame(frame.style)) {
    return plate.multiLayout({
      ...base,
      style: frame.style,
      fyraTheme: frame.fyraTheme,
      slots: request.slots ?? [],
    });
  }
  const stageOptions = request.typeBoost && request.typeBoost > 1 ? { typeBoost: request.typeBoost } : {};
  const first = plate.layout(
    { w: request.photo.width, h: request.photo.height, img: request.image },
    { ...base, style: frame.style, ...stageOptions },
  );
  // A generous margin can make the plate wider than the stage; recompute once
  // with the photo box scaled by the overflow so the whole plate always fits.
  return first;
}

/** Plate paint with the current device transform applied by the caller. */
export function paintPlate(plate: SPPlateApi, ctx: CanvasRenderingContext2D, layout: PlateLayout): void {
  plate.paint(ctx, layout);
}

export function platePixelSize(layout: PlateLayout, dpr = 1): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(layout.W * dpr)),
    height: Math.max(1, Math.round(layout.H * dpr)),
  };
}

/**
 * Fit the whole plate (not just the photo) into the stage by scaling the photo
 * box down until the plate fits. Two passes are enough because plate padding is
 * linear in the photo box.
 */
export function fitPlate(
  plate: SPPlateApi,
  emblems: SPEmblemsApi | null | undefined,
  frame: FrameSettings,
  meta: PlateMeta,
  image: CanvasImageSource | null,
  media: { width: number; height: number },
  stage: StageBox,
): { layout: PlateLayout; photo: { width: number; height: number } } {
  let photo = fitPhotoBox(stage, media);
  let layout = buildPlateLayout({ plate, emblems, frame, meta, photo, image });
  if (isMultiFrame(frame.style)) return { layout, photo };
  for (let pass = 0; pass < 2; pass += 1) {
    const overflow = Math.min(stage.width / layout.W, stage.height / layout.H);
    if (overflow >= 0.995) break;
    photo = {
      width: Math.max(1, Math.floor(photo.width * overflow)),
      height: Math.max(1, Math.floor(photo.height * overflow)),
    };
    layout = buildPlateLayout({ plate, emblems, frame, meta, photo, image });
  }
  return { layout, photo };
}
