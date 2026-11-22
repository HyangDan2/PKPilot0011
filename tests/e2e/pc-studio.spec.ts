import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';

/**
 * The wide studio (≥ 1024px): three columns, the two-door open window, the
 * workspace strip under the plate — and, at 390px, the phone studio exactly as
 * it was.
 */
const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../..');
const SAMPLE_DIR = resolve(process.cwd(), 'public/samples');
const sample = (name: string) => resolve(SAMPLE_DIR, name);

const WORKSPACE_FILES = [
  sample('sample-01.jpg'),
  sample('sample-02.jpg'),
  sample('portrait_test.png'),
  sample('sample-clip.mp4'),
];

/**
 * A real folder on disk: `setInputFiles` on a `<input webkitdirectory>` takes a
 * directory path, and the browser fills in each file's own relative path.
 * `Trip/day2` gives the 하위 폴더 포함 switch something to include.
 */
function makeWorkspaceFolder(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'cineplate-ws-'));
  const folder = resolve(root, 'Trip');
  mkdirSync(resolve(folder, 'day2'), { recursive: true });
  for (const path of WORKSPACE_FILES) copyFileSync(path, resolve(folder, basename(path)));
  copyFileSync(sample('landscape_test.png'), resolve(folder, 'day2/landscape.png'));
  return folder;
}

function watch(page: Page): { errors: string[] } {
  const seen = { errors: [] as string[] };
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(message.text());
  });
  page.on('pageerror', (error) => seen.errors.push(`pageerror: ${error.message}`));
  return seen;
}

const shot = async (page: Page, name: string) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOT_DIR, name) });
};

async function waitForPlate(page: Page) {
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }).toBeGreaterThan(200);
  await page.waitForTimeout(500);
}

async function expectNoOverflow(page: Page, width: number) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(width);
  expect(metrics.bodyScrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(width);
}

test('pc: the landing opens the two-door window, and a file fills the studio', async ({ page }) => {
  const console = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  // The landing's open chip asks the two-door window instead of a picker.
  await page.locator('[data-testid="landing-open"]').click();
  await expect(page.locator('[data-testid="open-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="open-photo-card"]')).toContainText('사진 · 동영상');
  await expect(page.locator('[data-testid="open-workspace-card"]')).toContainText('워크스페이스');
  await expect(page.locator('[data-testid="include-subfolders"]')).toBeChecked();
  await page.waitForTimeout(350);
  await shot(page, 'cineplate-open-modal.png');

  await page.locator('[data-testid="open-file-input"]').setInputFiles([sample('sample-01.jpg')]);
  await expect(page.locator('[data-testid="open-modal"]')).toHaveCount(0);
  await waitForPlate(page);

  // Three columns, no dock, no bottom strip, and the save door beside 교체.
  await expect(page.locator('[data-testid="studio-pc"]')).toBeVisible();
  await expect(page.locator('[data-testid="pc-left-sidebar"]')).toBeVisible();
  await expect(page.locator('[data-testid="pc-right-sidebar"]')).toBeVisible();
  await expect(page.locator('.dock')).toHaveCount(0);
  await expect(page.locator('[data-testid="filter-strip"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="topbar-save"]')).toBeVisible();
  await expect(page.locator('[data-testid="explorer-preview"]')).toBeVisible();
  await expect(page.locator('[data-testid="explorer-preview"]')).toContainText('sample-01.jpg');

  const boxes = await page.evaluate(() => {
    const left = document.querySelector('[data-testid="pc-left-sidebar"]')!.getBoundingClientRect();
    const right = document.querySelector('[data-testid="pc-right-sidebar"]')!.getBoundingClientRect();
    return { left: left.width, right: right.width };
  });
  expect(Math.round(boxes.left)).toBe(280);
  expect(Math.round(boxes.right)).toBe(300);

  // The film shelf lists all 69 looks; the frame shelf its single cuts.
  await expect(page.locator('[data-testid="film-list"] [data-filter-key]')).toHaveCount(69);
  await page.locator('[data-testid="side-tab-frame"]').click();
  await expect(page.locator('[data-testid="frame-options"]')).toBeVisible();
  await expect(page.locator('[data-testid="frame-list"] [data-frame-id]')).toHaveCount(11);
  await page.locator('[data-testid="frame-options"] button:has-text("4컷")').click();
  await expect(page.locator('[data-testid="frame-list"] [data-frame-id]')).toHaveCount(2);
  await expect(page.locator('[data-testid="frame-list"] [data-frame-id="fyra04"]')).toHaveCount(1);
  await page.locator('[data-testid="side-tab-film"]').click();

  await expectNoOverflow(page, 1440);
  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('pc: a folder becomes a workspace of stills and clips, each with its own session', async ({ page }) => {
  const console = watch(page);
  // The directory handle API is absent here, so the door falls back to
  // <input webkitdirectory> — the path Safari and Firefox take.
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).showDirectoryPicker;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.locator('[data-testid="landing-open"]').click();
  await expect(page.locator('[data-testid="open-modal"]')).toBeVisible();
  // Without 하위 폴더 포함 the nested stills stay out of the list.
  await page.locator('[data-testid="include-subfolders"]').uncheck();
  await page.locator('[data-testid="workspace-folder-input"]').setInputFiles(makeWorkspaceFolder());
  await waitForPlate(page);

  await expect(page.locator('[data-testid="workspace-strip"]')).toBeVisible();
  await expect(page.locator('[data-testid="workspace-thumb"]')).toHaveCount(4);
  await expect(page.locator('[data-testid="workspace-thumb"][data-kind="video"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="explorer-index"]')).toHaveText('1 / 4');
  await expect(page.locator('[data-testid="explorer-preview"]')).toContainText('portrait_test.png');

  // File 1 gets its own stock.
  await page.locator('[data-testid="film-list"] [data-filter-key="FS-001"]').click();
  await expect(page.locator('[data-testid="film-list"] [data-filter-key="FS-001"]')).toHaveAttribute('aria-selected', 'true');

  // ← / → walk the strip.
  await page.locator('[data-testid="workspace-scroll"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-testid="explorer-index"]')).toHaveText('2 / 4');
  await expect(page.locator('[data-testid="explorer-preview"]')).toContainText('sample-01.jpg');

  // File 2 takes another stock and a grade of its own.
  await page.locator('[data-testid="film-list"] [data-filter-key="FS-006"]').click();
  const exposure = page.locator('[data-testid="grade-light"] input[aria-label="노출"]');
  await exposure.focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  await expect(exposure).toHaveValue('0.2');

  await page.locator('[data-testid="workspace-scroll"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-testid="explorer-index"]')).toHaveText('1 / 4');
  await expect(page.locator('[data-testid="film-list"] [data-filter-key="FS-001"]')).toHaveAttribute('aria-selected', 'true');
  await expect(exposure).toHaveValue('0');

  await page.locator('[data-testid="workspace-scroll"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-testid="explorer-index"]')).toHaveText('2 / 4');
  await expect(page.locator('[data-testid="film-list"] [data-filter-key="FS-006"]')).toHaveAttribute('aria-selected', 'true');
  await expect(exposure).toHaveValue('0.2');

  // Order and kind settle the list; the strip walks it in that order.
  await page.locator('[data-testid="ws-sort"]').selectOption('reverse');
  await expect(page.locator('[data-testid="workspace-thumb"] .ws-label').first()).toHaveText('sample-clip.mp4');
  await page.locator('[data-testid="ws-filter-video"]').click();
  await expect(page.locator('[data-testid="workspace-thumb"]')).toHaveCount(1);
  await page.locator('[data-testid="ws-filter-photo"]').click();
  await expect(page.locator('[data-testid="workspace-thumb"]')).toHaveCount(3);
  await page.locator('[data-testid="ws-filter-all"]').click();
  await page.locator('[data-testid="ws-sort"]').selectOption('name');
  await expect(page.locator('[data-testid="workspace-thumb"]')).toHaveCount(4);

  // The shelf folds to one line and comes back; the top edge resizes it.
  const before = (await page.locator('[data-testid="workspace-strip"]').boundingBox())!.height;
  await page.locator('[data-testid="workspace-resize"]').focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await page.locator('[data-testid="workspace-strip"]').boundingBox())!.height).toBeGreaterThan(before);
  await page.locator('[data-testid="workspace-collapse"]').click();
  await expect(page.locator('[data-testid="workspace-scroll"]')).toHaveCount(0);
  await expect.poll(async () => (await page.locator('[data-testid="workspace-strip"]').boundingBox())!.height).toBeLessThan(40);
  await page.locator('[data-testid="workspace-collapse"]').click();
  await expect(page.locator('[data-testid="workspace-scroll"]')).toBeVisible();

  // A clip opens with its own transport; its card says so.
  await page.locator('[data-testid="workspace-thumb"][data-kind="video"]').click();
  await expect(page.locator('[data-testid="pc-transport"]')).toBeVisible();
  await expect(page.locator('[data-testid="explorer-spec"]')).toContainText('영상');
  await expect(page.locator('[data-testid="workspace-thumb"][data-kind="video"] .ws-badge')).toHaveText('영상');

  // Back to a still for the finished studio shot.
  await page.locator('[data-testid="workspace-thumb"][data-kind="photo"]').first().click();
  await expect(page.locator('[data-testid="pc-transport"]')).toHaveCount(0);
  await waitForPlate(page);
  await page.waitForTimeout(900);
  await shot(page, 'cineplate-pc-ui-workspace.png');

  // 하위 폴더 포함 brings the nested still into the same shelf.
  await page.locator('[data-testid="workspace-strip"] .ws-tools button').filter({ hasText: '+ 폴더' }).click();
  await expect(page.locator('[data-testid="open-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="include-subfolders"]')).toBeChecked();
  await page.locator('[data-testid="workspace-folder-input"]').setInputFiles(makeWorkspaceFolder());
  await expect(page.locator('[data-testid="workspace-thumb"]')).toHaveCount(5);
  await expect(page.locator('[data-testid="explorer-index"]')).toHaveText('1 / 5');
  await expect(page.locator('[data-testid="explorer-preview"]')).toContainText('landscape.png');

  await expectNoOverflow(page, 1440);
  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('pc: the right rail carries the whole grade and its three doors', async ({ page }) => {
  const console = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.sample-card.photo').first().click();
  await waitForPlate(page);

  const exposure = page.locator('[data-testid="grade-light"] input[aria-label="노출"]');
  await expect(exposure).toBeVisible();
  await exposure.focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect(exposure).toHaveValue('0.3');
  // The plate hears it: the canvas repaints under the new grade.
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="plate-canvas"]') as HTMLCanvasElement | null;
    return canvas ? canvas.dataset.frameEnabled : null;
  })).toBe('true');

  await page.locator('[data-testid="side-colorlab"]').click();
  await expect(page.locator('[data-testid="colorlab-modal"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="colorlab-modal"]')).toHaveCount(0);

  await page.locator('[data-testid="side-tonecurve"]').click();
  await expect(page.locator('#tone-curve-overlay')).toBeVisible();
  await page.locator('[data-testid="side-tonecurve"]').click();
  await expect(page.locator('#tone-curve-overlay')).toHaveCount(0);

  await page.locator('[data-testid="side-cameraeffects"]').click();
  await expect(page.locator('[data-testid="cameraeffects-modal"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('[data-testid="grade-reset"]').click();
  await expect(exposure).toHaveValue('0');

  // The grade rails scroll instead of pushing the stage, and nothing spills.
  await expectNoOverflow(page, 1440);
  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('pc: 저장 / 공유 sits beside 교체 and opens the export sheet', async ({ page }) => {
  const console = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.sample-card.photo').first().click();
  await waitForPlate(page);

  const swap = (await page.locator('[data-testid="replace-button"]').boundingBox())!;
  const save = (await page.locator('[data-testid="topbar-save"]').boundingBox())!;
  expect(Math.round(save.x - (swap.x + swap.width))).toBeLessThanOrEqual(12);
  expect(Math.abs((save.y + save.height / 2) - (swap.y + swap.height / 2))).toBeLessThan(4);

  await page.locator('[data-testid="topbar-save"]').click();
  await expect(page.locator('[data-testid="export-modal"]')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(SHOT_DIR, 'cineplate-pc-export.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="export-modal"]')).toHaveCount(0);

  // 교체 asks the same two-door window as the landing.
  await page.locator('[data-testid="replace-button"]').click();
  await expect(page.locator('[data-testid="open-modal"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('mobile: 390×844 keeps the dock, the strip and the utility bar', async ({ page }) => {
  const console = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-testid="studio-pc"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="open-modal"]')).toHaveCount(0);

  await page.locator('.sample-card.photo').first().click();
  await waitForPlate(page);

  await expect(page.locator('.dock')).toBeVisible();
  await expect(page.locator('[data-testid="dock-filter"]')).toBeVisible();
  await expect(page.locator('[data-testid="dock-frame"]')).toBeVisible();
  await expect(page.locator('[data-testid="dock-adjust"]')).toBeVisible();
  await expect(page.locator('[data-testid="dock-export"]')).toBeVisible();
  await expect(page.locator('[data-testid="filter-strip"]')).toBeVisible();
  await expect(page.locator('[data-testid="utility-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="pc-left-sidebar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="pc-right-sidebar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="topbar-save"]')).toHaveCount(0);

  // The phone's own doors still work: strips, dock sheets, playback toggle.
  await page.locator('[data-testid="dock-filter"]').click();
  await expect(page.locator('[data-testid="filter-modal"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="dock-adjust"]').click();
  await expect(page.locator('[data-testid="adjust-modal"]')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.waitForTimeout(600);
  await shot(page, 'cineplate-mobile-keep.png');
  await expectNoOverflow(page, 390);
  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});
