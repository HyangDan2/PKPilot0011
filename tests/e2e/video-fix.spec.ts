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
  await page.setViewportSize({ width: 1000, height: 800 });
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
  await expect(page.locator('[data-testid="utility-bar"] .media-spec')).toHaveText(/·\s*[1-9][\d.]*s/, { timeout: 20_000 });

  // ── 3. a decoded frame lands on the plate, even with the clip paused ──
  // The transport lives in the playback sheet over the utility bar now.
  const overlayToggle = page.locator('[data-testid="playback-overlay-toggle"]');
  await expect(overlayToggle).toBeEnabled();
  await overlayToggle.click();
  await expect(page.locator('[data-testid="playback-overlay"]')).toBeVisible();
  const play = page.locator('[data-testid="play-button"]');
  await expect(play).toHaveAttribute('aria-label', '일시정지');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', '재생');
  await expect.poll(async () => (await plateSample(page)).colours, { timeout: 20_000 }).toBeGreaterThan(24);
  await page.waitForTimeout(500);
  const idle = await plateSample(page);
  const idleTime = await page.evaluate(() => (document.querySelector('video.source-video') as HTMLVideoElement).currentTime);
  process.stdout.write(`[idle] colours=${idle.colours} t=${idleTime}\n`);
  await shot(page, 'cineplate_video_fix_idle.png');

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
  await shot(page, 'cineplate_video_fix_playing.png');

  // ── 5. sound: the transport starts the clip with sound, and the analyser
  //       proves real PCM is flowing — not just that a flag flipped ──
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : true;
  }), { message: 'transport play should ask for sound' }).toBe(false);

  const liveAudio = await page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement;
    return {
      muted: video.muted,
      volume: video.volume,
      paused: video.paused,
      preload: video.preload,
      audio: window.__cineplateAudio ?? null,
    };
  });
  process.stdout.write(`[sound] ${JSON.stringify(liveAudio)}\n`);
  expect(liveAudio.volume).toBe(1);
  expect(liveAudio.paused).toBe(false);
  expect(liveAudio.preload).toBe('auto');
  expect(liveAudio.audio?.context).toBe('running');
  expect(liveAudio.audio?.routed).toBe(true);
  // The element is routed through MediaElementAudioSourceNode → Gain → Analyser:
  // a non-zero RMS here is sound leaving the graph, not a UI state.
  await expect.poll(async () => page.evaluate(() => window.__cineplateAudio?.rms ?? 0), {
    message: 'the analyser should see the sample bed', timeout: 10_000,
  }).toBeGreaterThan(0.01);

  await page.locator('[data-testid="mute-toggle"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : false;
  })).toBe(true);
  await expect(page.locator('[data-testid="mute-toggle"]')).toHaveText(/소리 켜기/);
  await expect(page.locator('[data-testid="mute-toggle"]')).toHaveAttribute('aria-label', '소리 켜기');
  await expect.poll(async () => page.evaluate(() => window.__cineplateAudio?.rms ?? 1), {
    message: 'silenced graph', timeout: 10_000,
  }).toBeLessThan(0.02);

  await page.locator('[data-testid="mute-toggle"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : true;
  })).toBe(false);
  await expect(page.locator('[data-testid="mute-toggle"]')).toHaveText(/소리 켜짐/);
  await expect(page.locator('[data-testid="mute-toggle"]')).toHaveAttribute('aria-label', '음소거');
  await expect.poll(async () => page.evaluate(() => window.__cineplateAudio?.rms ?? 0), {
    message: 'the graph should pass sound again', timeout: 10_000,
  }).toBeGreaterThan(0.01);

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

test('wide 1000×800: the ⋮ menu opens above the corner tools', async ({ page }) => {
  const errors = watch(page);
  // A short window is where the dropdown's bottom meets the floating cluster.
  await page.setViewportSize({ width: 1000, height: 560 });
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

  await shot(page, 'cineplate_nav_menu_over_stage.png');
  expect(errors.errors, errors.errors.join(' | ')).toEqual([]);
});

/**
 * A phone turns sound on with one tap on the sound chip. The tap sits inside the
 * stage, where a long press means "compare with the original" — so the chip has
 * to answer the tap immediately and never let the stage start its timer.
 */
test('mobile 390×844: the sound toggle answers the tap, never the long press', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const errors = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.locator('.sample-card.video').click();
  await expect(page.locator('video.source-video')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.readyState : 0;
  }), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  const toggle = page.locator('[data-testid="mute-toggle"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('data-has-audio', 'true');
  await expect(toggle).toHaveText(/소리 켜기/);
  await expect(toggle).toHaveAttribute('aria-label', '소리 켜기');

  // The chip sits above the print, and a press that rests past the 260ms
  // compare delay still only flips the sound.
  const box = (await toggle.boundingBox())!;
  expect(box.width).toBeGreaterThan(40);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(420);
  await expect(page.locator('.compare-badge')).toHaveCount(0);
  await page.mouse.up();

  await expect(toggle).toHaveText(/소리 켜짐/, { timeout: 10_000 });
  await expect(toggle).toHaveAttribute('aria-label', '음소거');
  await expect(page.locator('.compare-badge')).toHaveCount(0);

  const live = await page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement;
    const button = document.querySelector('[data-testid="mute-toggle"]') as HTMLElement;
    return {
      muted: video.muted,
      volume: video.volume,
      paused: video.paused,
      preload: video.preload,
      top: Math.round(button.getBoundingClientRect().top),
      audio: window.__cineplateAudio ?? null,
    };
  });
  process.stdout.write(`[mobile sound] ${JSON.stringify(live)}\n`);
  expect(live.muted).toBe(false);
  expect(live.volume).toBe(1);
  expect(live.paused).toBe(false);
  expect(live.preload).toBe('auto');
  expect(live.audio?.context).toBe('running');
  expect(live.audio?.routed).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__cineplateAudio?.rms ?? 0), {
    message: 'the phone tap should put real PCM through the graph', timeout: 10_000,
  }).toBeGreaterThan(0.01);

  // The phone's header is one clean row: the lockup, then the backdrop slide,
  // the replace door and the menu — nothing wraps, nothing overflows.
  const header = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar') as HTMLElement;
    const brand = document.querySelector('.topbar .brand') as HTMLElement;
    const backdrop = document.querySelector('[data-testid="backdrop-switch"]') as HTMLElement;
    const replace = document.querySelector('[data-testid="replace-button"]') as HTMLElement;
    const menu = document.querySelector('[data-testid="nav-menu-button"]') as HTMLElement;
    const rect = (element: HTMLElement) => element.getBoundingClientRect();
    return {
      overflow: topbar.scrollWidth - topbar.clientWidth,
      brandRight: Math.round(rect(brand).right),
      backdropLeft: Math.round(rect(backdrop).left),
      order: [rect(backdrop).left, rect(replace).left, rect(menu).left].map(Math.round),
      bottoms: [rect(brand).bottom, rect(backdrop).bottom, rect(replace).bottom, rect(menu).bottom]
        .map((value) => Math.round(value)),
      topbarBottom: Math.round(rect(topbar).bottom),
      wordmark: getComputedStyle(document.querySelector('.topbar .brand-name') as HTMLElement).fontSize,
      mark: (() => {
        const mark = document.querySelector('.topbar .mark') as HTMLElement;
        const style = getComputedStyle(mark);
        return { width: style.width, height: style.height, border: style.borderTopWidth, skew: style.transform };
      })(),
    };
  });
  process.stdout.write(`[mobile header] ${JSON.stringify(header)}\n`);
  expect(header.overflow).toBeLessThanOrEqual(0);
  expect(header.brandRight).toBeLessThan(header.backdropLeft);
  expect(header.order[0]).toBeLessThan(header.order[1]);
  expect(header.order[1]).toBeLessThan(header.order[2]);
  for (const bottom of header.bottoms) expect(bottom).toBeLessThanOrEqual(header.topbarBottom + 1);
  expect(header.wordmark).toBe('22px');
  expect(header.mark.width).toBe('17px');
  expect(header.mark.height).toBe('22px');
  expect(header.mark.border).toBe('3px');
  // skewY(-23deg) computes to matrix(1, -0.4245, 0, 1, 0, 0).
  const headerSkew = Number((header.mark.skew.match(/matrix\(([^)]+)\)/) || ['', ''])[1].split(',')[1]);
  expect(Math.atan(headerSkew) * 180 / Math.PI).toBeCloseTo(-23, 1);

  await page.screenshot({ path: resolve(SHOT_DIR, 'cineplate_audio_fix_mobile.png') });
  expect(errors.errors, errors.errors.join(' | ')).toEqual([]);
});

/**
 * The tone curve is an overlay on the print, not a sheet over it: on a phone the
 * graph has to fit inside the stage, stay transparent, and take a drag without
 * the stage stealing the gesture.
 */
test('mobile 390×844: the tone curve floats over the print', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const errors = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.sample-card.photo').first().click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible();
  await page.waitForTimeout(900);

  await page.locator('[data-testid="tonecurve-fab"]').click();
  const overlay = page.locator('[data-testid="tonecurve-overlay"]');
  await expect(overlay).toBeVisible();
  await expect(page.locator('[data-testid="tonecurve-fab"]')).toHaveAttribute('aria-expanded', 'true');

  const placement = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="tonecurve-overlay"]') as HTMLElement;
    const wrap = document.querySelector('.stage-wrap') as HTMLElement;
    const plate = document.querySelector('[data-testid="plate-canvas"]') as HTMLElement;
    const rect = element.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const plateRect = plate.getBoundingClientRect();
    return {
      inside: wrap.contains(element),
      background: getComputedStyle(element).backgroundColor,
      graphBackground: getComputedStyle(element.querySelector('svg') as SVGElement).backgroundColor,
      width: Math.round(rect.width),
      fits: rect.top >= wrapRect.top - 1 && rect.bottom <= wrapRect.bottom + 1
        && rect.left >= wrapRect.left - 1 && rect.right <= wrapRect.right + 1,
      centreDx: (rect.left + rect.width / 2) - (wrapRect.left + wrapRect.width / 2),
      centreDy: (rect.top + rect.height / 2) - (wrapRect.top + wrapRect.height / 2),
      plateWider: plateRect.width > rect.width + 20,
    };
  });
  process.stdout.write(`[mobile curve] ${JSON.stringify(placement)}\n`);
  expect(placement.inside).toBe(true);
  expect(placement.background).toBe('rgba(0, 0, 0, 0)');
  expect(placement.graphBackground).toBe('rgba(0, 0, 0, 0)');
  expect(placement.fits).toBe(true);
  expect(Math.abs(placement.centreDx)).toBeLessThanOrEqual(1);
  expect(Math.abs(placement.centreDy)).toBeLessThanOrEqual(1);
  expect(placement.width).toBeLessThanOrEqual(240);
  expect(placement.plateWider).toBe(true);

  // Add a point on the graph and drag it up: the curve follows, the stage does
  // not draw its compare badge, and the fab picks up the touched dot.
  const graph = page.locator('[data-testid="tonecurve-graph"]');
  const box = (await graph.boundingBox())!;
  const line = page.locator('[data-testid="tonecurve-line"]');
  const before = await line.getAttribute('d');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  const afterAdd = await line.getAttribute('d');
  expect(afterAdd).not.toBe(before);
  expect(await line.getAttribute('d')).not.toBe(before);

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.32, { steps: 10 });
  await page.mouse.up();
  const afterDrag = await line.getAttribute('d');
  expect(afterDrag).not.toBe(afterAdd);
  await expect(page.locator('.compare-badge')).toHaveCount(0);
  await expect(page.locator('[data-testid="tonecurve-fab"] .dot-active')).toHaveCount(1);

  // The channel chips and the numbers reach the same curve.
  await page.locator('[data-testid="tonecurve-overlay"] [data-channel="red"]').click();
  await expect(page.locator('.tonecurve-title')).toHaveText(/RGB|R/);
  await expect(page.locator('[data-testid="tonecurve-overlay"] [data-channel="red"]')).toHaveAttribute('aria-pressed', 'true');

  await page.screenshot({ path: resolve(SHOT_DIR, 'cineplate_tonecurve_overlay_mobile.png') });

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="tonecurve-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tonecurve-fab"]')).toHaveAttribute('aria-expanded', 'false');
  expect(errors.errors, errors.errors.join(' | ')).toEqual([]);
});
