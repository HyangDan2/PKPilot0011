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

test('landing: CinePlate lockup, one open card, the corner cluster and both palettes', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');

  await expect(page).toHaveTitle(/CinePlate/);
  // The landing carries the same Web-HQ lockup as the editor: CSS dual-skew
  // mark, wordmark, and the product name behind a rule.
  await expect(page.locator('.landing-top .brand-name')).toHaveText('HD2Lab');
  await expect(page.locator('.landing-top .brand em')).toHaveText('CinePlate');
  await expect(page.locator('.landing-top .brand-badge')).toHaveText('STUDIO');
  const landingLockup = await page.evaluate(() => {
    const mark = document.querySelector('.landing-top .mark') as HTMLElement;
    const style = getComputedStyle(mark);
    return {
      width: style.width, height: style.height, border: style.borderTopWidth,
      skew: (() => { const m = style.transform.match(/matrix\(([^)]+)\)/); return m ? Math.atan(Number(m[1].split(',')[1])) * 180 / Math.PI : null; })(),
      svg: document.querySelector('.landing-top .mark svg') !== null,
      name: getComputedStyle(document.querySelector('.landing-top .brand-name') as HTMLElement).fontSize,
    };
  });
  process.stdout.write(`[landing lockup] ${JSON.stringify(landingLockup)}\n`);
  expect(landingLockup.width).toBe('17px');
  expect(landingLockup.height).toBe('22px');
  expect(landingLockup.border).toBe('3px');
  expect(landingLockup.skew).toBeCloseTo(-23, 1);
  expect(landingLockup.svg).toBe(false);
  expect(landingLockup.name).toBe('25px');

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

  await shot(page, 'cineplate_landing.png');

  // The floating toggle owns the whole UI's palette.
  await page.locator('[data-testid="theme-fab"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(350);
  await shot(page, 'cineplate_landing_light.png');
  await page.locator('[data-testid="theme-fab"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('landing header: the editor title bar, both portal doors and the ⋮ menu', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');

  // ── the bar itself: 56px, pinned, and the scroll box starts under it ──
  const bar = page.locator('.landing .topbar.landing-top');
  await expect(bar).toBeVisible();
  const layout = await page.evaluate(() => {
    const header = document.querySelector('.landing .topbar.landing-top') as HTMLElement;
    const scroll = document.querySelector('.landing-scroll') as HTMLElement;
    const actions = document.querySelector('.landing-top .topbar-actions') as HTMLElement;
    const rect = header.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      headerHeight: Math.round(rect.height),
      headerTop: Math.round(rect.top),
      scrollTop: Math.round(scroll.getBoundingClientRect().top),
      actionsInset: Math.round(window.innerWidth - actionsRect.right),
      portalLinks: document.querySelectorAll('.landing-top .portal-link').length,
      menus: header.querySelectorAll('[data-testid="nav-menu-button"]').length,
      badge: (document.querySelector('.landing-top .brand-badge') as HTMLElement).textContent,
    };
  });
  process.stdout.write(`[landing header] ${JSON.stringify(layout)}\n`);
  expect(layout.headerHeight).toBe(56);
  expect(layout.headerTop).toBe(0);
  expect(layout.scrollTop).toBe(56);
  expect(layout.actionsInset).toBeLessThanOrEqual(56);
  expect(layout.portalLinks).toBe(2);
  expect(layout.menus).toBe(1);
  expect(layout.badge).toBe('STUDIO');

  // The two doors are real links to the real portals, and they open elsewhere.
  await expect(page.locator('[data-testid="landing-webhq"]')).toBeVisible();
  await expect(page.locator('[data-testid="landing-webhq"]')).toHaveAttribute('href', 'https://hyangdan2.github.io/');
  await expect(page.locator('[data-testid="landing-webhq"]')).toHaveAttribute('target', '_blank');
  await expect(page.locator('[data-testid="landing-apps"]')).toBeVisible();
  await expect(page.locator('[data-testid="landing-apps"]')).toHaveAttribute('href', 'https://hyangdan2.github.io/ApplicationHub/');
  await expect(page.locator('[data-testid="landing-open"]')).toBeVisible();
  await expect(page.locator('[data-testid="landing-sample"]')).toBeVisible();
  await expectNoOverlap(page, '.landing-top .brand', '.landing-top .topbar-actions');
  await expectNoOverlap(page, '.landing-top .brand-badge', '.landing-top .topbar-actions');

  // ── the bar does not scroll with the page ──
  await page.evaluate(() => { (document.querySelector('.landing-scroll') as HTMLElement).scrollTop = 700; });
  await page.waitForTimeout(250);
  const pinned = await page.evaluate(() => ({
    scrolled: (document.querySelector('.landing-scroll') as HTMLElement).scrollTop,
    headerTop: Math.round((document.querySelector('.landing-top') as HTMLElement).getBoundingClientRect().top),
  }));
  expect(pinned.scrolled).toBeGreaterThan(100);
  expect(pinned.headerTop).toBe(0);
  await page.evaluate(() => { (document.querySelector('.landing-scroll') as HTMLElement).scrollTop = 0; });
  await page.waitForTimeout(250);

  // ── the hero: mark, wordmark with the HD2Lab badge, the headline under it ──
  const hero = await page.evaluate(() => ({
    svg: document.querySelectorAll('.hero .hero-mark svg').length,
    markBox: (() => { const box = (document.querySelector('.hero-mark') as HTMLElement).getBoundingClientRect(); return { w: Math.round(box.width), h: Math.round(box.height) }; })(),
    title: (document.querySelector('.hero-title-row h1') as HTMLElement).textContent,
    badge: (document.querySelector('.hero-title-row .hero-badge') as HTMLElement).textContent,
    headline: (document.querySelector('.hero-headline') as HTMLElement).textContent,
    stats: Array.from(document.querySelectorAll('.hero-stats b')).map((b) => b.textContent),
  }));
  process.stdout.write(`[landing hero] ${JSON.stringify(hero)}\n`);
  expect(hero.svg).toBe(1);
  expect(hero.markBox.w).toBe(62);
  expect(hero.markBox.h).toBe(62);
  expect(hero.title).toBe('CinePlate');
  expect(hero.badge).toBe('HD2Lab');
  expect(hero.headline).toContain('하나의 플레이트로');
  expect(hero.stats).toEqual(['13', '69', '4K', '0 B']);

  await shot(page, 'cineplate_landing_v2.png');

  // ── the landing's ⋮ carries the workspace, samples and both portals ──
  await page.locator('.landing-top [data-testid="nav-menu-button"]').click();
  const menu = page.locator('[data-testid="nav-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.portal-menu-head')).toHaveText(['WORKSPACE', 'SAMPLES', 'NAVIGATION']);
  await expect(menu.locator('.portal-item')).toHaveCount(11);
  await expect(menu.locator('a[href="https://hyangdan2.github.io/"]')).toHaveCount(1);
  await expect(menu.locator('a[href="https://hyangdan2.github.io/ApplicationHub/"]')).toHaveCount(1);
  // nothing is open yet, so the media-clearing entries are honestly disabled
  await expect(menu.getByRole('menuitem', { name: /미디어 비우기/ })).toBeDisabled();
  await page.waitForTimeout(260);
  await shot(page, 'cineplate_landing_nav_menu.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="nav-menu"]')).toHaveCount(0);

  // The header's sample door opens the first sample, the same as the cards do.
  await page.locator('[data-testid="landing-sample"]').click();
  await expect(page.locator('[data-testid="plate-canvas"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.topbar [data-testid="nav-menu-button"]')).toHaveCount(1);

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('mobile 390×844: the landing bar keeps one row, portals fold into ⋮', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const bar = await page.evaluate(() => {
    const header = document.querySelector('.landing .topbar.landing-top') as HTMLElement;
    const brand = document.querySelector('.landing-top .brand') as HTMLElement;
    const actions = document.querySelector('.landing-top .topbar-actions') as HTMLElement;
    const open = document.querySelector('[data-testid="landing-open"]') as HTMLElement;
    const h = header.getBoundingClientRect();
    const b = brand.getBoundingClientRect();
    const a = actions.getBoundingClientRect();
    return {
      header: { top: Math.round(h.top), bottom: Math.round(h.bottom), height: Math.round(h.height) },
      brand: { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) },
      actions: { left: Math.round(a.left), right: Math.round(a.right), top: Math.round(a.top), bottom: Math.round(a.bottom) },
      openBox: { w: Math.round(open.getBoundingClientRect().width), h: Math.round(open.getBoundingClientRect().height) },
      badge: getComputedStyle(document.querySelector('.landing-top .brand-badge') as HTMLElement).display,
    };
  });
  process.stdout.write(`[mobile landing bar] ${JSON.stringify(bar)}\n`);
  // one row: both ends inside the bar's own height
  expect(bar.brand.top).toBeGreaterThanOrEqual(bar.header.top);
  expect(bar.brand.bottom).toBeLessThanOrEqual(bar.header.bottom);
  expect(bar.actions.bottom).toBeLessThanOrEqual(bar.header.bottom);
  // and no collision, with room to spare inside 390
  expect(bar.brand.right).toBeLessThan(bar.actions.left);
  expect(bar.brand.left).toBeGreaterThanOrEqual(0);
  expect(bar.actions.right).toBeLessThanOrEqual(390);
  // the compact door stays a thumb-sized square, not a shrinking label
  expect(bar.openBox.w).toBeGreaterThanOrEqual(34);
  expect(bar.openBox.w).toBeLessThanOrEqual(44);
  expect(bar.openBox.h).toBeGreaterThanOrEqual(34);
  await expectNoOverlap(page, '.landing-top .brand', '.landing-top .topbar-actions');

  // the header's own links are gone; the ⋮ holds them instead
  await expect(page.locator('.landing-top .portal-link').first()).toBeHidden();
  await expect(page.locator('[data-testid="landing-sample"]')).toBeHidden();
  await expect(page.locator('[data-testid="landing-open"]')).toBeVisible();
  await expect(page.locator('[data-testid="theme-fab"]')).toBeVisible();
  await shot(page, 'cineplate_landing_mobile_v2.png');

  await page.locator('.landing-top [data-testid="nav-menu-button"]').click();
  const menu = page.locator('[data-testid="nav-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('a[href="https://hyangdan2.github.io/"]')).toBeVisible();
  await expect(menu.locator('a[href="https://hyangdan2.github.io/ApplicationHub/"]')).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
  await page.waitForTimeout(260);
  await shot(page, 'cineplate_landing_mobile_menu.png');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('wide editor (1000×800): title-backdrop slide, strip, cluster, and no corner collisions', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  // The Shutterplate lockup: a CSS dual-skew mark, the wordmark, and the
  // product name behind a rule — never a typed "|" character.
  await expect(page.locator('.topbar .brand-name')).toHaveText('HD2Lab');
  await expect(page.locator('.topbar .brand em')).toHaveText('CinePlate');
  const lockup = await page.evaluate(() => {
    const mark = document.querySelector('.topbar .mark') as HTMLElement;
    const name = document.querySelector('.topbar .brand-name') as HTMLElement;
    const em = document.querySelector('.topbar .brand em') as HTMLElement;
    const style = getComputedStyle(mark);
    return {
      mark: {
        width: style.width, height: style.height, border: style.borderTopWidth,
        // skewY(-23deg) computes to a matrix whose b component is tan(-23°).
        skew: (() => { const m = style.transform.match(/matrix\(([^)]+)\)/); return m ? Math.atan(Number(m[1].split(',')[1])) * 180 / Math.PI : null; })(),
      },
      name: { size: getComputedStyle(name).fontSize, weight: getComputedStyle(name).fontWeight },
      em: { style: getComputedStyle(em).fontStyle, border: getComputedStyle(em).borderLeftWidth },
      pipe: document.querySelector('.topbar .brand-div') !== null,
    };
  });
  process.stdout.write(`[lockup] ${JSON.stringify(lockup)}\n`);
  expect(lockup.mark.width).toBe('17px');
  expect(lockup.mark.height).toBe('22px');
  expect(lockup.mark.border).toBe('3px');
  expect(lockup.mark.skew).toBeCloseTo(-23, 1);
  expect(lockup.name.size).toBe('25px');
  expect(lockup.em.style).toBe('normal');
  expect(lockup.em.border).toBe('1px');
  expect(lockup.pipe).toBe(false);

  // Title slide = the viewport behind the plate (frame.backdrop), not the app theme.
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await expect(page.locator('.stage')).toHaveClass(/backdrop-dark/);
  // The slide sits in the actions row, immediately left of 교체.
  const order = await page.evaluate(() => {
    const left = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().left;
    return {
      backdrop: left('[data-testid="backdrop-switch"]'),
      replace: left('[data-testid="replace-button"]'),
      menu: left('[data-testid="nav-menu-button"]'),
    };
  });
  expect(order.backdrop).toBeLessThan(order.replace);
  expect(order.replace).toBeLessThan(order.menu);
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

  // Only the theme toggle floats over the stage now; the four tools live in
  // the utility bar under it, next to the file's own name and resolution.
  await expect(page.locator('[data-testid="float-cluster"] .tool-fab')).toHaveCount(0);
  await expect(page.locator('[data-testid="theme-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="utility-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="fourcut-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="colorlab-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="tonecurve-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="cameraeffects-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="utility-bar"] .utility-meta')).toContainText('sample-01.jpg');
  // the topbar no longer repeats the file name and resolution
  await expect(page.locator('.topbar-meta')).toHaveCount(0);
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '.dock');
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '[data-testid="filter-strip"]');
  await expectNoOverlap(page, '[data-testid="utility-bar"]', '[data-testid="filter-strip"]');
  await expectNoOverlap(page, '[data-testid="filter-strip"]', '.dock');

  // The trash is gone; replace + menu took its place.
  await expect(page.locator('.topbar-actions [aria-label="미디어 닫기"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="replace-button"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-menu-button"]')).toBeVisible();

  await page.waitForTimeout(600);
  // Clicking a card scrolls the strip; a screenshot should show it from its start.
  await resetStrip(page);
  await shot(page, 'cineplate_desktop.png');
  await shot(page, 'cineplate_desktop_v5.png');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('navigation menu: workspace, samples and portal links', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1000, height: 800 });
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
  await page.waitForTimeout(260);
  await shot(page, 'cineplate_nav_menu.png');

  // Emblem ink toggles from the menu and the badge says which way it went.
  await menu.getByRole('menuitemcheckbox', { name: /엠블럼 색상/ }).click();
  await page.locator('[data-testid="nav-menu-button"]').click();
  await expect(page.locator('[data-testid="nav-menu"] .portal-badge').nth(4)).toHaveText('MONO');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('modals: eleven single frames, the 4-cut window, and the three effect sheets', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  // ── the frame window is eleven singles now ──
  await page.locator('[data-testid="dock-frame"]').click();
  await expect(page.locator('[data-testid="frame-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="frame-modal"] .frame-card')).toHaveCount(11);
  await expect(page.locator('[data-testid="frame-modal"] [data-frame-id="contact"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="frame-modal"] [data-frame-id="fyra04"]')).toHaveCount(0);
  await expect.poll(async () => page.locator('.frame-thumb img').count(), { timeout: 30_000 }).toBe(11);
  await shotSheet(page, 'cineplate_frame_modal.png');
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
  await shotSheet(page, 'cineplate_fourcut_modal.png');

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
  // The photo bar is gone from the workbench: the slots live in the window.
  await expect(page.locator('.slot-strip')).toHaveCount(0);
  await page.waitForTimeout(900);

  // ── the three effect sheets, split out of the grade panel ──
  await page.locator('[data-testid="colorlab-fab"]').click();
  await expect(page.locator('[data-testid="colorlab-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="colorlab-modal"] .band-dot')).toHaveCount(8);
  await shotSheet(page, 'cineplate_colorlab_modal.png');
  await page.keyboard.press('Escape');

  await page.locator('[data-testid="tonecurve-fab"]').click();
  const curve = page.locator('[data-testid="tonecurve-overlay"]');
  await expect(curve).toBeVisible();
  await expect(page.locator('[data-testid="tonecurve-graph"]')).toBeVisible();
  // It is not a sheet: the overlay lives inside the stage, transparent, centred
  // on the print, so the graded picture shows through the graph.
  const curveBox = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="tonecurve-overlay"]') as HTMLElement | null;
    const wrap = document.querySelector('.stage-wrap') as HTMLElement | null;
    if (!overlay || !wrap) return null;
    const rect = overlay.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    return {
      inside: wrap.contains(overlay),
      background: getComputedStyle(overlay).backgroundColor,
      graphBackground: getComputedStyle(overlay.querySelector('svg') as SVGElement).backgroundColor,
      centreDx: (rect.left + rect.width / 2) - (wrapRect.left + wrapRect.width / 2),
      centreDy: (rect.top + rect.height / 2) - (wrapRect.top + wrapRect.height / 2),
      fits: rect.top >= wrapRect.top - 1 && rect.bottom <= wrapRect.bottom + 1
        && rect.left >= wrapRect.left - 1 && rect.right <= wrapRect.right + 1,
      expanded: document.querySelector('[data-testid="tonecurve-fab"]')?.getAttribute('aria-expanded'),
    };
  });
  process.stdout.write(`[curve] ${JSON.stringify(curveBox)}\n`);
  expect(curveBox!.inside).toBe(true);
  expect(curveBox!.background).toBe('rgba(0, 0, 0, 0)');
  expect(curveBox!.graphBackground).toBe('rgba(0, 0, 0, 0)');
  expect(Math.abs(curveBox!.centreDx)).toBeLessThanOrEqual(1);
  expect(Math.abs(curveBox!.centreDy)).toBeLessThanOrEqual(1);
  expect(curveBox!.fits).toBe(true);
  expect(curveBox!.expanded).toBe('true');
  await shotSheet(page, 'cineplate_tonecurve_overlay.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="tonecurve-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tonecurve-fab"]')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('[data-testid="cameraeffects-fab"]').click();
  await expect(page.locator('[data-testid="cameraeffects-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="cameraeffects-modal"]')).toContainText('날짜 각인');
  await expect(page.locator('[data-testid="cameraeffects-modal"]')).toContainText('광학 효과');
  await shotSheet(page, 'cineplate_cameraeffects_modal.png');
  await page.keyboard.press('Escape');

  // ── the grade panel keeps only light / colour / texture / video ──
  await page.locator('[data-testid="dock-adjust"]').click();
  await expect(page.locator('[data-testid="adjust-modal"]')).toBeVisible();
  const tabs = await page.locator('[data-testid="adjust-modal"] .chip-row .chip').allTextContents();
  expect(tabs).toEqual(['빛', '색', '질감', '영상'].filter((label) => label !== '영상'));
  await shotSheet(page, 'cineplate_adjust_modal.png');
  await page.keyboard.press('Escape');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('export: prepare first, then one save/share tap', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');
  await openSamplePhoto(page);

  await page.locator('[data-testid="dock-export"]').click();
  await expect(page.locator('[data-testid="export-modal"]')).toBeVisible();
  // The still is made on open, so the button already holds a file.
  await expect(page.locator('[data-testid="save-share"]')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[data-testid="export-modal"]')).toContainText('-CinePlate.jpg');
  await expect(page.locator('.export-foot .link-btn')).toBeVisible();
  await shotSheet(page, 'cineplate_export_modal.png');

  const download = page.waitForEvent('download', { timeout: 20_000 });
  await page.locator('[data-testid="save-share"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('-CinePlate');
  const path = resolve(SHOT_DIR, 'cineplate_still_export.jpg');
  await file.saveAs(path);

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});

test('video: sound toggle, plate legibility and an export that keeps its audio', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const console = watch(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/');
  await openSampleVideo(page);

  // The clip autoplays silent; the toggle is the visitor's way to the sound.
  const mute = page.locator('[data-testid="mute-toggle"]');
  await expect(mute).toBeVisible();
  await expect(mute).toHaveText(/소리 켜기/);
  await expect(mute).toHaveAttribute('aria-label', '소리 켜기');
  await mute.click();
  await expect(mute).toHaveText(/소리 켜짐/);
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video.source-video') as HTMLVideoElement | null;
    return video ? video.muted : true;
  })).toBe(false);
  await expect.poll(async () => page.evaluate(() => window.__cineplateAudio?.rms ?? 0), {
    message: 'the toggle should put real PCM through the graph', timeout: 10_000,
  }).toBeGreaterThan(0.01);
  await page.waitForTimeout(700);
  await resetStrip(page);
  await shot(page, 'cineplate_video.png');

  // A clip with no EXIF still prints a full spec row.
  const plateSpecial = await page.locator('[data-testid="plate-canvas"]').getAttribute('data-plate-size');
  expect(plateSpecial).toMatch(/^\d+x\d+$/);

  await page.locator('[data-testid="dock-export"]').click();
  await expect(page.locator('[data-testid="export-modal"]')).toBeVisible();
  await page.locator('[data-testid="export-modal"] .segmented-track button', { hasText: '720p' }).click();
  await expect(page.locator('[data-testid="save-share"]')).toBeDisabled();
  await page.getByRole('button', { name: /영상 준비/ }).click();
  await expect(page.locator('[data-testid="save-share"]')).toBeEnabled({ timeout: 200_000 });
  await expect(page.locator('[data-testid="export-modal"]')).toContainText('CinePlate');

  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-testid="save-share"]').click();
  const file = await download;
  const name = file.suggestedFilename();
  const out = resolve(SHOT_DIR, name.endsWith('.webm') ? 'cineplate_export_probe.webm' : 'cineplate_export_probe.mp4');
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
  // The sample bed is a real pad now (peak ≈ 0.66). A 1% tone used to pass
  // this at 0.005 while a phone heard nothing at all.
  expect(peak.peak, `audio peak in ${name}`).toBeGreaterThan(0.2);
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

  // The phone boosts only the copy, inside a slim frame: the band grows a
  // little (15.6% → at most ~23%), the plate width does not.
  const boost = Number(await page.locator('[data-testid="plate-canvas"]').getAttribute('data-type-boost'));
  const scale = Number(await page.locator('[data-testid="plate-canvas"]').getAttribute('data-plate-scale'));
  const band = Number(await page.locator('[data-testid="plate-canvas"]').getAttribute('data-band'));
  const minType = Number(await page.locator('[data-testid="plate-canvas"]').getAttribute('data-min-type-css'));
  const plateSize = (await page.locator('[data-testid="plate-canvas"]').getAttribute('data-plate-size'))!.split('x').map(Number);
  process.stdout.write(`[mobile] boost=${boost} scale=${scale} band=${band} minType=${minType} plate=${plateSize.join('x')}\n`);
  expect(boost).toBeGreaterThan(1.4);
  expect(boost).toBeLessThanOrEqual(1.6);
  expect(scale).toBeLessThan(0.45);
  // the band stays a slim share of the plate, not a phone-sized balloon
  expect(band / plateSize[1]).toBeGreaterThan(0.19);
  expect(band / plateSize[1]).toBeLessThanOrEqual(0.23);
  // and the frame's smallest row still reads at arm's length
  expect(minType).toBeGreaterThanOrEqual(5.2);

  // The print sits on the stage's centre line: no phone lane pushes it aside.
  const stageBox = await page.locator('.stage').boundingBox();
  expect(Math.abs((canvas!.x + canvas!.width / 2) - (stageBox!.x + stageBox!.width / 2))).toBeLessThanOrEqual(1);

  // The corner cluster holds the theme toggle alone inside the stage.
  const cluster = await page.locator('[data-testid="float-cluster"]').boundingBox();
  expect(cluster!.x).toBeGreaterThanOrEqual(0);
  expect(cluster!.x + cluster!.width).toBeLessThanOrEqual(390);
  expect(cluster!.width).toBeLessThan(320);
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '.dock');
  await expectNoOverlap(page, '[data-testid="float-cluster"]', '[data-testid="filter-strip"]');
  await expectNoOverlap(page, '[data-testid="utility-bar"]', '[data-testid="filter-strip"]');
  await expectNoOverlap(page, '[data-testid="filter-strip"]', '.dock');
  await expect(page.locator('[data-testid="float-cluster"] .tool-fab')).toHaveCount(0);
  await expect(page.locator('[data-testid="theme-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="utility-bar"] [data-testid="fourcut-fab"]')).toBeVisible();
  await expect(page.locator('[data-testid="backdrop-switch"]')).toBeVisible();

  await page.screenshot({ path: resolve(SHOT_DIR, 'cineplate_v3_mobile.png') });
  await page.locator('[data-testid="plate-canvas"]').screenshot({ path: resolve(SHOT_DIR, 'cineplate_v3_mobile_plate.png') });

  await expect(page.locator('[data-testid="filter-strip"] .strip-card')).toHaveCount(12);
  await page.locator('[data-testid="filter-strip"] [data-filter-key="FS-004"]').click();

  await page.locator('[data-testid="fourcut-fab"]').click();
  await expect(page.locator('[data-testid="fourcut-modal"]')).toBeVisible();
  await shotSheet(page, 'cineplate_v3_mobile_fourcut.png');
  await page.keyboard.press('Escape');

  expect(console.errors, console.errors.join(' | ')).toEqual([]);
});
