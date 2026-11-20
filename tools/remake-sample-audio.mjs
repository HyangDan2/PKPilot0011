#!/usr/bin/env node
/**
 * Rebuilds the sound track of public/samples/sample-clip.mp4 — the one-click
 * demo clip — without touching its picture.
 *
 * The old bed was a 1%-amplitude tone: peak 0.0101 (-39.9 dBFS), RMS 0.0024
 * (-52.4 dBFS), which is silence to any phone speaker. A test that only asked
 * for "> 0.005" passed it, and visitors heard nothing at all.
 *
 * This tool keeps the H.264 stream exactly as it is (packets are copied, not
 * re-encoded) and replaces the AAC track with a soft ambient chord that is
 * plainly audible on a phone speaker: peak around -4 dBFS, RMS around -13 dBFS,
 * with a fade in and out.
 *
 * No ffmpeg needed — mediabunny muxes in Node and its AAC encoder extension
 * (libavcodec via WebAssembly) does the encoding.
 *
 *   npm run make-sample-audio
 *
 * Options:
 *   --dry-run   measure the generated tone and the current file, write nothing
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';

registerAacEncoder();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public/samples/sample-clip.mp4');
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const DURATION = 6.2;
const PEAK_TARGET = 0.66;
const RMS_TARGET_DB = -13.5;

/** A gentle A-major add9 pad: warm, in tune, and obvious on a tiny speaker. */
function ambientChord(seconds, sampleRate) {
  const frames = Math.round(seconds * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  // A2, A3, C#4, E4, A4, C#5 — the fifth and the ninth carry the "pleasant".
  const voices = [
    { hz: 110.0, gain: 0.34, pan: -0.10, rate: 0.20 },
    { hz: 220.0, gain: 0.26, pan: 0.12, rate: 0.17 },
    { hz: 277.18, gain: 0.17, pan: 0.32, rate: 0.23 },
    { hz: 329.63, gain: 0.15, pan: -0.28, rate: 0.19 },
    { hz: 440.0, gain: 0.10, pan: 0.24, rate: 0.26 },
    { hz: 554.37, gain: 0.06, pan: -0.22, rate: 0.29 },
  ];
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    // A slow swell, so the bed breathes instead of sitting flat.
    const swell = 0.72 + 0.28 * Math.sin(2 * Math.PI * 0.22 * t - Math.PI / 2);
    let l = 0;
    let r = 0;
    for (const voice of voices) {
      // Two detuned oscillators per voice: a beat that reads as a pad, not a beep.
      const detune = 1 + 0.0015;
      const mod = 0.85 + 0.15 * Math.sin(2 * Math.PI * voice.rate * t);
      const base = Math.sin(2 * Math.PI * voice.hz * t);
      const wide = Math.sin(2 * Math.PI * voice.hz * detune * t + 0.6) * 0.45;
      const value = (base + wide) * voice.gain * mod * swell;
      const pan = (voice.pan + 1) / 2;
      l += value * (1 - pan) * 1.35;
      r += value * pan * 1.35;
    }
    // A soft low pulse every 1.55s keeps a sense of time under the pad.
    const pulse = Math.exp(-((t % 1.55) * 6.5)) * 0.16
      * Math.sin(2 * Math.PI * 55 * t);
    l += pulse;
    r += pulse;
    // Fades: 0.6s in, 1.2s out, so the clip never clicks at either end.
    const fadeIn = Math.min(1, t / 0.6);
    const fadeOut = Math.min(1, Math.max(0, (seconds - t) / 1.2));
    const envelope = Math.pow(fadeIn, 1.4) * Math.pow(fadeOut, 1.2);
    left[i] = l * envelope;
    right[i] = r * envelope;
  }
  return { left, right, frames };
}

function stats(channels, frames) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const data of channels) {
    for (let i = 0; i < frames; i += 1) {
      const value = data[i];
      if (!Number.isFinite(value)) throw new Error('generated a non-finite sample');
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
      sum += value * value;
      count += 1;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  return { peak, rms, peakDb: 20 * Math.log10(Math.max(peak, 1e-9)), rmsDb: 20 * Math.log10(Math.max(rms, 1e-9)) };
}

/** Level the bed: hit the RMS target, then keep the peak under the ceiling. */
function level(channels, frames) {
  const before = stats(channels, frames);
  const rmsGain = Math.pow(10, RMS_TARGET_DB / 20) / Math.max(before.rms, 1e-9);
  let gain = rmsGain;
  const peaked = stats(channels.map((data) => data.map((value) => value * gain)), frames);
  if (peaked.peak > PEAK_TARGET) gain *= PEAK_TARGET / peaked.peak;
  for (const data of channels) {
    for (let i = 0; i < frames; i += 1) data[i] *= gain;
  }
  return gain;
}

/** Measurements the muxed file must beat; also used as the tool's own check. */
export function measurePcm(channels, frames) {
  return stats(channels, frames);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { left, right, frames } = ambientChord(DURATION, SAMPLE_RATE);
  const channels = [left, right];
  const gain = level(channels, frames);
  const tone = stats(channels, frames);
  console.log(`[tone] gain=${gain.toFixed(3)} peak=${tone.peak.toFixed(3)} (${tone.peakDb.toFixed(1)} dBFS) rms=${tone.rms.toFixed(3)} (${tone.rmsDb.toFixed(1)} dBFS)`);
  if (tone.peak < 0.55 || tone.peak > 0.75) throw new Error(`peak ${tone.peak} outside 0.55..0.75`);
  if (tone.rmsDb < -16 || tone.rmsDb > -12) throw new Error(`rms ${tone.rmsDb} outside -16..-12 dBFS`);

  const before = await readFile(target);
  console.log(`[source] ${target} ${before.length} bytes`);
  if (dryRun) return;

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([before], { type: 'video/mp4' })) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('the sample has no video track to keep');
  const videoInfo = {
    codec: await videoTrack.getCodec(),
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    duration: await videoTrack.computeDuration(),
  };
  console.log(`[video] ${JSON.stringify(videoInfo)}`);
  const decoderConfig = await videoTrack.getDecoderConfig();
  if (!decoderConfig) throw new Error('no decoder config for the video track');

  const videoSource = new EncodedVideoPacketSource(videoInfo.codec);
  const audioSource = new AudioSampleSource({
    codec: 'aac',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: CHANNELS,
    bitrate: 128_000,
  });

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  output.addVideoTrack(videoSource, { frameRate: 30 });
  output.addAudioTrack(audioSource, { sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS });
  await output.start();

  // ── picture: copy every packet as it is, so not a single pixel is re-encoded ──
  const sink = new EncodedPacketSink(videoTrack);
  let packets = 0;
  for await (const packet of sink.packets()) {
    await videoSource.add(packet, packets === 0 ? { decoderConfig } : undefined);
    packets += 1;
  }
  console.log(`[video] copied ${packets} packets`);

  // ── sound: hand the encoder the pad in 1024-frame chunks ──
  const block = 1024;
  for (let start = 0; start < frames; start += block) {
    const length = Math.min(block, frames - start);
    const planar = new Float32Array(CHANNELS * length);
    planar.set(left.subarray(start, start + length), 0);
    planar.set(right.subarray(start, start + length), length);
    const sample = new AudioSample({
      data: planar,
      format: 'f32-planar',
      numberOfChannels: CHANNELS,
      sampleRate: SAMPLE_RATE,
      timestamp: start / SAMPLE_RATE,
    });
    await audioSource.add(sample);
    sample.close();
  }

  await output.finalize();
  const bytes = new Uint8Array(output.target.buffer);
  if (!bytes.byteLength) throw new Error('the muxer produced an empty file');
  await writeFile(target, bytes);
  console.log(`[wrote] ${target} ${bytes.byteLength} bytes`);
  input.dispose();
}

await main();
