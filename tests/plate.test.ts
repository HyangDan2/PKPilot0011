import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FRAMES, frameDef, frameSupportsVideo } from '../src/plate/frames';
import { framesFor, isMultiFrame, SINGLE_FRAMES, MULTI_FRAMES } from '../src/types/studio';

interface PlateLike {
  STYLES: Record<string, { label: string; multi?: boolean; cells?: number }>;
  ORDER: string[];
  MULTI: string[];
  layout: (photo: { w: number; h: number; img?: unknown }, options: Record<string, unknown>) => Record<string, unknown>;
  multiLayout: (options: Record<string, unknown>) => Record<string, unknown>;
  defaults: (style: string) => { padPct: number; extraPct: number; radiusPct: number };
  isMulti: (id: string) => boolean;
  cellCount: (id: string) => number;
}

let plate: PlateLike;

beforeAll(() => {
  const root = resolve(__dirname, '..');
  const read = (file: string) => readFileSync(resolve(root, 'public/plate', file), 'utf8');
  // The Shutterplate engine is a plain script that attaches to window; running
  // it here means the layout the tests assert on is the same code the app ships.
  const load = new Function('window', `${read('emblems.js')}\n${read('plate.js')}\nreturn window.SPPlate;`);
  plate = load(window) as PlateLike;
});

describe('the Shutterplate frame library', () => {
  it('ships thirteen frames: eleven single-cut then two four-cut plates', () => {
    expect(plate.ORDER).toHaveLength(13);
    expect(plate.ORDER.slice(0, 11)).toEqual([
      'horizon', 'gallery', 'dual', 'strap', 'film', 'studio', 'edge', 'pro', 'polaroid', 'frosted', 'editorial',
    ]);
    expect(plate.MULTI).toEqual(['contact', 'fyra04']);
    expect(plate.ORDER.slice(11)).toEqual(plate.MULTI);
  });

  it('marks exactly the last two as multi-cut with four cells', () => {
    for (const id of plate.MULTI) {
      expect(plate.isMulti(id)).toBe(true);
      expect(plate.cellCount(id)).toBe(4);
    }
    for (const id of plate.ORDER.slice(0, 11)) {
      expect(plate.isMulti(id)).toBe(false);
      expect(plate.cellCount(id)).toBe(1);
    }
  });

  it('offers the eleven single frames to video and all thirteen to photos', () => {
    expect(framesFor('video')).toEqual(SINGLE_FRAMES);
    expect(framesFor('photo')).toHaveLength(13);
    expect(framesFor('video')).toHaveLength(11);
    expect(isMultiFrame('contact')).toBe(true);
    expect(isMultiFrame('fyra04')).toBe(true);
    expect(isMultiFrame('gallery')).toBe(false);
    expect(frameSupportsVideo('editorial')).toBe(true);
    expect(frameSupportsVideo('contact')).toBe(false);
  });

  it('keeps the UI catalogue aligned with the engine order', () => {
    expect(FRAMES.map((frame) => frame.id)).toEqual(plate.ORDER);
    expect(frameDef('film').label).toBe('Film Sprocket');
    expect(MULTI_FRAMES).toEqual(['contact', 'fyra04']);
  });
});

describe('plate layout', () => {
  it('surrounds the photograph with the frame margin and text band', () => {
    const layout = plate.layout({ w: 1200, h: 800 }, { style: 'gallery' });
    expect(layout.W as number).toBeGreaterThan(1200);
    expect(layout.H as number).toBeGreaterThan(800);
    const box = layout.photoBox as { x: number; y: number; w: number; h: number };
    expect(box.w).toBe(1200);
    expect(box.h).toBe(800);
    expect(box.y).toBe(layout.padTop as number);
    expect((layout.band as number)).toBeGreaterThan(0);
  });

  it('honours a custom margin and radius', () => {
    const wide = plate.layout({ w: 1000, h: 700 }, { style: 'horizon', padPct: 8 });
    const tight = plate.layout({ w: 1000, h: 700 }, { style: 'horizon', padPct: 2 });
    expect(wide.W as number).toBeGreaterThan(tight.W as number);
    expect(wide.padX as number).toBe(80);
    expect(tight.padX as number).toBe(20);
  });

  it('parametrises the eleven single signatures instead of falling back', () => {
    for (const id of plate.ORDER.slice(0, 11)) {
      const layout = plate.layout({ w: 900, h: 600 }, { style: id });
      expect(layout.style).toBe(id);
      // Strap Bar prints flush (no side margin), so W can equal the photo width.
      expect(layout.W as number).toBeGreaterThanOrEqual(900);
      expect(layout.H as number).toBeGreaterThan(600);
      expect(layout.emblem).toBe('hd2lab');
    }
    expect(plate.layout({ w: 900, h: 600 }, { style: 'nope' }).style).toBe('gallery');
  });

  it('builds a four-cut plate with four cells and the chosen theme', () => {
    const slots = Array.from({ length: 4 }, () => ({ img: { naturalWidth: 1200, naturalHeight: 800 }, w: 1200, h: 800 }));
    const contact = plate.multiLayout({ style: 'contact', slots, fields: {} });
    expect(contact.multi).toBe(true);
    expect((contact.cells as unknown[]).length).toBe(4);
    const fyra = plate.multiLayout({ style: 'fyra04', slots, fyraTheme: 'minimal', fields: {} });
    expect(fyra.theme).toBe('minimal');
    expect((fyra.cells as unknown[]).length).toBe(4);
  });

  it('keeps the plate sane when only one of four cells is filled', () => {
    const one = plate.multiLayout({ style: 'contact', slots: [{ img: { naturalWidth: 900, naturalHeight: 600 } }] });
    expect((one.cells as unknown[]).length).toBe(4);
    expect(one.W as number).toBeGreaterThan(0);
  });

  it('exposes each frame’s own default margin', () => {
    const gallery = plate.defaults('gallery');
    expect(gallery.padPct).toBeCloseTo(4.5);
    expect(plate.defaults('pro').padPct).toBeCloseTo(8);
  });
});
