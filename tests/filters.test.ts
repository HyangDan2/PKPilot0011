import { describe, expect, it } from 'vitest';
import {
  ALL_FILTERS,
  DEFAULT_FILTER,
  FILM_FILTERS,
  MARGARINE_FILTERS,
  MARGARINE_GROUPS,
  NEUTRAL_FILTER,
  RETRO90_FILTER,
  RETRO_OPTICS,
  gradeForFilter,
  margarinePreset,
} from '../src/filters/catalog';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import { FILM_PROFILES } from '../src/films/registry';
import { defaultCurves } from '../src/types/curves';

describe('filter catalogue', () => {
  it('offers nine film stocks, the 58 Margarine looks and RETRO 90 on its own', () => {
    expect(FILM_FILTERS).toHaveLength(9);
    expect(FILM_FILTERS.some((filter) => filter.key === 'FS-010')).toBe(false);
    expect(RETRO90_FILTER.key).toBe('FS-010');
    expect(RETRO90_FILTER.name).toBe('RETRO 90');
    expect(RETRO90_FILTER.group).toBe('Filter Set');
    expect(MARGARINE_FILTERS).toHaveLength(58);
    expect(ALL_FILTERS).toHaveLength(1 + 9 + 58 + 1);
    expect(MARGARINE_GROUPS).toHaveLength(6);
    expect(new Set(MARGARINE_GROUPS)).toEqual(new Set(['Light', 'Cafe', 'Portrait', 'Nature', 'Color', 'Vintage']));
    expect(NEUTRAL_FILTER.filmId).toBe('identity');
  });

  it('puts RETRO 90 after the whole Margarine catalogue', () => {
    const keys = ALL_FILTERS.map((filter) => filter.key);
    expect(keys[0]).toBe('neutral');
    expect(keys.slice(1, 10)).toEqual(['FS-001', 'FS-002', 'FS-003', 'FS-004', 'FS-005', 'FS-006', 'FS-007', 'FS-008', 'FS-009']);
    expect(keys.slice(10, keys.length - 1)).toEqual(MARGARINE_FILTERS.map((filter) => filter.key));
    expect(keys[keys.length - 1]).toBe('FS-010');
  });

  it('every filter maps to a real LUT-bearing profile', () => {
    for (const filter of ALL_FILTERS) {
      expect(filter.filmId.length).toBeGreaterThan(0);
      expect(filter.name.length).toBeGreaterThan(0);
    }
    expect(Object.keys(FILM_PROFILES)).toHaveLength(11); // identity + FS-001…FS-010
  });
});

describe('gradeForFilter', () => {
  it('starts from the neutral defaults for a film stock', () => {
    const grade = gradeForFilter({ kind: 'film', filmId: 'FS-001', presetId: null });
    expect(grade.filmId).toBe('FS-001');
    expect(grade.adjustments.filmStrength).toBe(100);
    expect(grade.adjustments.grain).toBe(FILM_PROFILES['FS-001'].defaultAdjustments.grain);
    expect(grade.curves).toEqual(defaultCurves());
  });

  it('uses the identity LUT for Neutral without dropping user defaults', () => {
    const grade = gradeForFilter({ kind: 'neutral', filmId: 'identity', presetId: null });
    expect(grade.filmId).toBe('identity');
    expect(grade.adjustments).toEqual({ ...DEFAULT_ADJUSTMENTS, filmStrength: 100 });
  });

  it('applies RETRO 90’s amber look and its halation optics', () => {
    const grade = gradeForFilter({ kind: 'film', filmId: 'FS-010', presetId: null });
    expect(grade.filmId).toBe('FS-010');
    expect(grade.adjustments.temperature).toBe(24);
    expect(grade.adjustments.vignette).toBe(32);
    expect(grade.camera.optics.halation).toBe(RETRO_OPTICS.halation);
  });

  it('clears the RETRO optics when another stock is selected', () => {
    const retro = gradeForFilter({ kind: 'film', filmId: 'FS-010', presetId: null });
    const clean = gradeForFilter({ kind: 'film', filmId: 'FS-004', presetId: null }, retro.camera);
    expect(clean.camera.optics).toEqual({ glow: 0, halation: 0, softness: 0, quality: 'standard' });
  });

  it('runs a Margarine look on its own base film', () => {
    const preset = margarinePreset('soft-white');
    expect(preset).not.toBeNull();
    const grade = gradeForFilter({ kind: 'margarine', filmId: 'FS-007', presetId: 'soft-white' });
    expect(grade.filmId).toBe(preset!.baseFilmId);
    expect(grade.adjustments.temperature).toBe(preset!.adjustments.temperature);
    expect(grade.adjustments.filmStrength).toBe(preset!.adjustments.filmStrength);
  });

  it('falls back safely for an unknown preset', () => {
    const grade = gradeForFilter({ kind: 'margarine', filmId: 'FS-003', presetId: 'missing' });
    expect(grade.filmId).toBe('FS-003');
    expect(DEFAULT_FILTER.filmId).toBe('FS-004');
  });
});
