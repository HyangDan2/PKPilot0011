import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Landing, SAMPLES, type SampleItem } from './components/Landing';
import { Stage, useLongPress, type MediaBank } from './components/Stage';
import { Timeline } from './components/Timeline';
import { FilterModal } from './components/FilterModal';
import { FrameModal } from './components/FrameModal';
import { AdjustModal } from './components/AdjustModal';
import { ExportModal } from './components/ExportModal';
import { IconDownload, IconFilm, IconFrame, IconPause, IconPlay, IconSliders, IconSun, IconMoon, IconTrash } from './components/Icons';
import { initialStudio, studioReducer } from './state/studio';
import { loadPlateEngine, type SPEmblemsApi, type SPPlateApi } from './plate/engine';
import { loadPhoto, loadVideo, releaseMedia } from './media/load';
import { buildFilterThumbs, buildFrameThumbs, type Cancellation } from './studio/thumbnails';
import { PhotoGrader, thumbnailSource } from './studio/grading';
import { exportMovie, exportStill, shareBlob } from './studio/exporters';
import { ALL_FILTERS } from './filters/catalog';
import { FRAME_MAP } from './plate/frames';
import { assetUrl } from './utils/assets';
import type { FilterOption } from './filters/catalog';
import type { FrameId, MediaInfo, PlateMeta, VideoExportOptions } from './types/studio';
import type { ExportProgress } from './export/videoExporter';
import type { StillResult } from './studio/exporters';

const THEME_KEY = 'hd2-theme';

function baseMeta(info: MediaInfo | null): PlateMeta {
  return info?.meta ?? { make: '', model: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', datetime: '', caption: '' };
}

export default function App() {
  const [state, dispatch] = useReducer(studioReducer, undefined, initialStudio);
  const [engine, setEngine] = useState<{ plate: SPPlateApi; emblems: SPEmblemsApi } | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [view, setView] = useState<'landing' | 'editor'>('landing');
  const [busy, setBusy] = useState<string | false>(false);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [filterThumbs, setFilterThumbs] = useState<Record<string, string>>({});
  const [frameThumbs, setFrameThumbs] = useState<Record<string, string>>({});
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [metaOverride, setMetaOverride] = useState<Partial<PlateMeta>>({});
  const bank = useRef<MediaBank>({ photos: new Map(), video: null });
  const fileRef = useRef<File | null>(null);
  const thumbGrader = useRef<PhotoGrader | null>(null);
  const cancelRef = useRef<Cancellation | null>(null);

  if (!thumbGrader.current && typeof document !== 'undefined') thumbGrader.current = new PhotoGrader();

  const activeMedia = state.media[state.activePhoto] ?? state.media[0] ?? null;
  const mediaKind = activeMedia?.kind ?? 'photo';
  const filterLabel = useMemo(() => {
    const found = ALL_FILTERS.find((filter) =>
      state.filter.kind === 'margarine'
        ? filter.presetId === state.filter.presetId
        : filter.kind === state.filter.kind && filter.filmId === state.filter.filmId && filter.presetId === null,
    );
    return found?.name ?? 'Neutral';
  }, [state.filter]);

  const composedMeta = useMemo<PlateMeta>(() => {
    const base = { ...baseMeta(activeMedia), ...metaOverride };
    return {
      ...base,
      make: state.frame.showSpec ? base.make : '',
      model: state.frame.showSpec ? base.model : '',
      lens: state.frame.showSpec ? base.lens : '',
      focal: state.frame.showSpec ? base.focal : '',
      aperture: state.frame.showSpec ? base.aperture : '',
      shutter: state.frame.showSpec ? base.shutter : '',
      iso: state.frame.showSpec ? base.iso : '',
      caption: state.frame.showCaption ? base.caption : '',
    };
  }, [activeMedia, metaOverride, state.frame.showSpec, state.frame.showCaption]);

  /* ── engine boot ────────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    loadPlateEngine()
      .then((loaded) => { if (alive) setEngine(loaded); })
      .catch((err: unknown) => {
        if (alive) setEngineError(err instanceof Error ? err.message : 'Shutterplate 엔진을 불러오지 못했습니다.');
      });
    return () => { alive = false; };
  }, []);

  /* ── theme ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') dispatch({ type: 'set-theme', theme: stored });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem(THEME_KEY, state.theme);
  }, [state.theme]);

  /* ── media loading ──────────────────────────────────────────────────────── */
  const clearMedia = useCallback(() => {
    state.media.forEach(releaseMedia);
    if (bank.current.video) {
      bank.current.video.pause();
      bank.current.video.remove();
      bank.current.video = null;
    }
    bank.current.photos.clear();
    fileRef.current = null;
    setMetaOverride({});
    setFilterThumbs({});
    setFrameThumbs({});
  }, [state.media]);

  const addPhotos = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy('사진을 더하는 중…');
    setError(null);
    try {
      const room = Math.max(0, 4 - state.media.length);
      const loaded = await Promise.all(files.slice(0, room).map((file) => loadPhoto(file)));
      loaded.forEach((item) => bank.current.photos.set(item.info.url, item.drawable));
      dispatch({ type: 'add-photos', media: loaded.map((item) => item.info) });
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 더하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [state.media.length]);

  const openPhotos = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy('사진을 여는 중…');
    setError(null);
    try {
      const loaded = await Promise.all(files.slice(0, 4).map((file) => loadPhoto(file)));
      clearMedia();
      bank.current.photos = new Map(loaded.map((item) => [item.info.url, item.drawable]));
      dispatch({ type: 'open-photos', media: loaded.map((item) => item.info) });
      setView('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 열지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [clearMedia]);

  const openVideo = useCallback(async (file: File) => {
    setBusy('영상을 분석하는 중…');
    setError(null);
    try {
      const loaded = await loadVideo(file);
      clearMedia();
      loaded.video.className = 'source-video';
      loaded.video.setAttribute('aria-hidden', 'true');
      document.body.appendChild(loaded.video);
      bank.current.video = loaded.video;
      fileRef.current = file;
      dispatch({ type: 'open-video', media: loaded.info });
      setView('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : '영상을 열지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [clearMedia]);

  const loadSample = useCallback(async (sample: SampleItem) => {
    setBusy(`${sample.label} 준비 중…`);
    setError(null);
    try {
      const response = await fetch(assetUrl(sample.path));
      if (!response.ok) throw new Error(`샘플을 불러오지 못했습니다 (${response.status})`);
      const blob = await response.blob();
      const name = sample.path.split('/').pop() ?? 'sample';
      const file = new File([blob], name, { type: blob.type });
      setBusy(false);
      if (sample.kind === 'video') await openVideo(file);
      else await openPhotos([file]);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : '샘플을 열지 못했습니다.');
    }
  }, [openPhotos, openVideo]);

  const pickFrame = useCallback(async (frameId: FrameId) => {
    dispatch({ type: 'set-frame', patch: { style: frameId } });
    if (state.media.length) { setView('editor'); return; }
    await loadSample(SAMPLES[0]);
    dispatch({ type: 'set-frame', patch: { style: frameId } });
  }, [loadSample, state.media.length]);

  /* ── actions ────────────────────────────────────────────────────────────── */
  const selectFilter = useCallback((filter: FilterOption) => {
    dispatch({ type: 'select-filter', filter: { kind: filter.kind, filmId: filter.filmId, presetId: filter.presetId } });
  }, []);

  const openFilterModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'filter' });
    setThumbsLoading(true);
    cancelRef.current = { cancelled: false };
    const token = cancelRef.current;
    const grader = thumbGrader.current;
    const source = activeMedia
      ? thumbnailSource({
          kind: activeMedia.kind,
          drawable: bank.current.photos.get(activeMedia.url) ?? null,
          video: bank.current.video,
        })
      : null;
    if (!grader || !source || !activeMedia) { setThumbsLoading(false); return; }
    void buildFilterThumbs({
      grader,
      source,
      sourceWidth: activeMedia.width,
      sourceHeight: activeMedia.height,
      filters: ALL_FILTERS,
      onEach: (key, url) => setFilterThumbs((previous) => ({ ...previous, [key]: url })),
      token,
    }).finally(() => { if (!token.cancelled) setThumbsLoading(false); });
  }, [activeMedia]);

  const openFrameModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'frame' });
    if (!engine || !activeMedia) return;
    setThumbsLoading(true);
    if (cancelRef.current) cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const token = cancelRef.current;
    const grader = thumbGrader.current;
    const source = thumbnailSource({
      kind: activeMedia.kind,
      drawable: bank.current.photos.get(activeMedia.url) ?? null,
      video: bank.current.video,
    });
    if (!grader || !source) { setThumbsLoading(false); return; }
    void (async () => {
      const width = 640;
      const height = Math.max(120, Math.round(width * (activeMedia.height / Math.max(1, activeMedia.width))));
      const graded = await grader.render({ source, grade: state.grade, width, height });
      const slots = (state.frame.style === 'contact' || state.frame.style === 'fyra04')
        ? state.media.filter((item) => item.kind === 'photo').slice(0, 4).map((item) => {
            const image = bank.current.photos.get(item.url) ?? null;
            return { img: image as CanvasImageSource | null, w: item.width, h: item.height };
          })
        : [];
      await buildFrameThumbs({
        plate: engine.plate, emblems: engine.emblems, frame: state.frame, meta: composedMeta,
        graded, sourceWidth: activeMedia.width, sourceHeight: activeMedia.height,
        slots, frames: ['horizon', 'gallery', 'dual', 'strap', 'film', 'studio', 'edge', 'pro', 'polaroid', 'frosted', 'editorial', 'contact', 'fyra04'],
        onEach: (id, url) => setFrameThumbs((previous) => ({ ...previous, [id]: url })),
        token,
      });
      if (!token.cancelled) setThumbsLoading(false);
    })();
  }, [engine, activeMedia, state.grade, state.frame, state.media, composedMeta]);

  const closeModal = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    dispatch({ type: 'open-modal', modal: null });
  }, []);

  /* ── exports ────────────────────────────────────────────────────────────── */
  const editMeta = useCallback((patch: Partial<PlateMeta>) => {
    setMetaOverride((previous) => ({ ...previous, ...patch }));
  }, []);

  const exportStillHandler = useCallback(async (format: 'jpeg' | 'png', quality: number): Promise<StillResult> => {
    if (!engine || !activeMedia) throw new Error('엔진이 준비되지 않았습니다.');
    const photos = state.media
      .filter((item) => item.kind === 'photo')
      .slice(0, 4)
      .map((item) => ({ info: item, image: bank.current.photos.get(item.url) as CanvasImageSource | null }));
    return exportStill({
      plate: engine.plate, emblems: engine.emblems, frame: state.frame, meta: composedMeta,
      grade: state.grade, media: activeMedia,
      image: bank.current.photos.get(activeMedia.url) ?? null,
      photos,
      inputGuard: state.inputGuard,
    }, format, quality);
  }, [engine, activeMedia, state.media, state.frame, composedMeta, state.grade, state.inputGuard]);

  const exportMovieHandler = useCallback(async (options: VideoExportOptions, onProgress: (progress: ExportProgress) => void, signal: AbortSignal) => {
    if (!engine || !activeMedia || !fileRef.current) throw new Error('영상이 준비되지 않았습니다.');
    return exportMovie({
      plate: engine.plate, emblems: engine.emblems, frame: state.frame, meta: composedMeta,
      grade: state.grade, media: activeMedia, file: fileRef.current, trim: state.trim,
      inputGuard: state.inputGuard,
    }, options, onProgress, signal);
  }, [engine, activeMedia, state.frame, composedMeta, state.grade, state.trim, state.inputGuard]);

  const shareStillHandler = useCallback(async (result: StillResult) => shareBlob(result.blob, result.filename, 'HD2Lab plate'), []);

  /* ── keyboard ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (view !== 'editor' || state.modal) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return;
      if (event.key === 'f' || event.key === 'F') { event.preventDefault(); openFilterModal(); }
      if (event.key === 'r' || event.key === 'R') { event.preventDefault(); openFrameModal(); }
      if (event.key === 'e' || event.key === 'E') { event.preventDefault(); dispatch({ type: 'open-modal', modal: 'export' }); }
      if (event.code === 'Space' && mediaKind === 'video') { event.preventDefault(); dispatch({ type: 'set-playing', playing: !state.playing }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, state.modal, state.playing, mediaKind, openFilterModal, openFrameModal]);

  /* ── stage gestures ─────────────────────────────────────────────────────── */
  const longPress = useLongPress(setShowOriginal);
  const seek = useCallback((seconds: number) => {
    const video = bank.current.video;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, seconds));
    dispatch({ type: 'set-time', time: video.currentTime });
  }, []);

  const onTime = useCallback((seconds: number) => dispatch({ type: 'set-time', time: seconds }), []);

  const editorSessionLabel = activeMedia
    ? `${activeMedia.name} · ${activeMedia.width}×${activeMedia.height}`
    : '';

  /* ── landing ────────────────────────────────────────────────────────────── */
  if (engineError) {
    return (
      <div className="fatal">
        <h1>스튜디오를 열 수 없습니다</h1>
        <p>{engineError}</p>
      </div>
    );
  }

  if (view === 'landing' || !state.media.length) {
    return (
      <Landing
        busy={busy}
        error={error}
        hasSession={state.media.length > 0}
        sessionLabel={editorSessionLabel}
        onOpenPhotos={(files) => void openPhotos(files)}
        onOpenVideo={(file) => void openVideo(file)}
        onLoadSample={(sample) => void loadSample(sample)}
        onPickFrame={(id) => void pickFrame(id)}
        onContinue={() => setView('editor')}
        onDismissError={() => setError(null)}
      />
    );
  }

  if (!engine) {
    return (
      <div className="boot">
        <span className="spinner" aria-hidden />
        <p>플레이트 엔진을 준비하는 중…</p>
      </div>
    );
  }

  const padDefault = engine.plate.defaults(state.frame.style).padPct;
  const plateSizeLabel = (() => {
    const media = activeMedia;
    if (!media) return '';
    const pad = Math.round((state.frame.padPct ?? padDefault) * 10) / 10;
    return `원본 ${media.width}×${media.height} · 여백 ${pad}%`;
  })();

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand-btn" onClick={() => setView('landing')} aria-label="홈으로">
          <span className="brand-mark small" aria-hidden>
            <svg viewBox="0 0 64 64"><path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="currentColor" /></svg>
          </span>
          <span className="brand-word">PKPilot 0011</span>
        </button>
        <div className="topbar-meta">
          <span className="media-name" title={activeMedia?.name}>{activeMedia?.name}</span>
          <span className="media-spec">{activeMedia?.width}×{activeMedia?.height}{activeMedia?.kind === 'video' ? ` · ${state.trim.end.toFixed(1)}s` : ''}</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="chip on desktop-only" onClick={openFilterModal}>{filterLabel}</button>
          <button type="button" className="chip desktop-only" onClick={openFrameModal}>{FRAME_MAP[state.frame.style].label}</button>
          <button
            type="button"
            className="icon-btn"
            aria-label={state.theme === 'dark' ? '라이트 테마' : '다크 테마'}
            onClick={() => dispatch({ type: 'set-theme', theme: state.theme === 'dark' ? 'light' : 'dark' })}
          >
            {state.theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
          <button type="button" className="icon-btn" aria-label="미디어 닫기" onClick={() => { clearMedia(); dispatch({ type: 'clear-media' }); setView('landing'); }}>
            <IconTrash size={18} />
          </button>
        </div>
      </header>

      <main className="workbench">
        <div className="stage-wrap" {...longPress}>
          <Stage
            plate={engine.plate}
            emblems={engine.emblems}
            media={state.media}
            activePhoto={state.activePhoto}
            bank={bank.current}
            grade={state.grade}
            frame={state.frame}
            meta={composedMeta}
            trim={state.trim}
            playing={state.playing}
            showOriginal={showOriginal}
            inputGuard={state.inputGuard}
            revision={state.revision}
            onTime={onTime}
            onTogglePlay={() => dispatch({ type: 'set-playing', playing: !state.playing })}
          />
          {showOriginal && <span className="compare-badge">원본</span>}
        </div>

        {mediaKind === 'video' ? (
          <section className="transport" aria-label="재생과 트림">
            <button
              type="button"
              className="play-btn"
              aria-label={state.playing ? '일시정지' : '재생'}
              onClick={() => dispatch({ type: 'set-playing', playing: !state.playing })}
            >
              {state.playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </button>
            <Timeline
              duration={state.trim.end || activeMedia?.duration || 0}
              trim={state.trim}
              time={state.currentTime}
              playing={state.playing}
              onTrim={(trim) => dispatch({ type: 'set-trim', trim })}
              onSeek={seek}
            />
          </section>
        ) : state.media.length > 1 ? (
          <section className="slot-strip" aria-label="플레이트 사진">
            {state.media.slice(0, 4).map((item, index) => (
              <button
                key={item.url}
                type="button"
                className={`slot${state.activePhoto === index ? ' on' : ''}`}
                onClick={() => dispatch({ type: 'set-active-photo', index })}
              >
                <img src={item.url} alt={`슬롯 ${index + 1}`} />
                <span>SLOT {index + 1}</span>
              </button>
            ))}
            {state.media.length < 4 && (
              <label className="slot add">
                <span>+ 사진</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length) void addPhotos(files);
                    event.target.value = '';
                  }}
                />
              </label>
            )}
          </section>
        ) : null}

        <nav className="dock" aria-label="스튜디오 도구">
          <button type="button" className="dock-btn primary" onClick={openFilterModal} data-testid="dock-filter">
            <IconFilm size={21} />
            <span>필터 선택</span>
            <small>{filterLabel}</small>
          </button>
          <button type="button" className="dock-btn" onClick={openFrameModal} data-testid="dock-frame">
            <IconFrame size={21} />
            <span>프레임 선택</span>
            <small>{FRAME_MAP[state.frame.style].label}</small>
          </button>
          <button type="button" className="dock-btn" onClick={() => dispatch({ type: 'open-modal', modal: 'adjust' })} data-testid="dock-adjust">
            <IconSliders size={21} />
            <span>세부 보정</span>
            <small>{Math.round(state.grade.adjustments.exposure * 100) / 100} EV</small>
          </button>
          <button type="button" className="dock-btn" onClick={() => dispatch({ type: 'open-modal', modal: 'export' })} data-testid="dock-export">
            <IconDownload size={21} />
            <span>내보내기</span>
            <small>{mediaKind === 'video' ? 'MP4 · H.264' : '원본 1:1'}</small>
          </button>
        </nav>
      </main>

      {state.modal === 'filter' && (
        <FilterModal
          selection={state.filter}
          strength={state.grade.adjustments.filmStrength}
          thumbs={filterThumbs}
          onSelect={selectFilter}
          onStrength={(value) => dispatch({ type: 'patch-adjustments', patch: { filmStrength: value } })}
          onClose={closeModal}
        />
      )}
      {state.modal === 'frame' && (
        <FrameModal
          frame={state.frame}
          mediaKind={mediaKind}
          thumbs={frameThumbs}
          defaultPad={padDefault}
          meta={composedMeta}
          onMeta={editMeta}
          onPatch={(patch) => dispatch({ type: 'set-frame', patch })}
          onClose={closeModal}
        />
      )}
      {state.modal === 'adjust' && (
        <AdjustModal
          filmId={state.grade.filmId}
          filterLabel={filterLabel}
          adjustments={state.grade.adjustments}
          camera={state.grade.camera}
          curves={state.grade.curves}
          mixer={state.grade.colorMixer}
          sharpening={state.grade.sharpening}
          mediaKind={mediaKind}
          duration={activeMedia?.duration ?? state.trim.end}
          fps={activeMedia?.fps ?? 30}
          inputGuard={state.inputGuard}
          trim={state.trim}
          onAdjustments={(patch) => dispatch({ type: 'patch-adjustments', patch })}
          onDateStamp={(patch) => dispatch({ type: 'patch-date-stamp', patch })}
          onOptics={(patch) => dispatch({ type: 'patch-optics', patch })}
          onCurves={(curves) => dispatch({ type: 'set-curves', curves })}
          onMixer={(mixer) => dispatch({ type: 'patch-mixer', mixer })}
          onSharpening={(patch) => dispatch({ type: 'patch-sharpening', patch })}
          onTrim={(trim) => dispatch({ type: 'set-trim', trim })}
          onInputGuard={(guard) => dispatch({ type: 'set-input-guard', guard })}
          onReset={() => dispatch({ type: 'reset-grade' })}
          onClose={closeModal}
        />
      )}
      {state.modal === 'export' && (
        <ExportModal
          media={activeMedia!}
          trim={state.trim}
          filterLabel={filterLabel}
          frameLabel={FRAME_MAP[state.frame.style].label}
          plateSize={plateSizeLabel}
          onExportStill={exportStillHandler}
          onExportMovie={exportMovieHandler}
          onShareStill={shareStillHandler}
          onClose={closeModal}
        />
      )}

      {thumbsLoading && <span className="sr-only" role="status">썸네일을 그리는 중</span>}
      {error && (
        <div className="toast error" role="alert">
          {error}
          <button type="button" className="icon-btn tiny" onClick={() => setError(null)} aria-label="닫기">✕</button>
        </div>
      )}
    </div>
  );
}
