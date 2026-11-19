import { describe, expect, it } from 'vitest';
import {
  formatAperture,
  formatDateTime,
  formatFocal,
  formatIso,
  formatShutter,
  metaFromExif,
} from '../src/media/metadata';
import { kindOfFile } from '../src/media/load';

describe('camera metadata formatting', () => {
  it('prints the exposure triangle the way a plate reads', () => {
    expect(formatFocal(35)).toBe('35mm');
    expect(formatFocal(23.5)).toBe('24mm');
    expect(formatAperture(1.8)).toBe('f/1.8');
    expect(formatAperture(8)).toBe('f/8');
    expect(formatShutter(0.004)).toBe('1/250s');
    expect(formatShutter(2)).toBe('2s');
    expect(formatIso(400)).toBe('ISO 400');
    expect(formatIso([200, 400])).toBe('ISO 200');
  });

  it('ignores missing or impossible values', () => {
    expect(formatFocal(undefined)).toBe('');
    expect(formatAperture(0)).toBe('');
    expect(formatShutter(-1)).toBe('');
    expect(formatIso(undefined)).toBe('');
  });

  it('keeps the camera clock instead of shifting to UTC', () => {
    expect(formatDateTime('2026:11:19 18:04:31')).toBe('2026-11-19 18:04:31');
    expect(formatDateTime('2026-11-19T18:04:31')).toBe('2026-11-19 18:04:31');
    const local = new Date(2026, 10, 19, 7, 5, 9);
    expect(formatDateTime(local)).toBe('2026-11-19 07:05:09');
    expect(formatDateTime('nope')).toBe('');
  });

  it('builds a plate meta from EXIF, stripping a duplicated make prefix', () => {
    const meta = metaFromExif({
      Make: 'SONY', Model: 'SONY ILCE-7M4', LensModel: 'FE 35mm F1.8',
      FocalLength: 35, FNumber: 1.8, ExposureTime: 0.004, ISO: 100,
      DateTimeOriginal: '2026:10:24 17:32:11',
    });
    expect(meta.model).toBe('ILCE-7M4');
    expect(meta.lens).toBe('FE 35mm F1.8');
    expect(meta.aperture).toBe('f/1.8');
    expect(meta.shutter).toBe('1/250s');
    expect(meta.iso).toBe('ISO 100');
    expect(meta.datetime).toBe('2026-10-24 17:32:11');
    expect(meta.caption).toBe('');
  });

  it('survives an empty EXIF block (a video or a stripped JPEG)', () => {
    expect(metaFromExif(null)).toEqual({
      make: '', model: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '', caption: '',
    });
  });
});

describe('file routing', () => {
  it('recognises photos and videos by MIME type', () => {
    expect(kindOfFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe('photo');
    expect(kindOfFile(new File([], 'a.png', { type: 'image/png' }))).toBe('photo');
    expect(kindOfFile(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe('video');
    expect(kindOfFile(new File([], 'a.mov', { type: 'video/quicktime' }))).toBe('video');
  });

  it('falls back to the extension when the browser gives no type', () => {
    expect(kindOfFile(new File([], 'clip.WEBM', { type: '' }))).toBe('video');
    expect(kindOfFile(new File([], 'plate.webp', { type: '' }))).toBe('photo');
    expect(kindOfFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBeNull();
  });
});
