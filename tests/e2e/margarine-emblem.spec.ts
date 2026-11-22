import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildTiff, jpegWithExif } from '../exif-fixtures';

/**
 * The two windows the visitor opens by hand:
 *
 *  1. Margarine — its own modal: seven group chips, a search, 58 live stills
 *     and the strength slider. The film shelf and strip keep the ten stocks.
 *  2. Emblem — EXIF 자동 / 없음, the ink switch, and the eleven official marks.
 *     A chosen mark prints whatever the EXIF says; the plate really redraws.
 *  3. A real camera file's own maker reaches the plate: uploaded JPEGs with
 *     EXIF (and one with the make dropped) print Sony and Fujifilm, not HD2Lab.
 */

const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../../downloads');
const SAMPLE_DIR = resolve(process.cwd(), 'public/samples');
const sample = (name: string) => resolve(SAMPLE_DIR, name);

mkdirSync(SHOT_DIR, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOT_DIR, name) });

async function openSamplePhoto(page: Page) {
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }).toBeGreaterThan(150);
  await page.waitForTimeout(600);
}

/** A JPEG on disk carrying the EXIF we want the studio to read. */
function photoFile(fields: Parameters<typeof buildTiff>[0]): string {
  const root = mkdtempSync(resolve(tmpdir(), 'cineplate-exif-'));
  const bytes = jpegWithExif(new Uint8Array(readFileSync(sample('sample-01.jpg'))), buildTiff(fields));
  const path = resolve(root, `${fields.make ?? 'no-make'}-${fields.model ?? 'body'}.jpg`);
  writeFileSync(path, bytes);
  return path;
}

async function openFile(page: Page, path: string) {
  await page.locator('[data-testid="open-input"]').setInputFiles(path);
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await page.waitForTimeout(1200);
}

/** The same, from inside the studio: the hidden replace input takes the file. */
async function replaceFile(page: Page, path: string) {
  await page.locator('[data-testid="replace-input"]').setInputFiles(path);
  await page.waitForTimeout(1400);
}

async function plateFacts(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="plate-canvas"]') as HTMLCanvasElement;
    return { ...canvas.dataset };
  });
}

test('pc: the Margarine window carries the 58 looks on its own shelf', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openSamplePhoto(page);

  // The film shelf is the ten stocks plus nothing else.
  await expect(page.locator('[data-testid="film-list"] [data-filter-key]')).toHaveCount(11);
  await expect(page.locator('[data-testid="side-margarine-open"]')).toContainText('Margarine 58종');
  await expect(page.locator('[data-testid="side-margarine-open"]')).toContainText('전용 모달에서 고르기');

  await page.locator('[data-testid="side-margarine-open"]').click();
  await expect(page.locator('[data-testid="margarine-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="margarine-modal"] .chip-row .chip')).toHaveCount(7);
  await expect(page.locator('[data-testid="margarine-tab-all"]')).toHaveText(/전체\s*58/);
  await expect(page.locator('[data-testid="margarine-modal"] [data-filter-key]')).toHaveCount(58);

  // A group chip narrows the grid to its own looks.
  await page.locator('[data-testid="margarine-tab-cafe"]').click();
  await expect(page.locator('[data-testid="margarine-modal"] [data-filter-key]')).toHaveCount(16);
  await page.locator('[data-testid="margarine-tab-all"]').click();
  await expect(page.locator('[data-testid="margarine-modal"] [data-filter-key]')).toHaveCount(58);

  // The search reads the look's name and its base stock.
  await page.locator('[data-testid="margarine-search"]').fill('brown');
  const found = await page.locator('[data-testid="margarine-modal"] [data-filter-key]').count();
  expect(found).toBeGreaterThan(0);
  expect(found).toBeLessThan(58);
  await page.locator('[data-testid="margarine-search"]').fill('');
  await page.waitForTimeout(300);

  // A press applies it at once: the chip in the bar names the look.
  const firstKey = await page.locator('[data-testid="margarine-modal"] [data-filter-key]').first().getAttribute('data-filter-key');
  const firstName = await page.locator('[data-testid="margarine-modal"] [data-filter-key]').first().locator('.filter-name').innerText();
  await page.locator('[data-testid="margarine-modal"] [data-filter-key]').first().click();
  await expect(page.locator('.topbar .chip').first()).toContainText(firstName);
  await expect(page.locator(`[data-testid="margarine-modal"] [data-filter-key="${firstKey}"]`)).toHaveAttribute('aria-pressed', 'true');

  // The footer's strength slider is the same film strength the studio uses.
  await page.locator('[data-testid="margarine-modal"] input[type="range"]').fill('60');
  await page.waitForTimeout(200);
  await shot(page, 'e2e-margarine-modal-pc.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="margarine-modal"]')).toHaveCount(0);

  // The shelf keeps showing what is applied: a selected look card, and the door.
  await expect(page.locator('[data-testid="film-list"] [data-filter-key="' + firstKey + '"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="film-list"] [data-filter-key]')).toHaveCount(12);
  await expect(page.locator('[data-testid="side-margarine-open"]')).toContainText(`적용 중 · ${firstName}`);
});

test('pc: the emblem window prints the eleven marks, whatever the EXIF says', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openSamplePhoto(page);

  await page.locator('[data-testid="side-tab-frame"]').click();
  // The old three-way switch is gone: one row control, showing what prints now.
  await expect(page.locator('[data-testid="frame-options"]')).not.toContainText('Auto · 메이커');
  await expect(page.locator('[data-testid="side-emblem-open"]')).toContainText('EXIF 자동 · Sony');
  expect((await plateFacts(page)).emblem).toBe('sony');

  await page.locator('[data-testid="side-emblem-open"]').click();
  await expect(page.locator('[data-testid="emblem-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="emblem-modal"] [data-emblem-id]')).toHaveCount(11);
  await expect(page.locator('[data-testid="emblem-option-auto"]')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'e2e-emblem-modal-pc.png');

  // A chosen mark is printed at once — the plate's own layout says so.
  await page.locator('[data-testid="emblem-modal"] [data-emblem-id="nikon"]').click();
  await expect(page.locator('[data-testid="emblem-current"]')).toHaveText('Nikon');
  await expect.poll(async () => (await plateFacts(page)).emblem).toBe('nikon');

  // The ink switch reaches the plate too.
  await page.locator('[data-testid="emblem-modal"] .segmented-track button', { hasText: 'All Black' }).click();
  await expect.poll(async () => (await plateFacts(page)).emblemMono).toBe('true');
  await page.waitForTimeout(300);
  await shot(page, 'e2e-emblem-modal-allblack.png');
  await page.locator('[data-testid="emblem-modal"] .segmented-track button', { hasText: 'Original' }).click();
  await expect.poll(async () => (await plateFacts(page)).emblemMono).toBe('false');

  // 없음 prints nothing; EXIF 자동 returns to the file's own maker.
  await page.locator('[data-testid="emblem-option-none"]').click();
  await expect.poll(async () => (await plateFacts(page)).emblem).toBe('none');
  await page.locator('[data-testid="emblem-option-auto"]').click();
  await expect.poll(async () => (await plateFacts(page)).emblem).toBe('sony');

  // Closing hands the visitor back to the frame shelf, not to a blank studio.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="emblem-modal"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="side-emblem-open"]')).toContainText('EXIF 자동 · Sony');
  await expect(page.locator('[data-testid="frame-options"]')).toBeVisible();
});

test('phone 390: both windows open from the strip and the frame sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openSamplePhoto(page);

  // The strip's Margarine card opens the 58-look window.
  await expect(page.locator('[data-testid="filter-strip"] [data-testid="margarine-door"]')).toBeVisible();
  await page.locator('[data-testid="margarine-door"]').click();
  await expect(page.locator('[data-testid="margarine-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="margarine-modal"] [data-filter-key]')).toHaveCount(58);
  await expect(page.locator('[data-testid="margarine-modal"]')).toBeInViewport();
  await shot(page, 'e2e-margarine-modal-mobile.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="margarine-modal"]')).toHaveCount(0);

  // The frame sheet's emblem row opens the emblem window over it.
  await page.locator('[data-testid="dock-frame"]').click();
  await expect(page.locator('[data-testid="frame-modal"]')).toBeVisible();
  await page.locator('[data-testid="frame-emblem-open"]').click();
  await expect(page.locator('[data-testid="emblem-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="emblem-modal"] [data-emblem-id]')).toHaveCount(11);
  await page.locator('[data-testid="emblem-modal"] [data-emblem-id="leica"]').click();
  await expect.poll(async () => (await plateFacts(page)).emblem).toBe('leica');
  await shot(page, 'e2e-emblem-modal-mobile.png');

  // Closing the emblem window returns to the frame sheet that opened it.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="emblem-modal"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="frame-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="frame-emblem-open"]')).toContainText('Leica');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="frame-modal"]')).toHaveCount(0);
});

test('a camera file prints its own maker; a file without one prints HD2Lab', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  // Apple, from a JPEG whose EXIF this test wrote: the bundled exifr reads it,
  // Auto resolves to the Apple mark, and the plate paints it.
  await openFile(page, photoFile({
    make: 'Apple',
    model: 'iPhone 15 Pro',
    lens: 'iPhone 15 Pro back camera 6.765mm f/1.78',
    fNumber: 1.78,
    exposureTime: 1 / 120,
    iso: 64,
  }));
  await page.locator('[data-testid="side-tab-frame"]').click();
  await expect(page.locator('.side-exif input[aria-label="카메라"]')).toHaveValue('Apple iPhone 15 Pro');
  await expect(page.locator('[data-testid="side-emblem-open"]')).toContainText('EXIF 자동 · Apple');
  await expect.poll(async () => (await plateFacts(page)).emblem).toBe('apple');
  await shot(page, 'e2e-emblem-auto-apple.png');

  // The reported bug: a file that kept only the model still names Fujifilm.
  await replaceFile(page, photoFile({ model: 'X-T5' }));
  await page.locator('[data-testid="side-tab-frame"]').click();
  await expect(page.locator('[data-testid="side-emblem-open"]')).toContainText('EXIF 자동 · Fujifilm');
  await expect.poll(async () => (await plateFacts(page)).emblem).toBe('fujifilm');
});
