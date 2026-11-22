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
  fromMake(make: string, model?: string): string;
  widthFor(id: string, height: number): number;
  svg(id: string, colors: { ink: string; accent: string; base: string; light: boolean; mono?: boolean }): string;
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

/**
 * Words a camera writes as its make, in the order they should win. A maker's
 * own name is trusted first; `MODEL_RULES` below only speaks up when the make
 * says nothing useful.
 */
const MAKE_RULES: [RegExp, string][] = [
  [/samsung|\bnx\b|\bnx[0-9]/i, 'samsung'],
  [/sony/i, 'sony'],
  [/canon/i, 'canon'],
  [/nikon/i, 'nikon'],
  [/fuji/i, 'fujifilm'],
  [/leica/i, 'leica'],
  [/hasselblad/i, 'hasselblad'],
  [/apple|iphone|ipad|ipod/i, 'apple'],
  [/panasonic|lumix/i, 'lumix'],
  [/om digital|olympus|om system|om-?d/i, 'omsystem'],
  [/hd2lab/i, 'hd2lab'],
];

/**
 * Model families, for the files whose make never made it into the EXIF: an
 * iPhone screenshot pipeline, an editor that keeps the model and drops the
 * make, a phone whose camera app writes `SM-S918N` alone. These run only after
 * the make failed to match, so a real make is never overruled.
 */
const MODEL_RULES: [RegExp, string][] = [
  [/\b(galaxy|sm-[a-z][0-9]{3,4}[a-z]?)\b/i, 'samsung'],
  [/\b(iphone|ipad|ipod)\b/i, 'apple'],
  [/\b(ilce|nex|slt-?a|zv-e?[0-9]|fx[0-9]|alpha|a[679][0-9]?[rsc]?\b)/i, 'sony'],
  [/\b(eos|powershot|ixus)\b/i, 'canon'],
  [/\b(coolpix)\b/i, 'nikon'],
  [/\bz\s?(5|6|7|8|9|30|50|f|fc)\b/i, 'nikon'],
  [/\bd[3-6][0-9]{2,3}\b/i, 'nikon'],
  [/\b(finepix|x-?t[0-9]+|x-?pro[0-9]?|x-?h[12]|x-?e[0-9]|x100[a-z]?|gfx)\b/i, 'fujifilm'],
  [/\b(lumix|dc-[a-z]{1,2}[0-9]+|gh[0-9]|s[1-9]r?)\b/i, 'lumix'],
  [/\b(om-?d|e-m[0-9]+|e-pl[0-9]+|e-p[0-9]+)\b/i, 'omsystem'],
  [/\b(leica|m[89]|m1[01]|q[1-3]|sl2?)\b/i, 'leica'],
  [/\b(x[12]d|907x|h[456]d)\b/i, 'hasselblad'],
];

function matchRules(rules: [RegExp, string][], text: string): string | null {
  for (const [pattern, id] of rules) if (pattern.test(text)) return id;
  return null;
}

/**
 * Camera make + model → maker emblem, with the engine's own matcher when it is
 * loaded. The model matters: plenty of files carry `ILCE-7M4` or `iPhone 15
 * Pro` with no make at all, and that is still a maker the plate can credit.
 */
export function emblemForMake(make: string, emblems?: SPEmblemsApi | null, model = ''): string {
  const maker = (make ?? '').trim();
  const body = (model ?? '').trim();
  if (!maker && !body) return 'hd2lab';
  if (emblems) {
    const hit = emblems.fromMake(maker, body);
    if (hit && hit !== 'hd2lab') return hit;
  }
  const fromMake = matchRules(MAKE_RULES, maker);
  if (fromMake) return fromMake;
  // The make was empty or a name no rule knows: try the model the camera wrote.
  return matchRules(MODEL_RULES, body || maker) ?? matchRules(MAKE_RULES, body) ?? 'hd2lab';
}
