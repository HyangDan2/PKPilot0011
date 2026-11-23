import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The title bar's file door: a 파일 mark where 교체 stood, and behind it the two
 * decisions the menu carries — 사진 · 영상 불러오기 and 초기화 — on both the wide
 * studio and the phone.
 */
const SHOT_DIR = process.env.SHOT_DIR || resolve(process.cwd(), '../..', 'pkpilot0011');
const SAMPLE_DIR = resolve(process.cwd(), 'public/samples');
const sample = (name: string) => resolve(SAMPLE_DIR, name);

function watch(page: Page): { errors: string[] } {
  const seen = { errors: [] as string[] };
  page.on('console', (message) => {
    if (message.type() === 'error') seen.errors.push(message.text());
  });
  page.on('pageerror', (error) => seen.errors.push(`pageerror: ${error.message}`));
  return seen;
}

async function waitForPlate(page: Page) {
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }).toBeGreaterThan(200);
  await page.waitForTimeout(400);
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOT_DIR, name) });
}

test('pc: the 파일 menu opens a file or resets the edit, and the plate stays', async ({ page }) => {
  const console = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.sample-card.photo').first().click();
  await waitForPlate(page);

  // The 교체 chip is gone; its place carries a file mark and the name 파일.
  const door = page.locator('[data-testid="file-button"]');
  await expect(door).toBeVisible();
  await expect(door).toContainText('파일');
  await expect(door.locator('svg')).toHaveCount(1);
  await expect(page.locator('.topbar')).not.toContainText('교체');

  await door.click();
  const menu = page.locator('[data-testid="file-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(menu.getByRole('menuitem').nth(0)).toContainText('사진 · 영상 불러오기');
  await expect(menu.getByRole('menuitem').nth(1)).toContainText('초기화');
  await expect(door).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(260);
  await shot(page, 'file-menu-pc.png');

  // Escape shuts the menu, not the studio.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-testid="studio-pc"]')).toBeVisible();

  // 사진 · 영상 불러오기 asks the two-door window; a picked file takes the plate.
  await door.click();
  await page.locator('[data-testid="file-menu-open"]').click();
  await expect(page.locator('[data-testid="open-modal"]')).toBeVisible();
  await page.locator('[data-testid="open-file-input"]').setInputFiles([sample('sample-02.jpg')]);
  await waitForPlate(page);
  await expect(page.locator('[data-testid="explorer-preview"]')).toContainText('sample-02.jpg');

  // An edit, then 초기화: the filter goes back to the studio's first stock, the file stays open.
  await page.locator('[data-testid="film-list"] [data-filter-key="FS-010"]').click();
  await expect(page.locator('.topbar .chip').first()).toContainText('RETRO 90');
  await door.click();
  await page.locator('[data-testid="file-menu-reset"]').click();
  await expect(menu).toHaveCount(0);
  // The studio's own first stock again (VESTRA, the filter a fresh open lands on).
  await expect(page.locator('.topbar .chip').first()).toContainText('VESTRA');
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect(page.locator('[data-testid="explorer-preview"]')).toContainText('sample-02.jpg');
  await expect(page.locator('.toast.is-notice')).toContainText('처음 상태');
  // The sidebar's own numbers came back with it.
  const exposure = page.locator('[data-testid="grade-light"] input[aria-label="노출"]');
  await expect(exposure).toHaveValue('0');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('mobile 390×844: the 파일 menu fits the phone and opens the picker', async ({ page }) => {
  const console = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.sample-card.photo').first().click();
  await waitForPlate(page);

  const door = page.locator('[data-testid="file-button"]');
  await expect(door).toBeVisible();
  await door.click();
  const menu = page.locator('[data-testid="file-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(2);

  // The dropdown stays inside the phone, and the row it hangs from does not spill.
  const box = (await menu.boundingBox())!;
  expect(Math.round(box.x)).toBeGreaterThanOrEqual(0);
  expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(390);
  const header = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar') as HTMLElement;
    return { overflow: topbar.scrollWidth - topbar.clientWidth };
  });
  expect(header.overflow).toBeLessThanOrEqual(0);
  await page.waitForTimeout(260);
  await shot(page, 'file-menu-mobile.png');

  // 초기화 on the phone too: the filter returns to Neutral, the plate stays.
  await page.locator('[data-testid="filter-strip"] [data-filter-key="FS-010"]').click();
  await expect(page.locator('[data-testid="dock-filter"] small')).toContainText('RETRO 90');
  await door.click();
  await page.locator('[data-testid="file-menu-reset"]').click();
  await expect(page.locator('[data-testid="dock-filter"] small')).toContainText('VESTRA');
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();

  // No open window on a phone: the door hands straight over to the picker.
  const chooser = page.waitForEvent('filechooser');
  await door.click();
  await page.locator('[data-testid="file-menu-open"]').click();
  const files = await chooser;
  await files.setFiles([sample('sample-02.jpg')]);
  await waitForPlate(page);
  await expect(page.locator('[data-testid="utility-bar"] .utility-meta')).toContainText('sample-02.jpg');
  await expect(page.locator('[data-testid="open-modal"]')).toHaveCount(0);

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});
