import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/workspace/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args:['--no-sandbox','--disable-gpu'] });
const page = await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
await page.goto('https://hyangdan2.github.io/PKPilot0011/?v=p2', {waitUntil:'domcontentloaded'});
await page.waitForTimeout(300);
await page.goto('https://hyangdan2.github.io/PKPilot0011/?v=p2#editor', {waitUntil:'networkidle'});
await page.waitForTimeout(800);
// load a sample photo the normal way
await page.goto('https://hyangdan2.github.io/PKPilot0011/?v=p2', {waitUntil:'networkidle'});
await page.waitForTimeout(600);
await page.locator('[role="button"], button').filter({ hasText: 'Landscape' }).first().click().catch(async()=>{ await page.locator('img[alt="Landscape"]').click(); });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/workspace/scratch/p2-gallery.png' });
console.log('shot');
await browser.close();
