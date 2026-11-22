import { expect, test, type Page } from '@playwright/test';

/**
 * The tone curve on a phone, as it is actually used:
 *  1. the close is a 32px+ target, and a press on the stage behind the overlay
 *     closes it — the graded picture is no longer stuck under the graph;
 *  2. a press on the disc that opened it closes it once, without the outside
 *     press closing it and the disc's own toggle opening it straight back;
 *  3. the badge on the disc reads what the curve does: it lights when a point
 *     is added, goes out on 전체 초기화, and a closed, reset curve leaves no dot;
 *  4. the black and white ends slide along the input axis, in the graph and in
 *     the Input field, and the drawn line runs flat out to the ends.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function openSamplePhoto(page: Page) {
  await page.goto('/');
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }).toBeGreaterThan(150);
  await page.waitForTimeout(800);
}

const overlay = (page: Page) => page.locator('[data-testid="tonecurve-overlay"]');
const fab = (page: Page) => page.locator('[data-testid="tonecurve-fab"]');

async function openCurve(page: Page) {
  await fab(page).click();
  await expect(overlay(page)).toBeVisible();
  await expect(fab(page)).toHaveAttribute('aria-expanded', 'true');
}

async function closeByX(page: Page) {
  await page.locator('.tonecurve-close').click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');
}

/** A press on the stage itself, away from the overlay. */
async function tapStageOutside(page: Page) {
  const stage = (await page.locator('.stage-wrap').boundingBox())!;
  const card = (await overlay(page).boundingBox())!;
  const x = Math.max(stage.x + 6, card.x - 18);
  const y = card.y + card.height / 2;
  expect(x).toBeLessThan(card.x);
  await page.touchscreen.tap(x, y);
}

async function dragPoint(page: Page, index: number, dx: number) {
  const point = page.locator(`[data-testid="tonecurve-point"][data-index="${index}"]`);
  const box = (await point.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 14 });
  await page.mouse.up();
}

const inputValue = async (page: Page) => Number(await page.locator('input[aria-label="Curve Input"]').inputValue());

test('phone: the curve closes from the X, the stage behind it, and the disc', async ({ page }) => {
  await openSamplePhoto(page);
  await openCurve(page);

  // The close is a thumb target now, not a 26×22 chip.
  const close = (await page.locator('.tonecurve-close').boundingBox())!;
  expect(close.width).toBeGreaterThanOrEqual(32);
  expect(close.height).toBeGreaterThanOrEqual(32);

  await closeByX(page);

  // A press on the stage behind the overlay closes it.
  await openCurve(page);
  await tapStageOutside(page);
  await expect(overlay(page)).toHaveCount(0);
  await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');

  // The disc closes it once: the outside press must not leave it re-opened.
  await openCurve(page);
  await fab(page).click();
  await expect(overlay(page)).toHaveCount(0);
  await page.waitForTimeout(250);
  await expect(overlay(page)).toHaveCount(0);
  await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');
});

test('phone: the disc badge follows what the curve does', async ({ page }) => {
  await openSamplePhoto(page);
  await openCurve(page);
  await expect(fab(page).locator('.dot-active')).toHaveCount(0);

  // A point off the line is a grade: the dot lights while the overlay is open.
  const graph = (await page.locator('[data-testid="tonecurve-graph"]').boundingBox())!;
  await page.touchscreen.tap(graph.x + graph.width * 0.5, graph.y + graph.height * 0.28);
  await expect(page.locator('[data-testid="tonecurve-point"]')).toHaveCount(3);
  await expect(fab(page).locator('.dot-active')).toHaveCount(1);

  // 전체 초기화 clears the grade and the dot, and leaves the overlay open.
  await page.locator('.tonecurve-chip.accent').click();
  await expect(page.locator('[data-testid="tonecurve-point"]')).toHaveCount(2);
  await expect(fab(page).locator('.dot-active')).toHaveCount(0);
  await expect(overlay(page)).toBeVisible();

  // A reset curve closed again leaves the disc quiet — no lingering badge.
  await closeByX(page);
  await expect(fab(page)).not.toHaveClass(/(^|\s)on(\s|$)/);
});

test('phone: the black and white ends move along the input axis', async ({ page }) => {
  await openSamplePhoto(page);
  await openCurve(page);

  const graph = page.locator('[data-testid="tonecurve-graph"]');
  // Both ends start where a fresh curve has them, and the white end is selected.
  expect(await inputValue(page)).toBe(255);

  // The black end slides right; the darkest tones are held at its value.
  await dragPoint(page, 0, 60);
  const blackInput = await inputValue(page);
  expect(blackInput).toBeGreaterThan(10);
  expect(blackInput).toBeLessThan(200);
  const blackCx = Number(await page.locator('[data-testid="tonecurve-point"][data-index="0"]').getAttribute('cx'));
  expect(blackCx).toBeGreaterThan(10);

  // The drawn line starts flat from 0 to that point, at that point's own level.
  const path = (await graph.locator('.tonecurve-line').getAttribute('d'))!;
  expect(path.startsWith('M0,')).toBe(true);
  const blackCy = Number(await page.locator('[data-testid="tonecurve-point"][data-index="0"]').getAttribute('cy'));
  const firstSegment = /^M0,([\d.]+) L([\d.]+),([\d.]+)/.exec(path)!;
  expect(Number(firstSegment[1])).toBeCloseTo(blackCy, 1);
  expect(Number(firstSegment[2])).toBeCloseTo(blackCx, 1);
  expect(Number(firstSegment[3])).toBeCloseTo(blackCy, 1);

  // The white end slides left the same way, from the graph…
  await dragPoint(page, 1, -60);
  const whiteCx = Number(await page.locator('[data-testid="tonecurve-point"][data-index="1"]').getAttribute('cx'));
  expect(whiteCx).toBeLessThan(246);
  expect(whiteCx).toBeGreaterThan(20);
  expect(await inputValue(page)).toBeGreaterThan(10);
  expect(await inputValue(page)).toBeLessThan(245);

  // …and the line runs flat out to white at the white end's level.
  const path2 = (await graph.locator('.tonecurve-line').getAttribute('d'))!;
  const whiteCy = Number(await page.locator('[data-testid="tonecurve-point"][data-index="1"]').getAttribute('cy'));
  expect(path2.endsWith(`L256,${whiteCy.toFixed(2)}`)).toBe(true);

  // The Input field moves an end too, exactly like a drag.
  await page.locator('input[aria-label="Curve Input"]').fill('128');
  await expect.poll(async () => Number(await page.locator('[data-testid="tonecurve-point"][data-index="1"]').getAttribute('cx')))
    .toBeGreaterThan(120);
  expect(Number(await page.locator('[data-testid="tonecurve-point"][data-index="1"]').getAttribute('cx'))).toBeLessThan(140);
  await expect(fab(page).locator('.dot-active')).toHaveCount(1);
});
