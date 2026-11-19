import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../../downloads');

type Console = { errors: string[] };

function watch(page: Page): Console {
  const seen: Console = { errors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(message.text());
  });
  page.on('pageerror', (error) => seen.errors.push(`pageerror: ${error.message}`));
  return seen;
}

async function openSamplePhoto(page: Page) {
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }).toBeGreaterThan(200);
}

async function openSampleVideo(page: Page) {
  await page.locator('.sample-card.video').click();
  await expect(page.locator('video.source-video')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.readyState : 0;
  })).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.currentTime : 0;
  })).toBeGreaterThan(0.2);
}

test('desktop studio: photo, filter modal, frame modal', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const console = watch(page);

  await page.goto('/');
  await expect(page.locator('.hero h1')).toContainText('플레이트');
  await expect(page.locator('.frame-chip')).toHaveCount(13);
  await expect(page.locator('.sample-card')).toHaveCount(4);

  await openSamplePhoto(page);
  await page.waitForTimeout(900);

  // A graded, framed plate is actually painted — not a blank canvas.
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="plate-canvas"]');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let bright = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (data[i] + data[i + 1] + data[i + 2] > 90) bright += 1;
    }
    return bright;
  });
  expect(painted).toBeGreaterThan(100);
  await page.screenshot({ path: resolve(SHOT_DIR, 'pkpilot0011_desktop.png') });

  // ── filter modal ──
  await page.locator('[data-testid="dock-filter"]').click();
  await expect(page.locator('[data-testid="filter-modal"]')).toBeVisible();
  await expect(page.locator('.filter-card')).toHaveCount(69);
  await expect.poll(async () => page.locator('.filter-thumb img').count(), { timeout: 30_000 }).toBeGreaterThan(12);
  await page.locator('[data-filter-key="FS-010"]').click();
  await expect(page.locator('.filter-card.selected')).toHaveAttribute('data-filter-key', 'FS-010');
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(SHOT_DIR, 'pkpilot0011_filter_modal.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="filter-modal"]')).toHaveCount(0);
  await expect(page.locator('.topbar .chip').first()).toContainText('RETRO 90');

  // ── frame modal ──
  await page.locator('[data-testid="dock-frame"]').click();
  await expect(page.locator('[data-testid="frame-modal"]')).toBeVisible();
  await expect(page.locator('.frame-card')).toHaveCount(13);
  await expect(page.locator('.frame-card.disabled')).toHaveCount(0);
  await expect.poll(async () => page.locator('.frame-thumb img').count(), { timeout: 30_000 }).toBe(13);
  await page.locator('[data-frame-id="film"]').click();
  await expect(page.locator('.frame-card.selected')).toHaveAttribute('data-frame-id', 'film');
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(SHOT_DIR, 'pkpilot0011_frame_modal.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.topbar .chip').nth(1)).toContainText('Film Sprocket');

  // ── video: play, scrub, trim and the photo-only frames ──
  await page.locator('.brand-btn').click();
  await expect(page.locator('.landing')).toBeVisible();
  await openSampleVideo(page);
  await expect(page.locator('.timeline')).toBeVisible();
  await page.locator('[data-testid="dock-frame"]').click();
  await expect(page.locator('.frame-card.disabled')).toHaveCount(2);
  await page.locator('.modal-head .icon-btn').click();
  await page.waitForTimeout(400);

  expect(console.errors, `console errors: ${console.errors.join(' | ')}`).toEqual([]);
});

test('mobile studio: landing, editor, both modals', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const console = watch(page);

  await page.goto('/');
  await expect(page.locator('.hero h1')).toBeVisible();
  await openSamplePhoto(page);
  await page.waitForTimeout(900);

  const canvas = await page.locator('[data-testid="plate-canvas"]').boundingBox();
  expect(canvas!.width).toBeLessThanOrEqual(390);
  expect(canvas!.height).toBeLessThanOrEqual(844);

  // Nothing overflows the 100dvh editor on a phone.
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    inner: window.innerHeight,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner + 1);

  await page.screenshot({ path: resolve(SHOT_DIR, 'pkpilot0011_mobile.png') });

  await page.locator('[data-testid="dock-filter"]').click();
  await expect(page.locator('[data-testid="filter-modal"]')).toBeVisible();
  await expect.poll(async () => page.locator('.filter-thumb img').count(), { timeout: 30_000 }).toBeGreaterThan(6);
  await page.locator('[data-filter-key="FS-008"]').click();
  await page.waitForTimeout(600);
  await page.locator('.modal-head .icon-btn').click();
  await expect(page.locator('[data-testid="filter-modal"]')).toHaveCount(0);
  await expect(page.locator('.topbar .desktop-only').first()).toBeHidden();

  await page.locator('[data-testid="dock-frame"]').click();
  await expect(page.locator('[data-testid="frame-modal"]')).toBeVisible();
  await expect(page.locator('.frame-card')).toHaveCount(13);
  await page.locator('[data-frame-id="polaroid"]').click();
  await page.waitForTimeout(800);
  await expect(page.locator('.frame-card.selected')).toHaveAttribute('data-frame-id', 'polaroid');
  await page.locator('.modal-head .icon-btn').click();
  await page.waitForTimeout(600);

  expect(console.errors, `console errors: ${console.errors.join(' | ')}`).toEqual([]);
});
