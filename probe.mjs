import { chromium } from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
vm.runInThisContext(fs.readFileSync('/workspace/repos/PKPilot0015/public/lz-string.min.js','utf8'));
vm.runInThisContext(fs.readFileSync('/workspace/repos/PKPilot0015/public/shutterframe.js','utf8'));
const spec = JSON.parse(fs.readFileSync('/workspace/downloads/dark-cinema.shutterframe.json','utf8'));
const ENC = globalThis.ShutterFrame.encode(spec);
const browser = await chromium.launch({ executablePath: '/workspace/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args:['--no-sandbox','--disable-gpu'] });
const page = await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
await page.goto('https://hyangdan2.github.io/PKPilot0011/?v=probe1', {waitUntil:'domcontentloaded'});
await page.goto(`https://hyangdan2.github.io/PKPilot0011/?v=probe1&frame=${ENC}#editor`, {waitUntil:'networkidle'});
await page.waitForTimeout(1200);
await page.setInputFiles('[data-testid="fourcut-modal"] input[type=file][multiple]', [
 '/workspace/repos/PKPilot0011/public/samples/sample-01.jpg',
 '/workspace/repos/PKPilot0011/public/samples/film_test_portrait.jpg',
 '/workspace/repos/PKPilot0011/public/samples/landscape_test.png',
 '/workspace/repos/PKPilot0011/public/samples/portrait_test.png']);
await page.waitForTimeout(2500);
await page.locator('[data-testid="custom-frame-section"] [data-frame-id^="custom:"]').first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /이 프레임으로 적용/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: '/workspace/scratch/probe-custom.png' });
// now a built-in single frame: does the standard plate print the exposure row?
await page.getByRole('button', { name: '프레임 13' }).click().catch(()=>{});
await page.waitForTimeout(400);
await page.locator('[data-frame-id="gallery"]').first().click().catch(()=>{});
await page.waitForTimeout(1200);
await page.screenshot({ path: '/workspace/scratch/probe-gallery.png' });
console.log('done');
await browser.close();
