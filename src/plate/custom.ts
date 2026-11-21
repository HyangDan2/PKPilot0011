import { assetUrl } from '../utils/assets';
import type { PlateImage, PlateLayout, SPPlateApi } from './engine';
import type { PlateMeta } from '../types/studio';

/**
 * Custom four-cut frames (`.shutterframe.json` v1).
 *
 * The spec, the validator, the painter and the lz-string codec are one script
 * shared with Mynda Ljósa (PKPilot0015) and Shutterplate (PKPilot0003), so a
 * frame designed in one app prints identically in the other two. The engine is
 * injected lazily, exactly like `plate.js`, and every loaded frame lives in the
 * shared IndexedDB shelf (`hd2_custom_frames_v1`).
 */

export const CUSTOM_PREFIX = 'custom:';

export interface ShutterFrameSpec {
  schema: 'shutterframe/v1';
  id: string;
  name: string;
  author?: string;
  updatedAt: string;
  canvas: { width: number; height: number; background: string; gradient?: { type: 'linear'; angle: number; stops: [string, string] }; light: boolean };
  perforation: { enabled: boolean; style: 'side' | 'film'; color: string; holeWidth: number; holeHeight: number; gap: number };
  cells: { x: number; y: number; w: number; h: number; radius: number }[];
  overlay?: { dataUrl: string; layer: 'above' | 'below'; opacity: number };
  texts: { id: string; text: string; x: number; y: number; size: number; family: 'sans' | 'serif' | 'mono'; weight: number; align: 'left' | 'center' | 'right'; color: string; letterSpacing: number; visible?: boolean }[];
  emblem: { enabled: boolean; x: number; y: number; maxW: number; maxH: number; align: 'left' | 'center' | 'right'; mode: 'auto' | 'light' | 'dark' };
}

interface ShutterFrameApi {
  validate(raw: unknown): { ok: boolean; spec: ShutterFrameSpec | null; errors: string[]; warnings: string[] };
  parse(raw: unknown): { ok: boolean; spec: ShutterFrameSpec | null; errors: string[]; warnings: string[] };
  decode(text: string): ShutterFrameSpec | null;
  decodeText(text: string): ShutterFrameSpec | null;
  encode(spec: ShutterFrameSpec): string;
  fromUrl(href?: string): ShutterFrameSpec | null;
  shareUrl(base: string, spec: ShutterFrameSpec): string;
  layout(spec: ShutterFrameSpec, opts?: { scale?: number; slots?: { img: CanvasImageSource | null; w: number; h: number }[]; fields?: Record<string, string> }): PlateLayout & { custom: CustomPayload };
  paint(ctx: CanvasRenderingContext2D, layout: PlateLayout): boolean;
  primeOverlay(spec: ShutterFrameSpec): Promise<ShutterFrameSpec>;
  buildVars(spec: ShutterFrameSpec, fields: Record<string, string>): Record<string, string>;
  summary(spec: ShutterFrameSpec): string;
  store: {
    list(): Promise<ShutterFrameSpec[]>;
    put(spec: ShutterFrameSpec): Promise<ShutterFrameSpec>;
    remove(id: string): Promise<boolean>;
  };
}

export interface CustomPayload {
  spec: ShutterFrameSpec;
  slots: { img: CanvasImageSource | null; w: number; h: number }[];
  fields: Record<string, string>;
  scale: number;
}

declare global {
  interface Window {
    ShutterFrame?: ShutterFrameApi;
  }
}

let engine: ShutterFrameApi | null = null;
let pending: Promise<ShutterFrameApi> | null = null;
const registry = new Map<string, ShutterFrameSpec>();
let activeFilm = '';

function inject(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-frame-engine="${src}"]`);
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.frameEngine = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

/** lz-string then the shared ShutterFrame engine, once per page. */
export function loadCustomEngine(): Promise<ShutterFrameApi> {
  if (engine) return Promise.resolve(engine);
  if (pending) return pending;
  pending = (async () => {
    const base = assetUrl('plate');
    await inject(`${base}/lz-string.min.js`);
    await inject(`${base}/shutterframe.js`);
    const found = window.ShutterFrame;
    if (!found) throw new Error('ShutterFrame engine did not attach to window');
    engine = found;
    return found;
  })();
  return pending;
}

export function customEngine(): ShutterFrameApi | null {
  return engine ?? window.ShutterFrame ?? null;
}

export function isCustomStyle(style: string | null | undefined): boolean {
  return typeof style === 'string' && style.startsWith(CUSTOM_PREFIX);
}

export function customStyleOf(spec: ShutterFrameSpec): string {
  return `${CUSTOM_PREFIX}${spec.id}`;
}

export function specForStyle(style: string): ShutterFrameSpec | null {
  if (!isCustomStyle(style)) return null;
  return registry.get(style.slice(CUSTOM_PREFIX.length)) ?? null;
}

export function registerCustomSpec(raw: unknown): ShutterFrameSpec | null {
  const api = customEngine();
  if (!api) return null;
  const checked = api.validate(raw);
  if (!checked.ok || !checked.spec) return null;
  registry.set(checked.spec.id, checked.spec);
  return checked.spec;
}

export function customSpecs(): ShutterFrameSpec[] {
  return [...registry.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function loadCustomShelf(): Promise<ShutterFrameSpec[]> {
  const api = await loadCustomEngine();
  try {
    const rows = await api.store.list();
    rows.forEach((spec) => registerCustomSpec(spec));
    return customSpecs();
  } catch {
    return customSpecs();
  }
}

export async function persistCustom(spec: ShutterFrameSpec): Promise<ShutterFrameSpec | null> {
  const api = await loadCustomEngine();
  const stored = await api.store.put(spec);
  registerCustomSpec(stored);
  return stored;
}

export async function deleteCustom(id: string): Promise<void> {
  const api = await loadCustomEngine();
  await api.store.remove(id);
  registry.delete(id);
}

/** The stamp the film name fills `{{film}}` with in this session. */
export function setActiveFilm(label: string): void {
  activeFilm = label || '';
}

export function customFields(meta: Partial<PlateMeta>, film?: string): Record<string, string> {
  const camera = [meta.make, meta.model].filter(Boolean).join(' ');
  return {
    camera,
    lens: meta.lens ?? '',
    film: film ?? activeFilm,
    date: meta.datetime ?? '',
    datetime: meta.datetime ?? '',
    caption: meta.caption ?? '',
    shutter: meta.shutter ?? '',
    iso: meta.iso ?? '',
    aperture: meta.aperture ?? '',
    title: '',
  };
}

/**
 * A custom plate in the plate contract every studio surface already consumes:
 * the live stage, the frame thumbnails, the four-cut window and the 1:1 export
 * all paint through `paintPlateLayout`.
 */
export function customPlateLayout(style: string, options: {
  slots?: PlateImage[];
  meta?: Partial<PlateMeta>;
  scale?: number;
  film?: string;
} = {}): PlateLayout | null {
  const spec = specForStyle(style);
  const api = customEngine();
  if (!spec || !api) return null;
  const scale = options.scale ?? 1;
  const slots = (options.slots ?? []).map((slot) => ({ img: slot.img ?? null, w: slot.w ?? 0, h: slot.h ?? 0 }));
  while (slots.length < 4) slots.push({ img: null, w: 0, h: 0 });
  const fields = customFields(options.meta ?? {}, options.film);
  const layout = api.layout(spec, { scale, slots, fields });
  const W = layout.W;
  const H = layout.H;
  return {
    ...layout,
    style,
    colors: {
      base: layout.colors.base,
      ink: layout.colors.ink,
      muted: layout.colors.ink,
      line: layout.colors.base,
      accent: layout.colors.ink,
      light: layout.colors.light,
    },
    W,
    H,
    PW: W,
    PH: H,
    padX: 0,
    padTop: 0,
    band: 0,
    radius: 0,
    ratio: W / Math.max(1, H),
    u: W / 100,
    photoBox: { x: 0, y: 0, w: W, h: H },
    emblem: null,
    img: null,
    multi: true,
    opts: {},
    fields: (options.meta ?? {}) as Partial<PlateMeta>,
    custom: { spec, slots, fields, scale },
  } as PlateLayout;
}

/** The one paint door: a custom plate asks the shared engine, others the plate. */
export function paintPlateLayout(plate: SPPlateApi, ctx: CanvasRenderingContext2D, layout: PlateLayout): void {
  if (layout.custom) {
    const api = customEngine();
    if (api) {
      api.paint(ctx, layout);
      return;
    }
  }
  plate.paint(ctx, layout);
}

/** A small data-URL miniature of a custom frame for the pickers. */
export function customThumb(spec: ShutterFrameSpec, options: {
  slots?: PlateImage[];
  meta?: Partial<PlateMeta>;
  width?: number;
} = {}): string | null {
  const api = customEngine();
  if (!api) return null;
  const width = options.width ?? 148;
  const scale = width / Math.max(1, spec.canvas.width);
  const layout = customPlateLayout(customStyleOf(spec), { slots: options.slots, meta: options.meta, scale });
  if (!layout) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(layout.W));
  canvas.height = Math.max(2, Math.round(layout.H));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  api.paint(ctx, layout);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** The factor a 1:1 export uses so a printed frame never goes soft. */
export function customExportScale(style: string, longEdge = 2400): number {
  const spec = specForStyle(style);
  if (!spec) return 1;
  return Math.max(1, longEdge / Math.max(spec.canvas.width, spec.canvas.height));
}

export function customSummary(spec: ShutterFrameSpec): string {
  return `${spec.canvas.width}×${spec.canvas.height} · 4컷`;
}

export const MYNDA_URL = 'https://hyangdan2.github.io/PKPilot0015/';
export const SHUTTERPLATE_URL = 'https://hyangdan2.github.io/PKPilot0003/';
