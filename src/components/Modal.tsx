import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './Icons';

interface ModalProps {
  kicker: string;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sheet' | 'wide';
  testId?: string;
}

/** One sheet shell for all four studios: Esc, backdrop and X all close it. */
export function Modal({ kicker, title, description, onClose, children, footer, size = 'sheet', testId }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className={`modal-panel ${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        data-testid={testId}
      >
        <header className="modal-head">
          <div>
            <p className="modal-kicker">{kicker}</p>
            <h2>{title}</h2>
            {description && <p className="modal-desc">{description}</p>}
          </div>
          <button type="button" className="icon-btn ghost" onClick={onClose} aria-label="닫기">
            <IconClose size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
