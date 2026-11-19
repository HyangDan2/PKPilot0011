import type { PlateMeta } from '../types/studio';

export interface ExifLike {
  Make?: string;
  Model?: string;
  LensModel?: string;
  Lens?: string;
  FocalLength?: number;
  FocalLengthIn35mmFormat?: number;
  FNumber?: number;
  ExposureTime?: number;
  ISO?: number;
  ISOSpeedRatings?: number | number[];
  DateTimeOriginal?: Date | string;
  CreateDate?: Date | string;
  ModifyDate?: Date | string;
}

export function formatFocal(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value)}mm`;
}

export function formatAperture(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  const rounded = Math.round(value * 10) / 10;
  return `f/${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}`;
}

export function formatShutter(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  if (value >= 1) return `${Math.round(value * 10) / 10}s`;
  return `1/${Math.round(1 / value)}s`;
}

export function formatIso(value?: number | number[] | null): string {
  const iso = Array.isArray(value) ? value[0] : value;
  if (typeof iso !== 'number' || !Number.isFinite(iso) || iso <= 0) return '';
  return `ISO ${Math.round(iso)}`;
}

/** `YYYY-MM-DD HH:MM:SS`, read from the camera's own clock — no timezone shift. */
export function formatDateTime(value?: Date | string | null): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
    if (!match) return '';
    const time = match[4] ? ` ${match[4]}:${match[5] ?? '00'}:${match[6] ?? '00'}` : '';
    return `${match[1]}-${match[2]}-${match[3]}${time}`;
  }
  if (Number.isNaN(value.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export function metaFromExif(exif: ExifLike | null | undefined): PlateMeta {
  const make = (exif?.Make ?? '').trim();
  const model = (exif?.Model ?? '').trim();
  const lens = (exif?.LensModel ?? exif?.Lens ?? '').trim();
  return {
    make,
    model: model.startsWith(make) && make ? model.slice(make.length).trim() : model,
    lens,
    focal: formatFocal(exif?.FocalLength),
    aperture: formatAperture(exif?.FNumber),
    shutter: formatShutter(exif?.ExposureTime),
    iso: formatIso(exif?.ISO ?? exif?.ISOSpeedRatings),
    datetime: formatDateTime(exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.ModifyDate),
    caption: '',
  };
}

export async function readPhotoMeta(file: Blob): Promise<PlateMeta> {
  try {
    const { parse } = await import('exifr');
    const exif = (await parse(file, {
      pick: ['Make', 'Model', 'LensModel', 'Lens', 'FocalLength', 'FocalLengthIn35mmFormat', 'FNumber', 'ExposureTime', 'ISO', 'ISOSpeedRatings', 'DateTimeOriginal', 'CreateDate', 'ModifyDate'],
      reviveValues: false,
    })) as ExifLike | null;
    return metaFromExif(exif);
  } catch {
    return metaFromExif(null);
  }
}
