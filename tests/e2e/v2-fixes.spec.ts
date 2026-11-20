import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The layout of 2026-11-20, checked in a real browser:
 *  1. the landing keeps a two-disc corner column (4-cut + theme); over the stage
 *     only the theme toggle is left, and the four tools moved into the utility
 *     bar under the stage;
 *  2. the utility bar is file info | four tool discs | playback toggle, in one
 *     line on a phone and a desktop; the playback toggle is disabled for a
 *     photo and opens the playing sheet over the bar for a clip;
 *  3. the frame switch prints the picture alone, and its choices come back;
 *  4. the photo bar is gone from the workbench — 4-cut slots live in the window;
 *  5. RETRO 90 closes the filter shelf, after the whole Margarine catalogue;
 *  6. the print is centred in a symmetric stage on a phone, where only the
 *     frame's copy is boosted (the band stays slim).
 */

const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../../downloads');
const SAMPLE_DIR = resolve(process.cwd(), 'public/samples');
/** The phone caps the frame's type boost; the band may not pass this share. */
const MAX_BAND_SHARE = 0.23;

const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOT_DIR, name) });

type Box = { x: number; y: number; width: number; height: number };

async function boxes(page: Page, selectors: string[]): Promise<Box[]> {
  const found: (Box | null)[] = await Promise.all(selectors.map((selector) => page.locator(selector).boundingBox()));
  found.forEach((box, index) => { if (!box) throw new Error(`missing box for ${selectors[index]}`); });
  return found as Box[];
}

function overlaps(a: Box, b: Box, tolerance = 1): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlapX > tolerance && overlapY > tolerance;
}

async function openSamplePhoto(page: Page) {
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }).toBeGreaterThan(150);
  await page.waitForTimeout(800);
}

async function openSampleVideo(page: Page) {
  await page.locator('.sample-card.video').click();
  await expect(page.locator('video.source-video')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.readyState : 0;
  })).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(700);
}

const TOOL_DISCS = ['fourcut-fab', 'colorlab-fab', 'tonecurve-fab', 'cameraeffects-fab'];

/* ── 1. one theme toggle over the stage, four tools in the bar ───────────── */

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`utility bar: info · four tools · playback at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.setViewportSize(viewport);
    await page.goto('/');

    // Landing: the 4-cut door sits above the theme toggle, in one column.
    const landing = await boxes(page, ['[data-testid="fourcut-fab"]', '[data-testid="theme-fab"]']);
    expect(landing[0].y + landing[0].height).toBeLessThanOrEqual(landing[1].y + 1);
    expect(Math.abs((landing[0].x + landing[0].width / 2) - (landing[1].x + landing[1].width / 2))).toBeLessThanOrEqual(1);

    await openSamplePhoto(page);

    // Over the stage only the theme toggle is left in the corner.
    const cluster = page.locator('.stage-wrap > [data-testid="float-cluster"].in-stage');
    await expect(cluster).toHaveCount(1);
    await expect(cluster.locator('button')).toHaveCount(1);
    await expect(cluster.locator('[data-testid="theme-fab"]')).toBeVisible();
    await expect(cluster.locator('[data-testid="fourcut-fab"]')).toHaveCount(0);
    await expect(cluster.locator('.tool-fab')).toHaveCount(0);

    // The bar itself: one line, in order, between the stage and the strip.
    const bar = page.locator('[data-testid="utility-bar"]');
    await expect(bar).toBeVisible();
    for (const id of TOOL_DISCS) await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
    await expect(bar.locator('.utility-meta .media-name')).toHaveText(/^sample-01\.(jpg|jpeg|png)$/i);
    const spec = (await bar.locator('.utility-meta .media-spec').textContent())!.trim();
    expect(spec).toMatch(/^\d+×\d+$/);

    const [barBox, meta, tools, toggle, stageBox, strip] = await boxes(page, [
      '[data-testid="utility-bar"]', '.utility-meta', '.utility-tools',
      '[data-testid="playback-overlay-toggle"]', '.stage', '[data-testid="filter-strip"]',
    ]);
    expect(barBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 1);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(strip.y + 1);
    expect(meta.x + meta.width).toBeLessThanOrEqual(tools.x + 1);
    expect(tools.x + tools.width).toBeLessThanOrEqual(toggle.x + 1);
    expect(overlaps(meta, tools, 0)).toBe(false);
    expect(overlaps(tools, toggle, 0)).toBe(false);
    // the toggle is the right-hand end of the bar
    expect(barBox.x + barBox.width - (toggle.x + toggle.width)).toBeLessThanOrEqual(12);
    // one line: nothing wraps out of the bar, and it fits the window
    const overflow = await bar.evaluate((element) => ({
      scroll: element.scrollWidth, client: element.clientWidth,
      barHeight: element.getBoundingClientRect().height,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
    expect(overflow.barHeight).toBeLessThanOrEqual(70);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(viewport.width - 8);

    // A photo has the playback toggle, but grey and inert.
    const playback = page.locator('[data-testid="playback-overlay-toggle"]');
    await expect(playback).toBeVisible();
    await expect(playback).toBeDisabled();
    await expect(playback).toHaveAttribute('aria-disabled', 'true');
    await playback.click({ force: true }).catch(() => undefined);
    await expect(page.locator('[data-testid="playback-overlay"]')).toHaveCount(0);

    if (viewport.width < 820) await shot(page, 'nordlys_v4_mobile_photo.png');
    else await shot(page, 'nordlys_v4_desktop.png');
  });
}

/* ── 2. the frame switch: picture alone, choices kept ─────────────────────── */

test('frame off: the picture alone on the stage, and every choice comes back', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openSamplePhoto(page);

  const canvas = page.locator('[data-testid="plate-canvas"]');
  await expect(canvas).toHaveAttribute('data-frame-enabled', 'true');
  const framed = await canvas.evaluate((element) => ({ ...(element as HTMLCanvasElement).dataset }));
  expect(Number(framed.band)).toBeGreaterThan(0);
  expect(Number(framed.padX)).toBeGreaterThan(0);

  await page.locator('[data-testid="dock-frame"]').click();
  await expect(page.locator('[data-testid="frame-modal"]')).toBeVisible();
  const toggle = page.locator('[data-testid="frame-enabled-toggle"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('data-checked', 'true');
  await expect(page.locator('[data-testid="frame-modal"] .frame-enable')).toContainText('프레임 사용');
  await page.waitForTimeout(500);
  await shot(page, 'nordlys_v4_frame_modal.png');

  await toggle.click();
  await expect(toggle).toHaveAttribute('data-checked', 'false');
  // the eleven frames and the options stay in place, out of reach and dimmed
  await expect(page.locator('[data-testid="frame-modal"] fieldset.frame-scope.is-off')).toHaveCount(1);
  await expect(page.locator('[data-testid="frame-modal"] [data-frame-id="polaroid"]')).toBeDisabled();
  await expect(page.locator('[data-testid="dock-frame"] small')).toHaveText('프레임 꺼짐');

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="frame-modal"]')).toHaveCount(0);
  await expect.poll(async () => canvas.getAttribute('data-frame-enabled')).toBe('false');

  // No margin, band or emblem: the picture at its own ratio, filling the room.
  const plain = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    const box = node.getBoundingClientRect();
    return { data: { ...node.dataset }, width: box.width, height: box.height };
  });
  expect(plain.data.band).toBe('0');
  expect(plain.data.padX).toBe('0');
  expect(plain.data.padTop).toBe('0');
  const spec = (await page.locator('[data-testid="utility-bar"] .media-spec').textContent())!.trim();
  const [sourceW, sourceH] = spec.split('×').map(Number);
  const [plainW, plainH] = plain.data.plateSize!.split('x').map(Number);
  expect(plainW / plainH).toBeCloseTo(sourceW / sourceH, 2);
  const [roomW, roomH] = plain.data.room!.split('x').map(Number);
  // contained in the room, one edge exactly on it
  expect(Math.abs(plainW - roomW) <= 1 || Math.abs(plainH - roomH) <= 1).toBe(true);
  expect(plain.width).toBeLessThanOrEqual(roomW + 1);
  expect(plain.height).toBeLessThanOrEqual(roomH + 1);
  await page.waitForTimeout(400);
  await shot(page, 'nordlys_v4_mobile_noframe.png');

  // The 1:1 still is the picture itself, at the file's own size.
  await page.locator('[data-testid="dock-export"]').click();
  await expect(page.locator('[data-testid="export-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="export-modal"]')).toContainText(`프레임 없음 · 원본 ${sourceW}×${sourceH}`);
  await expect(page.locator('[data-testid="export-modal"] .export-table')).toContainText(`${sourceW}×${sourceH}px`, { timeout: 30_000 });
  await page.keyboard.press('Escape');

  // Back on, the same frame and margin are exactly where they were.
  await page.locator('[data-testid="dock-frame"]').click();
  await page.locator('[data-testid="frame-enabled-toggle"]').click();
  await expect(page.locator('[data-testid="frame-enabled-toggle"]')).toHaveAttribute('data-checked', 'true');
  await page.keyboard.press('Escape');
  await expect.poll(async () => canvas.getAttribute('data-frame-enabled')).toBe('true');
  const restored = await canvas.evaluate((element) => ({ ...(element as HTMLCanvasElement).dataset }));
  expect(restored.plateSize).toBe(framed.plateSize);
  expect(restored.band).toBe(framed.band);
  await expect(page.locator('[data-testid="dock-frame"] small')).toHaveText('Classic Gallery');
});

test('4-cut apply switches the frame back on, so the plate is actually printed', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  // Turn the frame off first.
  await page.locator('[data-testid="dock-frame"]').click();
  await page.locator('[data-testid="frame-enabled-toggle"]').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => page.locator('[data-testid="plate-canvas"]').getAttribute('data-frame-enabled')).toBe('false');

  // Then apply a 4-cut plate from the utility bar's own door.
  await page.locator('[data-testid="fourcut-fab"]').click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toBeVisible();
  await page.locator('[data-testid="fourcut-modal"] [data-frame-id="contact"]').click();
  await page.getByRole('button', { name: /이 프레임으로 적용/ }).click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toHaveCount(0);
  await expect.poll(async () => page.locator('[data-testid="plate-canvas"]').getAttribute('data-frame-enabled')).toBe('true');
  await page.waitForTimeout(900);
});

/* ── 3. the clip's playback sheet over the bar ────────────────────────────── */

test('video: the playback toggle opens the sheet beside itself, never under it', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openSampleVideo(page);

  const bar = page.locator('[data-testid="utility-bar"]');
  const toggle = page.locator('[data-testid="playback-overlay-toggle"]');
  await expect(bar.locator('.utility-meta .media-spec')).toHaveText(/1280×720 · [1-9][\d.]*s/);
  await expect(bar.locator('.utility-meta .media-name')).toHaveText('sample-clip.mp4');

  // A clip: the toggle is live, and the bar opens on the file info + tools.
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-testid="playback-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="play-button"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  await shot(page, 'nordlys_v4_mobile_video_bar.png');

  const closedBox = (await bar.boundingBox())!;

  await toggle.click();
  const overlay = page.locator('[data-testid="playback-overlay"]');
  await expect(overlay).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(overlay.locator('[data-testid="play-button"]')).toBeVisible();
  await expect(overlay.locator('.timeline')).toBeVisible();
  await expect(overlay.locator('.timeline-bar')).toBeVisible();

  // The toggle is not under the sheet: the two boxes do not touch.
  const [toggleBox, overlayBox] = await boxes(page, ['[data-testid="playback-overlay-toggle"]', '[data-testid="playback-overlay"]']);
  expect(overlaps(toggleBox, overlayBox)).toBe(false);
  expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(toggleBox.x + 1);
  // and it is still the thing at that point of the screen
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return !!element?.closest('[data-testid="playback-overlay-toggle"]');
  }, { x: toggleBox.x + toggleBox.width / 2, y: toggleBox.y + toggleBox.height / 2 });
  expect(hit, 'the toggle is covered by the sheet').toBe(true);

  // The bar keeps its height: the sheet swaps in, it does not push the page.
  const openBox = (await bar.boundingBox())!;
  expect(Math.abs(openBox.height - closedBox.height)).toBeLessThanOrEqual(2);
  await page.waitForTimeout(400);
  await shot(page, 'nordlys_v4_mobile_video_overlay.png');

  // The sheet is the transport: play/pause works from it.
  const play = page.locator('[data-testid="play-button"]');
  const label = await play.getAttribute('aria-label');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', label === '일시정지' ? '재생' : '일시정지');

  // Closing it brings the file info and the four tools straight back.
  await toggle.click();
  await expect(overlay).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(bar.locator('.utility-meta')).toBeVisible();
  await expect(bar.locator('.utility-tools')).toBeVisible();
  for (const id of TOOL_DISCS) await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
});

/* ── 4. the photo bar left the workbench ──────────────────────────────────── */

test('4-cut slots live in the window only, and survive the trip to a single frame', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  await page.locator('[data-testid="fourcut-fab"]').click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toBeVisible();
  await page.locator('[data-testid="fourcut-modal"] [data-frame-id="contact"]').click();
  await page.locator('[data-testid="fourcut-modal"] input[type="file"]').first().setInputFiles([
    resolve(SAMPLE_DIR, 'landscape_test.png'),
    resolve(SAMPLE_DIR, 'color_chart.png'),
    resolve(SAMPLE_DIR, 'portrait_test.png'),
  ]);
  await expect(page.locator('[data-testid="fourcut-modal"] .fourcut-slot.filled')).toHaveCount(4);
  await page.getByRole('button', { name: /이 프레임으로 적용/ }).click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toHaveCount(0);
  await page.waitForTimeout(900);

  // Four photos on a 4-cut plate: still no photo bar under the stage.
  await expect(page.locator('.slot-strip')).toHaveCount(0);
  expect(await page.locator('.slot').count()).toBe(0);
  await page.waitForTimeout(400);
  await shot(page, 'nordlys_v2_fourcut_editor.png');

  // Switch to a single-cut frame: the bar must not appear then either.
  await page.locator('[data-testid="dock-frame"]').click();
  await page.locator('[data-testid="frame-modal"] [data-frame-id="gallery"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="frame-modal"]')).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page.locator('.slot-strip')).toHaveCount(0);
  expect(await page.locator('.slot').count()).toBe(0);
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();

  // The slots themselves are kept: reopening the window shows all four again.
  await page.locator('[data-testid="fourcut-fab"]').click();
  await expect(page.locator('[data-testid="fourcut-modal"] .fourcut-slot.filled')).toHaveCount(4);
  await expect(page.locator('[data-testid="fourcut-modal"]')).toContainText('네 슬롯이 모두 찼습니다.');
  await page.keyboard.press('Escape');
});

/* ── 5. RETRO 90 after Margarine ──────────────────────────────────────────── */

test('RETRO 90 closes the filter shelf, after the 58 Margarine looks', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  const stripOrder = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="filter-strip"] > *'))
    .map((element) => element.getAttribute('data-filter-key')
      ?? (element.classList.contains('margarine') ? 'margarine' : '?')));
  expect(stripOrder).toEqual([
    'neutral', 'FS-001', 'FS-002', 'FS-003', 'FS-004', 'FS-005', 'FS-006', 'FS-007', 'FS-008', 'FS-009',
    'margarine', 'FS-010',
  ]);

  // The strip keeps working from the far end: the last card selects RETRO 90.
  await page.evaluate(() => { document.querySelector('.filter-strip')?.scrollTo({ left: 99999 }); });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="filter-strip"] [data-filter-key="FS-010"]').click();
  await expect(page.locator('.topbar .chip').first()).toContainText('RETRO 90');
  await page.evaluate(() => { document.querySelector('.filter-strip')?.scrollTo({ left: 99999 }); });
  await page.waitForTimeout(400);
  await shot(page, 'nordlys_v2_filter_strip_retro.png');

  // The window: HD2Lab Film (Neutral + nine stocks) → Margarine groups → Filter Set.
  await page.locator('[data-testid="dock-filter"]').click();
  await expect(page.locator('[data-testid="filter-modal"]')).toBeVisible();
  const sections = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="filter-modal"] .section-title'))
    .map((title) => (title.childNodes[0]?.textContent ?? '').trim()));
  expect(sections[0]).toBe('HD2Lab Film');
  // six Margarine groups, in the catalogue's own order, right after the film shelf
  expect(sections.slice(1, 7)).toHaveLength(6);
  for (const title of sections.slice(1, 7)) expect(title.startsWith('Margarine · ')).toBe(true);
  expect(sections[sections.length - 1]).toBe('Filter Set · RETRO 90');

  const chips = await page.locator('[data-testid="filter-modal"] .chip-row .chip').allTextContents();
  expect(chips[0]).toContain('전체');
  expect(chips[0]).toContain('69');
  expect(chips[1]).toContain('HD2Lab Film');
  expect(chips[chips.length - 1]).toContain('Filter Set · RETRO 90');

  // The shelf inside the window follows the same order.
  const modalOrder = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="filter-modal"] [data-filter-key]'))
    .map((card) => card.getAttribute('data-filter-key')));
  expect(modalOrder.slice(0, 10)).toEqual(['neutral', 'FS-001', 'FS-002', 'FS-003', 'FS-004', 'FS-005', 'FS-006', 'FS-007', 'FS-008', 'FS-009']);
  expect(modalOrder[modalOrder.length - 1]).toBe('FS-010');
  await page.waitForTimeout(500);
  await shot(page, 'nordlys_v2_filter_modal_retro.png');
  await page.keyboard.press('Escape');
});

/* ── 6. Shutterplate's own frame size ─────────────────────────────────────── */

async function plateFacts(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="plate-canvas"]') as HTMLCanvasElement;
    const stage = document.querySelector('.stage') as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    const style = getComputedStyle(stage);
    return {
      data: { ...canvas.dataset },
      stage: {
        x: Math.round(stageBox.x), width: Math.round(stageBox.width), height: Math.round(stageBox.height),
        centre: stageBox.x + stageBox.width / 2,
      },
      padding: { left: style.paddingLeft, right: style.paddingRight },
      canvas: {
        width: canvasBox.width, height: canvasBox.height, x: canvasBox.x, y: canvasBox.y,
        centre: canvasBox.x + canvasBox.width / 2,
      },
    };
  });
}

test('mobile 390×844: the print centres in the stage and only the copy is boosted', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openSamplePhoto(page);
  await expect(page.locator('[data-testid="dock-frame"] small')).toHaveText('Classic Gallery');

  const facts = await plateFacts(page);
  const d = facts.data;
  const [W, H] = d.plateSize!.split('x').map(Number);
  const [PW, PH] = d.photoBox!.split('x').map(Number);
  const [roomW, roomH] = d.room!.split('x').map(Number);
  const padX = Number(d.padX);
  const padTop = Number(d.padTop);
  const band = Number(d.band);
  const boost = Number(d.typeBoost);
  const scale = Number(d.plateScale);
  process.stdout.write(`[v2 mobile] ${JSON.stringify({ W, H, PW, PH, padX, padTop, band, boost, roomW, roomH, scale, pad: d.roomPad })}\n`);

  // No lane: the stage keeps its whole width and the print sits on the screen's
  // centre line, exactly as it does on a desktop.
  expect(facts.padding).toEqual({ left: '0px', right: '0px' });
  expect(Number(d.roomPad)).toBe(16);
  expect(roomW).toBe(facts.stage.width - 2 - 16);
  expect(roomH).toBe(facts.stage.height - 2 - 16);
  expect(Math.abs(facts.canvas.centre - facts.stage.centre), 'the print is off centre').toBeLessThanOrEqual(1);

  // The frame is still Shutterplate's: the plate width and the photo box are
  // untouched and only the band and the type unit are boosted.
  expect(padX).toBe(Math.round(PW * 0.045));
  expect(padTop).toBe(padX);
  expect(W).toBe(PW + 2 * padX);
  const frameBand = Math.round(padX + PH * 0.13); // Classic Gallery geo: pad 4.5, extra 13
  expect(boost).toBeGreaterThan(1.4);
  expect(boost).toBeLessThanOrEqual(1.6);
  expect(band).toBe(Math.round(frameBand * boost));
  expect(H).toBe(padTop + PH + band);
  // Slim, not a card: the frame's 15.6% band, at most ~23% once boosted.
  expect(band / H).toBeGreaterThan(0.19);
  expect(band / H).toBeLessThanOrEqual(MAX_BAND_SHARE);
  // and the smallest row the frame prints is legible at arm's length
  expect(Number(d.minTypeCss)).toBeGreaterThanOrEqual(5.2);
  expect(Number(d.minTypeCss)).toBeLessThanOrEqual(6.2);
  expect(scale).toBeCloseTo(Math.min(1, roomW / W, roomH / H), 3);
  expect(facts.canvas.width).toBeLessThanOrEqual(roomW + 1);
  expect(facts.canvas.height).toBeLessThanOrEqual(roomH + 1);

  await shot(page, 'nordlys_v3_mobile_centred.png');

  // The same plate on a desktop: no boost, the frame's own band ratio, centred.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(900);
  const wide = await plateFacts(page);
  const [wideW, wideH] = wide.data.plateSize!.split('x').map(Number);
  expect(wideW).toBe(W);
  expect(wideH).toBe(padTop + PH + frameBand);
  expect(wide.data.typeBoost).toBe('1');
  expect(Number(wide.data.band)).toBe(frameBand);
  expect(Number(wide.data.band) / wideH).toBeCloseTo(0.156, 3);
  expect(Number(wide.data.minTypeCss)).toBeGreaterThanOrEqual(5.2);
  expect(Number(wide.data.roomPad)).toBe(40);
  expect(Number(wide.data.room!.split('x')[0])).toBe(wide.stage.width - 2 - 40);
  expect(Number(wide.data.room!.split('x')[1])).toBe(wide.stage.height - 2 - 40);
  expect(Math.abs(wide.canvas.centre - wide.stage.centre)).toBeLessThanOrEqual(1);

  await page.evaluate(() => { document.querySelector('.filter-strip')?.scrollTo({ left: 0 }); });
  await page.waitForTimeout(500);
  await shot(page, 'nordlys_v3_desktop.png');
});
