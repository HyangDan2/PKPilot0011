import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clampPlateSize,
  evenSize,
  frameTimestamps,
  pickEncodePlan,
  plateEdgeCap,
  type AudioFormat,
  type AudioProbe,
  type VideoProbe,
} from '../src/export/codecs';
import { routeFiles } from '../src/media/route';
import { specFields, withSpecFallback } from '../src/media/spec';
import { STAGE_MAX_TYPE_BOOST, STAGE_TYPE_TARGET_CSS, stageTypeBoost, virtualPhotoBox } from '../src/studio/render';
import { initialStudio, studioReducer } from '../src/state/studio';
import type { MediaInfo } from '../src/types/studio';

/* ------------------------------------------------------------------ audio */

const videoYes: VideoProbe = async () => true;
const videoNo: VideoProbe = async () => false;

describe('the audio a real clip brings', () => {
  it('probes the track’s own rate and channel count, not a stereo 48k guess', async () => {
    const seen: { codec: string; sampleRate: number; channels: number }[] = [];
    const probe: AudioProbe = async (codec, sampleRate, channels) => {
      seen.push({ codec, sampleRate, channels });
      return codec === 'aac';
    };
    const mono: AudioFormat = { sampleRate: 44100, channels: 1 };
    const plan = await pickEncodePlan(videoYes, probe, 1920, 1080, mono);
    expect(plan).toEqual({ container: 'mp4', video: 'avc', audio: 'aac' });
    expect(seen[0]).toEqual({ codec: 'aac', sampleRate: 44100, channels: 1 });
  });

  it('keeps the sound by moving to Opus in MP4 when there is no AAC encoder', async () => {
    const probe: AudioProbe = async (codec) => codec === 'opus';
    const plan = await pickEncodePlan(videoYes, probe, 1280, 720, { sampleRate: 48000, channels: 2 });
    expect(plan).toEqual({ container: 'mp4', video: 'avc', audio: 'opus' });
  });

  it('still goes silent in MP4 only when no audio encoder exists at all', async () => {
    const probe: AudioProbe = async () => false;
    const plan = await pickEncodePlan(videoYes, probe, 1280, 720, { sampleRate: 48000, channels: 1 });
    expect(plan).toEqual({ container: 'mp4', video: 'avc', audio: null });
  });

  it('never asks for audio on a clip that has no track', async () => {
    const probe: AudioProbe = async () => true;
    const plan = await pickEncodePlan(videoYes, probe, 1280, 720, null);
    expect(plan).toEqual({ container: 'mp4', video: 'avc', audio: null });
  });

  it('falls back to VP9/Opus in WebM when H.264 is missing', async () => {
    const video: VideoProbe = async (codec) => codec === 'vp9';
    const probe: AudioProbe = async (codec) => codec === 'opus';
    expect(await pickEncodePlan(video, probe, 1280, 720, { sampleRate: 48000, channels: 2 }))
      .toEqual({ container: 'webm', video: 'vp9', audio: 'opus' });
    expect(await pickEncodePlan(videoNo, probe, 1280, 720, { sampleRate: 48000, channels: 2 })).toBeNull();
  });
});

/* ------------------------------------------------------------- plate size */

describe('the finished plate the encoder is handed', () => {
  it('rounds every dimension down onto the even pixel grid', () => {
    expect(evenSize(1081)).toBe(1080);
    expect(evenSize(1080)).toBe(1080);
    expect(evenSize(1)).toBe(2);
    expect(evenSize(1921.4)).toBe(1920);
  });

  it('caps the long edge per preset, and only at 4K for "source"', () => {
    expect(plateEdgeCap('720p')).toBe(1280);
    expect(plateEdgeCap('1080p')).toBe(1920);
    expect(plateEdgeCap('source', 16384)).toBe(3840);
    expect(plateEdgeCap('source', 2048)).toBe(2048);
  });

  it('shrinks the photograph until a plate with its margin fits the cap', () => {
    // A layout that behaves like the real thing: 17% margin on both sides and a
    // copy band under the picture.
    const layoutFor = (photo: { width: number; height: number }) => {
      const pad = Math.round(photo.width * 0.045);
      const band = Math.round(pad + photo.height * 0.13);
      return { W: photo.width + pad * 2, H: photo.height + pad + band };
    };
    const result = clampPlateSize({ photo: { width: 3840, height: 2160 }, cap: 1920, layoutFor });
    expect(Math.max(result.layout.W, result.layout.H)).toBeLessThanOrEqual(1920);
    expect(result.photo.width).toBeLessThan(3840);
    // and it is stable: running it again changes nothing
    const again = clampPlateSize({ photo: result.photo, cap: 1920, layoutFor });
    expect(again.photo).toEqual(result.photo);
  });

  it('leaves a plate that already fits exactly where it was', () => {
    const layoutFor = (photo: { width: number; height: number }) => ({ W: photo.width, H: photo.height });
    const result = clampPlateSize({ photo: { width: 1080, height: 720 }, cap: 1920, layoutFor });
    expect(result.photo).toEqual({ width: 1080, height: 720 });
  });

  it('keeps the frame list in time order and at the requested rate', () => {
    const stamps = frameTimestamps(1, 2, 30);
    expect(stamps).toHaveLength(30);
    expect(stamps[0]).toBeCloseTo(1);
    expect(stamps[29]).toBeLessThan(2);
  });
});

/* ------------------------------------------------------------ file routing */

function file(name: string, type: string): File {
  return new File([new Uint8Array([0])], name, { type });
}

describe('one drop zone, one picker', () => {
  it('opens a clip when a clip is among the files', () => {
    const picked = routeFiles([file('a.jpg', 'image/jpeg'), file('b.mp4', 'video/mp4')]);
    expect(picked?.kind).toBe('video');
    if (picked?.kind === 'video') expect(picked.file.name).toBe('b.mp4');
  });

  it('takes up to four stills into the plate', () => {
    const picked = routeFiles([
      file('1.jpg', 'image/jpeg'), file('2.png', 'image/png'),
      file('3.webp', 'image/webp'), file('4.jpg', 'image/jpeg'), file('5.jpg', 'image/jpeg'),
    ]);
    expect(picked?.kind).toBe('photos');
    if (picked?.kind === 'photos') expect(picked.files).toHaveLength(4);
  });

  it('answers nothing for a file it cannot open', () => {
    expect(routeFiles([file('notes.txt', 'text/plain')])).toBeNull();
    expect(routeFiles([])).toBeNull();
  });

  it('falls back to the extension when the browser sends no MIME type', () => {
    const picked = routeFiles([file('clip.MOV', '')]);
    expect(picked?.kind).toBe('video');
  });
});

/* --------------------------------------------------------- plate metadata */

const videoInfo: MediaInfo = {
  kind: 'video', name: 'clip.mp4', url: 'blob:v', width: 1280, height: 720, duration: 6.2, fps: 30, size: 10,
  meta: { make: '', model: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '2026-11-19 10:00:00', caption: 'clip' },
};

describe('a plate never prints an empty row', () => {
  it('fills resolution, rate and length for a clip with no EXIF', () => {
    const spec = specFields(videoInfo);
    expect(spec.model).toBe('1280×720');
    expect(spec.focal).toBe('30fps');
    expect(spec.shutter).toBe('6.2s');
  });

  it('only uses the fallback when the file had no camera data', () => {
    const filled = withSpecFallback(videoInfo);
    expect(filled.model).toBe('1280×720');
    const real = { ...videoInfo, meta: { ...videoInfo.meta, make: 'SONY', model: 'A7 IV' } };
    expect(withSpecFallback(real).model).toBe('A7 IV');
  });

  it('prints the pixel size of a photo that carries no EXIF', () => {
    const photo: MediaInfo = { ...videoInfo, kind: 'photo', name: 'a.png', width: 900, height: 600, duration: 0, fps: 0 };
    expect(specFields(photo).model).toBe('900×600');
     expect(withSpecFallback(photo).model).toBe('900×600');
  });
});

/* ------------------------------------------------------- stage geometry */

describe('the stage designs at Shutterplate’s print size and only scales it', () => {
  it('keeps the plate at a real print size however small the phone is', () => {
    const small = virtualPhotoBox({ width: 900, height: 600 }, 1200, 1200);
    expect(Math.max(small.width, small.height)).toBe(1200);
    expect(small.width / small.height).toBeCloseTo(1.5, 2);
    const big = virtualPhotoBox({ width: 4000, height: 3000 }, 1200, 1200);
    expect(Math.max(big.width, big.height)).toBe(1200);
  });

  it('asks for no type boost on a stage that already reads at print scale', () => {
    // A 1280×800 desktop shows Classic Gallery at about 0.53: its smallest row
    // lands above the target, so the frame is exactly Shutterplate's.
    const boost = stageTypeBoost({ u: 1.308, band: 158, cssScale: 0.525 });
    expect(boost).toBe(1);
  });

  it('boosts a phone’s copy only as far as the cap, not to a card', () => {
    // 390×844: Classic Gallery at ~0.27 puts the smallest row near 3.3px.
    const boost = stageTypeBoost({ u: 1.308, band: 158, cssScale: 0.27 });
    expect(boost).toBe(STAGE_MAX_TYPE_BOOST);
    expect(boost).toBeLessThanOrEqual(1.6);
  });

  it('sets a target a boosted phone actually reaches', () => {
    // The boost lifts the band with the type, so the row grows by the boost and
    // the target is met at the cap: 3.33px × 1.6 ≈ 5.3px.
    expect(STAGE_TYPE_TARGET_CSS).toBeGreaterThanOrEqual(5.2);
    expect(STAGE_TYPE_TARGET_CSS).toBeLessThanOrEqual(6);
    expect(3.33 * STAGE_MAX_TYPE_BOOST).toBeGreaterThanOrEqual(5.2);
  });

  it('leaves a half-size stage a modest boost instead of the whole cap', () => {
    // Nothing to do with the phone cap: the boost matches what the scale lacks.
    const boost = stageTypeBoost({ u: 1.308, band: 158, cssScale: 0.4 });
    expect(boost).toBeGreaterThan(1);
    expect(boost).toBeLessThan(1.3);
    const target = stageTypeBoost({ u: 1.308, band: 158, cssScale: 0.2 });
    expect(target).toBeGreaterThanOrEqual(boost);
  });
});

/* ------------------------------------------------------------- the engine */

interface PlateLike {
  layout: (photo: { w: number; h: number; img?: unknown }, options: Record<string, unknown>) => Record<string, number | string>;
  FYRA_THEMES: { id: string; label: string; layout: string }[];
  multiLayout: (options: Record<string, unknown>) => Record<string, unknown>;
}

let plate: PlateLike;

beforeAll(() => {
  const root = resolve(__dirname, '..');
  const read = (name: string) => readFileSync(resolve(root, 'public/plate', name), 'utf8');
  const load = new Function('window', `${read('emblems.js')}\n${read('plate.js')}\nreturn window.SPPlate;`);
  plate = load(window) as PlateLike;
});

describe('the plate keeps Shutterplate’s designed proportions', () => {
  it('prints Classic Gallery at its own geo, with no type boost', () => {
    const layout = plate.layout({ w: 1200, h: 750 }, { style: 'gallery' });
    expect(layout.typeBoost).toBe(1);
    // geo: pad 4.5% of the photo width on every side, band 13% of its height
    const padX = Math.round(1200 * 0.045);
    expect(layout.padX).toBe(padX);
    expect(layout.W).toBe(1200 + 2 * padX);
    expect(layout.padTop).toBe(padX);
    expect(layout.band).toBe(Math.round(padX + 750 * 0.13));
    expect(layout.H).toBe((layout.padTop as number) + 750 + (layout.band as number));
    expect(layout.u as number).toBeCloseTo((layout.W as number) / 1000, 5);
    // the band stays a fraction of the plate, not a phone-sized balloon
    expect((layout.band as number) / (layout.H as number)).toBeCloseTo(0.159, 2);
  });

  it('reaches the same geometry for the same photograph at any display size', () => {
    // The stage scales the canvas, it never re-lays the plate out per viewport.
    const layout = plate.layout({ w: 1200, h: 750 }, { style: 'gallery' });
    expect(layout.uBase as number).toBeCloseTo((layout.W as number) / 1000, 5);
    expect(layout.band as number).toBe(Math.round((layout.padX as number) + 750 * 0.13));
  });

  it('grows the band with the type for a phone, and only that far', () => {
    // The stage's phone boost is 1.6: the band goes 15.6% → ~23% of the plate,
    // never the 35% card an uncapped 2.6× made, while the copy grows with it.
    const base = plate.layout({ w: 1200, h: 800 }, { style: 'gallery' });
    const phone = plate.layout({ w: 1200, h: 800 }, { style: 'gallery', typeBoost: STAGE_MAX_TYPE_BOOST });
    expect(phone.typeBoost).toBe(STAGE_MAX_TYPE_BOOST);
    expect(phone.W).toBe(base.W);
    expect(phone.PW).toBe(base.PW);
    expect(phone.padX).toBe(base.padX);
    expect(phone.band).toBe(Math.round((base.band as number) * STAGE_MAX_TYPE_BOOST));
    expect((phone.u as number) / (base.u as number)).toBeCloseTo(STAGE_MAX_TYPE_BOOST, 5);
    expect((phone.band as number) / (phone.H as number)).toBeGreaterThan(0.19);
    expect((phone.band as number) / (phone.H as number)).toBeLessThanOrEqual(0.23);
  });

  it('ships the four themes the 4-cut window opens with', () => {
    const ids = plate.FYRA_THEMES.map((theme) => theme.id);
    for (const id of ['midnight', 'snow', 'forest', 'sand']) expect(ids).toContain(id);
    const layout = plate.multiLayout({
      style: 'fyra04', fyraTheme: 'midnight',
      slots: [{ img: { naturalWidth: 900, naturalHeight: 600 }, w: 900, h: 600 }],
      fields: {},
    });
    expect(layout.theme).toBe('midnight');
    expect(layout.themeLabel).toBe('Midnight');
    expect((layout.cells as unknown[]).length).toBe(4);
  });
});

/* ----------------------------------------------------------------- state */

const photo = (url: string): MediaInfo => ({
  kind: 'photo', name: `${url}.jpg`, url, width: 1200, height: 800, duration: 0, fps: 0, size: 1,
  meta: { make: '', model: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '', caption: '' },
});

describe('the four-cut slots', () => {
  it('removes one slot and keeps the active index inside the plate', () => {
    let state = studioReducer(initialStudio(), { type: 'open-photos', media: [photo('a'), photo('b'), photo('c')] });
    state = studioReducer(state, { type: 'set-active-photo', index: 2 });
    state = studioReducer(state, { type: 'remove-photo', index: 2 });
    expect(state.media).toHaveLength(2);
    expect(state.activePhoto).toBe(1);
  });

  it('replaces the photograph in a slot', () => {
    let state = studioReducer(initialStudio(), { type: 'open-photos', media: [photo('a'), photo('b')] });
    state = studioReducer(state, { type: 'set-photo', index: 1, media: photo('z') });
    expect(state.media.map((item) => item.url)).toEqual(['a', 'z']);
  });

  it('ignores an index that is not on the plate', () => {
    const state = studioReducer(initialStudio(), { type: 'open-photos', media: [photo('a')] });
    expect(studioReducer(state, { type: 'remove-photo', index: 4 })).toBe(state);
    expect(studioReducer(state, { type: 'set-photo', index: -1, media: photo('z') })).toBe(state);
  });
});
