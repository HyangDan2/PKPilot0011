import { FILM_LIST, FILM_PROFILES } from '../films/registry';
import { RETRO90 } from '../films/retro90';
import { MARGARINE_PRESETS, type MargarinePreset } from '../presets/margarine';
import { DEFAULT_ADJUSTMENTS, type AdjustmentSettings, type FilmProfile } from '../types/film';
import { DEFAULT_CAMERA, type CameraSettings } from '../types/camera';
import { defaultCurves } from '../types/curves';
import { defaultColorMixer } from '../types/colorMixer';
import { DEFAULT_SHARPENING } from '../types/sharpening';
import type { FilterSelection, GradeSettings } from '../types/studio';

export interface FilterOption {
  key: string;
  kind: 'neutral' | 'film' | 'margarine';
  filmId: string;
  presetId: string | null;
  name: string;
  detail: string;
  group: string;
}

export const NEUTRAL_FILTER: FilterOption = {
  key: 'neutral', kind: 'neutral', filmId: 'identity', presetId: null,
  name: 'Neutral', detail: '보정 없이 원본 그대로', group: 'Base',
};

/** 9 film stocks + RETRO 90, the "HD2Lab" shelf of the filter modal. */
export const FILM_FILTERS: FilterOption[] = [
  ...FILM_LIST.map((film) => ({
    key: film.id, kind: 'film' as const, filmId: film.id, presetId: null,
    name: film.name, detail: film.style, group: 'HD2Lab Film',
  })),
  {
    key: 'FS-010', kind: 'film' as const, filmId: 'FS-010', presetId: null,
    name: 'RETRO 90', detail: 'Night Amber · Halation', group: 'HD2Lab Film',
  },
];

export const MARGARINE_GROUPS: string[] = Array.from(new Set(MARGARINE_PRESETS.map((preset) => preset.category)));

export const MARGARINE_FILTERS: FilterOption[] = MARGARINE_PRESETS.map((preset) => ({
  key: `mg-${preset.id}`, kind: 'margarine' as const, filmId: preset.baseFilmId, presetId: preset.id,
  name: preset.name, detail: `${preset.baseFilmId} · ${preset.category}`, group: preset.category,
}));

export const ALL_FILTERS: FilterOption[] = [NEUTRAL_FILTER, ...FILM_FILTERS, ...MARGARINE_FILTERS];

export const DEFAULT_FILTER: FilterSelection = { kind: 'film', filmId: 'FS-004', presetId: null };

export function filmProfile(filmId: string): FilmProfile | null {
  if (filmId === 'FS-010') return RETRO90;
  return FILM_PROFILES[filmId as keyof typeof FILM_PROFILES] ?? null;
}

export function margarinePreset(id: string | null): MargarinePreset | null {
  if (!id) return null;
  return MARGARINE_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function findFilter(key: string): FilterOption | undefined {
  return ALL_FILTERS.find((filter) => filter.key === key);
}

/** RETRO 90 is a compact-camera look: its halation belongs to the stock. */
export const RETRO_OPTICS: CameraSettings['optics'] = { glow: 20, halation: 28, softness: 10, quality: 'standard' };

export function cameraForFilm(filmId: string, previous?: CameraSettings): CameraSettings {
  const base = previous ?? DEFAULT_CAMERA;
  const optics = filmId === 'FS-010' ? { ...RETRO_OPTICS } : { glow: 0, halation: 0, softness: 0, quality: base.optics.quality };
  return { ...base, dateStamp: { ...base.dateStamp }, optics };
}

/**
 * Picks a filter and resets the grade to that stock's own defaults.
 * Strength is `filmStrength`; 100 = the stock exactly as authored.
 */
export function gradeForFilter(selection: FilterSelection, previousCamera?: CameraSettings): GradeSettings {
  const preset = selection.kind === 'margarine' ? margarinePreset(selection.presetId) : null;
  const profile = filmProfile(selection.filmId);
  const defaults: AdjustmentSettings = {
    ...DEFAULT_ADJUSTMENTS,
    ...(preset ? preset.adjustments : profile ? profile.defaultAdjustments : {}),
  };
  return {
    filmId: selection.kind === 'neutral' ? 'identity' : (preset?.baseFilmId ?? selection.filmId),
    adjustments: { ...DEFAULT_ADJUSTMENTS, ...defaults, filmStrength: defaults.filmStrength ?? 100 },
    camera: cameraForFilm(selection.filmId, previousCamera),
    curves: defaultCurves(),
    colorMixer: defaultColorMixer(),
    sharpening: { ...DEFAULT_SHARPENING },
  };
}

/** The look as it will be graded — used by the thumbnails and the export. */
export function adjustmentsForPreset(preset: MargarinePreset, strength = 100): AdjustmentSettings {
  return { ...DEFAULT_ADJUSTMENTS, ...preset.adjustments, filmStrength: (preset.adjustments.filmStrength ?? 100) * (strength / 100) };
}
