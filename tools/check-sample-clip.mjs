#!/usr/bin/env node
/**
 * Measures public/samples/sample-clip.mp4 the way a visitor's phone hears and
 * sees it: Chromium decodes the sound track, mediabunny reads the container for
 * the picture's size, rate and length.
 *
 *   npm run check-sample-clip
 *
 * Exits non-zero when the sample no longer carries sound a phone speaker can
 * play (peak < 0.4) or its picture changed (1280×720, 30 fps, ~6.2 s).
 */
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'public/samples/sample-clip.mp4');
const bytes = await readFile(file);

// ── the container: the picture must be exactly the clip it always was ────────
const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes], { type: 'video/mp4' })) });
const videoTrack = await input.getPrimaryVideoTrack();
const audioTrack = await input.getPrimaryAudioTrack();
if (!videoTrack) throw new Error('the sample has no video track');
const metrics = await videoTrack.computeFrameRateMetrics({ targetPacketCount: 60 });
const video = {
  width: videoTrack.displayWidth,
  height: videoTrack.displayHeight,
  duration: await videoTrack.computeDuration(),
  rate: metrics.underlyingFrameRate ?? metrics.bestGuessFrameRate ?? metrics.medianFrameRate ?? -1,
  codec: await videoTrack.getCodec(),
  audioCodec: (await audioTrack?.getCodec()) ?? null,
};
input.dispose();

// ── the sound: a real decode, measured sample by sample ─────────────────────
const server = http.createServer((request, response) => {
  if (request.url?.startsWith('/clip')) {
    response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(bytes.length) });
    response.end(bytes);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><meta charset="utf-8"><title>sample check</title><body>sample check</body>');
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const { port } = server.address();

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
let audio;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  audio = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
    const ctx = new AudioContext();
    try {
      const decoded = await ctx.decodeAudioData(buffer.buffer);
      let peak = 0;
      let sum = 0;
      let count = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        for (let i = 0; i < data.length; i += 1) {
          const magnitude = Math.abs(data[i]);
          if (magnitude > peak) peak = magnitude;
          sum += data[i] * data[i];
          count += 1;
        }
      }
      const rms = Math.sqrt(sum / Math.max(1, count));
      return {
        peak,
        rms,
        peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
        rmsDb: 20 * Math.log10(Math.max(rms, 1e-9)),
        seconds: decoded.duration,
        channels: decoded.numberOfChannels,
      };
    } finally {
      await ctx.close();
    }
  }, bytes.toString('base64'));
} finally {
  await browser.close();
  server.close();
}

console.log(`[audio] peak=${audio.peak.toFixed(4)} (${audio.peakDb.toFixed(1)} dBFS) rms=${audio.rms.toFixed(4)} (${audio.rmsDb.toFixed(1)} dBFS) ${audio.channels}ch ${audio.seconds.toFixed(2)}s · ${video.audioCodec}`);
console.log(`[video] ${video.width}x${video.height} ${video.rate.toFixed(2)}fps ${video.duration.toFixed(2)}s · ${video.codec}`);

const problems = [];
if (!video.audioCodec) problems.push('no audio track');
if (audio.peak < 0.4) problems.push(`audio peak ${audio.peak.toFixed(4)} < 0.4`);
if (audio.rmsDb < -20) problems.push(`audio rms ${audio.rmsDb.toFixed(1)} dBFS is too quiet`);
if (audio.seconds < 6 || audio.seconds > 6.5) problems.push(`audio length ${audio.seconds.toFixed(2)}s`);
if (video.width !== 1280 || video.height !== 720) problems.push(`picture ${video.width}x${video.height}`);
if (video.duration < 6 || video.duration > 6.5) problems.push(`picture length ${video.duration.toFixed(2)}s`);
if (video.rate > 0 && Math.abs(video.rate - 30) > 1.5) problems.push(`rate ${video.rate.toFixed(2)}fps`);
if (problems.length) {
  console.error(`FAIL: ${problems.join(' · ')}`);
  process.exitCode = 1;
} else {
  console.log('PASS: the sample carries audible sound and its 1280×720 / 30fps / 6.2s picture is intact');
}
