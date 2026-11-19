import { IconMoon, IconSun } from './Icons';

interface ThemeFabProps {
  theme: 'dark' | 'light';
  onToggle: () => void;
}

/**
 * The app's own light/dark switch: a 44px floating button in the bottom-right
 * corner of every screen, the same mark Web-HQ and Film Studio carry. It moves
 * `data-theme` on the whole UI, and never the plate's own backdrop — that one
 * lives on the title bar slide, beside the brand.
 */
export function ThemeFab({ theme, onToggle }: ThemeFabProps) {
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? '다크 테마로 전환' : '라이트 테마로 전환';
  return (
    <button
      type="button"
      className="theme-fab"
      data-testid="theme-fab"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={theme === 'dark'}
      title={label}
    >
      <span className="theme-fab-icon" data-icon="sun" aria-hidden>
        <IconSun size={19} />
      </span>
      <span className="theme-fab-icon" data-icon="moon" aria-hidden>
        <IconMoon size={19} />
      </span>
    </button>
  );
}

interface BackdropSwitchProps {
  backdrop: 'dark' | 'light';
  onChange: (backdrop: 'dark' | 'light') => void;
}

/**
 * The title-bar slide: the viewport *behind the plate* (frame.backdrop), which
 * the frame modal's own Dark/Light option shares both ways. It is deliberately
 * separate from the app theme — a light studio with a dark viewport is a
 * perfectly normal working state.
 */
export function BackdropSwitch({ backdrop, onChange }: BackdropSwitchProps) {
  const light = backdrop === 'light';
  return (
    <div className="backdrop-switch" data-state={backdrop}>
      <button
        type="button"
        role="switch"
        aria-checked={light}
        className="backdrop-track"
        onClick={() => onChange(light ? 'dark' : 'light')}
        title={`프레임 배경 · ${light ? 'Light' : 'Dark'} (클릭해서 ${light ? 'Dark' : 'Light'})`}
        data-testid="backdrop-switch"
      >
        <span className="backdrop-ic dark" aria-hidden><IconMoon size={12} /></span>
        <span className="backdrop-ic light" aria-hidden><IconSun size={12} /></span>
        <span className="backdrop-thumb" aria-hidden />
      </button>
      <span className="backdrop-label">뷰포트</span>
    </div>
  );
}
