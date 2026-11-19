import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  IconApps, IconDots, IconExternal, IconHome, IconImage, IconRefresh, IconStamp, IconTrash, IconVideo,
} from './Icons';
import type { SampleItem } from './Landing';

export interface NavMenuProps {
  hasMedia: boolean;
  isPhoto: boolean;
  emblemMono: boolean;
  samples: SampleItem[];
  onHome: () => void;
  onReplace: () => void;
  onResetExif: () => void;
  onClear: () => void;
  onEmblemMono: (mono: boolean) => void;
  onSample: (sample: SampleItem) => void;
}

function Item(props: {
  icon: ReactNode;
  title: string;
  hint: string;
  badge: string;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  as?: 'button';
}) {
  return (
    <button
      type="button"
      role={props.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={props.checked}
      className="portal-item"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <span className="portal-ic" aria-hidden>{props.icon}</span>
      <span className="portal-text"><b>{props.title}</b><small>{props.hint}</small></span>
      <span className="portal-badge" aria-hidden>{props.badge}</span>
    </button>
  );
}

function Link(props: { icon: ReactNode; title: string; hint: string; href: string }) {
  return (
    <a className="portal-item" role="menuitem" href={props.href} target="_blank" rel="noopener noreferrer">
      <span className="portal-ic" aria-hidden>{props.icon}</span>
      <span className="portal-text"><b>{props.title}</b><small>{props.hint}</small></span>
      <span className="portal-badge" aria-hidden>EXTERNAL</span>
    </a>
  );
}

/**
 * The title bar's ⋮ menu, in the layout Shutterplate's portal menu established:
 * WORKSPACE / SAMPLES / NAVIGATION. It is where the old trash button went —
 * clearing the media is a decision, not an everyday tap.
 */
export function NavMenu(props: NavMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void) => () => { setOpen(false); action(); };

  return (
    <div className="portal-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`icon-btn portal-menu-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="studio-nav-menu"
        aria-label="더 보기 — 워크스페이스 · 샘플 · 포털"
        title="더 보기"
        data-testid="nav-menu-button"
      >
        <IconDots size={18} />
      </button>

      {open && (
        <div className="portal-menu-dropdown" id="studio-nav-menu" role="menu" data-testid="nav-menu">
          <p className="portal-menu-head">WORKSPACE</p>
          <Item icon={<IconHome size={15} />} title="홈 / 랜딩 화면" hint="시작 화면으로 이동" badge="HOME" onClick={run(props.onHome)} />
          <Item icon={<IconImage size={15} />} title="사진 · 영상 교체" hint="지금 편집 중인 미디어를 새 파일로" badge="SWAP" onClick={run(props.onReplace)} />
          <Item
            icon={<IconRefresh size={15} />}
            title="EXIF 값으로 되돌리기"
            hint={props.isPhoto ? '카메라·노출·날짜를 원본 값으로' : '사진을 열면 쓸 수 있습니다'}
            badge="EXIF"
            disabled={!props.isPhoto}
            onClick={run(props.onResetExif)}
          />
          <Item
            icon={<IconTrash size={15} />}
            title="미디어 비우기"
            hint={props.hasMedia ? '플레이트를 비우고 랜딩으로' : '미디어가 없습니다'}
            badge="CLEAR"
            disabled={!props.hasMedia}
            onClick={run(props.onClear)}
          />
          <Item
            icon={<IconStamp size={15} />}
            title="엠블럼 색상"
            hint={props.emblemMono ? '현재 All Black — 눌러서 원본 컬러' : '현재 원본 컬러 — 눌러서 All Black'}
            badge={props.emblemMono ? 'MONO' : 'COLOR'}
            checked={props.emblemMono}
            onClick={run(() => props.onEmblemMono(!props.emblemMono))}
          />

          <span className="portal-sep" role="separator" />
          <p className="portal-menu-head">SAMPLES</p>
          {props.samples.map((sample) => (
            <Item
              key={sample.id}
              icon={sample.kind === 'video' ? <IconVideo size={15} /> : <IconImage size={15} />}
              title={sample.label}
              hint={sample.path.split('/').pop() ?? ''}
              badge={sample.kind === 'video' ? 'CLIP' : 'STILL'}
              onClick={run(() => props.onSample(sample))}
            />
          ))}

          <span className="portal-sep" role="separator" />
          <p className="portal-menu-head">NAVIGATION</p>
          <Link icon={<IconHome size={15} />} title="HD2Lab Web-HQ" hint="Main Portal" href="https://hyangdan2.github.io/" />
          <Link icon={<IconApps size={15} />} title="ApplicationHub" hint="Apps Catalog" href="https://hyangdan2.github.io/ApplicationHub/" />
          <span className="sr-only"><IconExternal size={1} /></span>
        </div>
      )}
    </div>
  );
}
