import { assetUrl } from '../utils/assets';
import type { PlateMeta } from '../types/studio';

/**
 * Typed bridge to the verified Shutterplate engine (PKPilot0003 `plate.js` +
 * `emblems.js`). The engine owns plate space: every frame is drawn at plate
 * pixels, so the live preview, the frame-modal miniatures and the 1:1 export
 * all come from one paint routine.
 */

export interface PlateColors {
  base: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  band?: string;
  light: boolean;
}

export interface PlateCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlateImage {
  img: CanvasImageSource | null;
  w?: number;
  h?: number;
}

export interface PlateLayout {
  style: string;
  colors: PlateColors;
  W: number;
  H: number;
  PW: number;
  PH: number;
  padX: number;
  padTop: number;
  band: number;
  radius: number;
  ratio: number;
  u: number;
  /** The plate's own type unit, before any display type boost. */
  uBase?: number;
  /** 1 in every export; >1 only when the stage had to enlarge the copy. */
  typeBoost?: number;
  photoBox: PlateCell;
  emblem: string | null;
  img: CanvasImageSource | null;
  multi?: boolean;
  cells?: PlateCell[];
  images?: PlateImage[];
  theme?: string;
  themeLabel?: string;
  opts: Record<string, unknown>;
  fields: Partial<PlateMeta>;
  /** Set only for a `.shutterframe.json` plate: the shared engine paints it. */
  custom?: {
    spec: unknown;
    slots: { img: CanvasImageSource | null; w: number; h: number }[];
    fields: Record<string, string>;
    scale: number;
  };
}

export interface PlateLayoutOptions {
  style: string;
  padPct?: number | null;
  extraPct?: number | null;
  radiusPct?: number | null;
  ratio?: number | null;
  emblem?: string;
  emblemMono?: boolean;
  fields?: Partial<PlateMeta>;
  slotFields?: Partial<PlateMeta>[];
  font?: string;
  fyraTheme?: string;
  /** Stage-only legibility compensation; never set for an export. */
  typeBoost?: number;
}

export interface SPPlateApi {
  STYLES: Record<string, { label: string; tag: string; light: boolean; multi?: boolean; cells?: number; index: string }>;
  ORDER: string[];
  MULTI: string[];
  FYRA_THEMES: { id: string; label: string; layout: string }[];
  FYRA_DEFAULT: string;
  isMulti(id: string): boolean;
  cellCount(id: string): number;
  layout(photo: { w: number; h: number; img?: CanvasImageSource | null }, options: PlateLayoutOptions): PlateLayout;
  paint(ctx: CanvasRenderingContext2D, layout: PlateLayout): void;
  defaults(style: string): { padPct: number; extraPct: number; radiusPct: number };
  multiLayout(options: PlateLayoutOptions & { slots?: PlateImage[] }): PlateLayout;
}

export interface SPEmblemsApi {
  list: { id: string; name: string }[];
  has(id: string): boolean;
  fromMake(make: string): string;
  widthFor(id: string, height: number): number;
  svg(id: string, colors: { ink: string; accent: string; base: string; light: boolean }): string;
}

declare global {
  interface Window {
    SPPlate?: SPPlateApi;
    SPEmblems?: SPEmblemsApi;
  }
}

let loading: Promise<{ plate: SPPlateApi; emblems: SPEmblemsApi }> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-plate="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.plate = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

/** Loads emblems.js then plate.js exactly once; both attach themselves to window. */
export function loadPlateEngine(): Promise<{ plate: SPPlateApi; emblems: SPEmblemsApi }> {
  if (loading) return loading;
  loading = (async () => {
    const base = assetUrl('plate');
    await injectScript(`${base}/emblems.js`);
    await injectScript(`${base}/plate.js`);
    const plate = window.SPPlate;
    const emblems = window.SPEmblems;
    if (!plate || !emblems) throw new Error('Shutterplate engine did not attach to window');
    return { plate, emblems };
  })();
  return loading;
}

/** Camera make → maker emblem, with the engine's own matcher when loaded. */
export function emblemForMake(make: string, emblems?: SPEmblemsApi | null): string {
  if (!make) return 'hd2lab';
  if (emblems) return emblems.fromMake(make);
  const m = make.toLowerCase();
  if (m.includes('sony')) return 'sony';
  if (m.includes('canon')) return 'canon';
  if (m.includes('nikon')) return 'nikon';
  if (m.includes('fuji')) return 'fujifilm';
  if (m.includes('leica')) return 'leica';
  if (m.includes('hasselblad')) return 'hasselblad';
  if (m.includes('apple')) return 'apple';
  if (m.includes('samsung')) return 'samsung';
  if (m.includes('panasonic') || m.includes('lumix')) return 'lumix';
  if (m.includes('olympus') || m.includes('om digital') || m.includes('om system')) return 'omsystem';
  return 'hd2lab';
}
