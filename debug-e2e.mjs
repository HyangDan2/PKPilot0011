import { chromium } from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
vm.runInThisContext(fs.readFileSync('/workspace/repos/PKPilot0015/public/lz-string.min.js','utf8'));
vm.runInThisContext(fs.readFileSync('/workspace/repos/PKPilot0015/public/shutterframe.js','utf8'));
const spec = JSON.parse(fs.readFileSync('/workspace/downloads/dark-cinema.shutterframe.json','utf8'));
const ENC = globalThis.ShutterFrame.encode(spec);
const browser = await chromium.launch({ executablePath: '/workspace/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args:['--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:900} });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await page.goto(`https://hyangdan2.github.io/PKPilot0003/?v=${Date.now()}#frame=${ENC}`, {waitUntil:'networkidle'});
await page.waitForTimeout(1500);
console.log('after load', await page.evaluate(() => ({
  hash: location.hash.length,
  decoded: (()=>{try{return window.ShutterFrame.fromUrl(location.href)?.name}catch(e){return 'E'+e.message}})(),
  active: window.SPApp?.activeCustom?.()?.name ?? null,
  style: window.SPApp?.state?.style,
  view: window.SPApp?.state?.view,
  list: window.SPApp?.customFrames?.().map(f=>f.name),
})));
await page.setInputFiles('#wsFileInput', [
 '/workspace/repos/PKPilot0011/public/samples/sample-01.jpg',
 '/workspace/repos/PKPilot0011/public/samples/film_test_portrait.jpg',
 '/workspace/repos/PKPilot0011/public/samples/landscape_test.png',
 '/workspace/repos/PKPilot0011/public/samples/portrait_test.png',
]);
await page.waitForTimeout(2500);
console.log('after photos', await page.evaluate(() => ({
  active: window.SPApp?.activeCustom?.()?.name ?? null,
  style: window.SPApp?.state?.style,
  view: window.SPApp?.state?.view,
  media: window.SPApp?.state?.media?.length,
  slots: window.SPApp?.slotFilledCount?.(),
  plate: (()=>{const L=window.SPApp?.currentLayout?.();return L?`${L.W}x${L.H} custom=${!!L.custom}`:null})(),
})));
console.log('errors', errs);
await browser.close();
