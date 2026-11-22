import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTiff, heicWithExif, jpegWithExif } from './exif-fixtures';
import { readPhotoMeta } from '../src/media/metadata';
import { emblemForMake, type SPEmblemsApi } from '../src/plate/engine';

/**
 * `readPhotoMeta` against real camera bytes: a JPEG whose APP1 carries a TIFF,
 * and a HEIC whose `meta` box points at an `Exif` item. This is the path the
 * reported bug ran through — a photo whose maker never reached the plate, so
 * `Auto` always printed HD2Lab.
 */
const base = new Uint8Array(readFileSync(resolve(__dirname, '../public/samples/sample-01.jpg')));
let emblems: SPEmblemsApi;

beforeAll(() => {
  const source = readFileSync(resolve(__dirname, '../public/plate/emblems.js'), 'utf8');
  const load = new Function('window', `${source}\nreturn window.SPEmblems;`);
  emblems = load(window) as SPEmblemsApi;
});

const blob = (bytes: Uint8Array, type: string) => new Blob([bytes.slice().buffer as ArrayBuffer], { type });

describe('EXIF in a JPEG', () => {
  it('reads the maker, lens and exposure triangle exifr needs to find', async () => {
    const file = blob(jpegWithExif(base, buildTiff({
      make: 'SONY',
      model: 'ILCE-7M4',
      lens: 'FE 35mm F1.4 GM',
      fNumber: 1.8,
      exposureTime: 1 / 250,
      iso: 100,
      datetime: '2026:11:19 18:04:31',
    })), 'image/jpeg');

    const meta = await readPhotoMeta(file);
    expect(meta.make).toBe('SONY');
    expect(meta.model).toBe('ILCE-7M4');
    expect(meta.lens).toBe('FE 35mm F1.4 GM');
    expect(meta.aperture).toBe('f/1.8');
    expect(meta.shutter).toBe('1/250s');
    expect(meta.iso).toBe('ISO 100');
    expect(meta.datetime).toBe('2026-11-19 18:04:31');
    // …and that is a maker the plate can credit.
    expect(emblemForMake(meta.make, emblems, meta.model)).toBe('sony');
  });

  it('keeps a model whose make the file dropped', async () => {
    const file = blob(jpegWithExif(base, buildTiff({ model: 'X-T5' })), 'image/jpeg');
    const meta = await readPhotoMeta(file);
    expect(meta.make).toBe('');
    expect(meta.model).toBe('X-T5');
    // Before the fix this printed HD2Lab: `auto` only ever asked for the make.
    expect(emblemForMake(meta.make, emblems, meta.model)).toBe('fujifilm');
  });

  it('returns an empty meta for bytes that are not a photograph', async () => {
    const meta = await readPhotoMeta(blob(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg'));
    expect(meta).toMatchObject({ make: '', model: '', lens: '', aperture: '', shutter: '', iso: '', datetime: '' });
  });
});

describe('EXIF in a HEIC', () => {
  it('reads an iPhone photo\'s maker out of the HEIF meta box', async () => {
    const file = blob(heicWithExif(buildTiff({
      make: 'Apple',
      model: 'iPhone 15 Pro',
      lens: 'iPhone 15 Pro back camera 6.765mm f/1.78',
      fNumber: 1.78,
      exposureTime: 1 / 120,
      iso: 64,
    })), 'image/heic');

    const meta = await readPhotoMeta(file);
    expect(meta.make).toBe('Apple');
    expect(meta.model).toBe('iPhone 15 Pro');
    expect(meta.aperture).toBe('f/1.8'); // the plate prints one decimal
    expect(meta.shutter).toBe('1/120s');
    expect(meta.iso).toBe('ISO 64');
    expect(emblemForMake(meta.make, emblems, meta.model)).toBe('apple');
  });
});
