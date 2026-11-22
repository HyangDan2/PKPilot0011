export type ContainerKind = 'mp4' | 'webm';
export type VideoCodecName = 'avc' | 'vp9' | 'vp8' | 'av1';
export type AudioCodecName = 'aac' | 'opus';

export interface EncodePlan {
  container: ContainerKind;
  video: VideoCodecName;
  /** null when this plan has to stay silent. */
  audio: AudioCodecName | null;
}

export type VideoProbe = (codec: VideoCodecName, width: number, height: number) => Promise<boolean>;
export type AudioProbe = (codec: AudioCodecName, sampleRate: number, channels: number) => Promise<boolean>;

/** The audio track as the decoder reports it — the probe has to use these. */
export interface AudioFormat {
  sampleRate: number;
  channels: number;
}

export interface PlanRequest {
  /** Null when the clip has no audio track at all (or the visitor muted it). */
  audio: AudioFormat | null;
}

export const VIDEO_CODEC_ORDER: VideoCodecName[] = ['avc', 'vp9', 'vp8', 'av1'];

interface Candidate {
  container: ContainerKind;
  video: VideoCodecName;
  audio: AudioCodecName | null;
}

/**
 * The order is a promise, not a preference: sound comes before container shape.
 *
 * The first two lines are the ones that matter, and they are chosen so the
 * export keeps its audio on every platform that can encode it at all:
 *
 *  1. H.264 + AAC in MP4 — plays in every gallery, phone and desktop.
 *  2. Opus in MP4 — Android Chrome encodes Opus but not always AAC, and Opus
 *     rides in MP4 unchanged for anything that reads the ISO box (Chrome,
 *     Android 10+). Silent video is a bug the visitor already reported, so a
 *     plan with sound beats a prettier extension without it.
 *  3. VP9/VP8 + Opus in WebM — the classic web fallback when there is no H.264.
 *  4. A silent MP4 — still better than nothing when no audio encoder exists.
 *
 * mediabunny's own container support is what makes 2 legal: `Mp4OutputFormat`
 * lists every non-PCM audio codec (AAC and Opus included) and `WebMOutputFormat`
 * lists Opus/Vorbis.
 */
const CANDIDATES: Candidate[] = [
  { container: 'mp4', video: 'avc', audio: 'aac' },
  { container: 'mp4', video: 'avc', audio: 'opus' },
  { container: 'webm', video: 'vp9', audio: 'opus' },
  { container: 'webm', video: 'vp8', audio: 'opus' },
  { container: 'mp4', video: 'avc', audio: null },
  { container: 'mp4', video: 'av1', audio: 'aac' },
  { container: 'mp4', video: 'av1', audio: 'opus' },
  { container: 'mp4', video: 'av1', audio: null },
  { container: 'webm', video: 'vp9', audio: null },
  { container: 'webm', video: 'vp8', audio: null },
];

/**
 * Choose an encoder/container pair the browser can actually run, probing with
 * the clip's real audio format (48000 Hz stereo used to be assumed, and a mono
 * track then failed the probe and came out silent).
 */
export async function pickEncodePlan(
  canVideo: VideoProbe,
  canAudio: AudioProbe,
  width: number,
  height: number,
  audio: AudioFormat | null = { sampleRate: 48000, channels: 2 },
): Promise<EncodePlan | null> {
  const format: AudioFormat = {
    sampleRate: Math.max(8000, Math.round(audio?.sampleRate || 48000)),
    channels: Math.min(2, Math.max(1, Math.round(audio?.channels || 2))),
  };
  for (const candidate of CANDIDATES) {
    if (!(await canVideo(candidate.video, width, height))) continue;
    if (candidate.audio) {
      if (!audio) continue;
      if (!(await canAudio(candidate.audio, format.sampleRate, format.channels))) continue;
    }
    return { container: candidate.container, video: candidate.video, audio: candidate.audio };
  }
  return null;
}

/** Long-edge target per export preset; never upscales past the source. */
export function exportDimensions(
  resolution: 'source' | '1080p' | '720p',
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const sw = Math.max(2, Math.round(sourceWidth));
  const sh = Math.max(2, Math.round(sourceHeight));
  const longEdge = Math.max(sw, sh);
  const target = resolution === 'source' ? longEdge : resolution === '1080p' ? 1920 : 1280;
  const scale = Math.min(1, target / longEdge);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(sw), height: even(sh) };
}

/** H.264 (and every hardware block behind it) refuses an odd width or height. */
export function evenSize(value: number, floor = 2): number {
  const n = Math.max(floor, Math.round(value));
  return n % 2 === 0 ? n : n - 1;
}

/** Long-edge cap for the finished plate, per preset. */
export function plateEdgeCap(resolution: 'source' | '1080p' | '720p', maxTextureSize = 4096): number {
  if (resolution === '720p') return 1280;
  if (resolution === '1080p') return 1920;
  return Math.max(1920, Math.min(3840, Math.round(maxTextureSize)));
}

/** Timestamps (seconds from the clip start) for a trimmed export. */
export function frameTimestamps(start: number, end: number, fps: number): number[] {
  const safeFps = Math.min(60, Math.max(1, Math.round(fps)));
  const from = Math.max(0, start);
  const to = Math.max(from, end);
  const duration = to - from;
  if (duration <= 0) return [];
  const count = Math.max(1, Math.round(duration * safeFps));
  const step = duration / count;
  return Array.from({ length: count }, (_, i) => from + i * step);
}

export function fileExtension(plan: EncodePlan): string {
  return plan.container === 'mp4' ? 'mp4' : 'webm';
}

export function outputFileName(sourceName: string, extension: string): string {
  const stem = sourceName.replace(/\.[^.]+$/, '') || 'clip';
  return `${stem}-CinePlate.${extension}`;
}

/**
 * Fit the finished plate (margins and copy band included) into the preset's
 * cap and onto the even pixel grid, by shrinking the photograph the frame is
 * wrapped around. A plate that came out 4098px wide or 1081px high is what
 * made H.264's encoder throw "An error occurred" mid-export.
 */
export function clampPlateSize<L extends { W: number; H: number }>(input: {
  photo: { width: number; height: number };
  cap: number;
  layoutFor: (photo: { width: number; height: number }) => L;
  minPhoto?: number;
}): { photo: { width: number; height: number }; layout: L } {
  const minPhoto = input.minPhoto ?? 64;
  let photo = {
    width: Math.max(minPhoto, Math.round(input.photo.width)),
    height: Math.max(minPhoto, Math.round(input.photo.height)),
  };
  let layout = input.layoutFor(photo);
  for (let pass = 0; pass < 4; pass += 1) {
    const long = Math.max(layout.W, layout.H);
    const shrink = long > input.cap ? input.cap / long : 1;
    const evenPick = (n: number) => Math.max(minPhoto, Math.round(n * shrink));
    const next = { width: evenPick(photo.width), height: evenPick(photo.height) };
    if (shrink >= 0.999) break;
    photo = next;
    layout = input.layoutFor(photo);
  }
  return { photo, layout };
}
