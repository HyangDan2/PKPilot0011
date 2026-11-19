import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../../downloads');
const SAMPLE_DIR = resolve(process.cwd(), 'public/samples');

type Watched = { errors: string[] };

function watch(page: Page): Watched {
  const seen: Watched = { errors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(message.text());
  });
  page.on('pageerror', (error) => seen.errors.push(`pageerror: ${error.message}`));
  return seen;
}

const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOT_DIR, name) });

/** Modals animate in over 240ms; a screenshot mid-rise reads as a faded sheet. */
const shotSheet = async (page: Page, name: string) => {
  await page.waitForTimeout(450);
  await shot(page, name);
};

async function openSamplePhoto(page: Page) {
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }).toBeGreaterThan(200);
  await page.waitForTimeout(700);
}

/** Clicking a card can leave the strip scrolled; a screenshot wants its start. */
async function resetStrip(page: Page) {
  await page.evaluate(() => { document.querySelector('.filter-strip')?.scrollTo({ left: 0 }); });
  await page.waitForTimeout(150);
}

async function openSampleVideo(page: Page) {
  await page.locator('.sample-card.video').click();
  await expect(page.locator('video.source-video')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.readyState : 0;
  })).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(600);
}

/** No two corners of the screen may sit on top of each other. */
async function expectNoOverlap(page: Page, a: string, b: string) {
  const [firstBox, secondBox] = await Promise.all([
    page.locator(a).boundingBox(),
    page.locator(b).boundingBox(),
  ]);
  if (!firstBox || !secondBox) throw new Error(`missing box for ${a} / ${b}`);
  const overlapX = Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width) - Math.max(firstBox.x, secondBox.x);
  const overlapY = Math.min(firstBox.y + firstBox.height, secondBox.y + secondBox.height) - Math.max(firstBox.y, secondBox.y);
  expect(overlapX <= 1 || overlapY <= 1, `${a} overlaps ${b}`).toBe(true);
}

test('landing: Nordlys lockup, one open card, the corner cluster and both palettes', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page).toHaveTitle(/Nordlys/);
  await expect(page.locator('.landing-top .brand-word')).toHaveText('HD2Lab');
  await expect(page.locator('.landing-top .brand-sub')).toHaveText('Nordlys');
  // The HD2Lab mark is two hollow parallelograms, never a filled block.
  const mark = page.locator('.landing-top .brand-mark svg path');
  await expect(mark).toHaveAttribute('fill', 'none');
  await expect(mark).toHaveAttribute('stroke-width', '4.2');

  // One card opens both kinds of file.
  await expect(page.locator('[data-testid="open-any"]')).toHaveCount(1);
  await expect(page.locator('.open-card')).toHaveCount(1);
  await expect(page.locator('[data-testid="open-any"]')).toContainText('사진 · 영상 열기');
  await expect(page.locator('[data-testid="open-input"]')).toHaveAttribute('accept', /video\/\*/);

  await expect(page.locator('.frame-chip')).toHaveCount(13);
  await expect(page.locator('.sample-card')).toHaveCount(4);

  // Landing corner: the 4-cut door and the app-theme toggle, nothing else.
  await expect(page.locator('[data-testid="float-cluster"] .tool-fab')).toHaveCount(1);
  await expect(page.locator('[data-testid="float-cluster"] [data-testid="theme-fab"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="colorlab-fab"]')).toHaveCount(0);

  await shot(page, 'nordlys_landing.png');

  // The floating toggle owns the whole UI's palette.
  await page.locator('[data-testid="theme-fab"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(350);
  await shot(page, 'nordlys_landing_light.png');
  await page.locator('[data-testid="theme-fab"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('desktop editor: title-backdrop slide, strip, cluster, and no corner collisions', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  await expect(page.locator('.topbar .brand-word')).toHaveText('HD2Lab');
  await expect(page.locator('.topbar .brand-sub')).toHaveText('Nordlys');

  // Title slide = the viewport behind the plate (frame.backdrop), not the app theme.
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await expect(page.locator('.stage')).toHaveClass(/backdrop-dark/);
  await page.locator('[data-testid="backdrop-switch"]').click();
  await expect(page.locator('.stage')).toHaveClass(/backdrop-light/);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  await page.locator('[data-testid="backdrop-switch"]').click();
  await expect(page.locator('.stage')).toHaveClass(/backdrop-dark/);

  // The strip paints the eleven stocks without opening a window.
  await expect(page.locator('[data-testid="filter-strip"] .strip-card')).toHaveCount(12);
  await expect(page.locator('[data-testid="filter-modal"]')).toHaveCount(0);
  await page.locator('[data-testid="filter-strip"] [data-filter-key="FS-010"]').click();
  await expect(page.locator('.topbar .chip').first()).toContainText('RETRO 90');
  expect(await page.locator('[data-testid="filter-modal"]').count()).toBe(0);

  // All four tools sit in the corner cluster, in the editor only.
  await expect(page.locator('[data-testid="float-cluster"] .tool-fab')).toHaveCount(4);
  await expect(page.locator('[data-testid="fourcut-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="colorlab-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="tonecurve-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="cameraeffects-fab"]')).toBeVisible();
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '.dock');
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '[data-testid="filter-strip"]');
  await expectNoOverlap(page, '[data-testid="filter-strip"]', '.dock');

  // The trash is gone; replace + menu took its place.
  await expect(page.locator('.topbar-actions [aria-label="미디어 닫기"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="replace-button"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-menu-button"]')).toBeVisible();

  await page.waitForTimeout(600);
  // Clicking a card scrolls the strip; a screenshot should show it from its start.
  await resetStrip(page);
  await shot(page, 'nordlys_desktop.png');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('navigation menu: workspace, samples and portal links', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  await page.locator('[data-testid="nav-menu-button"]').click();
  await expect(page.locator('[data-testid="nav-menu"]')).toBeVisible();
  const menu = page.locator('[data-testid="nav-menu"]');
  await expect(menu.locator('.portal-menu-head')).toHaveText(['WORKSPACE', 'SAMPLES', 'NAVIGATION']);
  await expect(menu.locator('.portal-item')).toHaveCount(11);
  await expect(menu.getByRole('menuitem', { name: /EXIF 값으로 되돌리기/ })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: /미디어 비우기/ })).toBeEnabled();
  await expect(menu.locator('a[href="https://hyangdan2.github.io/"]')).toHaveCount(1);
  await expect(menu.locator('a[href="https://hyangdan2.github.io/ApplicationHub/"]')).toHaveCount(1);
  await shot(page, 'nordlys_nav_menu.png');

  // Emblem ink toggles from the menu and the badge says which way it went.
  await menu.getByRole('menuitemcheckbox', { name: /엠블럼 색상/ }).click();
  await page.locator('[data-testid="nav-menu-button"]').click();
  await expect(page.locator('[data-testid="nav-menu"] .portal-badge').nth(4)).toHaveText('MONO');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('modals: eleven single frames, the 4-cut window, and the three effect sheets', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  // ── the frame window is eleven singles now ──
  await page.locator('[data-testid="dock-frame"]').click();
  await expect(page.locator('[data-testid="frame-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="frame-modal"] .frame-card')).toHaveCount(11);
  await expect(page.locator('[data-testid="frame-modal"] [data-frame-id="contact"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="frame-modal"] [data-frame-id="fyra04"]')).toHaveCount(0);
  await expect.poll(async () => page.locator('.frame-thumb img').count(), { timeout: 30_000 }).toBe(11);
  await shotSheet(page, 'nordlys_frame_modal.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="frame-modal"]')).toHaveCount(0);

  // ── the 4-cut window: two plates, four slots, ten themes ──
  await page.locator('[data-testid="fourcut-fab"]').click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="fourcut-modal"] .frame-card')).toHaveCount(2);
  await expect(page.locator('[data-testid="fourcut-modal"] .fourcut-slot')).toHaveCount(4);
  await page.locator('[data-testid="fourcut-modal"] [data-frame-id="fyra04"]').click();
  await expect(page.locator('[data-testid="fourcut-modal"] .segmented', { hasText: 'FYRA 테마' }).locator('button')).toHaveCount(10);
  await expect(page.locator('[data-testid="fourcut-modal"]')).toContainText('Midnight');
  await page.waitForTimeout(800);
  await shotSheet(page, 'nordlys_fourcut_modal.png');

  // Fill the empty slots from the picker, then apply.
  const before = await page.locator('[data-testid="fourcut-modal"] .fourcut-slot.filled').count();
  await page.locator('[data-testid="fourcut-modal"] input[type="file"]').first().setInputFiles([
    resolve(SAMPLE_DIR, 'landscape_test.png'),
    resolve(SAMPLE_DIR, 'color_chart.png'),
  ]);
  await expect(page.locator('[data-testid="fourcut-modal"] .fourcut-slot.filled'))
    .toHaveCount(Math.min(4, before + 2));
  await page.getByRole('button', { name: /이 프레임으로 적용/ }).click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toHaveCount(0);
  await expect(page.locator('.slot-strip .slot:not(.add)')).toHaveCount(Math.min(4, before + 2));
  await page.waitForTimeout(900);

  // ── the three effect sheets, split out of the grade panel ──
  await page.locator('[data-testid="colorlab-fab"]').click();
  await expect(page.locator('[data-testid="colorlab-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="colorlab-modal"] .band-dot')).toHaveCount(8);
  await shotSheet(page, 'nordlys_colorlab_modal.png');
  await page.keyboard.press('Escape');

  await page.locator('[data-testid="tonecurve-fab"]').click();
  await expect(page.locator('[data-testid="tonecurve-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="tonecurve-modal"] canvas')).toBeVisible();
  await shotSheet(page, 'nordlys_tonecurve_modal.png');
  await page.keyboard.press('Escape');

  await page.locator('[data-testid="cameraeffects-fab"]').click();
  await expect(page.locator('[data-testid="cameraeffects-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="cameraeffects-modal"]')).toContainText('날짜 각인');
  await expect(page.locator('[data-testid="cameraeffects-modal"]')).toContainText('광학 효과');
  await shotSheet(page, 'nordlys_cameraeffects_modal.png');
  await page.keyboard.press('Escape');

  // ── the grade panel keeps only light / colour / texture / video ──
  await page.locator('[data-testid="dock-adjust"]').click();
  await expect(page.locator('[data-testid="adjust-modal"]')).toBeVisible();
  const tabs = await page.locator('[data-testid="adjust-modal"] .chip-row .chip').allTextContents();
  expect(tabs).toEqual(['빛', '색', '질감', '영상'].filter((label) => label !== '영상'));
  await shotSheet(page, 'nordlys_adjust_modal.png');
  await page.keyboard.press('Escape');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('export: prepare first, then one save/share tap', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  await page.locator('[data-testid="dock-export"]').click();
  await expect(page.locator('[data-testid="export-modal"]')).toBeVisible();
  // The still is made on open, so the button already holds a file.
  await expect(page.locator('[data-testid="save-share"]')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[data-testid="export-modal"]')).toContainText('-Nordlys.jpg');
  await expect(page.locator('.export-foot .link-btn')).toBeVisible();
  await shotSheet(page, 'nordlys_export_modal.png');

  const download = page.waitForEvent('download', { timeout: 20_000 });
  await page.locator('[data-testid="save-share"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('-Nordlys');
  const path = resolve(SHOT_DIR, 'nordlys_still_export.jpg');
  await file.saveAs(path);

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('video: sound toggle, plate legibility and an export that keeps its audio', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSampleVideo(page);

  // The clip autoplays silent; the toggle is the visitor's way to the sound.
  const mute = page.locator('[data-testid="mute-toggle"]');
  await expect(mute).toBeVisible();
  await expect(mute).toContainText('음소거');
  await mute.click();
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : true;
  })).toBe(false);
  await page.waitForTimeout(700);
  await resetStrip(page);
  await shot(page, 'nordlys_video.png');

  // A clip with no EXIF still prints a full spec row.
  const plateSpecial = await page.locator('[data-testid="plate-canvas"]').getAttribute('data-plate-size');
  expect(plateSpecial).toMatch(/^\d+x\d+$/);

  await page.locator('[data-testid="dock-export"]').click();
  await expect(page.locator('[data-testid="export-modal"]')).toBeVisible();
  await page.locator('[data-testid="export-modal"] .segmented-track button', { hasText: '720p' }).click();
  await expect(page.locator('[data-testid="save-share"]')).toBeDisabled();
  await page.getByRole('button', { name: /영상 준비/ }).click();
  await expect(page.locator('[data-testid="save-share"]')).toBeEnabled({ timeout: 200_000 });
  await expect(page.locator('[data-testid="export-modal"]')).toContainText('Nordlys');

  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="save-share"]').click();
  const file = await download;
  const name = file.suggestedFilename();
  const out = resolve(SHOT_DIR, name.endsWith('.webm') ? 'nordlys_export_probe.webm' : 'nordlys_export_probe.mp4');
  await file.saveAs(out);
  process.stdout.write(`[export] ${name} → ${out}\n`);

  // The exported container must carry real sound, not an empty track.
  const bytes = readFileSync(out);
  const peak = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(buffer.buffer);
      let loudest = 0;
      for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        const data = audio.getChannelData(channel);
        for (let i = 0; i < data.length; i += 17) loudest = Math.max(loudest, Math.abs(data[i]));
      }
      return { peak: loudest, seconds: audio.duration, channels: audio.numberOfChannels };
    } catch (error) {
      return { peak: -1, seconds: 0, channels: 0, error: String(error) };
    } finally {
      await ctx.close();
    }
  }, bytes.toString('base64'));
  process.stdout.write(`[export audio] ${JSON.stringify(peak)}\n`);
  expect(peak.peak, `audio peak in ${name}`).toBeGreaterThan(0.005);
  expect(peak.seconds).toBeGreaterThan(5);

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('mobile 390×844: the strip, the cluster and readable plate copy', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.hero h1')).toBeVisible();
  await openSamplePhoto(page);

  // Nothing spills out of the 100dvh editor.
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    inner: window.innerHeight,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner + 1);

  const canvas = await page.locator('[data-testid="plate-canvas"]').boundingBox();
  expect(canvas!.width).toBeLessThanOrEqual(390);
  expect(canvas!.height).toBeLessThanOrEqual(844);

  // The plate is designed at print size and its copy is boosted for the phone.
  const boost = Number(await page.locator('[data-testid="plate-canvas"]').getAttribute('data-type-boost'));
  const scale = Number(await page.locator('[data-testid="plate-canvas"]').getAttribute('data-plate-scale'));
  const minType = Number(await page.locator('[data-testid="plate-canvas"]').getAttribute('data-min-type-css'));
  process.stdout.write(`[mobile] boost=${boost} scale=${scale} smallest row=${minType}px\n`);
  expect(boost).toBeGreaterThan(1.5);
  expect(scale).toBeLessThan(0.45);
  // Every row of frame copy has to read at arm's length on a phone.
  expect(minType).toBeGreaterThanOrEqual(8.5);

  // The corner cluster is one row inside the stage and touches nothing.
  const cluster = await page.locator('[data-testid="float-cluster"]').boundingBox();
  expect(cluster!.x).toBeGreaterThanOrEqual(0);
  expect(cluster!.x + cluster!.width).toBeLessThanOrEqual(390);
  expect(cluster!.width).toBeLessThan(320);
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '.dock');
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '[data-testid="filter-strip"]');
  await expectNoOverlap(page, '[data-testid="filter-strip"]', '.dock');
  await expect(page.locator('[data-testid="float-cluster"] .tool-fab')).toHaveCount(4);
  await expect(page.locator('[data-testid="theme-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="backdrop-switch"]')).toBeVisible();

  await page.screenshot({ path: resolve(SHOT_DIR, 'nordlys_mobile.png') });
  await page.locator('[data-testid="plate-canvas"]').screenshot({ path: resolve(SHOT_DIR, 'nordlys_mobile_plate.png') });

  await expect(page.locator('[data-testid="filter-strip"] .strip-card')).toHaveCount(12);
  await page.locator('[data-testid="filter-strip"] [data-filter-key="FS-004"]').click();

  await page.locator('[data-testid="fourcut-fab"]').click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toBeVisible();
  await shotSheet(page, 'nordlys_mobile_fourcut.png');
  await page.keyboard.press('Escape');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});
