import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp, IconFolder, IconPhoto, IconVideo } from './Icons';
import { cachedThumb, requestThumb, type WorkspaceThumb } from '../media/workspaceThumbs';
import { formatDuration, workspaceSummary, visibleWorkspace, type WorkspaceFile, type WorkspaceFilter, type WorkspaceSort } from '../media/workspace';

const ITEM_W = 138;

interface WorkspaceStripProps {
  name: string;
  entries: WorkspaceFile[];
  activeId: string | null;
  sort: WorkspaceSort;
  filter: WorkspaceFilter;
  collapsed: boolean;
  height: number;
  scanning: string | null;
  onSort: (sort: WorkspaceSort) => void;
  onFilter: (filter: WorkspaceFilter) => void;
  onCollapse: (collapsed: boolean) => void;
  onHeight: (height: number) => void;
  onSelect: (entry: WorkspaceFile) => void;
  onStep: (direction: -1 | 1) => void;
  onOpenFolder: () => void;
}

function Thumb({ entry }: { entry: WorkspaceFile }) {
  const [thumb, setThumb] = useState<WorkspaceThumb | null>(() => cachedThumb(entry.id) ?? null);
  useEffect(() => {
    if (thumb) return;
    let alive = true;
    void requestThumb(entry).then((value) => { if (alive) setThumb(value); });
    return () => { alive = false; };
  }, [entry, thumb]);
  if (thumb) return <img src={thumb.url} alt="" draggable={false} loading="lazy" />;
  return (
    <span className="ws-thumb-empty" aria-hidden>
      {entry.kind === 'video' ? <IconVideo size={20} /> : <IconPhoto size={20} />}
    </span>
  );
}

/**
 * The folder, along the foot of the centre column: every still and clip in it,
 * one card each, in the order the ← / → keys walk. The header settles the order
 * and the kind; the top edge resizes the shelf, and the chevron folds it into a
 * single line so the plate can take the room back.
 */
export function WorkspaceStrip(props: WorkspaceStripProps) {
  const visible = useMemo(
    () => visibleWorkspace(props.entries, props.sort, props.filter),
    [props.entries, props.sort, props.filter],
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ left: 0, width: 1200 });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ left: el.scrollLeft, width: el.clientWidth || 1200 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [props.collapsed]);

  // Follow the open file: a card chosen by arrow key must not walk off-screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el || props.collapsed) return;
    const index = visible.findIndex((entry) => entry.id === props.activeId);
    if (index < 0) return;
    const x = index * ITEM_W;
    if (x < el.scrollLeft || x + ITEM_W > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2 + ITEM_W / 2), behavior: 'smooth' });
    }
  }, [props.activeId, visible, props.collapsed]);

  const start = Math.max(0, Math.floor(view.left / ITEM_W) - 2);
  const end = Math.min(visible.length, Math.ceil((view.left + view.width) / ITEM_W) + 2);
  const activeIndex = visible.findIndex((entry) => entry.id === props.activeId);

  const dragHeight = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(360, Math.max(118, window.innerHeight - moveEvent.clientY));
      props.onHeight(next);
    };
    const up = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
  };

  return (
    <section
      className={`workspace-strip${props.collapsed ? ' is-collapsed' : ''}`}
      data-testid="workspace-strip"
      aria-label="워크스페이스 스트립"
      style={{ height: props.collapsed ? 34 : props.height }}
    >
      {!props.collapsed && (
        <div
          className="ws-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="워크스페이스 높이 조절"
          tabIndex={0}
          data-testid="workspace-resize"
          onPointerDown={dragHeight}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            event.stopPropagation();
            props.onHeight(Math.min(360, Math.max(118, props.height + (event.key === 'ArrowUp' ? 12 : -12))));
          }}
        />
      )}

      <header className="ws-head">
        <button
          type="button"
          className="ws-title"
          onClick={() => props.onCollapse(!props.collapsed)}
          aria-expanded={!props.collapsed}
          aria-label={props.collapsed ? '워크스페이스 펼치기' : '워크스페이스 접기'}
          data-testid="workspace-collapse"
        >
          <IconFolder size={15} />
          <span className="ws-name" title={props.name}>{props.name}</span>
          <span className="ws-count">{workspaceSummary(props.entries)}</span>
          {props.scanning && <span className="ws-scanning" role="status">{props.scanning}</span>}
          {props.collapsed ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>

        <div className="ws-tools">
          <div className="ws-filters" role="group" aria-label="파일 종류">
            {(['all', 'photo', 'video'] as WorkspaceFilter[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`mini-chip${props.filter === kind ? ' on' : ''}`}
                onClick={() => props.onFilter(kind)}
                data-testid={`ws-filter-${kind}`}
              >
                {kind === 'all' ? '전체' : kind === 'photo' ? '사진' : '영상'}
              </button>
            ))}
          </div>
          <select
            className="ws-sort"
            aria-label="정렬"
            value={props.sort}
            onChange={(event) => props.onSort(event.target.value as WorkspaceSort)}
            data-testid="ws-sort"
          >
            <option value="name">이름 ↑</option>
            <option value="reverse">이름 ↓</option>
            <option value="kind">종류별</option>
          </select>
          <button type="button" className="mini-chip" onClick={props.onOpenFolder}>+ 폴더</button>
        </div>
      </header>

      {!props.collapsed && (
        <div
          className="ws-scroll"
          ref={scroller}
          tabIndex={0}
          role="listbox"
          aria-label="워크스페이스 파일"
          data-testid="workspace-scroll"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); props.onStep(1); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); props.onStep(-1); }
            if (event.key === 'Home' && visible[0]) { event.preventDefault(); props.onSelect(visible[0]); }
            if (event.key === 'End' && visible.length) { event.preventDefault(); props.onSelect(visible[visible.length - 1]); }
          }}
        >
          <div className="ws-track" style={{ width: Math.max(1, visible.length * ITEM_W) }}>
            {visible.slice(start, end).map((entry, offset) => {
              const index = start + offset;
              const selected = entry.id === props.activeId;
              const thumb = cachedThumb(entry.id);
              const duration = thumb?.duration ?? 0;
              return (
                <div key={entry.id} className="ws-cell" style={{ left: index * ITEM_W }}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={`${entry.name} 열기`}
                    className={`ws-card${selected ? ' on' : ''}`}
                    onClick={() => props.onSelect(entry)}
                    data-testid="workspace-thumb"
                    data-entry-id={entry.id}
                    data-kind={entry.kind}
                    title={entry.path}
                  >
                    <span className="ws-thumb">
                      <Thumb entry={entry} />
                      {entry.kind === 'video' && (
                        <>
                          <span className="ws-badge"><IconVideo size={9} /> 영상</span>
                          <span className="ws-duration">{duration > 0 ? formatDuration(duration) : '--:--'}</span>
                        </>
                      )}
                    </span>
                    <span className="ws-label">{entry.name}</span>
                  </button>
                </div>
              );
            })}
          </div>
          {!visible.length && (
            <p className="ws-empty">
              {props.entries.length ? '이 종류의 파일이 없습니다.' : props.scanning ? '폴더를 읽는 중입니다…' : '이 폴더에 사진이나 동영상이 없습니다.'}
            </p>
          )}
        </div>
      )}

      {props.collapsed && (
        <span className="ws-collapsed-note">
          {activeIndex >= 0 ? `${activeIndex + 1} / ${visible.length}` : `${visible.length}개`}
        </span>
      )}
    </section>
  );
}
