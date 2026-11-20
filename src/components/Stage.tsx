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
  /** The element's own `durationchange`: the cut and the spec row follow it. */
  onDuration: (seconds: number) => void;
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
 * the plate is asked for only the type boost that scale needs: the band and the
 * type unit grow together while the photograph, its margin and the plate width
 * stay exactly where they are. The boost is capped (STAGE_MAX_TYPE_BOOST) so a
 * phone gets readable copy instead of a swollen frame, and the 1:1 export never
 * asks for it — the print keeps Shutterplate's designed proportions.
 */
export function Stage(props: StageProps) {
  const { plate, emblems, media, bank, frame, meta, trim, playing, showOriginal, inputGuard, revision, muted, onToggleMute, onTime, onDuration, onTogglePlay } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graderRef = useRef<PhotoGrader | null>(null);
  const layoutRef = useRef<PlateLayout | null>(null);
  /** With the frame off there is no plate: the source fills this box instead. */
  const plainRef = useRef<{ W: number; H: number } | null>(null);
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
  /** The room the plate was fitted into, and the viewport margin around it. */
  const roomRef = useRef({ width: 0, height: 0 });
  const roomPadRef = useRef(0);
  /** True once the GPU proved it cannot paint: the plate then shows the source pixels. */
  const rawFallback = useRef(false);

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
      rawFallback.current = false;
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
    const painter = graderRef.current;
    if (!canvas) return;
    const state = live.current;
    const framed = state.frame.enabled !== false;
    const layout = layoutRef.current;
    const plain = plainRef.current;
    const box = framed ? layout : plain;
    if (!box) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const scale = cssScale.current * dpr;
    const key = `${box.W}x${box.H}@${scale.toFixed(3)}`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvasKey.current !== key) {
      canvas.width = Math.max(1, Math.round(box.W * scale));
      canvas.height = Math.max(1, Math.round(box.H * scale));
      canvas.style.width = `${Math.round(box.W * cssScale.current)}px`;
      canvas.style.height = `${Math.round(box.H * cssScale.current)}px`;
      canvasKey.current = key;
    }
    canvas.dataset.frameEnabled = String(framed);

    const source = state.activeMedia
      ? state.activeMedia.kind === 'photo'
        ? bank.photos.get(state.activeMedia.url) ?? null
        : video
      : null;
    const graded = painter && painter.available && !rawFallback.current && painter.canvas.width > 1
      ? painter.canvas
      : null;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, box.W, box.H);

    if (!framed) {
      // No margin, band or emblem: the graded picture itself, filling the box.
      const picture = graded ?? (source as CanvasImageSource | null);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (picture) ctx.drawImage(picture, 0, 0, box.W, box.H);
      canvas.dataset.plateSize = `${box.W}x${box.H}`;
      canvas.dataset.photoBox = `${box.W}x${box.H}`;
      canvas.dataset.padX = '0';
      canvas.dataset.padTop = '0';
      canvas.dataset.band = '0';
      canvas.dataset.typeBoost = '1';
      canvas.dataset.plateScale = cssScale.current.toFixed(3);
      canvas.dataset.room = `${Math.round(roomRef.current.width)}x${Math.round(roomRef.current.height)}`;
      canvas.dataset.roomPad = String(roomPadRef.current);
      canvas.dataset.minTypeCss = '0';
      return;
    }

    if (!layout) return;
    if (painter && (!painter.available || rawFallback.current) && state.activeMedia) {
      layout.img = source as CanvasImageSource | null;
    }
    // A small window onto what the stage decided, so a test can tell a
    // designed-at-print-size plate from a phone-sized one.
    canvas.dataset.plateSize = `${layout.W}x${layout.H}`;
    canvas.dataset.typeBoost = String(layout.typeBoost ?? 1);
    canvas.dataset.plateScale = cssScale.current.toFixed(3);
    // The frame's own geometry, so a test can check the Shutterplate ratio the
    // visitor actually got: W = PW + 2 padX, band = padX + PH · extra%, no boost.
    canvas.dataset.photoBox = `${layout.PW}x${layout.PH}`;
    canvas.dataset.padX = String(layout.padX);
    canvas.dataset.padTop = String(layout.padTop);
    canvas.dataset.band = String(layout.band);
    canvas.dataset.room = `${Math.round(roomRef.current.width)}x${Math.round(roomRef.current.height)}`;
    canvas.dataset.roomPad = String(roomPadRef.current);
    // The smallest row the frame prints, as the visitor actually sees it.
    const smallestRow = Math.min(layout.u * 11, layout.band * 0.078);
    canvas.dataset.minTypeCss = (smallestRow * cssScale.current).toFixed(2);
    plate.paint(ctx, layout);
  }, [plate, bank, video]);

  /**
   * Grade and paint whatever the element shows right now. Returns false when
   * there is nothing safe to paint yet (no LUT, no decoded frame), so callers
   * can keep the frame already on the plate instead of drawing a blank one.
   */
  const paintSourceFrame = useCallback(() => {
    const painter = graderRef.current;
    const media = live.current.activeMedia;
    if (!painter || !video || !media || media.kind !== 'video') return false;
    if (video.readyState < 2) return false;
    const state = live.current;
    const size = previewGradeSize(media);
    const painted = painter.renderNow({
      source: video,
      grade: state.grade,
      width: size.width,
      height: size.height,
      time: video.currentTime,
      compareMode: state.showOriginal ? 'original' : 'none',
      inputGuard: state.inputGuard,
    }, state.grade);
    if (!painted) return false;
    draw();
    onTime(video.currentTime);
    return true;
  }, [video, draw, onTime]);

  /* ── plate geometry ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!stageSize.width || !stageSize.height || !activeMedia) return;
    let cancelled = false;
    const painter = graderRef.current;
    // Shutterplate's own viewport margin: a phone keeps 16px of air around the
    // print, a wider window 40px, so the plate never touches the stage edge.
    const pad = stageSize.width < 520 ? 16 : 40;
    const room = {
      width: Math.max(60, stageSize.width - pad),
      height: Math.max(60, stageSize.height - pad),
    };
    roomRef.current = room;
    roomPadRef.current = pad;

    const build = async () => {
      // With the frame off nothing is designed: the picture itself is contained
      // in the room, at its own ratio, and the stage centres it.
      if (frame.enabled === false) {
        const contain = Math.min(
          room.width / Math.max(1, activeMedia.width),
          room.height / Math.max(1, activeMedia.height),
        );
        const W = Math.max(2, Math.round(activeMedia.width * contain));
        const H = Math.max(2, Math.round(activeMedia.height * contain));
        if (cancelled) return;
        plainRef.current = { W, H };
        layoutRef.current = null;
        cssScale.current = 1;
        canvasKey.current = '';
        setGlUnavailable(!(painter?.available ?? false));
        setRatio(W / H);
        draw();
        setReady(true);
        return;
      }

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
      const photo = { width: base.width, height: base.height };
      // Fit the plate, measure how small its smallest row lands, and lay it out
      // again with just enough type boost to read it. The scale is measured
      // once more from the boosted plate, because the taller band takes a
      // little of the room back.
      let layout = buildPlateLayout({ plate, emblems, frame, meta, photo, image: painter?.canvas ?? null });
      let scale = Math.min(1, room.width / layout.W, room.height / layout.H);
      const boost = stageTypeBoost({ u: layout.W / 1000, band: layout.band, cssScale: scale });
      if (boost > 1) {
        layout = buildPlateLayout({ plate, emblems, frame, meta, photo, image: painter?.canvas ?? null, typeBoost: boost });
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
          if (!cancelled && !painter.hasPixels()) {
            rawFallback.current = true;
            setGlUnavailable(true);
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : '사진을 처리하지 못했습니다.');
          return;
        }
      } else if (video) {
        const size = previewGradeSize(activeMedia);
        await painter.prepare(props.grade).catch(() => undefined);
        if (cancelled) return;
        // The LUT is in: force the current frame onto the plate now instead of
        // waiting for the playback loop's next tick.
        if (video.readyState >= 2) {
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
      // Only a known cut loops or clamps the clip: with no end yet, playing
      // must not be pinned to 0s.
      if (state.trim.end > 0 && state.playing) {
        if (video.currentTime >= state.trim.end - 0.02) {
          video.currentTime = state.trim.start;
          lastTime = -1;
        } else if (video.currentTime < state.trim.start - 0.05) {
          video.currentTime = state.trim.start;
        }
      }
      if (video.currentTime === lastTime || video.readyState < 2) return;
      const painter = graderRef.current;
      if (!painter) return;
      const painted = painter.renderNow({
        source: video,
        grade: state.grade,
        width: size.width,
        height: size.height,
        time: video.currentTime,
        compareMode: state.showOriginal ? 'original' : 'none',
        inputGuard: state.inputGuard,
      }, state.grade);
      // The LUT may still be uploading: keep the frame already on the plate and
      // retry on the next tick rather than locking a blank frame in place.
      if (!painted) return;
      lastTime = video.currentTime;
      draw();
      onTime(video.currentTime);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [video, activeMedia, draw, onTime]);

  /* ── the decoder's first frames: paint them the moment they exist ───────── */
  useEffect(() => {
    if (!video || !activeMedia || activeMedia.kind !== 'video') return;
    let cancelled = false;

    const onFrame = () => {
      if (cancelled || video.readyState < 2) return;
      const painter = graderRef.current;
      if (!painter) return;
      const paint = () => { if (!cancelled) paintSourceFrame(); };
      // `loadeddata` can land before the LUT finished uploading. prepare() is
      // idempotent, so wait for it and paint straight after rather than
      // leaving the plate on the last frame it happened to have.
      if (painter.isPrepared(live.current.grade)) paint();
      else void painter.prepare(live.current.grade).then(paint).catch(() => undefined);
    };
    // The element reports its own length whenever it finally knows it (a clip
    // opened on metadata alone knows it a beat later); the cut follows.
    const onDurationChange = () => {
      const seconds = video.duration;
      if (Number.isFinite(seconds) && seconds > 0) onDuration(seconds);
    };
    // A clip that reaches its own end stops itself. The stage's loop is the
    // transport, so it starts the next pass instead of freezing on frame 0.
    const onEnded = () => {
      const state = live.current;
      if (!state.playing) return;
      video.currentTime = state.trim.start;
      void video.play().catch(() => undefined);
    };

    video.addEventListener('loadeddata', onFrame);
    video.addEventListener('canplay', onFrame);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('ended', onEnded);
    // The element outlives this effect (it is the shared bank clip), so it may
    // already hold a frame and a length by the time the stage mounts.
    onFrame();
    onDurationChange();
    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', onFrame);
      video.removeEventListener('canplay', onFrame);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('ended', onEnded);
    };
  }, [video, activeMedia, paintSourceFrame, onDuration]);

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
      // An unknown end (trim.end === 0) must not read as "already past the
      // out point", which would pin the playhead to 0s.
      const end = trim.end > 0
        ? trim.end
        : (Number.isFinite(video.duration) ? video.duration : 0);
      if (video.currentTime < trim.start || (end > 0 && video.currentTime >= end)) {
        video.currentTime = trim.start;
      }
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
