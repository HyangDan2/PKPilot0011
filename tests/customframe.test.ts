import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CUSTOM_PREFIX,
  customFields,
  customPlateLayout,
  customSpecs,
  customStyleOf,
  isCustomStyle,
  registerCustomSpec,
  setActiveFilm,
  specForStyle,
} from '../src/plate/custom';

const sample = {
  schema: 'shutterframe/v1',
  id: 'frame-nordlys-test',
  name: 'Nordlys Test Strip',
  updatedAt: '2026-11-21T00:00:00.000Z',
  canvas: { width: 600, height: 1800, background: '#121110', light: false },
  perforation: { enabled: true, style: 'side', color: '#efe9dc', holeWidth: 16, holeHeight: 12, gap: 26 },
  cells: [
    { x: 92, y: 150, w: 496, h: 352, radius: 2 },
    { x: 92, y: 528, w: 496, h: 352, radius: 2 },
    { x: 92, y: 906, w: 496, h: 352, radius: 2 },
    { x: 92, y: 1284, w: 496, h: 352, radius: 2 },
  ],
  texts: [{ id: 't1', text: '{{film}} · {{camera}}', x: 340, y: 1716, size: 20, family: 'mono', weight: 500, align: 'center', color: '#c9c2b5' }],
  emblem: { enabled: true, x: 340, y: 1812, maxW: 210, maxH: 40, align: 'center', mode: 'light' },
};

beforeAll(() => {
  const lz = readFileSync(resolve(process.cwd(), 'public/plate/lz-string.min.js'), 'utf8');
  new Function(lz)();
  const code = readFileSync(resolve(process.cwd(), 'public/plate/shutterframe.js'), 'utf8');
  new Function(code)();
});

describe('custom frame registry', () => {
  it('names a style with the custom: prefix', () => {
    expect(customStyleOf(sample as never)).toBe(`${CUSTOM_PREFIX}frame-nordlys-test`);
    expect(isCustomStyle('custom:frame-nordlys-test')).toBe(true);
    expect(isCustomStyle('fyra04')).toBe(false);
    expect(isCustomStyle(null)).toBe(false);
  });

  it('validates, registers and resolves the spec', () => {
    const spec = registerCustomSpec(sample);
    expect(spec).not.toBeNull();
    expect(specForStyle(customStyleOf(spec!))?.name).toBe('Nordlys Test Strip');
    expect(customSpecs().some((item) => item.id === sample.id)).toBe(true);
  });

  it('refuses a document that is not a shutterframe', () => {
    expect(registerCustomSpec({ schema: 'nope' })).toBeNull();
  });
});

describe('custom plate layout', () => {
  it('returns the plate contract with the shared payload', () => {
    registerCustomSpec(sample);
    const layout = customPlateLayout(`${CUSTOM_PREFIX}${sample.id}`, { meta: { make: 'Leica', model: 'M6' } });
    expect(layout).not.toBeNull();
    expect(layout!.W).toBe(600);
    expect(layout!.H).toBe(1800);
    expect(layout!.multi).toBe(true);
    expect(layout!.cells).toHaveLength(4);
    expect((layout!.custom!.spec as { id: string }).id).toBe(sample.id);
  });

  it('scales a 1:1 export from design units', () => {
    const layout = customPlateLayout(`${CUSTOM_PREFIX}${sample.id}`, { scale: 2 });
    expect(layout!.W).toBe(1200);
    expect(layout!.H).toBe(3600);
    expect(layout!.cells?.[0]).toMatchObject({ x: 184, y: 300, w: 992, h: 704 });
  });

  it('returns null for a style nobody loaded', () => {
    expect(customPlateLayout('custom:missing')).toBeNull();
  });
});

describe('film-aware variables', () => {
  it('fills camera and the selected film name', () => {
    setActiveFilm('Nordlys 400');
    const fields = customFields({ make: 'Leica', model: 'M6', lens: 'Summicron', iso: '400' });
    expect(fields.camera).toBe('Leica M6');
    expect(fields.film).toBe('Nordlys 400');
    expect(fields.iso).toBe('400');
  });

  it('lets an explicit film win over the session film', () => {
    setActiveFilm('Nordlys 400');
    expect(customFields({}, 'VAERN').film).toBe('VAERN');
  });
});
