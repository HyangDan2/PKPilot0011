import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The four layout fixes of 2026-11-20, checked in a real browser:
 *  1. the corner cluster is one vertical column, in the landing and the stage;
 *  2. the photo bar is gone from the workbench — 4-cut slots live in the window;
 *  3. RETRO 90 closes the filter shelf, after the whole Margarine catalogue;
 *  4. the frame is laid out at Shutterplate's own ratio (no type boost) with
 *     Shutterplate's viewport margin around it.
 */

const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../../downloads');
const SAMPLE_DIR = resolve(process.cwd(), 'public/samples');
const LANE = 52; // the phone lane the corner column keeps for itself (app.css)

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

const FABS = ['[data-testid="fourcut-fab"]', '[data-testid="colorlab-fab"]', '[data-testid="tonecurve-fab"]', '[data-testid="cameraeffects-fab"]'];
const COLUMN = [...FABS, '[data-testid="theme-fab"]'];

/* ── 1. one column down the corner ────────────────────────────────────────── */

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`corner cluster: one vertical column at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    // Landing: the 4-cut door sits above the theme toggle, in one column.
    const landing = await boxes(page, ['[data-testid="fourcut-fab"]', '[data-testid="theme-fab"]']);
    expect(landing[0].y + landing[0].height).toBeLessThanOrEqual(landing[1].y + 1);
    expect(Math.abs((landing[0].x + landing[0].width / 2) - (landing[1].x + landing[1].width / 2))).toBeLessThanOrEqual(1);

    await openSamplePhoto(page);

    const direction = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="float-cluster"]')!).flexDirection);
    expect(direction).toBe('column');

    const items = await boxes(page, COLUMN);
    const centre = (box: Box) => box.x + box.width / 2;
    for (let i = 0; i < items.length; i += 1) {
      // one axis: every disc shares the column's centre line
      expect(Math.abs(centre(items[i]) - centre(items[0])), `disc ${i} is off the column`).toBeLessThanOrEqual(1);
      // and they stack: each one starts below the one above it
      if (i > 0) expect(items[i].y, `disc ${i} is not below the disc above it`).toBeGreaterThanOrEqual(items[i - 1].y + items[i - 1].height);
    }
    // the theme toggle closes the column at the bottom
    expect(items[items.length - 1].y).toBeGreaterThan(items[items.length - 2].y);
    // the seven-pixel gap the brief asks for
    for (let i = 1; i < items.length; i += 1) {
      expect(Math.abs((items[i].y - (items[i - 1].y + items[i - 1].height)) - 7)).toBeLessThanOrEqual(1);
    }

    const [cluster, plate, strip, dock, stage] = await boxes(page, [
      '[data-testid="float-cluster"]', '[data-testid="plate-canvas"]', '[data-testid="filter-strip"]', '.dock', '.stage',
    ]);
    // The column covers neither the print nor anything below the stage.
    expect(overlaps(cluster, plate), 'cluster overlaps the plate').toBe(false);
    expect(overlaps(cluster, strip), 'cluster overlaps the filter strip').toBe(false);
    expect(overlaps(cluster, dock), 'cluster overlaps the dock').toBe(false);
    // and it stays inside the stage it belongs to
    expect(cluster.x).toBeGreaterThanOrEqual(stage.x);
    expect(cluster.x + cluster.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(cluster.y + cluster.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  });
}

/* ── 2. the photo bar left the workbench ──────────────────────────────────── */

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

/* ── 3. RETRO 90 after Margarine ──────────────────────────────────────────── */

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

/* ── 4. Shutterplate's own frame size ─────────────────────────────────────── */

async function plateFacts(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="plate-canvas"]') as HTMLCanvasElement;
    const stage = document.querySelector('.stage') as HTMLElement;
    const stageBox = stage.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    return {
      data: { ...canvas.dataset },
      stage: { width: Math.round(stageBox.width), height: Math.round(stageBox.height) },
      canvas: { width: canvasBox.width, height: canvasBox.height, x: canvasBox.x, y: canvasBox.y },
    };
  });
}

test('mobile 390×844: Classic Gallery prints Shutterplate’s ratio, unboosted', async ({ page }) => {
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
  const scale = Number(d.plateScale);
  process.stdout.write(`[v2 mobile] ${JSON.stringify({ W, H, PW, PH, padX, padTop, band, roomW, roomH, scale, pad: d.roomPad })}\n`);

  // No type boost: the band and the type unit are the frame's own.
  expect(d.typeBoost).toBe('1');
  expect(padX).toBe(Math.round(PW * 0.045));
  expect(padTop).toBe(padX);
  expect(band).toBe(Math.round(padX + PH * 0.13)); // Classic Gallery geo: pad 4.5, extra 13
  expect(W).toBe(PW + 2 * padX);
  expect(H).toBe(padTop + PH + band);
  expect(band / H).toBeCloseTo(0.156, 3);
  // Shutterplate's viewport margin: 16px on a phone, measured inside the lane.
  expect(Number(d.roomPad)).toBe(16);
  // .stage's content box is the lane and the 1px borders taken out of its width.
  expect(roomW).toBe(facts.stage.width - 2 - LANE - 16);
  expect(roomH).toBe(facts.stage.height - 2 - 16);
  expect(scale).toBeCloseTo(Math.min(1, roomW / W, roomH / H), 3);
  expect(facts.canvas.width).toBeLessThanOrEqual(roomW + 1);
  expect(facts.canvas.height).toBeLessThanOrEqual(roomH + 1);

  await shot(page, 'nordlys_v2_mobile.png');

  // The same plate geometry on a desktop: the design does not follow the viewport.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(900);
  const wide = await plateFacts(page);
  expect(wide.data.plateSize).toBe(d.plateSize);
  expect(wide.data.band).toBe(d.band);
  expect(wide.data.typeBoost).toBe('1');
  expect(Number(wide.data.roomPad)).toBe(40);
  expect(Number(wide.data.room!.split('x')[0])).toBe(wide.stage.width - 2 - 40);
  expect(Number(wide.data.room!.split('x')[1])).toBe(wide.stage.height - 2 - 40);

  await page.evaluate(() => { document.querySelector('.filter-strip')?.scrollTo({ left: 0 }); });
  await page.waitForTimeout(500);
  await shot(page, 'nordlys_v2_desktop.png');
});
