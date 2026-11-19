import { gradeForFilter, type FilterOption } from '../filters/catalog';
import type { SPEmblemsApi, SPPlateApi } from '../plate/engine';
import type { FrameSettings, FrameId, PlateMeta } from '../types/studio';
import { buildPlateLayout } from './render';
import { PhotoGrader } from './grading';

export interface Cancellation {
  cancelled: boolean;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/**
 * One live thumbnail per filter, graded from the very frame on screen.
 * Rendered in small chunks so opening the modal never freezes the stage.
 */
export async function buildFilterThumbs(options: {
  grader: PhotoGrader;
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  filters: FilterOption[];
  width?: number;
  onEach: (key: string, url: string) => void;
  token: Cancellation;
}): Promise<void> {
  const { grader, source, filters, onEach, token } = options;
  const width = options.width ?? 208;
  const height = Math.max(60, Math.round(width * (options.sourceHeight / Math.max(1, options.sourceWidth))));
  for (const filter of filters) {
    if (token.cancelled) return;
    const grade = gradeForFilter({ kind: filter.kind, filmId: filter.filmId, presetId: filter.presetId });
    try {
      const graded = await grader.render({ source, grade, width, height });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(graded, 0, 0);
      if (!token.cancelled) onEach(filter.key, canvas.toDataURL('image/jpeg', 0.82));
    } catch {
      /* one dead thumbnail must not stop the shelf */
    }
    await nextFrame();
  }
}

/** One live miniature per frame, painted with the current filter applied. */
export async function buildFrameThumbs(options: {
  plate: SPPlateApi;
  emblems: SPEmblemsApi | null;
  frame: FrameSettings;
  meta: PlateMeta;
  graded: CanvasImageSource | null;
  sourceWidth: number;
  sourceHeight: number;
  slots?: { img: CanvasImageSource | null; w: number; h: number }[];
  frames: FrameId[];
  width?: number;
  onEach: (id: FrameId, url: string) => void;
  token: Cancellation;
}): Promise<void> {
  const { plate, emblems, frame, meta, graded, onEach, token } = options;
  const boxWidth = options.width ?? 148;
  const aspect = options.sourceHeight / Math.max(1, options.sourceWidth);
  for (const id of options.frames) {
    if (token.cancelled) return;
    try {
      const isMulti = id === 'contact' || id === 'fyra04';
      const layout = buildPlateLayout({
        plate,
        emblems,
        frame: { ...frame, style: id, padPct: null, extraPct: null },
        meta,
        photo: { width: boxWidth, height: Math.max(40, Math.round(boxWidth * aspect)) },
        image: graded,
        slots: isMulti
          // Miniatures keep the plate small: the engine scales the whole plate
          // from the slot's pixel size, so a 6000px photo would make a 6000px
          // thumbnail. The image itself is still drawn at full quality by drawCover.
          ? (options.slots ?? []).map((slot, index) => ({
              img: index === 0 && !slot.img ? graded : slot.img,
              w: Math.round(boxWidth),
              h: Math.max(40, Math.round(boxWidth * aspect)),
            }))
          : undefined,
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(layout.W));
      canvas.height = Math.max(1, Math.round(layout.H));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      plate.paint(ctx, layout);
      if (!token.cancelled) onEach(id, canvas.toDataURL('image/jpeg', 0.85));
    } catch {
      /* skip a broken miniature */
    }
    await nextFrame();
  }
}
