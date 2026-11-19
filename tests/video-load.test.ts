import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVideo } from '../src/media/load';

/**
 * Regression cover for the four ways a clip used to hang on "영상을 분석하는 중…":
 * the element was detached while it decoded, the whole file was preloaded, a
 * clip that only offered metadata was treated as broken, and a failed open left
 * its element and object URL behind.
 */

function clipFile(name = 'sample-clip.mp4'): File {
  return new File([new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112])], name, { type: 'video/mp4' });
}

function sourceVideo(): HTMLVideoElement {
  const video = document.querySelector('video.source-video');
  if (!video) throw new Error('영상 요소가 페이지에 붙지 않았습니다');
  return video as HTMLVideoElement;
}

function setGeometry(video: HTMLVideoElement, width: number, height: number): void {
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
}

function setReadyState(video: HTMLVideoElement, state: number): void {
  Object.defineProperty(video, 'readyState', { value: state, configurable: true });
}

function setDuration(video: HTMLVideoElement, seconds: number): void {
  Object.defineProperty(video, 'duration', { value: seconds, configurable: true });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('opening a clip', () => {
  it('waits for metadata in the page, never preloading the whole file', async () => {
    const loading = loadVideo(clipFile(), { timeoutMs: 40, probeTimeoutMs: 10 });
    const video = sourceVideo();

    expect(video.preload).toBe('metadata');
    expect(video.isConnected).toBe(true);
    expect(video.getAttribute('aria-hidden')).toBe('true');
    expect(video.className).toContain('source-video');

    setGeometry(video, 1920, 1080);
    setDuration(video, 6.2);
    setReadyState(video, 1);
    video.dispatchEvent(new Event('loadedmetadata'));

    const loaded = await loading;
    expect(loaded.info.kind).toBe('video');
    expect(loaded.info.width).toBe(1920);
    expect(loaded.info.height).toBe(1080);
    expect(loaded.info.duration).toBe(6.2);
    // The metadata nudge parks the playhead a frame in; the head is restored.
    expect(video.currentTime).toBe(0);
    // The stage keeps this very element: it is what feeds the plate.
    expect(loaded.video).toBe(video);
    expect(document.querySelector('video.source-video')).toBe(video);
  });

  it('opens at once when a frame is already decoded', async () => {
    const loading = loadVideo(clipFile(), { timeoutMs: 5000, probeTimeoutMs: 10 });
    const video = sourceVideo();

    setGeometry(video, 1280, 720);
    setDuration(video, 9.5);
    setReadyState(video, 2);
    video.dispatchEvent(new Event('loadeddata'));

    const loaded = await loading;
    expect(loaded.info.width).toBe(1280);
    expect(loaded.info.height).toBe(720);
    expect(loaded.info.duration).toBe(9.5);
  });

  it('reports a clip the browser cannot decode and takes its element down', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const loading = loadVideo(clipFile('broken.mp4'), { timeoutMs: 5000, probeTimeoutMs: 10 });
    const video = sourceVideo();
    const url = video.getAttribute('src') ?? '';

    video.dispatchEvent(new Event('error'));

    await expect(loading).rejects.toThrow(/영상을 열 수 없습니다: broken\.mp4/);
    expect(revoke).toHaveBeenCalledWith(url);
    expect(document.querySelector('video.source-video')).toBeNull();
  });

  it('gives up on a clip that never offers metadata instead of waiting forever', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const loading = loadVideo(clipFile('silent.mp4'), { timeoutMs: 30, probeTimeoutMs: 10 });
    const video = sourceVideo();
    const url = video.getAttribute('src') ?? '';

    await expect(loading).rejects.toThrow(/영상 데이터를 읽지 못했습니다: silent\.mp4/);
    expect(revoke).toHaveBeenCalledWith(url);
    expect(document.querySelector('video.source-video')).toBeNull();
  });

  it('refuses geometry of 0×0 rather than opening a plate it cannot print', async () => {
    const loading = loadVideo(clipFile('rotated.mov'), { timeoutMs: 30, probeTimeoutMs: 10 });
    const video = sourceVideo();

    setGeometry(video, 0, 0);
    setDuration(video, 3);
    setReadyState(video, 1);
    video.dispatchEvent(new Event('loadedmetadata'));

    await expect(loading).rejects.toThrow(/영상 크기를 읽지 못했습니다: rotated\.mov/);
    expect(document.querySelector('video.source-video')).toBeNull();
  });
});
