import type { WorkspaceFile } from './workspace';

/**
 * Strip thumbnails. One card, one small still: a photo is drawn down from the
 * file, a clip from its first frames (with its real length). Results are kept
 * for as long as the workspace is open, so scrolling back costs nothing.
 */
export interface WorkspaceThumb {
  url: string;
  width: number;
  height: number;
  /** Seconds; 0 for a photo or an undecodable clip. */
  duration: number;
}

const THUMB_W = 176;
const THUMB_H = 112;

const cache = new Map<string, WorkspaceThumb>();
const pending = new Map<string, Promise<WorkspaceThumb | null>>();
const queue: (() => void)[] = [];
let running = 0;
const MAX_PARALLEL = 2;

export function cachedThumb(entryId: string): WorkspaceThumb | undefined {
  return cache.get(entryId);
}

export function clearWorkspaceThumbs(): void {
  cache.clear();
}

function canvasUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.74);
}

/** Contain the picture in the card; the letterbox stays black like the stage. */
function drawContained(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#080b14';
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const scale = Math.min(THUMB_W / Math.max(1, width), THUMB_H / Math.max(1, height));
  const w = Math.max(1, width * scale);
  const h = Math.max(1, height * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);
  return canvasUrl(canvas);
}

function once(target: EventTarget, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      target.removeEventListener(name, finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    target.addEventListener(name, finish);
  });
}

async function photoThumb(entry: WorkspaceFile): Promise<WorkspaceThumb | null> {
  const url = URL.createObjectURL(entry.file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('thumb'));
      image.src = url;
    });
    return {
      url: drawContained(image, image.naturalWidth, image.naturalHeight),
      width: image.naturalWidth,
      height: image.naturalHeight,
      duration: 0,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function videoThumb(entry: WorkspaceFile): Promise<WorkspaceThumb | null> {
  const url = URL.createObjectURL(entry.file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  // A clip outside the document may never decode; keep it in the page like the
  // stage's own source element, but out of the way.
  video.className = 'source-video';
  video.setAttribute('aria-hidden', 'true');
  try {
    video.src = url;
    document.body.appendChild(video);
    await once(video, 'loadeddata', 4000);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (video.readyState >= 2) {
      const span = duration > 0 ? duration : 0.2;
      try {
        video.currentTime = Math.min(0.12, span / 2);
      } catch {
        /* the first frame will do */
      }
      await once(video, 'seeked', 1200);
    }
    if (!video.videoWidth || !video.videoHeight) return null;
    return {
      url: drawContained(video, video.videoWidth, video.videoHeight),
      width: video.videoWidth,
      height: video.videoHeight,
      duration,
    };
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

function work(entry: WorkspaceFile): Promise<WorkspaceThumb | null> {
  return entry.kind === 'video' ? videoThumb(entry) : photoThumb(entry);
}

function pump(): void {
  while (running < MAX_PARALLEL && queue.length) {
    const task = queue.shift();
    if (!task) break;
    running += 1;
    task();
  }
}

/**
 * The card's still. Two renders at a time — a folder of clips must not freeze
 * the stage — and a card that scrolls away can simply be asked for again.
 */
export function requestThumb(entry: WorkspaceFile): Promise<WorkspaceThumb | null> {
  const cached = cache.get(entry.id);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(entry.id);
  if (inFlight) return inFlight;
  const job = new Promise<WorkspaceThumb | null>((resolve) => {
    queue.push(() => {
      void work(entry)
        .then((thumb) => {
          if (thumb) cache.set(entry.id, thumb);
          resolve(thumb);
        })
        .catch(() => resolve(null))
        .finally(() => {
          pending.delete(entry.id);
          running -= 1;
          pump();
        });
    });
    pump();
  });
  pending.set(entry.id, job);
  return job;
}
