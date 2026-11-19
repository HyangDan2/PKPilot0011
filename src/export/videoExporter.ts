import type { TrimRange } from '../types/studio';
import {
  exportDimensions,
  fileExtension,
  frameTimestamps,
  outputFileName,
  pickEncodePlan,
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
  /**
   * Draw the plate for one frame into `out`. The callback owns the canvas size:
   * it must set `out.width/height` on the first call so the encoder is
   * configured for the exact plate the user is exporting.
   */
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
 * Render every frame of the trimmed range into the plate canvas, encode it with
 * WebCodecs (H.264 when the platform allows, VP9/VP8 otherwise) and mux it with
 * the original audio into MP4 or WebM. Falls back to MediaRecorder when the
 * browser has no VideoEncoder at all.
 */
export async function exportVideo(job: VideoExportJob): Promise<VideoExportResult> {
  const target = exportDimensions(job.resolution, job.sourceWidth, job.sourceHeight);
  const timestamps = frameTimestamps(job.range.start, job.range.end, job.fps);
  if (!timestamps.length) throw new Error('내보낼 구간이 없습니다.');

  if (typeof VideoEncoder === 'undefined') {
    return exportWithMediaRecorder(job, timestamps, '이 브라우저에 WebCodecs가 없어 MediaRecorder로 내보냅니다.');
  }

  const mediabunny = await import('mediabunny');
  const {
    Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget,
    CanvasSource, AudioBufferSource, Input, ALL_FORMATS, BlobSource,
    VideoSampleSink, AudioBufferSink, QUALITY_HIGH, canEncodeVideo, canEncodeAudio,
  } = mediabunny;

  const plan = await pickEncodePlan(
    (codec, width, height) => canEncodeVideo(codec, { width, height, quality: QUALITY_HIGH, frameRate: job.fps }).catch(() => false),
    (codec, sampleRate, channels) => canEncodeAudio(codec, { sampleRate, numberOfChannels: channels, quality: QUALITY_HIGH }).catch(() => false),
    target.width,
    target.height,
  );
  if (!plan) {
    return exportWithMediaRecorder(job, timestamps, '이 브라우저가 지원하는 영상 인코더가 없어 MediaRecorder로 내보냅니다.');
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.file) });
  const canvas = document.createElement('canvas');
  const out = new Output({
    format: plan.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  let videoSource: InstanceType<typeof CanvasSource> | null = null;
  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  let audioTrack: Awaited<ReturnType<typeof input.getPrimaryAudioTrack>> = null;
  let audioBuffers: InstanceType<typeof AudioBufferSink> | null = null;
  let note: string | undefined;

  try {
    job.onProgress?.({ phase: 'prepare', current: 0, total: timestamps.length, message: '첫 프레임을 준비하는 중…' });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('영상 트랙을 찾을 수 없습니다.');

    // The first plate render fixes the canvas size the encoder will use.
    await job.renderFrame(null, timestamps[0], canvas);
    throwIfAborted(job.signal);

    videoSource = new CanvasSource(canvas, { codec: plan.video, quality: QUALITY_HIGH, keyFrameInterval: 2 });
    out.addVideoTrack(videoSource);

    if (job.includeAudio && plan.audio) {
      audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        audioBuffers = new AudioBufferSink(audioTrack);
        audioSource = new AudioBufferSource({ codec: plan.audio, quality: QUALITY_HIGH });
        out.addAudioTrack(audioSource);
      }
    } else if (job.includeAudio && !plan.audio) {
      note = '이 브라우저에는 AAC 인코더가 없어 소리 없이 저장합니다.';
    }

    await out.start();

    const sink = new VideoSampleSink(track);
    const duration = 1 / Math.max(1, job.fps);
    let index = 0;
    // Decode the trim once, in order, and hold each decoded frame for every
    // output timestamp that falls before the next one. A random-access lookup
    // per timestamp re-seeks the decoder and turns a 6s clip into a 2-minute
    // export; a sequential pass keeps it near real time.
    for await (const sample of sink.samples(job.range.start, job.range.end)) {
      throwIfAborted(job.signal);
      const nextTimestamp = sample.timestamp + (sample.duration || duration);
      while (index < timestamps.length && timestamps[index] < nextTimestamp - 1e-6) {
        const seconds = timestamps[index];
        await job.renderFrame(sample.toCanvasImageSource(), seconds, canvas);
        await videoSource.add(Math.max(0, seconds - job.range.start), duration);
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
      await videoSource.add(Math.max(0, seconds - job.range.start), duration);
      index += 1;
    }

    if (audioSource && audioBuffers) {
      job.onProgress?.({ phase: 'audio', current: 0, total: 1, message: '원본 오디오를 결합하는 중…' });
      try {
        for await (const wrapped of audioBuffers.buffers(job.range.start, job.range.end)) {
          throwIfAborted(job.signal);
          if (wrapped?.buffer) await audioSource.add(wrapped.buffer);
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

/** Last-resort path: real-time capture of the plate canvas. */
async function exportWithMediaRecorder(
  job: VideoExportJob,
  timestamps: number[],
  note: string,
): Promise<VideoExportResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('이 브라우저에서는 영상 내보내기를 지원하지 않습니다.');
  const canvas = document.createElement('canvas');
  await job.renderFrame(null, timestamps[0], canvas);
  const fps = Math.min(30, Math.max(12, Math.round(job.fps)));
  const stream = canvas.captureStream(fps);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };

  const video = document.createElement('video');
  video.src = URL.createObjectURL(job.file);
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('영상을 다시 열지 못했습니다.'));
    setTimeout(() => resolve(), 4000);
  });

  await new Promise<void>((resolve) => {
    video.currentTime = job.range.start;
    video.onseeked = () => resolve();
    setTimeout(() => resolve(), 800);
  });

  recorder.start(250);
  const begin = performance.now();
  const duration = job.range.end - job.range.start;
  await new Promise<void>((resolve) => {
    const tick = async () => {
      const elapsed = (performance.now() - begin) / 1000;
      if (elapsed >= duration || job.signal?.aborted) {
        resolve();
        return;
      }
      video.currentTime = Math.min(job.range.end, job.range.start + elapsed);
      await job.renderFrame(video, job.range.start + elapsed, canvas);
      job.onProgress?.({
        phase: 'fallback', current: Math.round(elapsed * 10), total: Math.round(duration * 10),
        message: '빠른 내보내기(MediaRecorder)로 녹화 중…',
      });
      requestAnimationFrame(() => void tick());
    };
    void tick();
  });
  recorder.stop();
  await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  URL.revokeObjectURL(video.src);
  stream.getTracks().forEach((track) => track.stop());
  if (job.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  return {
    blob: new Blob(chunks, { type: mime || 'video/webm' }),
    filename: outputFileName(job.file.name, 'webm'),
    mode: 'mediarecorder',
    plan: null,
    note,
  };
}
