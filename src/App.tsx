import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Landing, SAMPLES, type SampleItem } from './components/Landing';
import { Stage, useLongPress, type MediaBank } from './components/Stage';
import { Timeline } from './components/Timeline';
import { FilterModal } from './components/FilterModal';
import { MargarineModal } from './components/MargarineModal';
import { EmblemModal } from './components/EmblemModal';
import { FrameModal } from './components/FrameModal';
import { FourCutModal } from './components/FourCutModal';
import { AdjustModal } from './components/AdjustModal';
import { ExportModal } from './components/ExportModal';
import { NavMenu } from './components/NavMenu';
import { FilterStrip, STRIP_FILTERS } from './components/FilterStrip';
import { ColorLabModal } from './components/ColorLabModal';
import { ToneCurveOverlay, curvesTouched } from './components/ToneCurveOverlay';
import { CameraEffectsModal } from './components/CameraEffectsModal';
import { BackdropSwitch, ThemeFab } from './components/ThemeControls';
import { OpenModal } from './components/OpenModal';
import { LeftSidebar, type SideTab } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { WorkspaceStrip } from './components/WorkspaceStrip';
import {
  IconCamera, IconDownload, IconFilm, IconFrame, IconPalette, IconPause, IconPlay, IconPlayback, IconSliders, IconSpline, IconSwap,
} from './components/Icons';
import { initialStudio, sessionOf, studioReducer, type StudioSession } from './state/studio';
import { loadPlateEngine, type SPEmblemsApi, type SPPlateApi } from './plate/engine';
import {
  customSpecs,
  customStyleOf,
  customThumb,
  deleteCustom,
  isCustomStyle,
  loadCustomEngine,
  loadCustomShelf,
  persistCustom,
  registerCustomSpec,
  setActiveFilm,
  type ShutterFrameSpec,
} from './plate/custom';
import { FILM_PROFILES } from './films/registry';
import { loadPhoto, loadVideo, mountCachedVideo, parkCachedVideo, releaseMedia } from './media/load';
import { closeAudioPath, openAudioPath, rebindAudioTrack, releaseAudio } from './media/audio';
import { routeFiles } from './media/route';
import { withSpecFallback } from './media/spec';
import {
  entriesFromFiles,
  scanDirectory,
  visibleWorkspace,
  type FsDirectoryHandle,
  type WorkspaceFile,
  type WorkspaceFilter,
  type WorkspaceSort,
} from './media/workspace';
import { clearWorkspaceThumbs } from './media/workspaceThumbs';
import { clearFilmThumbs, type FilmThumbSource } from './studio/filmThumbs';
import { buildFrameThumbs, buildFilterThumbs, type Cancellation } from './studio/thumbnails';
import { styleLabel, resolveEmblem } from './studio/render';
import { PhotoGrader, thumbnailSource } from './studio/grading';
import { exportMovie, exportStill } from './studio/exporters';
import { ALL_FILTERS, MARGARINE_FILTERS, margarinePreset } from './filters/catalog';
import { FRAME_MAP, FRAMES, SINGLE_FRAME_DEFS } from './plate/frames';
import { assetUrl } from './utils/assets';
import type { FilterOption } from './filters/catalog';
import type { FrameId, MediaInfo, PlateMeta, VideoExportOptions } from './types/studio';
import type { ModalKind } from './state/studio';
import type { ExportProgress } from './export/videoExporter';
import type { StillResult } from './studio/exporters';

const THEME_KEY = 'hd2-theme';
/** The studio splits into three columns from this width; below it the phone UI stays. */
const PC_QUERY = '(min-width: 1024px)';
/** A file's whole editing session: the grade, the frame and the cut. */
type EntrySession = StudioSession & { meta: Partial<PlateMeta> };

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
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
  const [stripThumbs, setStripThumbs] = useState<Record<string, string>>({});
  const [frameThumbs, setFrameThumbs] = useState<Record<string, string>>({});
  const [fourCutThumbs, setFourCutThumbs] = useState<Record<string, string>>({});
  const [customFrames, setCustomFrames] = useState<ShutterFrameSpec[]>([]);
  const [customThumbs, setCustomThumbs] = useState<Record<string, string>>({});
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [metaOverride, setMetaOverride] = useState<Partial<PlateMeta>>({});
  const [muted, setMuted] = useState(true);
  const [playbackOpen, setPlaybackOpen] = useState(false);
  /** Tone Curve is an overlay on the stage, not a sheet: it lives over the print. */
  const [toneCurveOpen, setToneCurveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* ── the wide studio ─────────────────────────────────────────────────────── */
  const isPC = useMediaQuery(PC_QUERY);
  const [sideTab, setSideTab] = useState<SideTab>('film');
  const [workspace, setWorkspace] = useState<{ name: string; entries: WorkspaceFile[] } | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [stripSort, setStripSort] = useState<WorkspaceSort>('name');
  const [stripFilter, setStripFilter] = useState<WorkspaceFilter>('all');
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const [stripHeight, setStripHeight] = useState(178);
  const [scanning, setScanning] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [openBusy, setOpenBusy] = useState<string | false>(false);
  /** Where the emblem window goes back to: the frame window, the 4-cut window, or nothing. */
  const [emblemReturn, setEmblemReturn] = useState<ModalKind>(null);

  const bank = useRef<MediaBank>({ photos: new Map(), video: null });
  const fileRef = useRef<File | null>(null);
  const cancelRef = useRef<Cancellation | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);
  /** One edit session per open file, kept for as long as the workspace is. */
  const sessions = useRef(new Map<string, EntrySession>());
  /** Clips already decoded, so walking back to one is instant. */
  const clips = useRef(new Map<string, { video: HTMLVideoElement; info: MediaInfo }>());
  const activeEntryRef = useRef<string | null>(null);
  const scanRef = useRef<{ cancelled: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const metaRef = useRef(metaOverride);
  metaRef.current = metaOverride;
  const sidebarFrameKey = useRef('');
  const sidebarFrameToken = useRef<Cancellation>({ cancelled: false });

  const activeMedia = state.media[state.activePhoto] ?? state.media[0] ?? null;
  const mediaKind = activeMedia?.kind ?? 'photo';
  const photos = useMemo(() => state.media.filter((item) => item.kind === 'photo'), [state.media]);
  const stripOrder = useMemo(
    () => (workspace ? visibleWorkspace(workspace.entries, stripSort, stripFilter) : []),
    [workspace, stripSort, stripFilter],
  );
  const activeStripIndex = useMemo(
    () => stripOrder.findIndex((entry) => entry.id === activeEntryId),
    [stripOrder, activeEntryId],
  );

  /* The playback sheet belongs to the clip that opened it: any new media
     (or a swap) starts from the plain bar again. */
  useEffect(() => { setPlaybackOpen(false); }, [activeMedia?.url]);

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

  /** The Margarine look in use, if any: the strip leads with its own card. */
  const activeMargarine = useMemo(
    () => (state.filter.kind === 'margarine'
      ? MARGARINE_FILTERS.find((filter) => filter.key === `mg-${state.filter.presetId}`) ?? null
      : null),
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

  /**
   * What `auto` prints for this file, whatever is chosen now: the emblem row
   * and the Auto card both say what the camera's own data would give.
   */
  const resolvedEmblem = useMemo(
    () => resolveEmblem({ ...state.frame, emblem: 'auto' }, composedMeta, engine?.emblems ?? null),
    [state.frame, composedMeta, engine],
  );

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

  /* ── custom frames: the shared engine, the shelf, and a #frame= link ────── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const api = await loadCustomEngine();
        const rows = await loadCustomShelf();
        for (const spec of rows) await api.primeOverlay(spec);
        if (!alive) return;
        setCustomFrames(customSpecs());
        const incoming = api.fromUrl(window.location.href);
        if (!incoming) return;
        await api.primeOverlay(incoming);
        registerCustomSpec(incoming);
        await persistCustom(incoming);
        if (!alive) return;
        setCustomFrames(customSpecs());
        dispatch({ type: 'set-frame', patch: { style: customStyleOf(incoming) as FrameId, enabled: true } });
        /* A link that carries a frame is an invitation to fill it: the 4-cut
           window is where the four photographs go, even on the landing. */
        dispatch({ type: 'open-modal', modal: 'fourcut' });
        setNotice(`'${incoming.name}' 커스텀 프레임을 불러왔습니다. 네 칸을 사진으로 채워 주세요.`);
        if (window.location.hash.includes('frame=') || window.location.search.includes('frame=')) {
          history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&]frame=[^&]*/, ''));
        }
      } catch {
        /* custom frames are an addition: the studio works without them */
      }
    })();
    return () => { alive = false; };
  }, []);

  /* The film the visitor picked fills {{film}} in a custom plate. */
  useEffect(() => {
    const profile = FILM_PROFILES[state.grade.filmId as keyof typeof FILM_PROFILES];
    setActiveFilm(profile?.name ?? '');
  }, [state.grade.filmId]);

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

  /* A sound fallback is information, not an error: it clears itself. */
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(id);
  }, [notice]);

  /* ── media loading ──────────────────────────────────────────────────────── */
  const clearMedia = useCallback(() => {
    state.media.forEach(releaseMedia);
    if (bank.current.video) {
      releaseAudio(bank.current.video);
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

  /**
   * Leaving a workspace releases everything it brought in — the decoded clips,
   * the image elements, the strip's stills — so a plain file afterwards starts
   * from a clean page.
   */
  /** Leaving a workspace releases everything it brought in — the decoded clips,
   *  the image elements, the strip's stills — so a plain file afterwards starts
   *  from a clean page. */
  const leaveWorkspace = useCallback(() => {
    sessions.current.clear();
    clips.current.forEach(({ video, info }) => {
      video.pause();
      video.remove();
      releaseMedia(info);
    });
    clips.current.clear();
    bank.current.photos.clear();
    clearWorkspaceThumbs();
    clearFilmThumbs();
    scanRef.current && (scanRef.current.cancelled = true);
    scanRef.current = null;
    activeEntryRef.current = null;
    setActiveEntryId(null);
    setWorkspace(null);
    setScanning(null);
    setOpenBusy(false);
  }, []);

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
      leaveWorkspace();
      clearMedia();
      bank.current.photos = new Map(loaded.map((item) => [item.info.url, item.drawable]));
      dispatch({ type: 'open-photos', media: loaded.map((item) => item.info) });
      setView('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 열지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [clearMedia, leaveWorkspace]);

  const openVideo = useCallback(async (file: File) => {
    setBusy('영상을 분석하는 중…');
    setError(null);
    try {
      // loadVideo already parked its element in the page (the decoder needs it
      // there); clearing here only drops the previous clip.
      const loaded = await loadVideo(file);
      leaveWorkspace();
      clearMedia();
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
  }, [clearMedia, leaveWorkspace]);

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

  /* ── workspace: files, sessions, walking the strip ──────────────────────── */

  /** Save the look on screen under the file that owns it. */
  const rememberSession = useCallback((id: string | null) => {
    if (!id) return;
    sessions.current.set(id, { ...sessionOf(stateRef.current), meta: metaRef.current });
  }, []);

  const pruneClips = useCallback((keepId: string) => {
    // Three decoded clips is plenty to walk back through; the fourth gives its
    // decoder and its blob URL back.
    while (clips.current.size > 3) {
      const oldest = [...clips.current.keys()].find((id) => id !== keepId);
      if (!oldest) break;
      const entry = clips.current.get(oldest);
      if (entry) {
        entry.video.pause();
        entry.video.remove();
        releaseMedia(entry.info);
      }
      clips.current.delete(oldest);
    }
  }, []);

  /** Open one file of the workspace, carrying its own session back with it. */
  const activateEntry = useCallback(async (entry: WorkspaceFile) => {
    if (!entry || activeEntryRef.current === entry.id) return;
    rememberSession(activeEntryRef.current);
    setBusy(entry.kind === 'photo' ? '사진을 여는 중…' : '영상을 분석하는 중…');
    setError(null);
    try {
      if (entry.kind === 'photo') {
        const loaded = await loadPhoto(entry.file);
        bank.current.photos.set(loaded.info.url, loaded.drawable);
        // Twelve decoded stills is more than a walk back needs; the rest drop
        // their elements and the blob URL that fed them.
        while (bank.current.photos.size > 12) {
          const oldest = [...bank.current.photos.keys()].find((url) => url !== loaded.info.url);
          if (!oldest) break;
          bank.current.photos.delete(oldest);
          try { URL.revokeObjectURL(oldest); } catch { /* already gone */ }
        }
        const previous = bank.current.video;
        if (previous) {
          parkCachedVideo(previous);
          releaseAudio(previous);
        }
        bank.current.video = null;
        fileRef.current = null;
        dispatch({ type: 'open-photos', media: [loaded.info] });
        setMuted(true);
      } else {
        const cached = clips.current.get(entry.id);
        const loaded = cached ?? await loadVideo(entry.file);
        if (!cached) {
          clips.current.set(entry.id, loaded);
          pruneClips(entry.id);
        }
        const previous = bank.current.video;
        if (previous && previous !== loaded.video) {
          parkCachedVideo(previous);
          releaseAudio(previous);
        }
        mountCachedVideo(loaded.video);
        bank.current.video = loaded.video;
        fileRef.current = entry.file;
        dispatch({ type: 'open-video', media: loaded.info });
        setMuted(true);
      }
      const saved = sessions.current.get(entry.id);
      if (saved) {
        const { meta, ...session } = saved;
        setMetaOverride(meta);
        dispatch({ type: 'restore-session', session });
      } else {
        setMetaOverride({});
      }
      activeEntryRef.current = entry.id;
      setActiveEntryId(entry.id);
      setView('editor');
      setPlaybackOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '파일을 열지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [pruneClips, rememberSession]);

  /** A folder is ready: drop what was open and walk in. */
  const startWorkspace = useCallback((name: string, entries: WorkspaceFile[]) => {
    if (!entries.length) {
      setOpenBusy(false);
      setError('이 폴더에 지원하는 사진·동영상이 없습니다 — JPEG · PNG · WebP 사진 또는 MP4 · MOV · WebM 영상을 넣어 주세요.');
      return;
    }
    // Whatever the studio held belongs to the old session.
    stateRef.current.media.forEach(releaseMedia);
    const previous = bank.current.video;
    if (previous) {
      previous.pause();
      releaseAudio(previous);
      previous.remove();
    }
    bank.current.video = null;
    bank.current.photos.clear();
    fileRef.current = null;
    sessions.current.clear();
    clips.current.forEach(({ video, info }) => { video.pause(); video.remove(); releaseMedia(info); });
    clips.current.clear();
    clearWorkspaceThumbs();
    activeEntryRef.current = null;
    setActiveEntryId(null);
    setMetaOverride({});
    setWorkspace({ name, entries });
    setStripSort('name');
    setStripFilter('all');
    setStripCollapsed(false);
    setOpenBusy(false);
    setOpenModal(false);
    void activateEntry(entries[0]);
  }, [activateEntry]);

  const openWorkspaceFiles = useCallback((files: File[], recursive: boolean) => {
    setOpenBusy('폴더 목록을 읽는 중…');
    const scan = entriesFromFiles(files, { recursive });
    if (!scan.entries.length) {
      setOpenBusy(false);
      setError('이 폴더에 지원하는 사진·동영상이 없습니다.');
      return;
    }
    startWorkspace(scan.name, scan.entries);
  }, [startWorkspace]);

  const openWorkspaceHandle = useCallback(async (handle: FsDirectoryHandle, recursive: boolean) => {
    setOpenBusy('폴더 목록을 읽는 중…');
    const signal = { cancelled: false };
    scanRef.current = signal;
    let found = 0;
    try {
      const entries = await scanDirectory(handle, {
        recursive,
        signal,
        onBatch: (batch) => {
          found += batch.length;
          setOpenBusy(`폴더 목록을 읽는 중… ${found}개`);
        },
      });
      if (signal.cancelled) return;
      if (!entries.length) {
        setOpenBusy(false);
        setError('이 폴더에 지원하는 사진·동영상이 없습니다.');
        return;
      }
      startWorkspace(handle.name, entries);
    } catch (err) {
      setOpenBusy(false);
      setError(err instanceof Error ? err.message : '폴더를 열지 못했습니다.');
    }
  }, [startWorkspace]);

  /** ← / → through the strip, in the order it is showing. */
  const stepWorkspace = useCallback((direction: -1 | 1) => {
    if (!workspace) return;
    const order = visibleWorkspace(workspace.entries, stripSort, stripFilter);
    if (!order.length) return;
    const index = order.findIndex((entry) => entry.id === activeEntryRef.current);
    const next = index < 0 ? 0 : Math.min(order.length - 1, Math.max(0, index + direction));
    const target = order[next];
    if (target && target.id !== activeEntryRef.current) void activateEntry(target);
  }, [workspace, stripSort, stripFilter, activateEntry]);

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

  /**
   * The strip's build covers the ten stocks and RETRO 90; a Margarine look in
   * use gets its own still here, so its card shows the look and not its key.
   */
  useEffect(() => {
    if (view !== 'editor' || !activeMedia || !activeMargarine) return;
    if (stripThumbs[activeMargarine.key]) return;
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
      filters: [activeMargarine],
      width: 104,
      onEach: (key, url) => setStripThumbs((previous) => ({ ...previous, [key]: url })),
      token,
    }).finally(() => grader.destroy());
    return () => { token.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeMedia?.url, activeMargarine?.key]);

  /** Every filter's own still, for the film shelf and the filter window. */
  const buildAllFilterThumbs = useCallback((options: { token?: Cancellation; silent?: boolean } = {}) => {
    if (!activeMedia) return;
    const token = options.token ?? { cancelled: false };
    if (!options.token) {
      if (cancelRef.current) cancelRef.current.cancelled = true;
      cancelRef.current = { cancelled: false };
      setThumbsLoading(true);
    }
    const source = thumbnailSource({
      kind: activeMedia.kind,
      drawable: bank.current.photos.get(activeMedia.url) ?? null,
      video: bank.current.video,
    });
    if (!source) { if (!options.silent) setThumbsLoading(false); return; }
    void withGrader((grader) => buildFilterThumbs({
      grader,
      source,
      sourceWidth: activeMedia.width,
      sourceHeight: activeMedia.height,
      filters: ALL_FILTERS,
      onEach: (key, url) => setFilterThumbs((previous) => ({ ...previous, [key]: url })),
      token,
    })).finally(() => { if (!options.silent && !token.cancelled) setThumbsLoading(false); });
  }, [activeMedia, withGrader]);

  const openFilterModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'filter' });
    buildAllFilterThumbs();
  }, [buildAllFilterThumbs]);

  /** The 58 Margarine looks, in their own window: its live stills come from the same build. */
  const openMargarineModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'margarine' });
    buildAllFilterThumbs();
  }, [buildAllFilterThumbs]);

  /** The eleven maker marks. Opened from a sheet, closing it hands that sheet back. */
  const openEmblemModal = useCallback((from: ModalKind = null) => {
    setEmblemReturn(from);
    dispatch({ type: 'open-modal', modal: 'emblem' });
  }, []);

  const buildThumbs = useCallback((
    ids: FrameId[],
    target: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    options: { token?: Cancellation; silent?: boolean; width?: number } = {},
  ) => {
    if (!engine || !activeMedia) return;
    const token = options.token ?? { cancelled: false };
    if (!options.token) {
      setThumbsLoading(true);
      if (cancelRef.current) cancelRef.current.cancelled = true;
      cancelRef.current = { cancelled: false };
    }
    const source = thumbnailSource({
      kind: activeMedia.kind,
      drawable: bank.current.photos.get(activeMedia.url) ?? null,
      video: bank.current.video,
    });
    if (!source) { if (!options.silent) setThumbsLoading(false); return; }
    void withGrader(async (grader) => {
      const width = options.width ?? 640;
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
      if (!options.silent && !token.cancelled) setThumbsLoading(false);
    });
  }, [engine, activeMedia, state.grade, state.frame, state.media, composedMeta, withGrader]);

  const openFrameModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'frame' });
    buildThumbs(SINGLE_FRAME_DEFS.map((frame) => frame.id), setFrameThumbs);
  }, [buildThumbs]);

  /* ── custom frames: shelf previews, import, delete ──────────────────────── */
  const buildCustomThumbs = useCallback(() => {
    if (!customFrames.length || !activeMedia) { setCustomThumbs({}); return; }
    const slotImages = photos.slice(0, 4).map((item) => ({
      img: (bank.current.photos.get(item.url) ?? null) as CanvasImageSource | null,
      w: item.width,
      h: item.height,
    }));
    const next: Record<string, string> = {};
    customFrames.forEach((spec) => {
      const url = customThumb(spec, { slots: slotImages, meta: composedMeta, width: 148 });
      if (url) next[spec.id] = url;
    });
    setCustomThumbs(next);
  }, [customFrames, activeMedia, photos, composedMeta]);

  useEffect(() => { buildCustomThumbs(); }, [buildCustomThumbs]);

  const applyCustomSpec = useCallback(async (spec: ShutterFrameSpec) => {
    const api = await loadCustomEngine();
    await api.primeOverlay(spec);
    registerCustomSpec(spec);
    await persistCustom(spec);
    setCustomFrames(customSpecs());
    dispatch({ type: 'set-frame', patch: { style: customStyleOf(spec) as FrameId, enabled: true } });
    setNotice(`'${spec.name}' 커스텀 프레임을 불러왔습니다.`);
    if (!state.media.length) dispatch({ type: 'open-modal', modal: 'fourcut' });
  }, [state.media.length]);

  const importCustomText = useCallback(async (text: string) => {
    try {
      const api = await loadCustomEngine();
      const spec = api.decode(text) ?? api.parse(text).spec;
      if (!spec) {
        setError('프레임을 읽지 못했습니다. .shutterframe.json 파일이나 #frame= 링크인지 확인해 주세요.');
        return;
      }
      await applyCustomSpec(spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : '프레임을 불러오지 못했습니다.');
    }
  }, [applyCustomSpec]);

  const importCustomFile = useCallback(async (file: File) => {
    const text = await file.text();
    await importCustomText(text);
  }, [importCustomText]);

  const removeCustomFrame = useCallback(async (id: string) => {
    await deleteCustom(id);
    setCustomFrames(customSpecs());
    if (state.frame.style === `custom:${id}`) dispatch({ type: 'set-frame', patch: { style: 'fyra04', enabled: true } });
    setNotice('커스텀 프레임을 삭제했습니다.');
  }, [state.frame.style]);

  const openFourCutModal = useCallback(() => {
    dispatch({ type: 'open-modal', modal: 'fourcut' });
    buildThumbs(['contact', 'fyra04'], setFourCutThumbs);
    buildCustomThumbs();
  }, [buildThumbs, buildCustomThumbs]);

  const closeModal = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    // The emblem window sits on top of a frame or 4-cut window: closing it
    // returns there rather than dropping the visitor back into the studio.
    const back = emblemReturn;
    setEmblemReturn(null);
    dispatch({ type: 'open-modal', modal: back ?? null });
  }, [emblemReturn]);

  /* ── the wide studio's shelves: previews are built once per open file ───── */
  /** The frame the shelf's stills are graded from, one per open file. */
  const filmThumbSource = useMemo<FilmThumbSource | null>(() => {
    if (!activeMedia) return null;
    const source = thumbnailSource({
      kind: activeMedia.kind,
      drawable: bank.current.photos.get(activeMedia.url) ?? null,
      video: bank.current.video,
    });
    if (!source) return null;
    return {
      mediaKey: `${activeMedia.url}|${state.grade.filmId}`,
      source,
      width: activeMedia.width,
      height: activeMedia.height,
    };
  }, [activeMedia, state.grade.filmId]);

  useEffect(() => {
    if (!isPC || view !== 'editor' || sideTab !== 'frame' || !activeMedia || !engine) return;
    const key = `${activeMedia.url}|${state.grade.filmId}`;
    if (sidebarFrameKey.current === key) return;
    sidebarFrameKey.current = key;
    sidebarFrameToken.current.cancelled = true;
    sidebarFrameToken.current = { cancelled: false };
    buildThumbs(FRAMES.map((frame) => frame.id), setFrameThumbs, { token: sidebarFrameToken.current, silent: true, width: 360 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPC, view, sideTab, activeMedia?.url, engine, state.grade.filmId]);

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
    // A 4-cut plate is a frame: applying it shows what was chosen.
    if (!state.frame.enabled) dispatch({ type: 'set-frame', patch: { enabled: true } });
    setView('editor');
  }, [photos.length, state.frame.enabled]);

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
  /**
   * Sound is turned on inside the visitor's own tap, never a render later:
   * the element is unmuted at full volume, the audio context is resumed and the
   * element routed through it, and a clip that was already running silently has
   * its audio track rebound on the same frame (the Android requirement).
   */
  const soundOn = useCallback(async (video: HTMLVideoElement, startIfPaused: boolean) => {
    const wasPlaying = !video.paused;
    try {
      await openAudioPath(video);
      if (startIfPaused && !wasPlaying) await video.play();
      else if (wasPlaying) await rebindAudioTrack(video);
      setMuted(false);
    } catch {
      // The browser refused sound with playback. Go silent instead of leaving
      // the clip frozen, and say so once.
      closeAudioPath(video);
      setMuted(true);
      setNotice('브라우저가 소리 있는 재생을 막아 음소거로 재생합니다.');
      void video.play().catch(() => undefined);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const video = bank.current.video;
    const next = !state.playing;
    if (video && next) {
      if (!muted) void video.play().catch(() => undefined);
      else void soundOn(video, true);
    }
    dispatch({ type: 'set-playing', playing: next });
  }, [state.playing, muted, soundOn]);

  const toggleMute = useCallback(() => {
    const video = bank.current.video;
    if (!video) return;
    // A clip without an audio track offers no sound button to press.
    if (activeMedia?.hasAudio === false) return;
    if (muted) {
      if (!state.playing) dispatch({ type: 'set-playing', playing: true });
      void soundOn(video, true);
    } else {
      closeAudioPath(video);
      setMuted(true);
    }
  }, [muted, state.playing, soundOn, activeMedia]);

  /* ── the curve overlay yields to a sheet, and to leaving the editor ─────── */
  useEffect(() => {
    if (state.modal || view !== 'editor') setToneCurveOpen(false);
  }, [state.modal, view]);

  /* ── keyboard ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (view !== 'editor' || state.modal || openModal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return;
      // The wide studio keeps its two shelves on the rails: F and R show them
      // instead of raising a sheet over the print.
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        if (isPC) setSideTab('film'); else openFilterModal();
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        if (isPC) setSideTab('frame'); else openFrameModal();
      }
      if (event.key === 'e' || event.key === 'E') { event.preventDefault(); dispatch({ type: 'open-modal', modal: 'export' }); }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && isPC && workspace) {
        event.preventDefault();
        stepWorkspace(event.key === 'ArrowRight' ? 1 : -1);
      }
      if (event.code === 'Space' && mediaKind === 'video') { event.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, state.modal, openModal, mediaKind, isPC, workspace, stepWorkspace, openFilterModal, openFrameModal, togglePlay]);

  /* ── stage gestures ─────────────────────────────────────────────────────── */
  const longPress = useLongPress(setShowOriginal);
  const seek = useCallback((seconds: number) => {
    const video = bank.current.video;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, seconds));
    dispatch({ type: 'set-time', time: video.currentTime });
  }, []);

  const onTime = useCallback((seconds: number) => dispatch({ type: 'set-time', time: seconds }), []);

  /** The element learns a clip's real length from `durationchange`; the trim
   *  bar and the spec row take it from there. */
  const onDuration = useCallback((seconds: number) => dispatch({ type: 'set-duration', duration: seconds }), []);

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
   * The 4-cut door. On the landing it sits alone above the theme toggle; in the
   * editor it leads the four tool discs of the utility bar under the stage.
   */
  const fourCutButton = (
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
  );

  /** The four tool discs, centre of the utility bar: 4-cut, Color Lab, Tone Curve, Camera Effects. */
  const toolDiscs = (
    <>
      {fourCutButton}
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
        className={`tool-fab${curvesActive || toneCurveOpen ? ' on' : ''}`}
        onClick={() => {
          // The curve floats over the stage; any sheet that opens takes its
          // place, and a second press on the disc closes it.
          setToneCurveOpen((open) => !open);
        }}
        aria-label="Tone Curve"
        aria-expanded={toneCurveOpen}
        aria-controls="tone-curve-overlay"
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
  );

  /**
   * The corner cluster. On the landing and over the wide stage only the
   * 4-cut door and the theme toggle are left — the three colour tools live on
   * the right rail there.
   */
  const floatingCluster = (inStage: boolean) => (
    <div className={`float-cluster${inStage ? ' in-stage' : ''}`} data-testid="float-cluster">
      {(!inStage || isPC) && fourCutButton}
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
      defaultPad={engine && !isCustomStyle(state.frame.style) ? engine.plate.defaults(state.frame.style).padPct : 4}
      customFrames={customFrames}
      customThumbs={customThumbs}
      onImportCustom={(file) => void importCustomFile(file)}
      onPasteCustom={(text) => void importCustomText(text)}
      onDeleteCustom={(id) => void removeCustomFrame(id)}
      busy={busy}
      emblems={engine?.emblems ?? null}
      resolvedEmblem={resolvedEmblem}
      onOpenEmblem={() => openEmblemModal('fourcut')}
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

  /** The two-door window: only a wide screen offers a workspace as well. */
  const openWindow = openModal && (
    <OpenModal
      busy={openBusy}
      error={error}
      onClose={() => { setOpenModal(false); setOpenBusy(false); }}
      onFiles={(files) => { setOpenModal(false); openAny(files); }}
      onWorkspaceFiles={(files, recursive) => openWorkspaceFiles(files, recursive)}
      onWorkspaceHandle={(handle, recursive) => void openWorkspaceHandle(handle, recursive)}
      onDismissError={() => setError(null)}
    />
  );

  /** Asking for a file: a modal on a wide screen, the plain picker on a phone. */
  const requestOpen = () => { if (isPC) setOpenModal(true); };

  /* ── landing ────────────────────────────────────────────────────────────── */
  if (engineError) {
    return (
      <div className="fatal">
        <h1>스튜디오를 열 수 없습니다</h1>
        <p>{engineError}</p>
      </div>
    );
  }

  if (view === 'landing' || (!state.media.length && !workspace)) {
    return (
      <>
        <Landing
          busy={busy}
          error={error}
          hasSession={state.media.length > 0}
          sessionLabel={editorSessionLabel}
          isPhoto={mediaKind === 'photo'}
          emblemMono={state.frame.emblemMono}
          onOpenPhotos={(files) => void openPhotos(files)}
          onOpenVideo={(file) => void openVideo(file)}
          onLoadSample={(sample) => void loadSample(sample)}
          onPickFrame={(id) => void pickFrame(id)}
          onContinue={() => setView('editor')}
          onDismissError={() => setError(null)}
          onResetExif={() => setMetaOverride({})}
          onClear={() => { clearMedia(); leaveWorkspace(); dispatch({ type: 'clear-media' }); setView('landing'); }}
          onEmblemMono={(mono) => dispatch({ type: 'set-frame', patch: { emblemMono: mono } })}
          onOpenRequest={isPC ? requestOpen : undefined}
        />
        {fourCutWindow}
        {openWindow}
        {replaceInput}
        {floatingCluster(false)}
        {notice && !fourCutWindow && (
          <div className="toast is-notice" role="status">
            {notice}
            <button type="button" className="icon-btn tiny" onClick={() => setNotice(null)} aria-label="닫기">✕</button>
          </div>
        )}
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

  if (!state.media.length) {
    return (
      <div className="boot">
        <span className="spinner" aria-hidden />
        <p>워크스페이스를 여는 중…</p>
      </div>
    );
  }

  const padDefault = isCustomStyle(state.frame.style) ? 0 : engine.plate.defaults(state.frame.style).padPct;
  const frameLabel = state.frame.enabled
    ? styleLabel(state.frame.style, FRAME_MAP[state.frame.style]?.label ?? '커스텀 프레임')
    : '프레임 꺼짐';
  const plateSizeLabel = (() => {
    const media = activeMedia;
    if (!media) return '';
    if (!state.frame.enabled) return `프레임 없음 · 원본 ${media.width}×${media.height}`;
    const pad = Math.round((state.frame.padPct ?? padDefault) * 10) / 10;
    return `원본 ${media.width}×${media.height} · 여백 ${pad}%`;
  })();

  const saveShareChip = (
    <button
      type="button"
      className="chip save-chip"
      onClick={() => dispatch({ type: 'open-modal', modal: 'export' })}
      aria-label="저장 / 공유"
      title="저장 / 공유"
      data-testid="topbar-save"
    >
      <IconDownload size={14} />
      <span className="chip-label">저장 / 공유</span>
    </button>
  );

  return (
    <div className={`app${isPC ? ' is-pc' : ''}`}>
      <header className="topbar">
        {/* The Web-HQ lockup every HD2Lab title carries: [mark] HD2Lab | CinePlate. */}
        <button
          type="button"
          className="brand"
          onClick={() => setView('landing')}
          aria-label="CinePlate 홈으로 이동"
          title="CinePlate 홈 — 랜딩 화면"
        >
          <span className="mark" aria-hidden />
          <span className="brand-name">HD2Lab</span>
          <em>CinePlate</em>
        </button>

        <div className="topbar-actions">
          <button
            type="button"
            className="chip on desktop-only"
            onClick={() => { if (isPC) setSideTab('film'); else openFilterModal(); }}
          >
            {filterLabel}
          </button>
          <button
            type="button"
            className="chip desktop-only"
            onClick={() => { if (isPC) setSideTab('frame'); else openFrameModal(); }}
          >
            {frameLabel}
          </button>
          <BackdropSwitch
            backdrop={state.frame.backdrop}
            onChange={(backdrop) => dispatch({ type: 'set-frame', patch: { backdrop } })}
          />
          <button
            type="button"
            className="chip swap-btn"
            onClick={() => (isPC ? setOpenModal(true) : replaceRef.current?.click())}
            aria-label="사진 · 영상 교체"
            data-testid="replace-button"
          >
            <IconSwap size={14} /> <span className="chip-label">교체</span>
          </button>
          {isPC && saveShareChip}
          <NavMenu
            hasMedia={state.media.length > 0}
            isPhoto={mediaKind === 'photo'}
            emblemMono={state.frame.emblemMono}
            samples={SAMPLES}
            onHome={() => setView('landing')}
            onReplace={() => (isPC ? setOpenModal(true) : replaceRef.current?.click())}
            onResetExif={() => setMetaOverride({})}
            onClear={() => { clearMedia(); leaveWorkspace(); dispatch({ type: 'clear-media' }); setView('landing'); }}
            onEmblemMono={(mono) => dispatch({ type: 'set-frame', patch: { emblemMono: mono } })}
            onSample={(sample) => void loadSample(sample)}
          />
        </div>
      </header>

      {isPC ? (
        <main className="workbench is-pc" data-testid="studio-pc">
          <LeftSidebar
            tab={sideTab}
            onTab={setSideTab}
            media={activeMedia}
            index={activeStripIndex >= 0 ? activeStripIndex + 1 : null}
            total={stripOrder.length}
            workspaceName={workspace?.name ?? null}
            revision={state.revision}
            filter={state.filter}
            strength={state.grade.adjustments.filmStrength}
            thumbSource={filmThumbSource}
            onSelectFilter={selectFilter}
            onStrength={(value) => dispatch({ type: 'patch-adjustments', patch: { filmStrength: value } })}
            thumbsLoading={thumbsLoading}
            frame={state.frame}
            mediaKind={mediaKind}
            defaultPad={padDefault}
            meta={composedMeta}
            frameThumbs={frameThumbs}
            onPatchFrame={(patch) => dispatch({ type: 'set-frame', patch })}
            onMeta={editMeta}
            onOpenFourCut={openFourCutModal}
            customFrames={customFrames}
            customThumbs={customThumbs}
            onOpenMargarine={openMargarineModal}
            emblems={engine.emblems}
            resolvedEmblem={resolvedEmblem}
            onOpenEmblem={() => openEmblemModal(null)}
          />

          <div className="pc-center">
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
                onDuration={onDuration}
                onTogglePlay={togglePlay}
              />
              {toneCurveOpen && (
                <ToneCurveOverlay
                  curves={state.grade.curves}
                  onCurves={(curves) => dispatch({ type: 'set-curves', curves })}
                  onClose={() => setToneCurveOpen(false)}
                />
              )}
              {showOriginal && <span className="compare-badge">원본</span>}
              {floatingCluster(true)}
            </div>

            {mediaKind === 'video' && (
              <div className="pc-transport" data-testid="pc-transport">
                <button
                  type="button"
                  className="play-btn"
                  aria-label={state.playing ? '일시정지' : '재생'}
                  onClick={togglePlay}
                  data-testid="play-button"
                >
                  {state.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
                </button>
                <Timeline
                  duration={state.trim.end || activeMedia?.duration || 0}
                  trim={state.trim}
                  time={state.currentTime}
                  playing={state.playing}
                  onTrim={(trim) => dispatch({ type: 'set-trim', trim })}
                  onSeek={seek}
                />
                <span className="pc-spec">
                  {activeMedia?.width}×{activeMedia?.height} · {(state.trim.end || activeMedia?.duration || 0).toFixed(1)}s
                </span>
              </div>
            )}

            {workspace && (
              <WorkspaceStrip
                name={workspace.name}
                entries={workspace.entries}
                activeId={activeEntryId}
                sort={stripSort}
                filter={stripFilter}
                collapsed={stripCollapsed}
                height={stripHeight}
                scanning={scanning}
                onSort={setStripSort}
                onFilter={setStripFilter}
                onCollapse={setStripCollapsed}
                onHeight={setStripHeight}
                onSelect={(entry) => void activateEntry(entry)}
                onStep={stepWorkspace}
                onOpenFolder={() => setOpenModal(true)}
              />
            )}
          </div>

          <RightSidebar
            filterLabel={filterLabel}
            adjustments={state.grade.adjustments}
            sharpening={state.grade.sharpening}
            mediaKind={mediaKind}
            duration={activeMedia?.duration ?? state.trim.end}
            fps={activeMedia?.fps ?? 30}
            inputGuard={state.inputGuard}
            trim={state.trim}
            active={{ mixer: mixerActive, curves: curvesActive, curveOpen: toneCurveOpen, camera: cameraActive }}
            onAdjustments={(patch) => dispatch({ type: 'patch-adjustments', patch })}
            onSharpening={(patch) => dispatch({ type: 'patch-sharpening', patch })}
            onTrim={(trim) => dispatch({ type: 'set-trim', trim })}
            onInputGuard={(guard) => dispatch({ type: 'set-input-guard', guard })}
            onReset={() => dispatch({ type: 'reset-grade' })}
            onOpenColorLab={() => dispatch({ type: 'open-modal', modal: 'colorlab' })}
            onOpenCamera={() => dispatch({ type: 'open-modal', modal: 'camera' })}
            onToggleCurve={() => setToneCurveOpen((open) => !open)}
          />
        </main>
      ) : (
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
              onDuration={onDuration}
              onTogglePlay={togglePlay}
            />
            {toneCurveOpen && (
              <ToneCurveOverlay
                curves={state.grade.curves}
                onCurves={(curves) => dispatch({ type: 'set-curves', curves })}
                onClose={() => setToneCurveOpen(false)}
              />
            )}
            {showOriginal && <span className="compare-badge">원본</span>}
            {floatingCluster(true)}
          </div>

          {/* One bar for both kinds: what is open on the left, the four tools in
              the middle, and — for a clip — the playback sheet on the right. */}
          <section
            className={`utility-bar${mediaKind === 'video' && playbackOpen ? ' is-playback' : ''}`}
            aria-label="파일 정보와 도구"
            data-testid="utility-bar"
          >
            {mediaKind === 'video' && playbackOpen && (
              <div className="playback-overlay" data-testid="playback-overlay">
                <button
                  type="button"
                  className="play-btn"
                  aria-label={state.playing ? '일시정지' : '재생'}
                  onClick={togglePlay}
                  data-testid="play-button"
                >
                  {state.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
                </button>
                <Timeline
                  duration={state.trim.end || activeMedia?.duration || 0}
                  trim={state.trim}
                  time={state.currentTime}
                  playing={state.playing}
                  onTrim={(trim) => dispatch({ type: 'set-trim', trim })}
                  onSeek={seek}
                />
              </div>
            )}

            <div className="utility-meta">
              <span className="media-name" title={activeMedia?.name}>{activeMedia?.name}</span>
              <span className="media-spec">
                {activeMedia?.width}×{activeMedia?.height}
                {mediaKind === 'video' ? ` · ${(state.trim.end || activeMedia?.duration || 0).toFixed(1)}s` : ''}
              </span>
            </div>

            <div className="utility-tools">{toolDiscs}</div>

            <button
              type="button"
              className={`playback-toggle${mediaKind === 'video' && playbackOpen ? ' on' : ''}`}
              onClick={() => setPlaybackOpen((open) => !open)}
              disabled={mediaKind !== 'video'}
              aria-disabled={mediaKind !== 'video'}
              aria-expanded={mediaKind === 'video' ? playbackOpen : false}
              aria-label="재생 · 트림 바"
              title={mediaKind === 'video' ? '재생 · 트림 바' : '영상에서 열립니다'}
              data-testid="playback-overlay-toggle"
            >
              <IconPlayback size={17} />
            </button>
          </section>

          <FilterStrip
            selection={state.filter}
            thumbs={stripThumbs}
            margarineName={margarineName}
            onSelect={selectFilter}
            onOpenMargarine={openMargarineModal}
          />

          <nav className="dock" aria-label="스튜디오 도구">
            <button type="button" className="dock-btn primary" onClick={() => (state.filter.kind === 'margarine' ? openMargarineModal() : openFilterModal())} data-testid="dock-filter">
              <IconFilm size={21} />
              <span>필터 선택</span>
              <small>{filterLabel}</small>
            </button>
            <button type="button" className="dock-btn" onClick={openFrameModal} data-testid="dock-frame">
              <IconFrame size={21} />
              <span>프레임 선택</span>
              <small>{frameLabel}</small>
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
      )}

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
      {state.modal === 'margarine' && (
        <MargarineModal
          selection={state.filter}
          strength={state.grade.adjustments.filmStrength}
          thumbs={filterThumbs}
          onSelect={selectFilter}
          onStrength={(value) => dispatch({ type: 'patch-adjustments', patch: { filmStrength: value } })}
          onClose={closeModal}
        />
      )}
      {state.modal === 'emblem' && (
        <EmblemModal
          value={state.frame.emblem}
          resolved={resolvedEmblem}
          mono={state.frame.emblemMono}
          backdrop={state.frame.backdrop}
          emblems={engine?.emblems ?? null}
          onPatch={(patch) => dispatch({ type: 'set-frame', patch })}
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
          emblems={engine.emblems}
          resolvedEmblem={resolvedEmblem}
          onOpenEmblem={() => openEmblemModal('frame')}
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
      {state.modal === 'export' && activeMedia && (
        <ExportModal
          media={activeMedia}
          trim={state.trim}
          filterLabel={filterLabel}
          frameLabel={frameLabel}
          plateSize={plateSizeLabel}
          onExportStill={exportStillHandler}
          onExportMovie={exportMovieHandler}
          onClose={closeModal}
        />
      )}

      {openWindow}
      {replaceInput}

      {thumbsLoading && <span className="sr-only" role="status">썸네일을 그리는 중</span>}
      {busy && (
        <div className="studio-busy" role="status" data-testid="studio-busy">
          <span className="spinner" aria-hidden />
          <p>{typeof busy === 'string' ? busy : '여는 중…'}</p>
        </div>
      )}
      {notice && (
        <div className="toast is-notice" role="status">
          {notice}
          <button type="button" className="icon-btn tiny" onClick={() => setNotice(null)} aria-label="닫기">✕</button>
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          {error}
          <button type="button" className="icon-btn tiny" onClick={() => setError(null)} aria-label="닫기">✕</button>
        </div>
      )}
    </div>
  );
}
