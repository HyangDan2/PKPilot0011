import { expect, test, type Page } from '@playwright/test';

/**
 * The phone stage keeps the print on its centre line.
 *
 * The bug this pins down (2026-11-22, iPhone): with a clip open and the sound
 * toggle + the long-press hint on the stage, the plate sat hard against the
 * right edge — a dead black gutter on the left, the right edge of the print cut
 * off. Nothing in the flow was pushing it: the plate was centred, but inside a
 * box that had grown wider than the stage. On WebKit a box that takes its width
 * from its own height (an `aspect-ratio` transfer) came back taller-than-wide
 * and wider than the stage, so centring inside it moved the print right, and the
 * stage's `overflow: hidden` cut what overhung.
 *
 * So the shape of the fix is a shape rule, and that is what is checked here:
 * the box the print is centred in is the stage itself — never a size derived
 * from the print, a badge or a ratio — and the print's own margins put it on
 * the centre line, inside the stage, at a phone and after a resize.
 */

const OPEN_TIMEOUT = 30_000;

type Frame = {
  stage: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  box: { left: number; right: number; top: number; bottom: number };
  canvas: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  scale: number;
  plateSize: string;
};

/** Every measurement the tests below judge, off the live page. */
async function frameOf(page: Page): Promise<Frame> {
  return page.evaluate(() => {
    const stage = document.querySelector('.stage') as HTMLElement;
    const inner = document.querySelector('.stage-inner') as HTMLElement;
    const canvas = document.querySelector('[data-testid="plate-canvas"]') as HTMLCanvasElement;
    const stageBox = stage.getBoundingClientRect();
    const style = getComputedStyle(stage);
    // The content box: the 1px border is not room the print may use.
    const left = stageBox.left + parseFloat(style.borderLeftWidth);
    const right = stageBox.right - parseFloat(style.borderRightWidth);
    const top = stageBox.top + parseFloat(style.borderTopWidth);
    const bottom = stageBox.bottom - parseFloat(style.borderBottomWidth);
    const box = inner.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    return {
      stage: { left, right, top, bottom, width: right - left, height: bottom - top },
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      canvas: {
        left: canvasBox.left, right: canvasBox.right, top: canvasBox.top, bottom: canvasBox.bottom,
        width: canvasBox.width, height: canvasBox.height,
      },
      scale: Number(canvas.dataset.plateScale),
      plateSize: canvas.dataset.plateSize ?? '',
    };
  });
}

/** What "centred on the stage" means, in numbers. */
function expectCentred(frame: Frame, label: string) {
  const gapLeft = frame.canvas.left - frame.stage.left;
  const gapRight = frame.stage.right - frame.canvas.right;
  const gapTop = frame.canvas.top - frame.stage.top;
  const gapBottom = frame.stage.bottom - frame.canvas.bottom;
  process.stdout.write(`[${label}] ${JSON.stringify({
    stage: [Math.round(frame.stage.width), Math.round(frame.stage.height)],
    print: [Math.round(frame.canvas.width), Math.round(frame.canvas.height)],
    gaps: { left: +gapLeft.toFixed(1), right: +gapRight.toFixed(1), top: +gapTop.toFixed(1), bottom: +gapBottom.toFixed(1) },
  })}\n`);

  // The margin it is given: symmetric left/right, and never hanging over an edge.
  expect(Math.abs(gapLeft - gapRight), `${label}: the print is off the centre line`).toBeLessThanOrEqual(2);
  expect(gapLeft, `${label}: the print overhangs the left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(gapRight, `${label}: the print overhangs the right edge`).toBeGreaterThanOrEqual(-0.5);
  // Centred on both axes, and wholly inside the stage.
  expect(Math.abs(gapTop - gapBottom), `${label}: the print is off the centre row`).toBeLessThanOrEqual(2);
  expect(gapTop).toBeGreaterThanOrEqual(-0.5);
  expect(gapBottom).toBeGreaterThanOrEqual(-0.5);
  expect(frame.canvas.width, `${label}: the print is wider than the stage`).toBeLessThanOrEqual(frame.stage.width + 0.5);
  expect(frame.canvas.height, `${label}: the print is taller than the stage`).toBeLessThanOrEqual(frame.stage.height + 0.5);
}

/**
 * The plate is centred inside the stage's own box. A box that takes its size
 * from anything else (the print's height × a ratio, a badge that slipped into
 * the flow) is how the print leaves the centre line, so it is checked directly.
 */
function expectBoxIsStage(frame: Frame, label: string) {
  expect(Math.abs(frame.box.left - frame.stage.left), `${label}: the plate's box does not start at the stage edge`).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.box.right - frame.stage.right), `${label}: the plate's box does not end at the stage edge`).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.box.top - frame.stage.top), `${label}: the plate's box does not start at the stage top`).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.box.bottom - frame.stage.bottom), `${label}: the plate's box does not end at the stage bottom`).toBeLessThanOrEqual(1);
}

async function openSamplePhoto(page: Page) {
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible({ timeout: OPEN_TIMEOUT });
  await expect.poll(async () => {
    const box = await page.locator('[data-testid="plate-canvas"]').boundingBox();
    return box ? Math.round(box.width) : 0;
  }, { timeout: OPEN_TIMEOUT }).toBeGreaterThan(150);
  await page.waitForTimeout(900);
}

async function openSampleVideo(page: Page) {
  await page.locator('.sample-card.video').first().click();
  await expect(page.locator('video.source-video')).toHaveCount(1, { timeout: OPEN_TIMEOUT });
  // The plate is painted from a decoded frame, not a skeleton.
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.readyState : 0;
  }), { timeout: OPEN_TIMEOUT }).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => page.getAttribute('[data-testid="plate-canvas"]', 'data-plate-size'), { timeout: OPEN_TIMEOUT })
    .not.toBeNull();
  await page.waitForTimeout(900);
}

test.describe('phone 390×844: the print holds the stage centre', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a photo sits on the centre line, inside the stage', async ({ page }) => {
    await page.goto('/');
    await openSamplePhoto(page);

    const frame = await frameOf(page);
    expectBoxIsStage(frame, 'photo');
    expectCentred(frame, 'photo');
  });

  test('a clip sits on the centre line with the sound toggle and the hint on the stage', async ({ page }) => {
    await page.goto('/');
    await openSampleVideo(page);

    // Both floating pieces of copy are actually up there, or the frame under
    // test is not the one the visitor reported.
    await expect(page.locator('.mute-btn')).toBeVisible();
    await expect(page.locator('.stage-hint')).toBeVisible();

    const frame = await frameOf(page);
    expectBoxIsStage(frame, 'clip');
    expectCentred(frame, 'clip');

    // The plate is still scaled down to the room: this is a fitted print, not a
    // print at 1:1 that only looks centred because it fills everything.
    expect(frame.scale).toBeGreaterThan(0.1);
    expect(frame.scale).toBeLessThan(1);
    expect(frame.plateSize).toMatch(/^\d+x\d+$/);
  });

  test('the sound toggle, the hint and the corner cluster take no room from the print', async ({ page }) => {
    await page.goto('/');
    await openSampleVideo(page);

    const before = await frameOf(page);
    await page.evaluate(() => {
      for (const selector of ['.mute-btn', '.stage-hint', '[data-testid="float-cluster"]']) {
        const element = document.querySelector(selector) as HTMLElement | null;
        if (element) element.style.visibility = 'hidden';
      }
    });
    await page.waitForTimeout(400);
    const after = await frameOf(page);

    // If any of them sat in the stage's flow, hiding it would hand the print
    // room back and the print would move.
    expect(Math.abs(after.canvas.left - before.canvas.left), 'the print moved when the copy was hidden').toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.canvas.right - before.canvas.right), 'the print moved when the copy was hidden').toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.canvas.width - before.canvas.width), 'the print resized when the copy was hidden').toBeLessThanOrEqual(0.5);
  });

  test('the print stays centred through a narrow resize and back', async ({ page }) => {
    await page.goto('/');
    await openSampleVideo(page);
    expectCentred(await frameOf(page), 'clip at 390');

    // A stage that grows and shrinks again is where a size derived from the
    // stage shows up: the print must re-centre, not keep an old offset.
    for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(700);
      const frame = await frameOf(page);
      expectBoxIsStage(frame, `clip at ${size.width}`);
      expectCentred(frame, `clip at ${size.width}`);
    }
  });
});
