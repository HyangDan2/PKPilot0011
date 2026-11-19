import { describe, expect, it } from 'vitest';
import { initialStudio, studioReducer } from '../src/state/studio';
import type { MediaInfo } from '../src/types/studio';
import { fitPhotoBox } from '../src/studio/render';

const photo: MediaInfo = {
  kind: 'photo', name: 'a.jpg', url: 'blob:a', width: 1200, height: 800, duration: 0, fps: 0, size: 1,
  meta: { make: 'SONY', model: 'A7', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '', caption: '' },
};
const video: MediaInfo = {
  kind: 'video', name: 'clip.mp4', url: 'blob:b', width: 1280, height: 720, duration: 6.2, fps: 30, size: 1,
  meta: { ...photo.meta, make: '', model: '' },
};

describe('studio reducer', () => {
  it('opens photos and keeps the active index valid', () => {
    let state = studioReducer(initialStudio(), { type: 'open-photos', media: [photo] });
    expect(state.media).toHaveLength(1);
    state = studioReducer(state, { type: 'set-active-photo', index: 5 });
    expect(state.activePhoto).toBe(0);
  });

  it('sets the whole trim range when a clip opens', () => {
    const state = studioReducer(initialStudio(), { type: 'open-video', media: video });
    expect(state.trim).toEqual({ start: 0, end: 6.2 });
    expect(state.playing).toBe(true);
  });

  it('drops a four-cut frame when a video takes over the stage', () => {
    let state = studioReducer(initialStudio(), { type: 'open-photos', media: [photo] });
    state = studioReducer(state, { type: 'set-frame', patch: { style: 'contact' } });
    state = studioReducer(state, { type: 'open-video', media: video });
    expect(state.frame.style).toBe('gallery');
  });

  it('resets the grade when a new filter is chosen but keeps the frame', () => {
    let state = studioReducer(initialStudio(), { type: 'open-photos', media: [photo] });
    state = studioReducer(state, { type: 'set-frame', patch: { style: 'film', padPct: 7 } });
    state = studioReducer(state, { type: 'patch-adjustments', patch: { exposure: 1.2, grain: 40 } });
    const revision = state.revision;
    state = studioReducer(state, { type: 'select-filter', filter: { kind: 'film', filmId: 'FS-009', presetId: null } });
    expect(state.grade.filmId).toBe('FS-009');
    expect(state.grade.adjustments.exposure).toBe(0);
    expect(state.grade.adjustments.grain).toBe(24);
    expect(state.frame.style).toBe('film');
    expect(state.frame.padPct).toBe(7);
    expect(state.revision).toBe(revision + 1);
  });

  it('edits the date stamp without touching the optics', () => {
    let state = initialStudio();
    state = studioReducer(state, { type: 'patch-optics', patch: { halation: 40 } });
    state = studioReducer(state, { type: 'patch-date-stamp', patch: { enabled: true, date: '2026-11-19' } });
    expect(state.grade.camera.dateStamp.enabled).toBe(true);
    expect(state.grade.camera.dateStamp.date).toBe('2026-11-19');
    expect(state.grade.camera.optics.halation).toBe(40);
  });

  it('returns to the stock defaults on reset', () => {
    let state = studioReducer(initialStudio(), { type: 'select-filter', filter: { kind: 'film', filmId: 'FS-010', presetId: null } });
    state = studioReducer(state, { type: 'patch-adjustments', patch: { exposure: 2 } });
    state = studioReducer(state, { type: 'reset-grade' });
    expect(state.grade.adjustments.exposure).toBe(-0.35);
    expect(state.grade.adjustments.filmStrength).toBe(100);
  });

  it('toggles the theme and modal state', () => {
    let state = studioReducer(initialStudio(), { type: 'set-theme', theme: 'light' });
    state = studioReducer(state, { type: 'open-modal', modal: 'filter' });
    expect(state.theme).toBe('light');
    expect(state.modal).toBe('filter');
    expect(state.modal).not.toBe('frame');
  });
});

describe('fitPhotoBox', () => {
  it('contains a landscape photo in a wide stage', () => {
    expect(fitPhotoBox({ width: 1000, height: 1000 }, { width: 1600, height: 900 })).toEqual({ width: 1000, height: 562 });
  });

  it('contains a portrait photo by height', () => {
    const box = fitPhotoBox({ width: 1000, height: 600 }, { width: 800, height: 1200 });
    expect(box.height).toBe(600);
    expect(box.width).toBe(400);
  });

  it('never returns a zero dimension', () => {
    const box = fitPhotoBox({ width: 0, height: 0 }, { width: 0, height: 0 });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});
