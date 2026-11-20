import type { TrimRange } from '../types/studio';
import {
  fileExtension,
  frameTimestamps,
  outputFileName,
  pickEncodePlan,
  type AudioFormat,
  type EncodePlan,
} from './codecs';

export interface ExportProgress {
  phase: 'prepare' | 'render' | 'audio' | 'finalize' | 'fallback';
  current: number;
  total: number;
  message: string;
}

export interface VideoExportJob {
  file: File;
  range: TrimRange;
  fps: number;
  resolution: 'source' | '1080p' | '720p';
  sourceWidth: number;
  sourceHeight: number;
  includeAudio: boolean;
  /** The finished plate size, margins and copy band included — always even. */
  outputWidth: number;
  outputHeight: number;
  /** Draw one plate frame into `out` (already the export size). */
  renderFrame: (source: CanvasImageSource | null, seconds: number, out: HTMLCanvasElement) => Promise<void>;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  filename: string;
  mode: 'webcodecs' | 'mediarecorder';
  plan: EncodePlan | null;
  note?: string;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

/**
 * The first decoded buffer can begin a little before the trim start. The audio
 * source lays buffers end to end from its own zero, so that surplus would push
 * every later sample late; the head is trimmed off instead.
 */
function trimHead(buffer: AudioBuffer, offsetSeconds: number): AudioBuffer {
  const offset = Math.round(Math.max(0, offsetSeconds) * buffer.sampleRate);
  if (offset <= 0) return buffer;
  if (offset >= buffer.length) return buffer;
  try {
    const length = buffer.length - offset;
    const copy = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const from = buffer.getChannelData(channel).subarray(offset);
      copy.getChannelData(channel).set(from);
    }
    return copy;
  } catch {
    // No AudioBuffer constructor on this platform: the few ms of slip is
    // better than losing the track.
    return buffer;
  }
}

/** Draw the current sample, honouring the clip's rotation/flip metadata. */
function sampleSource(
  sample: { toCanvasImageSource(): CanvasImageSource; draw?: (...args: never[]) => void; rotation?: number; flip?: boolean; displayWidth: number; displayHeight: number },
  scratch: { canvas: HTMLCanvasElement },
): CanvasImageSource {
  const rotated = (sample.rotation ?? 0) % 360 !== 0 || sample.flip;
  if (!rotated || typeof sample.draw !== 'function') return sample.toCanvasImageSource();
  const width = Math.max(2, Math.round(sample.displayWidth));
  const height = Math.max(2, Math.round(sample.displayHeight));
  if (scratch.canvas.width !== width || scratch.canvas.height !== height) {
    scratch.canvas.width = width;
    scratch.canvas.height = height;
  }
  const ctx = scratch.canvas.getContext('2d');
  if (!ctx || !sample.draw) return sample.toCanvasImageSource();
  ctx.clearRect(0, 0, width, height);
  (sample.draw as unknown as (
    context: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number,
  ) => void)(ctx, 0, 0, width, height);
  return scratch.canvas;
}

/**
 * Render every frame of the trimmed range into the plate canvas, encode it with
 * WebCodecs (H.264 when the platform allows, Opus/AAC for the sound) and mux it
 * with the original audio into MP4 or WebM. Falls back to MediaRecorder when the
 * browser has no working VideoEncoder.
 */
export async function exportVideo(job: VideoExportJob): Promise<VideoExportResult> {
  const timestamps = frameTimestamps(job.range.start, job.range.end, job.fps);
  if (!timestamps.length) throw new Error('내보낼 구간이 없습니다.');
  const width = Math.max(2, Math.round(job.outputWidth));
  const height = Math.max(2, Math.round(job.outputHeight));

  if (typeof VideoEncoder === 'undefined') {
    return exportWithMediaRecorder(job, timestamps, '이 브라우저에 WebCodecs가 없어 MediaRecorder로 내보냅니다.');
  }

  const mediabunny = await import('mediabunny');
  const {
    Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget,
    CanvasSource, AudioBufferSource, Input, ALL_FORMATS, BlobSource,
    VideoSampleSink, AudioBufferSink, QUALITY_HIGH, canEncodeVideo, canEncodeAudio,
  } = mediabunny;

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.file) });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  let plan: EncodePlan | null = null;
  let track: Awaited<ReturnType<typeof input.getPrimaryVideoTrack>> = null;
  let audioTrack: Awaited<ReturnType<typeof input.getPrimaryAudioTrack>> = null;
  let audioFormat: AudioFormat | null = null;
  let note: string | undefined;

  try {
    job.onProgress?.({ phase: 'prepare', current: 0, total: timestamps.length, message: '첫 프레임을 준비하는 중…' });
    track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('영상 트랙을 찾을 수 없습니다.');

    if (job.includeAudio) {
      audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        audioFormat = {
          sampleRate: audioTrack.sampleRate || 48000,
          channels: Math.min(2, Math.max(1, audioTrack.numberOfChannels || 2)),
        };
      }
    }

    // The probe runs at the exact plate size the encoder will be handed: a
    // margin or copy band can push a 1080p preset past 4000px, and an odd
    // pixel is enough for H.264 to refuse the whole export.
    plan = await pickEncodePlan(
      (codec, w, h) => canEncodeVideo(codec, { width: w, height: h, quality: QUALITY_HIGH, frameRate: job.fps }).catch(() => false),
      (codec, sampleRate, channels) => canEncodeAudio(codec, { sampleRate, numberOfChannels: channels, quality: QUALITY_HIGH }).catch(() => false),
      width,
      height,
      audioFormat,
    );
    if (!plan) {
      return exportWithMediaRecorder(job, timestamps, '이 브라우저가 지원하는 영상 인코더가 없어 MediaRecorder로 내보냅니다.');
    }
  } catch (error) {
    input.dispose();
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return exportWithMediaRecorder(job, timestamps, `영상 분석 실패(${error instanceof Error ? error.message : '오류'})로 MediaRecorder로 내보냅니다.`);
  }
  if (!plan || !track) {
    input.dispose();
    return exportWithMediaRecorder(job, timestamps, '영상 트랙을 읽지 못해 MediaRecorder로 내보냅니다.');
  }

  const out = new Output({
    format: plan.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  let videoSource: InstanceType<typeof CanvasSource> | null = null;
  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  let audioBuffers: InstanceType<typeof AudioBufferSink> | null = null;

  try {
    await job.renderFrame(null, timestamps[0], canvas);
    throwIfAborted(job.signal);

    videoSource = new CanvasSource(canvas, { codec: plan.video, quality: QUALITY_HIGH, keyFrameInterval: 2 });
    out.addVideoTrack(videoSource);

    if (job.includeAudio && plan.audio && audioTrack) {
      audioBuffers = new AudioBufferSink(audioTrack);
      audioSource = new AudioBufferSource(
        { codec: plan.audio, quality: QUALITY_HIGH },
        { startTimestamp: 0 },
      );
      out.addAudioTrack(audioSource);
      // AAC is what every gallery app plays. Opus in MP4 is a legal fallback and
      // Chrome plays it, but an Android gallery may show a silent clip — say so
      // instead of letting the visitor find out later.
      if (plan.container === 'mp4' && plan.audio === 'opus') {
        note = '이 브라우저는 MP4 Opus 오디오로 저장됩니다 (일부 기본 갤러리 앱에선 Chrome/VLC 재생 권장).';
      }
    } else if (job.includeAudio && !plan.audio) {
      note = '이 브라우저에는 쓸 수 있는 오디오 인코더가 없어 소리 없이 저장합니다.';
    } else if (job.includeAudio && !audioTrack) {
      note = '원본에 오디오 트랙이 없어 영상만 저장합니다.';
    }

    await out.start();

    const sink = new VideoSampleSink(track);
    const frameDuration = 1 / Math.max(1, job.fps);
    const scratch = { canvas: document.createElement('canvas') };
    let index = 0;
    // Decode the trim once, in order, and hold each decoded frame for every
    // output timestamp that falls before the next one. A random-access lookup
    // per timestamp re-seeks the decoder and turns a 6s clip into a 2-minute
    // export; a sequential pass keeps it near real time.
    for await (const sample of sink.samples(job.range.start, job.range.end)) {
      throwIfAborted(job.signal);
      const nextTimestamp = sample.timestamp + (sample.duration || frameDuration);
      while (index < timestamps.length && timestamps[index] < nextTimestamp - 1e-6) {
        const seconds = timestamps[index];
        await job.renderFrame(sampleSource(sample, scratch), seconds, canvas);
        await videoSource.add(Math.max(0, seconds - job.range.start), frameDuration);
        index += 1;
        if (index % 3 === 0 || index === timestamps.length) {
          job.onProgress?.({
            phase: 'render', current: index, total: timestamps.length,
            message: `프레임 ${index} / ${timestamps.length} 인코딩`,
          });
        }
      }
      sample.close();
      if (index >= timestamps.length) break;
    }
    // Anything left over (a stream shorter than the requested range) is padded
    // with the final plate rather than left as a shortened track.
    while (index < timestamps.length) {
      const seconds = timestamps[index];
      await job.renderFrame(null, seconds, canvas);
      await videoSource.add(Math.max(0, seconds - job.range.start), frameDuration);
      index += 1;
    }

    if (audioSource && audioBuffers) {
      job.onProgress?.({ phase: 'audio', current: 0, total: 1, message: '원본 오디오를 결합하는 중…' });
      try {
        for await (const wrapped of audioBuffers.buffers(job.range.start, job.range.end)) {
          throwIfAborted(job.signal);
          if (!wrapped?.buffer) continue;
          if (wrapped.timestamp > job.range.end) break;
          const head = Math.max(0, job.range.start - wrapped.timestamp);
          await audioSource.add(trimHead(wrapped.buffer, head));
        }
      } catch (error) {
        // A missing or undecodable audio track must never lose the picture.
        note = note ?? `오디오를 결합하지 못했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
      }
    }

    job.onProgress?.({ phase: 'finalize', current: 1, total: 1, message: '파일을 마무리하는 중…' });
    await out.finalize();
    const buffer = out.target.buffer;
    if (!buffer) throw new Error('인코더가 파일을 만들지 못했습니다.');
    const extension = fileExtension(plan);
    return {
      blob: new Blob([buffer], { type: plan.container === 'mp4' ? 'video/mp4' : 'video/webm' }),
      filename: outputFileName(job.file.name, extension),
      mode: 'webcodecs',
      plan,
      note,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    try { await out.cancel(); } catch { /* already cancelled */ }
    return exportWithMediaRecorder(job, timestamps, `WebCodecs 경로 실패(${error instanceof Error ? error.message : '오류'})로 MediaRecorder로 내보냅니다.`);
  } finally {
    try { input.dispose(); } catch { /* nothing to release */ }
  }
}

/** Wait for one media event, but never longer than the timeout. */
function once(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      target.removeEventListener(event, finish);
      resolve();
    };
    target.addEventListener(event, finish);
    window.setTimeout(finish, timeoutMs);
  });
}

/**
 * Last-resort path: real-time capture of the plate canvas.
 *
 * Frames are rendered one at a time, each after its own `seeked` has landed, and
 * the loop is paced by the wall clock so the recorded audio and picture stay in
 * step. The old version fired `requestAnimationFrame` regardless of whether the
 * decoder had answered, queued a second seek behind the first, and handed the
 * recorder a canvas that changed size mid-stream — that is the hang.
 */
async function exportWithMediaRecorder(
  job: VideoExportJob,
  timestamps: number[],
  note: string,
): Promise<VideoExportResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('이 브라우저에서는 영상 내보내기를 지원하지 않습니다.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(job.outputWidth));
  canvas.height = Math.max(2, Math.round(job.outputHeight));
  await job.renderFrame(null, timestamps[0], canvas);

  const fps = Math.min(30, Math.max(12, Math.round(job.fps)));
  const stream = canvas.captureStream(fps);

  const video = document.createElement('video');
  video.src = URL.createObjectURL(job.file);
  video.playsInline = true;
  video.preload = 'auto';
  // The element has to be unmuted for its sound to reach the recorder; the
  // graph below sends it to the recording destination only, not to the speakers.
  video.muted = false;
  video.volume = 1;

  let audioContext: AudioContext | null = null;
  let audioGraph: { source: MediaElementAudioSourceNode; destination: MediaStreamAudioDestinationNode } | null = null;

  try {
    await once(video, 'loadeddata', 6000);
    video.currentTime = job.range.start;
    await once(video, 'seeked', 2000);

    if (job.includeAudio) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          audioContext = new Ctor();
          const source = audioContext.createMediaElementSource(video);
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          audioGraph = { source, destination };
          destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
        }
      } catch {
        note = `${note} 오디오를 녹음에 넣지 못했습니다.`;
      }
    }

    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm']
      .find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    const duration = Math.max(0.1, job.range.end - job.range.start);
    recorder.start(250);
    if (audioContext?.state === 'suspended') await audioContext.resume().catch(() => undefined);
    await video.play().catch(() => undefined);
    const began = performance.now();

    for (let index = 0; index < timestamps.length; index += 1) {
      if (job.signal?.aborted) break;
      const seconds = timestamps[index];
      const target = job.range.start + (seconds - job.range.start);
      if (Math.abs(video.currentTime - target) > 0.02) {
        video.currentTime = target;
        await once(video, 'seeked', 1200);
      }
      // Give the decoder its frame, then paint at the clock's own pace so the
      // recording stays in real time (MediaRecorder captures a live stream).
      await job.renderFrame(video, seconds, canvas);
      job.onProgress?.({
        phase: 'fallback',
        current: Math.min(timestamps.length, index + 1),
        total: timestamps.length,
        message: '빠른 내보내기(MediaRecorder)로 녹화 중…',
      });
      const due = began + ((index + 1) / timestamps.length) * duration * 1000;
      const wait = due - performance.now();
      if (wait > 0) await new Promise<void>((resolve) => { window.setTimeout(resolve, wait); });
    }

    recorder.stop();
    await stopped;
    if (job.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

    return {
      blob: new Blob(chunks, { type: mime || 'video/webm' }),
      filename: outputFileName(job.file.name, 'webm'),
      mode: 'mediarecorder',
      plan: null,
      note: `${note}${job.includeAudio && audioGraph ? '' : ''}`,
    };
  } finally {
    try { video.pause(); } catch { /* already stopped */ }
    URL.revokeObjectURL(video.src);
    audioGraph?.source.disconnect();
    audioGraph?.destination.disconnect();
    await audioContext?.close().catch(() => undefined);
    stream.getTracks().forEach((track) => track.stop());
  }
}
