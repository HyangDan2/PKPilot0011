import { gradeForFilter, type FilterOption } from '../filters/catalog';
import { PhotoGrader } from './grading';

/**
 * The film shelf's previews, made on demand.
 *
 * Sixty-nine grades are too many to draw the moment the studio opens: the
 * shelf asks only for the cards on screen, one grader draws them in order, and
 * a card that scrolls away can be asked for again from the same cache.
 */
export interface FilmThumbSource {
  /** Identifies the frame the previews are graded from. */
  mediaKey: string;
  source: CanvasImageSource;
  width: number;
  height: number;
}

const WIDTH = 96;

const cache = new Map<string, string>();
let queue: { filter: FilterOption; source: FilmThumbSource; resolve: (url: string | null) => void }[] = [];
const pending = new Map<string, Promise<string | null>>();
let grader: PhotoGrader | null = null;
let running = false;

function keyOf(source: FilmThumbSource, filter: FilterOption): string {
  return `${source.mediaKey}|${filter.key}`;
}

export function cachedFilmThumb(source: FilmThumbSource, filterKey: string): string | undefined {
  return cache.get(`${source.mediaKey}|${filterKey}`);
}

export function clearFilmThumbs(): void {
  cache.clear();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        if (!grader) grader = new PhotoGrader();
        const height = Math.max(48, Math.round(WIDTH * (job.source.height / Math.max(1, job.source.width))));
        const grade = gradeForFilter({ kind: job.filter.kind, filmId: job.filter.filmId, presetId: job.filter.presetId });
        const graded = await grader.render({ source: job.source.source, grade, width: WIDTH, height });
        const canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(graded, 0, 0);
        const url = canvas.toDataURL('image/jpeg', 0.78);
        cache.set(keyOf(job.source, job.filter), url);
        job.resolve(url);
      } catch {
        job.resolve(null);
      }
      pending.delete(keyOf(job.source, job.filter));
      // Give the page a breath between cards: a click must land before the
      // sixty-ninth preview is drawn.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    running = false;
    grader?.destroy();
    grader = null;
  }
}

export function requestFilmThumb(source: FilmThumbSource, filter: FilterOption): Promise<string | null> {
  const key = keyOf(source, filter);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  // Previews of a frame that is no longer open are not worth drawing.
  if (queue.some((job) => job.source.mediaKey !== source.mediaKey)) {
    const stale = queue.filter((job) => job.source.mediaKey !== source.mediaKey);
    queue = queue.filter((job) => job.source.mediaKey === source.mediaKey);
    for (const job of stale) {
      pending.delete(keyOf(job.source, job.filter));
      job.resolve(null);
    }
  }
  const job = new Promise<string | null>((resolve) => {
    queue.push({ filter, source, resolve });
    void pump();
  });
  pending.set(key, job);
  return job;
}
