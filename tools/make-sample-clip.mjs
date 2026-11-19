#!/usr/bin/env node
/**
 * Builds public/samples/sample-clip.mp4 — the one-click demo clip.
 *
 * Two photographic stills get a slow Ken Burns move, a gentle exposure drift and
 * a soft ambient bed, so the sample exercises everything the video pipeline
 * cares about: colour, motion, a real H.264 stream and an AAC audio track.
 *
 * Requires a full ffmpeg (libx264 + aac) on PATH, or FFMPEG=/path/to/ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const a = resolve(root, 'public/samples/sample-01.jpg');
const b = resolve(root, 'public/samples/sample-02.jpg');
const out = resolve(root, 'public/samples/sample-clip.mp4');

for (const file of [a, b]) {
  if (!existsSync(file)) throw new Error(`missing sample still: ${file}`);
}

const graph = [
  // Shot A — a slow push in on the landscape.
  `[0:v]scale=1920:-2,crop=1920:1080,zoompan=z='min(1.0+on*0.0009,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+sin(on/40)*10':d=105:s=1280x720:fps=30,setsar=1[a]`,
  // Shot B — a lateral drift on the portrait.
  `[1:v]scale=2400:-2,crop=1920:1080,zoompan=z='1.12':x='iw/2-(iw/zoom/2)+on*0.35':y='ih/2-(ih/zoom/2)':d=105:s=1280x720:fps=30,setsar=1[b]`,
  `[a][b]xfade=transition=fade:duration=0.8:offset=2.7,eq=brightness='0.012*sin(2*PI*t/5.6)':saturation=1.05:contrast=1.02,format=yuv420p[v]`,
  // A quiet room tone: pink noise bed plus a low two-note drone.
  `anoisesrc=color=pink:sample_rate=48000:amplitude=0.05:duration=6.2,lowpass=f=1400,volume=0.55[n]`,
  `sine=frequency=110:sample_rate=48000:duration=6.2[s1]`,
  `sine=frequency=164.81:sample_rate=48000:duration=6.2[s2]`,
  `[s1][s2]amix=inputs=2:duration=longest,volume=0.05[d]`,
  `[n][d]amix=inputs=2:duration=longest,afade=t=in:st=0:d=0.8,afade=t=out:st=4.9:d=1.2[aout]`,
].join(';');

const args = [
  '-y',
  '-loop', '1', '-t', '3.9', '-i', a,
  '-loop', '1', '-t', '3.9', '-i', b,
  '-filter_complex', graph,
  '-map', '[v]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-profile:v', 'high',
  '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60',
  '-c:a', 'aac', '-b:a', '96k', '-ar', '48000',
  '-movflags', '+faststart', '-shortest',
  out,
];

const result = spawnSync(ffmpeg, args, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`wrote ${out}`);
