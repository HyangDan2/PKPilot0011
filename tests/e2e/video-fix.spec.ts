import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../../downloads');

function watch(page: Page): { errors: string[] } {
  const seen = { errors: [] as string[] };
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(message.text());
  });
  page.on('pageerror', (error) => seen.errors.push(`pageerror: ${error.message}`));
  return seen;
}

const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOT_DIR, name) });

/** What the stage actually paints, sampled off the plate canvas. */
async function plateSample(page: Page): Promise<{ colours: number; checksum: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="plate-canvas"]') as HTMLCanvasElement | null;
    if (!canvas) return { colours: 0, checksum: 0 };
    const width = 160;
    const height = 120;
    const probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    const ctx = probe.getContext('2d');
    if (!ctx) return { colours: 0, checksum: 0 };
    ctx.drawImage(canvas, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const seen = new Set<string>();
    let checksum = 0;
    for (let i = 0; i < data.length; i += 4) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      checksum = (checksum * 31 + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7 + data[i + 3]) % 2147483647;
    }
    return { colours: seen.size, checksum };
  });
}

/**
 * The four root causes of "영상을 분석하는 중…" that never ended: a detached
 * element, a whole-file preload, a metadata-only clip judged broken, and a
 * frame that painted before its LUT existed. Each is checked against the built
 * bundle, not the source.
 */
test('video: opens on metadata, decodes in the page, and keeps a live plate', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.locator('.sample-card.video').click();
  const source = page.locator('video.source-video');
  await expect(source).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.readyState : -1;
  }), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

  // ── 1. the element is in the viewport and only asks for metadata ──
  const state = await source.evaluate((video: HTMLVideoElement) => {
    const rect = video.getBoundingClientRect();
    return {
      preload: video.preload,
      readyState: video.readyState,
      connected: video.isConnected,
      inViewport: rect.left >= 0 && rect.top >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  });
  expect(state.preload).toBe('metadata');
  expect(state.connected).toBe(true);
  expect(state.inViewport).toBe(true);
  expect(state.width).toBeGreaterThan(0);
  expect(state.height).toBeGreaterThan(0);
  expect(state.duration).toBeGreaterThan(1);
  process.stdout.write(`[source-video] ${JSON.stringify(state)}\n`);

  const box = await source.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);

  // ── 2. the clip's real length reached the stage (durationchange) ──
  await expect(page.locator('.media-spec')).toHaveText(/·\s*[1-9][\d.]*s/, { timeout: 20_000 });

  // ── 3. a decoded frame lands on the plate, even with the clip paused ──
  const play = page.locator('[data-testid="play-button"]');
  await expect(play).toHaveAttribute('aria-label', '일시정지');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', '재생');
  await expect.poll(async () => (await plateSample(page)).colours, { timeout: 20_000 }).toBeGreaterThan(24);
  await page.waitForTimeout(500);
  const idle = await plateSample(page);
  const idleTime = await page.evaluate(() => (document.querySelector('video.source-video') as HTMLVideoElement).currentTime);
  process.stdout.write(`[idle] colours=${idle.colours} t=${idleTime}\n`);
  await shot(page, 'nordlys_video_fix_idle.png');

  // ── 4. playing moves both the clock and the pixels ──
  await play.click();
  await expect(play).toHaveAttribute('aria-label', '일시정지');
  await page.waitForTimeout(250);
  const first = await page.evaluate(() => (document.querySelector('video.source-video') as HTMLVideoElement).currentTime);
  await page.waitForTimeout(900);
  const second = await page.evaluate(() => (document.querySelector('video.source-video') as HTMLVideoElement).currentTime);
  const moving = await plateSample(page);
  process.stdout.write(`[playing] ${first.toFixed(2)}s → ${second.toFixed(2)}s colours=${moving.colours}\n`);
  expect(second).toBeGreaterThan(first + 0.2);
  expect(moving.colours).toBeGreaterThan(24);
  expect(moving.checksum).not.toBe(idle.checksum);
  await shot(page, 'nordlys_video_fix_playing.png');

  // ── 5. sound: the transport starts the clip with sound, the toggle silences it ──
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : true;
  }), { message: 'transport play should ask for sound' }).toBe(false);

  await page.locator('[data-testid="mute-toggle"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : false;
  })).toBe(true);
  await page.locator('[data-testid="mute-toggle"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : true;
  })).toBe(false);

  // ── 6. the loop starts the next pass instead of freezing on the last frame ──
  // A whole pass plus slack: had the loop not restarted itself, the element
  // would still be sitting at the end with the clock stopped.
  await page.waitForTimeout(7000);
  const afterWrap = await page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement;
    return { time: video.currentTime, paused: video.paused, ended: video.ended };
  });
  process.stdout.write(`[loop] after a full pass ${JSON.stringify(afterWrap)}\n`);
  expect(afterWrap.paused).toBe(false);
  expect(afterWrap.ended).toBe(false);
  expect(afterWrap.time).toBeLessThan(6.1);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement;
    return video.currentTime;
  }), { timeout: 5000 }).not.toBe(afterWrap.time);

  expect(errors.errors, errors.errors.join(' | ')).toEqual([]);
});

test('desktop: the ⋮ menu opens above the corner tools', async ({ page }) => {
  const errors = watch(page);
  // A short window is where the dropdown's bottom meets the floating cluster.
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto('/');
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();

  await page.locator('[data-testid="nav-menu-button"]').click();
  const menu = page.locator('[data-testid="nav-menu"]');
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  const clusterBox = await page.locator('[data-testid="float-cluster"]').boundingBox();
  expect(menuBox).not.toBeNull();
  expect(clusterBox).not.toBeNull();

  const overlapWidth = Math.min(menuBox!.x + menuBox!.width, clusterBox!.x + clusterBox!.width) - Math.max(menuBox!.x, clusterBox!.x);
  const overlapHeight = Math.min(menuBox!.y + menuBox!.height, clusterBox!.y + clusterBox!.height) - Math.max(menuBox!.y, clusterBox!.y);
  process.stdout.write(`[menu] overlap ${overlapWidth.toFixed(1)}×${overlapHeight.toFixed(1)}\n`);
  expect(overlapWidth, 'menu and cluster should share a corner at this size').toBeGreaterThan(4);
  expect(overlapHeight, 'menu and cluster should share a corner at this size').toBeGreaterThan(4);

  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      inMenu: !!element?.closest('[data-testid="nav-menu"]'),
      tag: element?.tagName ?? null,
      testId: element?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
    };
  }, {
    x: Math.max(menuBox!.x, clusterBox!.x) + overlapWidth / 2,
    y: Math.max(menuBox!.y, clusterBox!.y) + overlapHeight / 2,
  });
  process.stdout.write(`[menu] hit ${JSON.stringify(hit)}\n`);
  expect(hit.inMenu, `the menu is under ${hit.testId ?? hit.tag} there`).toBe(true);

  await shot(page, 'nordlys_nav_menu_over_stage.png');
  expect(errors.errors, errors.errors.join(' | ')).toEqual([]);
});
