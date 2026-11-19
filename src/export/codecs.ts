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

export const VIDEO_CODEC_ORDER: VideoCodecName[] = ['avc', 'vp9', 'vp8', 'av1'];
const CONTAINER_FOR: Record<VideoCodecName, ContainerKind> = { avc: 'mp4', vp9: 'webm', vp8: 'webm', av1: 'mp4' };

/**
 * Choose an encoder/container pair the browser can actually run.
 *
 * H.264 in MP4 is preferred because it plays everywhere including iOS Photos.
 * When the platform has no AAC encoder the clip is still exported as H.264,
 * silently, rather than dropping to a WebM a phone cannot hand to a photo
 * album; only if there is no H.264 at all does the studio produce VP9/VP8 WebM.
 */
export async function pickEncodePlan(
  canVideo: VideoProbe,
  canAudio: AudioProbe,
  width: number,
  height: number,
  sampleRate = 48000,
  channels = 2,
): Promise<EncodePlan | null> {
  for (const video of VIDEO_CODEC_ORDER) {
    if (!(await canVideo(video, width, height))) continue;
    const container = CONTAINER_FOR[video];
    const audioOrder: AudioCodecName[] = container === 'mp4' ? ['aac'] : ['opus'];
    for (const audio of audioOrder) {
      if (await canAudio(audio, sampleRate, channels)) {
        return { container, video, audio };
      }
    }
    return { container, video, audio: null };
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
  return `${stem}-HD2Lab.${extension}`;
}
