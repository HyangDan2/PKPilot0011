import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_FILTERS, MARGARINE_GROUPS, type FilterOption } from '../filters/catalog';
import { FRAME_MAP, FRAMES, FYRA_THEME_LABELS, MULTI_FRAME_DEFS, SINGLE_FRAME_DEFS } from '../plate/frames';
import { Field, Segmented, Slider, Toggle } from './controls';
import { IconCheck, IconFolder, IconSearch } from './Icons';
import { cachedFilmThumb, requestFilmThumb, type FilmThumbSource } from '../studio/filmThumbs';
import { customStyleOf, type ShutterFrameSpec } from '../plate/custom';
import type { FilterSelection, FrameId, FrameSettings, MediaInfo, MediaKind, PlateMeta } from '../types/studio';

export type SideTab = 'film' | 'frame';

interface ExplorerPreviewProps {
  media: MediaInfo | null;
  /** Position in the strip's own order, 1-based; null when this is not a workspace. */
  index: number | null;
  total: number;
  workspaceName: string | null;
  /** Bumped whenever the plate repaints, so the card follows the stage. */
  revision: number;
}

/**
 * The plate, small, at the head of the left rail: what is open, its own size,
 * and which file of the folder it is. It reads the stage's own canvas rather
 * than grading a second copy, so the card can never disagree with the print.
 */
export function ExplorerPreview({ media, index, total, workspaceName, revision }: ExplorerPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!media) return;
    let frame = 0;
    let interval = 0;
    const paint = () => {
      const source = document.querySelector<HTMLCanvasElement>('[data-testid="plate-canvas"]');
      const target = canvasRef.current;
      if (!source || !target || !source.width || !source.height) return;
      const ctx = target.getContext('2d');
      if (!ctx) return;
      const { width, height } = target;
      ctx.fillStyle = '#05070e';
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width / source.width, height / source.height);
      const w = source.width * scale;
      const h = source.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
    };
    // The stage paints on its own schedule; one frame later is enough for a
    // still, and a clip keeps its card moving while it plays.
    frame = window.requestAnimationFrame(() => window.requestAnimationFrame(paint));
    // The plate repaints on its own schedule (a LUT upload, a clip frame); a
    // slow poll keeps the card agreeing with it without watching every pixel.
    interval = window.setInterval(paint, 600);
    return () => {
      window.cancelAnimationFrame(frame);
      if (interval) window.clearInterval(interval);
    };
  }, [media, revision]);

  return (
    <section className="explorer-preview" data-testid="explorer-preview" aria-label="현재 미디어 미리보기">
      <div className="explorer-frame">
        <canvas ref={canvasRef} width={208} height={124} aria-label="현재 편집 중인 미디어" data-testid="explorer-canvas" />
      </div>
      <div className="explorer-meta">
        <span className="explorer-head">
          EXPLORER
          {index !== null && total > 0 && (
            <span className="explorer-index" data-testid="explorer-index">{index} / {total}</span>
          )}
        </span>
        <p className="explorer-name" title={media?.name ?? ''}>{media?.name ?? '미디어 없음'}</p>
        <p className="explorer-spec" data-testid="explorer-spec">
          {media ? `${media.width} × ${media.height}` : ''}
          {media?.kind === 'video' ? ' · 영상' : media ? ' · 사진' : ''}
          {workspaceName ? ` · ${workspaceName}` : ''}
        </p>
      </div>
    </section>
  );
}

/**
 * One shelf card's still: drawn when the card is actually on screen. A folder's
 * worth of previews is not worth a frozen first second.
 */
function FilmThumb({ source, filter }: { source: FilmThumbSource | null; filter: FilterOption }) {
  const holder = useRef<HTMLSpanElement | null>(null);
  const [url, setUrl] = useState<string | undefined>(() => (source ? cachedFilmThumb(source, filter.key) : undefined));
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = holder.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    }, { root: element.closest('.side-list'), rootMargin: '140px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!source || !seen) return;
    const hit = cachedFilmThumb(source, filter.key);
    if (hit) { setUrl(hit); return; }
    let alive = true;
    void requestFilmThumb(source, filter).then((next) => { if (alive && next) setUrl(next); });
    return () => { alive = false; };
  }, [source, filter, seen]);

  if (!url) return <span ref={holder} className="side-thumb-fill"><span className="thumb-shimmer" /></span>;
  return <span ref={holder} className="side-thumb-fill"><img src={url} alt="" draggable={false} /></span>;
}

interface LeftSidebarProps {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  media: MediaInfo | null;
  index: number | null;
  total: number;
  workspaceName: string | null;
  revision: number;

  filter: FilterSelection;
  strength: number;
  thumbSource: FilmThumbSource | null;
  onSelectFilter: (filter: FilterOption) => void;
  onStrength: (value: number) => void;
  thumbsLoading: boolean;

  frame: FrameSettings;
  mediaKind: MediaKind;
  defaultPad: number;
  meta: PlateMeta;
  frameThumbs: Record<string, string>;
  /** Custom `.shutterframe.json` frames, shown beside the built-in plates. */
  customFrames: ShutterFrameSpec[];
  customThumbs: Record<string, string>;
  onPatchFrame: (patch: Partial<FrameSettings>) => void;
  onMeta: (patch: Partial<PlateMeta>) => void;
  onOpenFourCut: () => void;
}

/** Neutral · the nine stocks · Margarine's groups · RETRO 90, in shelf order. */
function filterMatches(filter: FilterOption, search: string, group: string): boolean {
  if (group !== 'all') {
    if (group === 'hd2lab' && !(filter.kind === 'film' || filter.kind === 'neutral')) return false;
    if (group === 'retro90' && filter.kind !== 'film') return false;
    if (group !== 'hd2lab' && group !== 'retro90' && filter.group !== group) return false;
  }
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return `${filter.name} ${filter.detail} ${filter.key}`.toLowerCase().includes(needle);
}

/**
 * The left rail: the open plate at the head, then one of the two shelves —
 * films or frames — with its settings pinned above a list that scrolls under
 * them. The old bottom strip and its first ten cards live here now.
 */
export function LeftSidebar(props: LeftSidebarProps) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [frameMode, setFrameMode] = useState<'single' | 'multi'>(() => (props.frame.style === 'contact' || props.frame.style === 'fyra04' ? 'multi' : 'single'));

  const films = useMemo(
    () => ALL_FILTERS.filter((filter) => filterMatches(filter, search, group)),
    [search, group],
  );

  const activeFilterKey = props.filter.kind === 'margarine' ? `mg-${props.filter.presetId}` : props.filter.filmId;
  const singleFrames = SINGLE_FRAME_DEFS;
  const multiFrames = MULTI_FRAME_DEFS;
  const frameList = frameMode === 'single' ? singleFrames : multiFrames;
  const padValue = props.frame.padPct ?? props.defaultPad;
  const isMulti = props.frame.style === 'contact' || props.frame.style === 'fyra04';

  // Choosing a four-cut plate is a frame; the segment follows the choice even
  // when it was made from the strip's own 4-cut window.
  useEffect(() => {
    setFrameMode(isMulti ? 'multi' : 'single');
  }, [isMulti]);

  // A clip has no four-cut plate: the shelf stays on the eleven single cuts.
  useEffect(() => {
    if (props.mediaKind === 'video') setFrameMode('single');
  }, [props.mediaKind]);

  return (
    <aside className="pc-side pc-left" data-testid="pc-left-sidebar" aria-label="필름 · 프레임">
      <ExplorerPreview
        media={props.media}
        index={props.index}
        total={props.total}
        workspaceName={props.workspaceName}
        revision={props.revision}
      />

      <div className="side-tabs" role="tablist" aria-label="필름 · 프레임">
        <button
          type="button"
          role="tab"
          aria-selected={props.tab === 'film'}
          className={props.tab === 'film' ? 'on' : ''}
          onClick={() => props.onTab('film')}
          data-testid="side-tab-film"
        >
          필름 <span>{ALL_FILTERS.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={props.tab === 'frame'}
          className={props.tab === 'frame' ? 'on' : ''}
          onClick={() => props.onTab('frame')}
          data-testid="side-tab-frame"
        >
          프레임 <span>{FRAMES.length}</span>
        </button>
      </div>

      {props.tab === 'film' ? (
        <>
          <div className="side-pinned" data-testid="film-options">
            <Slider
              label="강도"
              value={props.strength}
              min={0}
              max={100}
              step={1}
              defaultValue={100}
              format={(value) => `${Math.round(value)}%`}
              onChange={props.onStrength}
            />
            <label className="side-search">
              <IconSearch size={14} />
              <input
                type="search"
                value={search}
                placeholder="필름 이름 · 코드 검색"
                aria-label="필름 검색"
                data-testid="film-search"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="side-chips" role="group" aria-label="필름 그룹">
              <button type="button" className={`mini-chip${group === 'all' ? ' on' : ''}`} onClick={() => setGroup('all')}>전체</button>
              <button type="button" className={`mini-chip${group === 'hd2lab' ? ' on' : ''}`} onClick={() => setGroup('hd2lab')}>HD2Lab</button>
              {MARGARINE_GROUPS.map((name) => (
                <button key={name} type="button" className={`mini-chip${group === name ? ' on' : ''}`} onClick={() => setGroup(name)}>{name}</button>
              ))}
              <button type="button" className={`mini-chip${group === 'retro90' ? ' on' : ''}`} onClick={() => setGroup('retro90')}>RETRO 90</button>
            </div>
          </div>

          <div className="side-list" data-testid="film-list" role="listbox" aria-label="필름 목록">
            {films.map((filter) => {
              const selected = activeFilterKey === filter.key || (filter.kind === 'film' && props.filter.kind === 'film' && props.filter.filmId === filter.filmId && filter.presetId === null);
              return (
                <button
                  key={filter.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`side-card${selected ? ' on' : ''}`}
                  onClick={() => props.onSelectFilter(filter)}
                  data-filter-key={filter.key}
                  title={`${filter.name} · ${filter.detail}`}
                >
                  <span className="side-thumb">
                    <FilmThumb source={props.thumbSource} filter={filter} />
                    {selected && <span className="side-check"><IconCheck size={12} /></span>}
                  </span>
                  <span className="side-text">
                    <b>{filter.name}</b>
                    <small>{filter.detail || filter.key}</small>
                  </span>
                </button>
              );
            })}
            {!films.length && <p className="side-empty">검색에 맞는 필름이 없습니다.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="side-pinned" data-testid="frame-options">
            <Toggle
              label="프레임 사용"
              hint="끄면 여백·메타 인화 없이 사진만 출력합니다."
              checked={props.frame.enabled}
              testId="side-frame-enabled"
              onChange={(value) => props.onPatchFrame({ enabled: value })}
            />
            <Segmented
              label="프레임 종류"
              compact
              value={frameMode}
              options={[
                { value: 'single', label: '단컷' },
                { value: 'multi', label: '4컷', disabled: props.mediaKind === 'video', title: props.mediaKind === 'video' ? '영상은 단일 프레임으로 인화합니다.' : undefined },
              ]}
              onChange={(value) => {
                setFrameMode(value);
                if (value === 'multi' && !isMulti) props.onPatchFrame({ style: 'fyra04' });
                if (value === 'single' && isMulti) props.onPatchFrame({ style: 'gallery' });
              }}
            />
            {frameMode === 'multi' && (
              <Segmented
                label="4컷 플레이트"
                compact
                value={props.frame.style === 'contact' ? 'contact' : 'fyra04'}
                options={[
                  { value: 'contact', label: 'Contact Sheet' },
                  { value: 'fyra04', label: 'FYRA 04' },
                ]}
                onChange={(value) => props.onPatchFrame({ style: value as FrameId })}
              />
            )}
            {props.frame.style === 'fyra04' && (
              <Segmented
                label="FYRA 테마"
                compact
                value={props.frame.fyraTheme}
                options={FYRA_THEME_LABELS.map((theme) => ({ value: theme.id, label: theme.label }))}
                onChange={(value) => props.onPatchFrame({ fyraTheme: value })}
              />
            )}
            <fieldset className={`frame-scope${props.frame.enabled ? '' : ' is-off'}`} disabled={!props.frame.enabled}>
              <Slider
                label="여백"
                value={padValue}
                min={0}
                max={12}
                step={0.1}
                defaultValue={props.defaultPad}
                format={(value) => `${value.toFixed(1)}%`}
                onChange={(value) => props.onPatchFrame({ padPct: value })}
              />
              <Segmented
                label="배경"
                compact
                value={props.frame.backdrop}
                options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
                onChange={(value) => props.onPatchFrame({ backdrop: value })}
              />
              <Segmented
                label="엠블럼"
                compact
                value={props.frame.emblem}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'hd2lab', label: 'HD2Lab' },
                  { value: 'none', label: '없음' },
                ]}
                onChange={(value) => props.onPatchFrame({ emblem: value })}
              />
              <Segmented
                label="엠블럼 잉크"
                compact
                value={props.frame.emblemMono ? 'mono' : 'original'}
                options={[{ value: 'original', label: 'Original' }, { value: 'mono', label: 'All Black' }]}
                onChange={(value) => props.onPatchFrame({ emblemMono: value === 'mono' })}
              />
              <details className="lab side-exif">
                <summary>EXIF · 캡션 <small>직접 인쇄할 값</small></summary>
                <div className="side-toggles">
                  <Toggle label="촬영 정보" checked={props.frame.showSpec} onChange={(value) => props.onPatchFrame({ showSpec: value })} />
                  <Toggle label="캡션" checked={props.frame.showCaption} onChange={(value) => props.onPatchFrame({ showCaption: value })} />
                </div>
                <div className="side-fields">
                  <Field label="카메라" hint="비우면 HD2Lab 엠블럼으로 인쇄됩니다.">
                    <input
                      value={[props.meta.make, props.meta.model].filter(Boolean).join(' ')}
                      onChange={(event) => {
                        const [make, ...rest] = event.target.value.split(' ');
                        props.onMeta({ make: make ?? '', model: rest.join(' ') });
                      }}
                      placeholder="SONY ILCE-7M4"
                      aria-label="카메라"
                    />
                  </Field>
                  <Field label="렌즈">
                    <input value={props.meta.lens} onChange={(event) => props.onMeta({ lens: event.target.value })} placeholder="FE 35mm F1.8" aria-label="렌즈" />
                  </Field>
                  <Field label="노출">
                    <div className="triple">
                      <input value={props.meta.aperture} onChange={(event) => props.onMeta({ aperture: event.target.value })} placeholder="f/1.8" aria-label="조리개" />
                      <input value={props.meta.shutter} onChange={(event) => props.onMeta({ shutter: event.target.value })} placeholder="1/250s" aria-label="셔터" />
                      <input value={props.meta.iso} onChange={(event) => props.onMeta({ iso: event.target.value })} placeholder="ISO 100" aria-label="ISO" />
                    </div>
                  </Field>
                  <Field label="촬영일">
                    <input value={props.meta.datetime} onChange={(event) => props.onMeta({ datetime: event.target.value })} placeholder="2026-11-19 18:04:31" aria-label="촬영일" />
                  </Field>
                  <Field label="캡션">
                    <input value={props.meta.caption} onChange={(event) => props.onMeta({ caption: event.target.value })} placeholder="한 줄 캡션" maxLength={80} aria-label="캡션" />
                  </Field>
                </div>
              </details>
            </fieldset>
            {frameMode === 'multi' && (
              <button type="button" className="btn ghost small side-fourcut" onClick={props.onOpenFourCut} data-testid="side-fourcut-open">
                <IconFolder size={13} /> 4컷 사진 넣기 · 바꾸기
              </button>
            )}
          </div>

          <div className="side-list" data-testid="frame-list" role="listbox" aria-label="프레임 목록">
            {frameList.map((item) => {
              const url = props.frameThumbs[item.id];
              const selected = props.frame.style === item.id;
              const videoOk = props.mediaKind === 'photo' || (item as { video?: boolean }).video !== false;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`side-card frame${selected ? ' on' : ''}`}
                  onClick={() => props.onPatchFrame({ style: item.id as FrameId, enabled: true })}
                  data-frame-id={item.id}
                  title={item.blurb ?? FRAME_MAP[item.id].label}
                >
                  <span className="side-thumb">
                    {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-shimmer" />}
                    {selected && <span className="side-check"><IconCheck size={12} /></span>}
                  </span>
                  <span className="side-text">
                    <b>{FRAME_MAP[item.id].label}</b>
                    <small>{item.tag}{!videoOk ? ' · 사진 전용' : ''}</small>
                  </span>
                </button>
              );
            })}
            {props.customFrames.map((spec) => {
              const style = customStyleOf(spec);
              const selected = String(props.frame.style) === style;
              const url = props.customThumbs[spec.id];
              return (
                <button
                  key={spec.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`side-card frame${selected ? ' on' : ''}`}
                  onClick={() => props.onPatchFrame({ style: style as FrameId, enabled: true })}
                  data-frame-id={style}
                  data-custom-frame={spec.id}
                  title={`${spec.name} · .shutterframe.json`}
                >
                  <span className="side-thumb">
                    {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-shimmer" />}
                    {selected && <span className="side-check"><IconCheck size={12} /></span>}
                  </span>
                  <span className="side-text">
                    <b>{spec.name}</b>
                    <small>커스텀 · {spec.canvas.width}×{spec.canvas.height}</small>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              className="side-card frame side-custom-open"
              onClick={props.onOpenFourCut}
              data-testid="side-custom-import"
            >
              <span className="side-thumb side-thumb-add">+</span>
              <span className="side-text">
                <b>커스텀 프레임</b>
                <small>.shutterframe.json 불러오기</small>
              </span>
            </button>
            {props.thumbsLoading && <p className="side-note" role="status">썸네일을 그리는 중…</p>}
          </div>
        </>
      )}
    </aside>
  );
}
