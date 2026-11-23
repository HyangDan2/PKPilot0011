import { useEffect, useRef, useState } from 'react';
import { IconFile, IconImage, IconRefresh } from './Icons';

export interface FileMenuProps {
  /** 사진 · 영상 불러오기 — the file window on a wide screen, the picker on a phone. */
  onOpen: () => void;
  /** 초기화 — the edit on the plate back to its first state, the file kept. */
  onReset: () => void;
  /** A file is still being decoded: the open door waits for it. */
  busy?: boolean;
}

/**
 * The title bar's file door, beside the backdrop slide.
 *
 * One button with a file icon, and behind it the two decisions a file menu
 * carries in this studio: open another photo or clip, or put the edit on the
 * plate back to its first state. It replaces the old 교체 chip — the same job
 * as its first row, with the reset that used to hide in the ⋮ menu beside it.
 */
export function FileMenu(props: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape shuts this menu, not the studio behind it.
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const run = (action: () => void) => () => { setOpen(false); action(); };

  return (
    <div className="portal-wrap file-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`chip file-btn${open ? ' on' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="studio-file-menu"
        aria-label="파일 — 사진 · 영상 불러오기, 초기화"
        title="파일"
        data-testid="file-button"
      >
        <IconFile size={15} />
        <span className="chip-label">파일</span>
      </button>

      {open && (
        <div
          className="file-menu-dropdown"
          id="studio-file-menu"
          role="menu"
          aria-label="파일"
          ref={panelRef}
          data-testid="file-menu"
        >
          <p className="portal-menu-head">FILE</p>

          <button
            type="button"
            role="menuitem"
            className="portal-item"
            onClick={run(props.onOpen)}
            disabled={!!props.busy}
            data-testid="file-menu-open"
          >
            <span className="portal-ic" aria-hidden><IconImage size={15} /></span>
            <span className="portal-text">
              <b>사진 · 영상 불러오기</b>
              <small>새 파일을 고르거나 폴더를 엽니다</small>
            </span>
            <span className="portal-badge" aria-hidden>OPEN</span>
          </button>

          <span className="portal-sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="portal-item"
            onClick={run(props.onReset)}
            data-testid="file-menu-reset"
          >
            <span className="portal-ic" aria-hidden><IconRefresh size={15} /></span>
            <span className="portal-text">
              <b>초기화</b>
              <small>편집을 처음 상태로 — 파일은 그대로</small>
            </span>
            <span className="portal-badge" aria-hidden>RESET</span>
          </button>
        </div>
      )}
    </div>
  );
}
