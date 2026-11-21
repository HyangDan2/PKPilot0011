import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/workspace/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args:['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
for (const n of [100, 500, 900, 1000, 1100, 1500]) {
  await page.goto('https://hyangdan2.github.io/PKPilot0003/?v=1#frame=' + 'A'.repeat(n), {waitUntil:'domcontentloaded'});
  console.log(n, '->', await page.evaluate(()=>location.hash.length));
}
await browser.close();
