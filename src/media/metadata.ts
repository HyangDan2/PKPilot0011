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

/** The tags the plate prints, in the names exifr reports them under. */
const EXIF_TAGS = [
  'Make', 'Model', 'LensModel', 'Lens', 'FocalLength', 'FocalLengthIn35mmFormat',
  'FNumber', 'ExposureTime', 'ISO', 'ISOSpeedRatings',
  'DateTimeOriginal', 'CreateDate', 'ModifyDate',
];

/**
 * Reads a file's EXIF through exifr, which is loaded on demand so the studio's
 * first paint does not carry the parser.
 *
 * Two passes on purpose: a JPEG or HEIC answers the first (`pick` keeps the
 * read small), but an export that keeps its camera tags in XMP, or whose EXIF
 * block exifr cannot settle in one go, still has a make and a model to find.
 * Only the maker tags decide whether the second pass is worth a file read —
 * everything else the plate prints is already in hand.
 */
async function readExif(file: Blob): Promise<ExifLike | null> {
  let parse: ((input: Blob, options?: Record<string, unknown>) => Promise<unknown>) | null = null;
  try {
    const module = await import('exifr');
    parse = (module.parse ?? (module as unknown as { default?: { parse?: typeof parse } }).default?.parse) ?? null;
  } catch {
    return null;
  }
  if (!parse) return null;

  let picked: ExifLike | null = null;
  try {
    picked = (await parse(file, { pick: EXIF_TAGS, reviveValues: false })) as ExifLike | null;
  } catch {
    picked = null;
  }
  const named = (value: ExifLike | null) => !!(value?.Make?.trim?.() || value?.Model?.trim?.());
  if (named(picked)) return picked;

  try {
    const wide = (await parse(file, { reviveValues: false, tiff: true, xmp: true, silentErrors: true })) as ExifLike | null;
    if (named(wide)) return wide;
    return picked ?? wide ?? null;
  } catch {
    return picked ?? null;
  }
}

export async function readPhotoMeta(file: Blob): Promise<PlateMeta> {
  return metaFromExif(await readExif(file));
}
