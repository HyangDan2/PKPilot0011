import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlateLayout, SPEmblemsApi, SPPlateApi } from '../plate/engine';
import { buildPlateLayout, stageTypeBoost, virtualPhotoBox } from '../studio/render';
import { PhotoGrader } from '../studio/grading';
import { IconVolume, IconVolumeOff } from './Icons';
import type { FrameSettings, GradeSettings, MediaInfo, PlateMeta, TrimRange } from '../types/studio';
import { PLATE_BASE_EDGE, PREVIEW_MAX_EDGE, isMultiFrame } from '../types/studio';

export interface MediaBank {
  photos: Map<string, HTMLImageElement>;
  video: HTMLVideoElement | null;
}

interface StageProps {
  plate: SPPlateApi;
  emblems: SPEmblemsApi | null;
  media: MediaInfo[];
  activePhoto: number;
  bank: MediaBank;
  grade: GradeSettings;
  frame: FrameSettings;
  meta: PlateMeta;
  trim: TrimRange;
  playing: boolean;
  showOriginal: boolean;
  inputGuard: 0 | 1;
  revision: number;
  /** True while the source clip plays silently (the browser's autoplay rule). */
  muted: boolean;
  onToggleMute: () => void;
  onTime: (seconds: number) => void;
  onTogglePlay: () => void;
}

function previewGradeSize(media: MediaInfo): { width: number; height: number } {
  const long = Math.max(media.width, media.height);
  const scale = Math.min(1, PREVIEW_MAX_EDGE / long);
  return { width: Math.max(2, Math.round(media.width * scale)), height: Math.max(2, Math.round(media.height * scale)) };
}

const MAX_DPR = 2;

/**
 * The live stage: one WebGL grade canvas feeding the Shutterplate painter, so
 * the preview is exactly the exported frame — filter, margins, emblem and all.
 *
 * The plate is designed at a virtual print size (long edge >= 1200px) and then
 * scaled to whatever room the stage has. On a phone that scale is a third, so
 * the plate is asked for a type boost in the same breath: the copy grows with
 * the band while the photograph keeps its place.
 */
export function Stage(props: StageProps) {
  const { plate, emblems, media, bank, frame, meta, trim, playing, showOriginal, inputGuard, revision, muted, onToggleMute, onTime, onTogglePlay } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graderRef = useRef<PhotoGrader | null>(null);
  const layoutRef = useRef<PlateLayout | null>(null);
  const slotCanvases = useRef<HTMLCanvasElement[]>([]);
  const canvasKey = useRef('');
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [glUnavailable, setGlUnavailable] = useState(false);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [ratio, setRatio] = useState(1.5);
  const cssScale = useRef(1);

  const activeMedia = media[props.activePhoto] ?? media[0] ?? null;
  const video = activeMedia?.kind === 'video' ? bank.video : null;
  const isMulti = isMultiFrame(frame.style) && activeMedia?.kind === 'photo';

  const live = useRef({ grade: props.grade, frame, meta, trim, playing, showOriginal, inputGuard, activeMedia, isMulti });
  live.current = { grade: props.grade, frame, meta, trim, playing, showOriginal, inputGuard, activeMedia, isMulti };

  if (!graderRef.current && typeof document !== 'undefined') {
    graderRef.current = new PhotoGrader();
  }

  /* ── a lost GL context is recoverable: say so, and rebuild on demand ─────── */
  useEffect(() => {
    const canvas = graderRef.current?.canvas;
    if (!canvas) return;
    const onLost = () => {
      setContextLost(true);
      // Repaint at once, so the plate falls back to the ungraded frame instead
      // of staying blank while the visitor reads the notice.
      setContextEpoch((value) => value + 1);
    };
    const onRestored = () => {
      setContextLost(false);
      setContextEpoch((value) => value + 1);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, []);

  useEffect(() => () => {
    graderRef.current?.destroy();
    graderRef.current = null;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    const painter = graderRef.current;
    if (!canvas || !layout) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const scale = cssScale.current * dpr;
    const key = `${layout.W}x${layout.H}@${scale.toFixed(3)}`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvasKey.current !== key) {
      canvas.width = Math.max(1, Math.round(layout.W * scale));
      canvas.height = Math.max(1, Math.round(layout.H * scale));
      canvas.style.width = `${Math.round(layout.W * cssScale.current)}px`;
      canvas.style.height = `${Math.round(layout.H * cssScale.current)}px`;
      canvasKey.current = key;
    }
    if (painter && !painter.available && live.current.activeMedia) {
      const fallback = live.current.activeMedia.kind === 'photo'
        ? bank.photos.get(live.current.activeMedia.url) ?? null
        : video;
      layout.img = fallback as CanvasImageSource | null;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, layout.W, layout.H);
    // A small window onto what the stage decided, so a test can tell a
    // designed-at-print-size plate from a phone-sized one.
    canvas.dataset.plateSize = `${layout.W}x${layout.H}`;
    canvas.dataset.typeBoost = String(layout.typeBoost ?? 1);
    canvas.dataset.plateScale = cssScale.current.toFixed(3);
    // The smallest row the frame prints, as the visitor actually sees it.
    const smallestRow = Math.min((layout.uBase ?? layout.u) * (layout.typeBoost ?? 1) * 11, layout.band * 0.078);
    canvas.dataset.minTypeCss = (smallestRow * cssScale.current).toFixed(2);
    plate.paint(ctx, layout);
  }, [plate, bank, video]);

  /* ── plate geometry ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!stageSize.width || !stageSize.height || !activeMedia) return;
    let cancelled = false;
    const painter = graderRef.current;
    const room = { width: Math.max(60, stageSize.width - 8), height: Math.max(60, stageSize.height - 8) };

    const build = async () => {
      // Multi-cut plates grade each photograph separately and keep the pixels.
      if (isMulti) {
        const slots: { img: HTMLCanvasElement | null; w: number; h: number }[] = [];
        const photos = media.filter((item) => item.kind === 'photo').slice(0, 4);
        for (let i = 0; i < photos.length; i += 1) {
          const item = photos[i];
          const image = bank.photos.get(item.url);
          if (!image) continue;
          let canvas = slotCanvases.current[i];
          if (!canvas) {
            canvas = document.createElement('canvas');
            slotCanvases.current[i] = canvas;
          }
          const size = previewGradeSize(item);
          if (painter?.available) {
            await painter.render({ source: image, grade: props.grade, width: size.width, height: size.height });
            canvas.width = size.width;
            canvas.height = size.height;
            canvas.getContext('2d')?.drawImage(painter.canvas, 0, 0);
          } else {
            canvas.width = size.width;
            canvas.height = size.height;
            canvas.getContext('2d')?.drawImage(image, 0, 0, size.width, size.height);
          }
          slots.push({ img: canvas, w: size.width, h: size.height });
        }
        while (slots.length < 4) slots.push({ img: null, w: 0, h: 0 });
        if (cancelled) return;
        const layout = buildPlateLayout({
          plate, emblems, frame, meta,
          photo: { width: 1, height: 1 },
          image: null,
          slots,
        });
        layoutRef.current = layout;
        // A four-cut plate is a fixed design size; fit it to the stage instead of
        // letting the canvas hang off the edge.
        cssScale.current = Math.min(1, room.width / layout.W, room.height / layout.H);
        canvasKey.current = '';
        setRatio(layout.W / layout.H);
        draw();
        setReady(true);
        return;
      }

      // One virtual print size for every stage: no more phone-sized plate.
      const base = virtualPhotoBox(activeMedia, PLATE_BASE_EDGE, PLATE_BASE_EDGE);
      let photo = { width: base.width, height: base.height };
      let layout = buildPlateLayout({ plate, emblems, frame, meta, photo, image: painter?.canvas ?? null });
      let scale = Math.min(1, room.width / layout.W, room.height / layout.H);

      // Ask the plate for whatever type boost the display scale needs, then let
      // the taller plate settle into the stage and repeat once so the boost is
      // measured against the scale the visitor actually gets.
      for (let pass = 0; pass < 2; pass += 1) {
        const boost = stageTypeBoost({ u: layout.W / 1000, band: layout.band, cssScale: scale });
        if (boost <= 1.001) break;
        const next = buildPlateLayout({
          plate, emblems, frame, meta, photo, image: painter?.canvas ?? null, typeBoost: boost,
        });
        layout = next;
        scale = Math.min(1, room.width / layout.W, room.height / layout.H);
      }

      if (cancelled) return;
      layoutRef.current = layout;
      cssScale.current = scale;
      setGlUnavailable(!(painter?.available ?? false));
      setRatio(layout.W / layout.H);
      draw();
      setReady(true);
    };

    void build();
    return () => { cancelled = true; };
  }, [stageSize, activeMedia, frame, meta, revision, plate, emblems, isMulti, media, bank, props.grade, draw, contextEpoch]);

  /* ── resize ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setStageSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(host);
    const rect = host.getBoundingClientRect();
    setStageSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    return () => observer.disconnect();
  }, []);

  /* ── prepare the LUT and grade a still / paused video frame ─────────────── */
  useEffect(() => {
    const painter = graderRef.current;
    if (!painter || !activeMedia) return;
    let cancelled = false;
    const run = async () => {
      const compareMode = showOriginal ? 'original' as const : 'none' as const;
      if (activeMedia.kind === 'photo') {
        if (isMulti) return;
        const image = bank.photos.get(activeMedia.url);
        if (!image) return;
        const size = previewGradeSize(activeMedia);
        try {
          await painter.render({ source: image, grade: props.grade, width: size.width, height: size.height, compareMode });
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : '사진을 처리하지 못했습니다.');
          return;
        }
      } else if (video) {
        const size = previewGradeSize(activeMedia);
        await painter.prepare(props.grade).catch(() => undefined);
        if (!cancelled && video.readyState >= 2) {
          painter.renderNow({ source: video, grade: props.grade, width: size.width, height: size.height, time: video.currentTime, compareMode, inputGuard }, props.grade);
        }
      }
      if (!cancelled) draw();
    };
    void run();
    return () => { cancelled = true; };
  }, [activeMedia, bank, props.grade, draw, video, revision, showOriginal, isMulti, inputGuard, contextEpoch]);

  /* ── video playback loop ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!video || !activeMedia) return;
    let raf = 0;
    let lastTime = -1;
    const size = previewGradeSize(activeMedia);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const state = live.current;
      if (state.trim.end <= 0) return;
      if (state.playing) {
        if (video.currentTime >= state.trim.end - 0.02) {
          video.currentTime = state.trim.start;
          lastTime = -1;
        } else if (video.currentTime < state.trim.start - 0.05) {
          video.currentTime = state.trim.start;
        }
      }
      if (video.currentTime === lastTime || video.readyState < 2) return;
      lastTime = video.currentTime;
      const painter = graderRef.current;
      if (!painter) return;
      painter.renderNow({
        source: video,
        grade: state.grade,
        width: size.width,
        height: size.height,
        time: video.currentTime,
        compareMode: state.showOriginal ? 'original' : 'none',
        inputGuard: state.inputGuard,
      }, state.grade);
      draw();
      onTime(video.currentTime);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [video, activeMedia, draw, onTime]);

  /* ── audio: the element follows the mute toggle ─────────────────────────── */
  useEffect(() => {
    if (!video) return;
    video.muted = muted;
    video.volume = 1;
  }, [video, muted]);

  /* ── play/pause ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!video) return;
    if (playing) {
      const start = video.currentTime < trim.start || video.currentTime >= trim.end ? trim.start : video.currentTime;
      if (video.currentTime !== start) video.currentTime = start;
      void video.play().catch(() => {
        /* Autoplay with sound can be refused before the visitor taps; the
           transport keeps the poster frame and the sound toggle stays visible. */
      });
    } else {
      video.pause();
    }
  }, [playing, video, trim.start, trim.end]);

  /* ── seeking while paused ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!video || playing) return;
    const onSeeked = () => {
      const painter = graderRef.current;
      if (!painter || !activeMedia) return;
      const size = previewGradeSize(activeMedia);
      painter.renderNow({
        source: video, grade: live.current.grade, width: size.width, height: size.height,
        time: video.currentTime, compareMode: live.current.showOriginal ? 'original' : 'none',
        inputGuard: live.current.inputGuard,
      }, live.current.grade);
      draw();
      onTime(video.currentTime);
    };
    video.addEventListener('seeked', onSeeked);
    return () => video.removeEventListener('seeked', onSeeked);
  }, [video, playing, draw, onTime, activeMedia]);

  return (
    <div className={`stage backdrop-${frame.backdrop}`} ref={hostRef}>
      <div className="stage-inner" style={{ aspectRatio: ratio > 0 ? `${ratio}` : undefined }}>
        <canvas
          ref={canvasRef}
          className={`plate-canvas${!ready ? ' is-loading' : ''}`}
          data-testid="plate-canvas"
          role="img"
          aria-label="필터와 프레임이 적용된 미리보기"
          onDoubleClick={activeMedia?.kind === 'video' ? onTogglePlay : undefined}
        />
        {error && <p className="stage-error">{error}</p>}
        {!ready && <div className="stage-skeleton" aria-hidden />}
        {contextLost && (
          <div className="stage-notice" role="status">
            <p>그래픽 메모리가 부족해 미리보기를 잠시 멈췄습니다.</p>
            <button type="button" className="btn small" onClick={() => setContextEpoch((value) => value + 1)}>
              미리보기 다시 그리기
            </button>
          </div>
        )}
        {!contextLost && glUnavailable && (
          <div className="stage-notice" role="status">
            <p>이 기기에서는 실시간 필터를 그릴 수 없어 원본으로 표시합니다.</p>
            <button type="button" className="btn small" onClick={() => setContextEpoch((value) => value + 1)}>
              다시 시도
            </button>
          </div>
        )}
      </div>

      {activeMedia?.kind === 'video' && (
        <>
          <button
            type="button"
            className={`mute-btn${muted ? ' is-muted' : ''}`}
            aria-label={muted ? '소리 켜기' : '음소거'}
            aria-pressed={!muted}
            title={muted ? '소리 켜기' : '음소거'}
            onClick={onToggleMute}
            data-testid="mute-toggle"
          >
            {muted ? <IconVolumeOff size={16} /> : <IconVolume size={16} />}
            <span>{muted ? '음소거' : '소리 켜짐'}</span>
          </button>
          <div className="stage-hint">길게 눌러 원본 비교 · 더블클릭으로 재생/일시정지</div>
        </>
      )}
    </div>
  );
}

/** Long-press compare gesture: press and hold to peek at the ungraded frame. */
export function useLongPress(onChange: (pressed: boolean) => void, delay = 260) {
  const timer = useRef<number | null>(null);
  const fire = useCallback((pressed: boolean) => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    onChange(pressed);
  }, [onChange]);
  const start = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    timer.current = window.setTimeout(() => onChange(true), delay);
  }, [onChange, delay]);
  const end = useCallback(() => fire(false), [fire]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return useMemo(
    () => ({ onPointerDown: start, onPointerUp: end, onPointerLeave: end, onPointerCancel: end }),
    [start, end],
  );
}
