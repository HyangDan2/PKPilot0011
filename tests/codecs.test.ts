import { describe, expect, it } from 'vitest';
import {
  exportDimensions,
  frameTimestamps,
  outputFileName,
  pickEncodePlan,
  type AudioProbe,
  type VideoProbe,
} from '../src/export/codecs';

const videoAll: VideoProbe = async () => true;
const audioNone: AudioProbe = async () => false;
const audioAll: AudioProbe = async () => true;
const nothing: VideoProbe = async () => false;

describe('pickEncodePlan', () => {
  it('prefers H.264 in MP4 with AAC when everything is available', async () => {
    const plan = await pickEncodePlan(videoAll, audioAll, 1920, 1080);
    expect(plan).toEqual({ container: 'mp4', video: 'avc', audio: 'aac' });
  });

  it('keeps H.264 and goes silent when there is no AAC encoder (older iOS)', async () => {
    const plan = await pickEncodePlan(videoAll, audioNone, 1920, 1080);
    expect(plan).toEqual({ container: 'mp4', video: 'avc', audio: null });
  });

  it('falls back to VP9/Opus in WebM when H.264 is not encodable', async () => {
    const video: VideoProbe = async (codec) => codec === 'vp9';
    const plan = await pickEncodePlan(video, audioAll, 1280, 720);
    expect(plan).toEqual({ container: 'webm', video: 'vp9', audio: 'opus' });
  });

  it('tries VP8 after VP9, and returns null when nothing can encode', async () => {
    const video: VideoProbe = async (codec) => codec === 'vp8';
    expect((await pickEncodePlan(video, audioNone, 1280, 720))?.video).toBe('vp8');
    expect(await pickEncodePlan(nothing, audioAll, 1280, 720)).toBeNull();
  });
});

describe('exportDimensions', () => {
  it('caps the long edge at 1920 for 1080p and never upscales', () => {
    expect(exportDimensions('1080p', 3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(exportDimensions('1080p', 1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('uses the long edge so portrait video stays portrait', () => {
    expect(exportDimensions('720p', 1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it('keeps source dimensions even when requesting source', () => {
    expect(exportDimensions('source', 4032, 3024)).toEqual({ width: 4032, height: 3024 });
  });

  it('always returns even numbers, which H.264 requires', () => {
    const size = exportDimensions('720p', 4001, 2249);
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
  });
});

describe('frameTimestamps', () => {
  it('cuts the trimmed range into an even grid', () => {
    const stamps = frameTimestamps(1, 2, 10);
    expect(stamps).toHaveLength(10);
    expect(stamps[0]).toBeCloseTo(1);
    expect(stamps[9]).toBeCloseTo(1.9);
  });

  it('returns nothing for an empty range and clamps the frame rate', () => {
    expect(frameTimestamps(2, 2, 30)).toEqual([]);
    expect(frameTimestamps(0, 1, 500)).toHaveLength(60);
  });
});

describe('outputFileName', () => {
  it('keeps the stem and appends the HD2Lab suffix', () => {
    expect(outputFileName('sample-clip.mp4', 'mp4')).toBe('sample-clip-HD2Lab.mp4');
    expect(outputFileName('no-extension', 'webm')).toBe('no-extension-HD2Lab.webm');
  });
});
