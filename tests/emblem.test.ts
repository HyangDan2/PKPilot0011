import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBLEM_CHOICES, emblemLabel } from '../src/plate/frames';
import { emblemForMake, type SPEmblemsApi } from '../src/plate/engine';
import { resolveEmblem } from '../src/studio/render';
import { DEFAULT_FRAME, EMBLEM_IDS, type PlateMeta } from '../src/types/studio';

/**
 * The maker matcher reads the make *and* the model, and the eleven marks it can
 * name are the engine's own — the same artwork the plate prints.
 */
let emblems: SPEmblemsApi;

beforeAll(() => {
  const source = readFileSync(resolve(__dirname, '../public/plate/emblems.js'), 'utf8');
  const load = new Function('window', `${source}\nreturn window.SPEmblems;`);
  emblems = load(window) as SPEmblemsApi;
});

const meta = (patch: Partial<PlateMeta>): PlateMeta => ({
  make: '', model: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '', caption: '',
  ...patch,
});

describe('the eleven maker marks', () => {
  it('lists HD2Lab first, then the ten camera makers', () => {
    expect(EMBLEM_CHOICES).toHaveLength(11);
    expect(EMBLEM_CHOICES.map((choice) => choice.id)).toEqual([
      'hd2lab', 'sony', 'canon', 'nikon', 'fujifilm', 'samsung',
      'leica', 'hasselblad', 'apple', 'lumix', 'omsystem',
    ]);
    expect(EMBLEM_IDS).toHaveLength(11);
  });

  it('names every mark the engine can actually print', () => {
    for (const choice of EMBLEM_CHOICES) {
      expect(emblems.has(choice.id), `${choice.id} is missing from emblems.js`).toBe(true);
      expect(emblemLabel(choice.id)).toBe(choice.label);
      // A real vector preview, not an empty string: the window shows these.
      expect(emblems.svg(choice.id, { ink: 'currentColor', accent: '#ff824f', base: 'currentColor', light: false }))
        .toMatch(/^<svg [^>]*viewBox=/);
    }
    expect(emblems.list).toHaveLength(11);
  });
});

describe('Auto: the make, then the model', () => {
  const cases: [string, string, string, string][] = [
    ['a make the engine knows', 'SONY', 'ILCE-7M4', 'sony'],
    ['a full model name with the make', 'FUJIFILM', 'X-T5', 'fujifilm'],
    ['an iPhone', 'Apple', 'iPhone 15 Pro', 'apple'],
    ['a Samsung body', 'SAMSUNG', 'SM-S918N', 'samsung'],
    ['an OM System body', 'OM Digital Solutions', 'OM-1', 'omsystem'],
    ['a Lumix body', 'Panasonic', 'DC-S5M2', 'lumix'],
    ['a Leica body', 'Leica Camera AG', 'M11', 'leica'],
    ['a Hasselblad body', 'Hasselblad', 'X2D 100C', 'hasselblad'],
    ['a Nikon body', 'NIKON CORPORATION', 'Z 8', 'nikon'],
    ['a Canon body', 'Canon', 'EOS R5', 'canon'],
  ];
  for (const [label, make, model, expected] of cases) {
    it(`names ${expected} from ${label}`, () => {
      expect(emblemForMake(make, emblems, model)).toBe(expected);
    });
  }

  it('reads a model the file never paired with a make', () => {
    // The reported bug: `make` empty, the model still says who shot it.
    expect(emblemForMake('', emblems, 'ILCE-7M4')).toBe('sony');
    expect(emblemForMake('', emblems, 'iPhone 15 Pro')).toBe('apple');
    expect(emblemForMake('', emblems, 'X-T5')).toBe('fujifilm');
    expect(emblemForMake('', emblems, 'SM-S918N')).toBe('samsung');
    expect(emblemForMake('', emblems, 'DC-GH6')).toBe('lumix');
  });

  it('falls back to HD2Lab only when nothing names a maker', () => {
    expect(emblemForMake('', emblems, '')).toBe('hd2lab');
    expect(emblemForMake('', emblems, '1200×800')).toBe('hd2lab');
    expect(emblemForMake('Unknown Optics', emblems, 'Scope 4')).toBe('hd2lab');
  });

  it('says the same thing before the engine has loaded', () => {
    expect(emblemForMake('SONY', null, 'ILCE-7M4')).toBe('sony');
    expect(emblemForMake('', null, 'iPhone 15 Pro')).toBe('apple');
    expect(emblemForMake('', null, 'X-T5')).toBe('fujifilm');
    expect(emblemForMake('', null, '')).toBe('hd2lab');
  });

  it('hands the engine both halves of the name', () => {
    const seen: string[] = [];
    const spy = {
      ...emblems,
      fromMake: (make: string, model?: string) => {
        seen.push(`${make}|${model ?? ''}`);
        return emblems.fromMake(make, model);
      },
    } as SPEmblemsApi;
    emblemForMake('Apple', spy, 'iPhone 15 Pro');
    expect(seen).toEqual(['Apple|iPhone 15 Pro']);
  });
});

describe('the frame\'s emblem choice', () => {
  it('auto follows the file', () => {
    const frame = { ...DEFAULT_FRAME, emblem: 'auto' as const };
    expect(resolveEmblem(frame, meta({ make: 'SONY', model: 'ILCE-7M4' }), emblems)).toBe('sony');
    expect(resolveEmblem(frame, meta({ model: 'X-T5' }), emblems)).toBe('fujifilm');
    expect(resolveEmblem(frame, meta({}), emblems)).toBe('hd2lab');
  });

  it('a chosen mark prints whatever the EXIF says', () => {
    const frame = { ...DEFAULT_FRAME, emblem: 'nikon' as const };
    expect(resolveEmblem(frame, meta({ make: 'SONY', model: 'ILCE-7M4' }), emblems)).toBe('nikon');
    expect(resolveEmblem(frame, meta({}), emblems)).toBe('nikon');
  });

  it('none prints nothing, and an id the engine does not know falls back home', () => {
    expect(resolveEmblem({ ...DEFAULT_FRAME, emblem: 'none' }, meta({ make: 'SONY' }), emblems)).toBe('none');
    expect(resolveEmblem({ ...DEFAULT_FRAME, emblem: 'konicaminolta' as never }, meta({}), emblems)).toBe('hd2lab');
  });
});
