import { useEffect, useRef, useState } from 'react';
import { IconClose, IconFolder, IconPhoto, IconVideo } from './Icons';
import { hasDirectoryPicker, pickDirectory, type FsDirectoryHandle } from '../media/workspace';

interface OpenModalProps {
  /** A message while files are opened or a folder is scanned; false when idle. */
  busy: string | false;
  error: string | null;
  onClose: () => void;
  /** Card 1: stills and clips, one or many, opened together. */
  onFiles: (files: File[]) => void;
  /** Card 2, browsers without a directory picker. */
  onWorkspaceFiles: (files: File[], recursive: boolean) => void;
  /** Card 2, browsers with one (Chrome · Edge · Samsung Internet). */
  onWorkspaceHandle: (handle: FsDirectoryHandle, recursive: boolean) => void;
  onDismissError: () => void;
}

/**
 * The two doors every HD2Lab studio opens with: a file, or a folder.
 *
 * A file door hands the picker back to the page; the folder door first asks the
 * browser for a directory handle (so a large folder can be scanned in batches
 * without copying every file into an input) and falls back to
 * `<input webkitdirectory>` where that API does not exist.
 */
export function OpenModal(props: OpenModalProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    // The modal opens once and closes once; a new onClose identity is not a
    // reason to move focus again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFolder = async () => {
    setLocalError(null);
    if (!hasDirectoryPicker()) {
      folderInput.current?.click();
      return;
    }
    try {
      const handle = await pickDirectory();
      props.onWorkspaceHandle(handle, recursive);
    } catch (err) {
      // A cancelled picker is not an error; anything else falls back to the
      // input route rather than leaving the door shut.
      if ((err as Error)?.name === 'AbortError') return;
      folderInput.current?.click();
    }
  };

  const busy = props.busy;
  const message = props.error ?? localError;

  return (
    <div className="modal-layer open-layer" role="presentation">
      <div className="modal-backdrop" onClick={props.onClose} />
      <div
        className="modal-panel open-panel"
        role="dialog"
        aria-modal="true"
        aria-label="사진 · 영상 불러오기"
        tabIndex={-1}
        ref={panel}
        data-testid="open-modal"
      >
        <header className="modal-head">
          <div>
            <p className="modal-kicker">OPEN</p>
            <h2>사진 · 영상 불러오기</h2>
            <p className="modal-desc">지금 플레이트를 새 파일로 바꾸거나, 폴더를 워크스페이스로 불러와 스트립에서 탐색합니다.</p>
          </div>
          <button type="button" className="icon-btn ghost" onClick={props.onClose} aria-label="닫기">
            <IconClose size={20} />
          </button>
        </header>

        <div className="modal-body">
          <div className="open-choice-grid">
            <button
              type="button"
              className="open-choice"
              onClick={() => fileInput.current?.click()}
              disabled={!!busy}
              data-testid="open-photo-card"
            >
              <span className="open-choice-icons" aria-hidden>
                <span className="open-icon"><IconPhoto size={22} /></span>
                <span className="open-icon video"><IconVideo size={22} /></span>
              </span>
              <strong>사진 · 동영상</strong>
              <span>선택한 파일을 바로 열어 편집합니다. 사진은 최대 4장까지 4컷 플레이트에 함께 올라갑니다.</span>
              <small>JPEG · PNG · WebP · MP4 · MOV · WebM</small>
            </button>

            <button
              type="button"
              className="open-choice"
              onClick={() => void openFolder()}
              disabled={!!busy}
              data-testid="open-workspace-card"
            >
              <span className="open-choice-icons" aria-hidden>
                <span className="open-icon folder"><IconFolder size={22} /></span>
              </span>
              <strong>워크스페이스</strong>
              <span>폴더 안의 사진과 동영상을 한 번에 불러와, 아래 스트립에서 파일마다 편집을 이어 갑니다.</span>
              <small>폴더 단위 일괄 탐색</small>
            </button>
          </div>

          <label className="open-recursive">
            <input
              type="checkbox"
              checked={recursive}
              disabled={!!busy}
              onChange={(event) => setRecursive(event.target.checked)}
              data-testid="include-subfolders"
            />
            <span>
              하위 폴더 포함
              <small>폴더 안의 모든 하위 폴더까지 사진과 동영상을 찾습니다.</small>
            </span>
          </label>

          {busy && (
            <p className="open-status" role="status" data-testid="open-status">
              <span className="spinner" aria-hidden /> {typeof busy === 'string' ? busy : '여는 중…'}
            </p>
          )}
          {!busy && message && (
            <p className="open-status is-error" role="alert">
              {message}
              <button type="button" className="link-btn" onClick={() => { setLocalError(null); props.onDismissError(); }}>닫기</button>
            </p>
          )}
          <p className="open-note">모든 파일은 이 기기 안에서만 처리됩니다 — 업로드 0 B.</p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*,.mp4,.mov,.webm,.m4v"
          multiple
          hidden
          data-testid="open-file-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) props.onFiles(files);
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          data-testid="workspace-folder-input"
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) props.onWorkspaceFiles(files, recursive);
          }}
        />
      </div>
    </div>
  );
}
