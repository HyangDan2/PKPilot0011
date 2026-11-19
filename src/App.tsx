import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Landing, SAMPLES, HD2LabMark, type SampleItem } from './components/Landing';
import { Stage, useLongPress, type MediaBank } from './components/Stage';
import { Timeline } from './components/Timeline';
import { FilterModal } from './components/FilterModal';
import { FrameModal } from './components/FrameModal';
import { FourCutModal } from './components/FourCutModal';
import { AdjustModal } from './components/AdjustModal';
import { ExportModal } from './components/ExportModal';
import { NavMenu } from './components/NavMenu';
import { FilterStrip, STRIP_FILTERS } from './components/FilterStrip';
import { ColorLabModal } from './components/ColorLabModal';
import { ToneCurveModal, curvesTouched } from './components/ToneCurveModal';
import { CameraEffectsModal } from './components/CameraEffectsModal';
import { BackdropSwitch, ThemeFab } from './components/ThemeControls';
import {
  IconCamera, IconDownload, IconFilm, IconFrame, IconPalette, IconPause, IconPlay, IconSliders, IconSpline, IconSwap,
} from './components/Icons';
import { initialStudio, studioReducer } from './state/studio';
import { loadPlateEngine, type SPEmblemsApi, type SPPlateApi } from './plate/engine';
import { loadPhoto, loadVideo, releaseMedia } from './media/load';
import { routeFiles } from './media/route';
import { withSpecFallback } from './media/spec';import { buildFrameThumbs, buildFilterThumbs, type Cancellation } from './studio/thumbnails';
import { PhotoGrader, thumbnailSource } from './studio/grading';
import { exportMovie, exportStill } from './studio/exporters';
import { ALL_FILTERS, margarinePreset } from './filters/catalog';
import { FRAME_MAP, SINGLE_FRAME_DEFS } from './plate/frames';
import { assetUrl } from './utils/assets';
import type { FilterOption } from './filters/catalog';
import type { FrameId, PlateMeta, VideoExportOptions } from './types/studio';
import type { ExportProgress } from './export/videoExporter';
import type { StillResult } from './studio/exporters';

const THEME_KEY = 'hd2-theme';

export default function App() {
  const [state, dispatch] = useReducer(studioReducer, undefined, initialStudio);
  const [engine, setEngine] = useState<{ plate: SPPlateApi; emblems: SPEmblemsApi } | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [view, setView] = useState<'landing' | 'editor'>('landing');
  const [busy, setBusy] = useState<string | false>(false);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [filterThumbs, setFilterThumbs] = useState<Record<string, string>>({});
  const [stripThumbs, setStripThumbs] = useState<Record<string, string>>({});
  const [frameThumbs, setFrameThumbs] = useState<Record<string, string>>({});
  const [fourCutThumbs, setFourCutThumbs] = useState<Record<string, string>>({});
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [metaOverride, setMetaOverride] = useState<Partial<PlateMeta>>({});
  const [muted, setMuted] = useState(true);
  const bank = useRef<MediaBank>({ photos: new Map(), video: null });
  const fileRef = useRef<File | null>(null);
  const cancelRef = useRef<Cancellation | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);

  const activeMedia = state.media[state.activePhoto] ?? state.media[0] ?? null;
  const mediaKind = activeMedia?.kind ?? 'photo';
  const photos = useMemo(() => state.media.filter((item) => item.kind === 'photo'), [state.media]);

  const filterLabel = useMemo(() => {
    const found = ALL_FILTERS.find((filter) =>
      state.filter.kind === 'margarine'
        ? filter.presetId === state.filter.presetId
        : filter.kind === state.filter.kind && filter.filmId === state.filter.filmId && filter.presetId === null,
    );
    return found?.name ?? 'Neutral';
  }, [state.filter]);

  const margarineName = useMemo(
    () => (state.filter.kind === 'margarine' ? margarinePreset(state.filter.presetId)?.name ?? null : null),
    [state.filter],
  );

  const composedMeta = useMemo<PlateMeta>(() => {
    const base = { ...withSpecFallback(activeMedia), ...metaOverride };
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
    const root = document.documentElement;
    root.dataset.theme = state.theme;
    localStorage.setItem(THEME_KEY, state.theme);
    /* A layer painted from themed gradients can keep its old pixels when only
       the custom properties change; one inherited-property change invalidates
       the whole tree so the swap is complete without a scroll. */
    root.style.setProperty('--theme-rev', String(Date.now()));
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
    setFourCutThumbs({});
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
      setMuted(true);
      setView('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : '영상을 열지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [clearMedia]);

  /** One picker for both kinds: a clip opens the studio, stills fill the plate. */
  const openAny = useCallback((files: File[]) => {
    const picked = routeFiles(files);
    if (!picked) {
      setError('지원하지 않는 파일입니다 — JPEG · PNG · WebP 사진 또는 MP4 · MOV · WebM 영상을 골라 주세요.');
      return;
    }
    if (picked.kind === 'video') void openVideo(picked.file);
    else void openPhotos(picked.files);
  }, [openPhotos, openVideo]);

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

  /** A thumbnail job owns its GL context and gives it back when it is done. */
  const withGrader = useCallback(async <T,>(work: (grader: PhotoGrader) => Promise<T>): Promise<T | null> => {
    if (!activeMedia) return null;
    const grader = new PhotoGrader();
    try {
      return await work(grader);
    } finally {
      grader.destroy();
    }
  }, [activeMedia]);

  /** The strip's own previews: cheap, and rebuilt whenever the media behind changes. */
  useEffect(() => {
    if (view !== 'editor' || !activeMedia) return;
    const source = thumbnailSource({
      kind: activeMedia.kind,
      drawable: bank.current.photos.get(activeMedia.url) ?? null,
      video: bank.current.video,
    });
    if (!source) return;
    const token: Cancellation = { cancelled: false };
    const grader = new PhotoGrader();
    void buildFilterThumbs({
      grader,
      source,
      sourceWidth: activeMedia.width,
      sourceHeight: activeMedia.height,
      filters: STRIP_FILTERS,
      width: 104,
      onEach: (key, url) => setStripThumbs((previous) => ({ ...previous, [key]: url })),
      token,
    }).finally(() => grader.destroy());
    return () => { token.cancelled = true; };
    // The previews follow the media, not every slider: one build per open media.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeMedia?.url, engine !== null]);

  const openFilterModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'filter' });
    setThumbsLoading(true);
    cancelRef.current = { cancelled: false };
    const token = cancelRef.current;
    const source = activeMedia
      ? thumbnailSource({
          kind: activeMedia.kind,
          drawable: bank.current.photos.get(activeMedia.url) ?? null,
          video: bank.current.video,
        })
      : null;
    if (!source || !activeMedia) { setThumbsLoading(false); return; }
    void withGrader((grader) => buildFilterThumbs({
      grader,
      source,
      sourceWidth: activeMedia.width,
      sourceHeight: activeMedia.height,
      filters: ALL_FILTERS,
      onEach: (key, url) => setFilterThumbs((previous) => ({ ...previous, [key]: url })),
      token,
    })).finally(() => { if (!token.cancelled) setThumbsLoading(false); });
  }, [activeMedia, withGrader]);

  const buildThumbs = useCallback((ids: FrameId[], target: React.Dispatch<React.SetStateAction<Record<string, string>>>) => {
    if (!engine || !activeMedia) return;
    setThumbsLoading(true);
    if (cancelRef.current) cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const token = cancelRef.current;
    const source = thumbnailSource({
      kind: activeMedia.kind,
      drawable: bank.current.photos.get(activeMedia.url) ?? null,
      video: bank.current.video,
    });
    if (!source) { setThumbsLoading(false); return; }
    void withGrader(async (grader) => {
      const width = 640;
      const height = Math.max(120, Math.round(width * (activeMedia.height / Math.max(1, activeMedia.width))));
      const graded = await grader.render({ source, grade: state.grade, width, height });
      const slots = state.media.filter((item) => item.kind === 'photo').slice(0, 4).map((item) => {
        const image = bank.current.photos.get(item.url) ?? null;
        return { img: image as CanvasImageSource | null, w: item.width, h: item.height };
      });
      await buildFrameThumbs({
        plate: engine.plate, emblems: engine.emblems, frame: state.frame, meta: composedMeta,
        graded, sourceWidth: activeMedia.width, sourceHeight: activeMedia.height,
        slots,
        frames: ids,
        onEach: (id, url) => target((previous) => ({ ...previous, [id]: url })),
        token,
      });
      if (!token.cancelled) setThumbsLoading(false);
    });
  }, [engine, activeMedia, state.grade, state.frame, state.media, composedMeta, withGrader]);

  const openFrameModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'frame' });
    buildThumbs(SINGLE_FRAME_DEFS.map((frame) => frame.id), setFrameThumbs);
  }, [buildThumbs]);

  const openFourCutModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'fourcut' });
    buildThumbs(['contact', 'fyra04'], setFourCutThumbs);
  }, [buildThumbs]);

  const closeModal = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    dispatch({ type: 'open-modal', modal: null });
  }, []);

  /* ── 4-cut slots ────────────────────────────────────────────────────────── */
  const addFourCutFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => (routeFiles([file])?.kind ?? 'photos') === 'photos');
    if (!images.length) { setError('4컷 플레이트에는 사진만 넣을 수 있습니다.'); return; }
    // A clip cannot share the stage with four stills: the 4-cut window is
    // photo-only, so a clip is swapped out for the photographs.
    if (state.media.some((item) => item.kind === 'video')) {
      await openPhotos(images);
      return;
    }
    await addPhotos(images);
  }, [addPhotos, openPhotos, state.media]);

  const replaceSlot = useCallback(async (index: number, file: File) => {
    const target = photos[index];
    if (!target) { await addFourCutFiles([file]); return; }
    setBusy('사진을 바꾸는 중…');
    try {
      const loaded = await loadPhoto(file);
      bank.current.photos.set(loaded.info.url, loaded.drawable);
      bank.current.photos.delete(target.url);
      releaseMedia(target);
      const mediaIndex = state.media.indexOf(target);
      dispatch({ type: 'set-photo', index: mediaIndex, media: loaded.info });
      setFourCutThumbs({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 바꾸지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [addFourCutFiles, photos, state.media]);

  const removeSlot = useCallback((index: number) => {
    const target = photos[index];
    if (!target) return;
    bank.current.photos.delete(target.url);
    releaseMedia(target);
    dispatch({ type: 'remove-photo', index: state.media.indexOf(target) });
    setFourCutThumbs({});
  }, [photos, state.media]);

  const applyFourCut = useCallback(() => {
    if (!photos.length) return;
    dispatch({ type: 'open-modal', modal: null });
    setView('editor');
  }, [photos.length]);

  /* ── exports ────────────────────────────────────────────────────────────── */
  const editMeta = useCallback((patch: Partial<PlateMeta>) => {
    setMetaOverride((previous) => ({ ...previous, ...patch }));
  }, []);

  const exportStillHandler = useCallback(async (format: 'jpeg' | 'png', quality: number): Promise<StillResult> => {
    if (!engine || !activeMedia) throw new Error('엔진이 준비되지 않았습니다.');
    const slots = state.media
      .filter((item) => item.kind === 'photo')
      .slice(0, 4)
      .map((item) => ({ info: item, image: bank.current.photos.get(item.url) as CanvasImageSource | null }));
    return exportStill({
      plate: engine.plate, emblems: engine.emblems, frame: state.frame, meta: composedMeta,
      grade: state.grade, media: activeMedia,
      image: bank.current.photos.get(activeMedia.url) ?? null,
      photos: slots,
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

  /* ── playback & sound ───────────────────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    const video = bank.current.video;
    const next = !state.playing;
    if (video && next && muted) {
      setMuted(false);
      void video.play().catch(() => {
        // Chrome refuses a sound-on play without a gesture: fall back to silent
        // playback and leave the sound toggle in the visitor's hands.
        setMuted(true);
        setError('브라우저가 소리 있는 재생을 막았습니다 — [소리 켜기]를 한 번 눌러 주세요.');
      });
    }
    dispatch({ type: 'set-playing', playing: next });
  }, [state.playing, muted]);

  const toggleMute = useCallback(() => {
    const video = bank.current.video;
    if (!video) return;
    if (muted) {
      setMuted(false);
      video.muted = false;
      void video.play().catch(() => {
        setMuted(true);
        video.muted = true;
        setError('브라우저가 소리 있는 재생을 막았습니다 — 화면을 한 번 누른 뒤 다시 시도해 주세요.');
      });
      if (!state.playing) dispatch({ type: 'set-playing', playing: true });
    } else {
      setMuted(true);
      video.muted = true;
    }
  }, [muted, state.playing]);

  /* ── keyboard ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (view !== 'editor' || state.modal) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return;
      if (event.key === 'f' || event.key === 'F') { event.preventDefault(); openFilterModal(); }
      if (event.key === 'r' || event.key === 'R') { event.preventDefault(); openFrameModal(); }
      if (event.key === 'e' || event.key === 'E') { event.preventDefault(); dispatch({ type: 'open-modal', modal: 'export' }); }
      if (event.code === 'Space' && mediaKind === 'video') { event.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, state.modal, mediaKind, openFilterModal, openFrameModal, togglePlay]);

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

  const themeFab = (
    <ThemeFab
      theme={state.theme}
      onToggle={() => dispatch({ type: 'set-theme', theme: state.theme === 'dark' ? 'light' : 'dark' })}
    />
  );

  const mixerActive = useMemo(() => {
    const mixer = state.grade.colorMixer;
    return mixer.points.length > 0
      || Object.values(mixer.bands).some((band) => band.hue !== 0 || band.saturation !== 0 || band.luminance !== 0)
      || mixer.rgbBase.shadowsTint !== 0;
  }, [state.grade.colorMixer]);
  const curvesActive = useMemo(() => curvesTouched(state.grade.curves), [state.grade.curves]);
  const cameraActive = state.grade.camera.dateStamp.enabled
    || state.grade.camera.optics.glow > 0
    || state.grade.camera.optics.halation > 0
    || state.grade.camera.optics.softness > 0;

  /**
   * The corner cluster. The landing carries the 4-cut door and the theme
   * toggle; the editor adds the three effect windows Film Studio keeps in its
   * own bar — Color Lab, Tone Curve and Camera Effects.
   */
  const floatingCluster = (withTools: boolean) => (
    <div className={`float-cluster${withTools ? ' in-stage' : ''}`} data-testid="float-cluster">
      <button
        type="button"
        className="tool-fab"
        onClick={openFourCutModal}
        aria-label="4컷 프레임"
        title="4컷 프레임"
        data-testid="fourcut-fab"
        data-tool="fourcut"
      >
        <span className="fourcut-grid" aria-hidden>
          <i /><i /><i /><i />
        </span>
      </button>
      {withTools && (
        <>
          <button
            type="button"
            className={`tool-fab${mixerActive ? ' on' : ''}`}
            onClick={() => dispatch({ type: 'open-modal', modal: 'colorlab' })}
            aria-label="Color Lab"
            title="Color Lab"
            data-testid="colorlab-fab"
            data-tool="colorlab"
          >
            <IconPalette size={16} />
            {mixerActive && <span className="dot-active" aria-hidden />}
          </button>
          <button
            type="button"
            className={`tool-fab${curvesActive ? ' on' : ''}`}
            onClick={() => dispatch({ type: 'open-modal', modal: 'tonecurve' })}
            aria-label="Tone Curve"
            title="Tone Curve"
            data-testid="tonecurve-fab"
            data-tool="tonecurve"
          >
            <IconSpline size={16} />
            {curvesActive && <span className="dot-active" aria-hidden />}
          </button>
          <button
            type="button"
            className={`tool-fab${cameraActive ? ' on' : ''}`}
            onClick={() => dispatch({ type: 'open-modal', modal: 'camera' })}
            aria-label="Camera Effects"
            title="Camera Effects"
            data-testid="cameraeffects-fab"
            data-tool="camera"
          >
            <IconCamera size={16} />
            {cameraActive && <span className="dot-active" aria-hidden />}
          </button>
        </>
      )}
      {themeFab}
    </div>
  );

  const fourCutWindow = state.modal === 'fourcut' && (
    <FourCutModal
      frame={state.frame}
      photos={photos}
      thumbs={fourCutThumbs}
      thumbsLoading={thumbsLoading}
      meta={composedMeta}
      defaultPad={engine ? engine.plate.defaults(state.frame.style).padPct : 4}
      busy={busy}
      onPatch={(patch) => dispatch({ type: 'set-frame', patch })}
      onMeta={editMeta}
      onAddFiles={(files) => void addFourCutFiles(files)}
      onReplaceSlot={(index, file) => void replaceSlot(index, file)}
      onRemoveSlot={removeSlot}
      onApply={applyFourCut}
      onClose={closeModal}
    />
  );

  const replaceInput = (
    <input
      ref={replaceRef}
      type="file"
      accept="image/*,video/*,.mp4,.mov,.webm,.m4v"
      hidden
      data-testid="replace-input"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (!files.length) return;
        setFourCutThumbs({});
        setFrameThumbs({});
        openAny(files);
      }}
    />
  );

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
      <>
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
        {fourCutWindow}
        {replaceInput}
        {floatingCluster(false)}
        {error && !fourCutWindow && (
          <div className="toast error" role="alert">
            {error}
            <button type="button" className="icon-btn tiny" onClick={() => setError(null)} aria-label="닫기">✕</button>
          </div>
        )}
      </>
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
          <HD2LabMark size={22} />
          <span className="brand-word">HD2Lab</span>
          <span className="brand-div">|</span>
          <span className="brand-sub strong">Nordlys</span>
        </button>

        <BackdropSwitch
          backdrop={state.frame.backdrop}
          onChange={(backdrop) => dispatch({ type: 'set-frame', patch: { backdrop } })}
        />

        <div className="topbar-meta">
          <span className="media-name" title={activeMedia?.name}>{activeMedia?.name}</span>
          <span className="media-spec">{activeMedia?.width}×{activeMedia?.height}{activeMedia?.kind === 'video' ? ` · ${state.trim.end.toFixed(1)}s` : ''}</span>
        </div>

        <div className="topbar-actions">
          <button type="button" className="chip on desktop-only" onClick={openFilterModal}>{filterLabel}</button>
          <button type="button" className="chip desktop-only" onClick={openFrameModal}>{FRAME_MAP[state.frame.style].label}</button>
          <button
            type="button"
            className="chip swap-btn"
            onClick={() => replaceRef.current?.click()}
            aria-label="사진 · 영상 교체"
            data-testid="replace-button"
          >
            <IconSwap size={14} /> 교체
          </button>
          <NavMenu
            hasMedia={state.media.length > 0}
            isPhoto={mediaKind === 'photo'}
            emblemMono={state.frame.emblemMono}
            samples={SAMPLES}
            onHome={() => setView('landing')}
            onReplace={() => replaceRef.current?.click()}
            onResetExif={() => setMetaOverride({})}
            onClear={() => { clearMedia(); dispatch({ type: 'clear-media' }); setView('landing'); }}
            onEmblemMono={(mono) => dispatch({ type: 'set-frame', patch: { emblemMono: mono } })}
            onSample={(sample) => void loadSample(sample)}
          />
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
            muted={muted}
            onToggleMute={toggleMute}
            onTime={onTime}
            onTogglePlay={togglePlay}
          />
          {showOriginal && <span className="compare-badge">원본</span>}
          {floatingCluster(true)}
        </div>

        {mediaKind === 'video' ? (
          <section className="transport" aria-label="재생과 트림">            <button
              type="button"
              className="play-btn"
              aria-label={state.playing ? '일시정지' : '재생'}
              onClick={togglePlay}
              data-testid="play-button"
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
                  accept="image/*"
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

        <FilterStrip
          selection={state.filter}
          thumbs={stripThumbs}
          margarineName={margarineName}
          onSelect={selectFilter}
          onOpenAll={openFilterModal}
        />

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
            <span>저장 / 공유</span>
            <small>{mediaKind === 'video' ? 'MP4 · H.264 + 사운드' : '원본 1:1'}</small>
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
      {fourCutWindow}
      {state.modal === 'colorlab' && (
        <ColorLabModal
          mixer={state.grade.colorMixer}
          onMixer={(mixer) => dispatch({ type: 'patch-mixer', mixer })}
          onClose={closeModal}
        />
      )}
      {state.modal === 'tonecurve' && (
        <ToneCurveModal
          curves={state.grade.curves}
          onCurves={(curves) => dispatch({ type: 'set-curves', curves })}
          onClose={closeModal}
        />
      )}
      {state.modal === 'camera' && (
        <CameraEffectsModal
          camera={state.grade.camera}
          filmId={state.grade.filmId}
          onDateStamp={(patch) => dispatch({ type: 'patch-date-stamp', patch })}
          onOptics={(patch) => dispatch({ type: 'patch-optics', patch })}
          onClose={closeModal}
        />
      )}
      {state.modal === 'adjust' && (
        <AdjustModal
          filmId={state.grade.filmId}
          filterLabel={filterLabel}
          adjustments={state.grade.adjustments}
          sharpening={state.grade.sharpening}
          mediaKind={mediaKind}
          duration={activeMedia?.duration ?? state.trim.end}
          fps={activeMedia?.fps ?? 30}
          inputGuard={state.inputGuard}
          trim={state.trim}
          onAdjustments={(patch) => dispatch({ type: 'patch-adjustments', patch })}
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
          onClose={closeModal}
        />
      )}

      {replaceInput}

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
