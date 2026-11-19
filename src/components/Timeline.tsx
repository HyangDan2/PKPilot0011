import { useCallback, useRef } from 'react';
import type { TrimRange } from '../types/studio';

interface TimelineProps {
  duration: number;
  trim: TrimRange;
  time: number;
  playing: boolean;
  onTrim: (trim: TrimRange) => void;
  onSeek: (seconds: number) => void;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.floor(Math.max(0, seconds) % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Trim bar: two handles solve the cut, a tap anywhere seeks. The playhead is
 * clamped to the loop so scrubbing never leaves the trimmed range by accident.
 */
export function Timeline({ duration, trim, time, playing, onTrim, onSeek }: TimelineProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<'in' | 'out' | 'seek' | null>(null);
  const d = Math.max(0.01, duration);

  const ratioAt = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const pointerDown = (kind: 'in' | 'out' | 'seek') => (event: React.PointerEvent) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = kind;
    if (kind === 'seek') onSeek(ratioAt(event.clientX) * d);
  };

  const pointerMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const value = ratioAt(event.clientX) * d;
    if (drag.current === 'in') {
      onTrim({ start: Math.max(0, Math.min(value, trim.end - 0.2)), end: trim.end });
      onSeek(Math.max(0, Math.min(value, trim.end - 0.2)));
    } else if (drag.current === 'out') {
      onTrim({ start: trim.start, end: Math.min(d, Math.max(value, trim.start + 0.2)) });
      onSeek(Math.min(d, Math.max(value, trim.start + 0.2)));
    } else {
      onSeek(value);
    }
  };

  const pointerUp = () => { drag.current = null; };

  return (
    <div className="timeline">
      <div
        className="timeline-bar"
        ref={barRef}
        onPointerDown={pointerDown('seek')}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        role="slider"
        aria-label="재생 위치"
        aria-valuemin={0}
        aria-valuemax={Math.round(d)}
        aria-valuenow={Math.round(time)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') onSeek(Math.min(trim.end, time + 0.5));
          if (event.key === 'ArrowLeft') onSeek(Math.max(trim.start, time - 0.5));
        }}
      >
        <span className="timeline-range" style={{ left: `${(trim.start / d) * 100}%`, width: `${((trim.end - trim.start) / d) * 100}%` }} />
        <span className="timeline-playhead" style={{ left: `${(time / d) * 100}%` }} />
        <button
          type="button"
          className="timeline-handle in"
          style={{ left: `${(trim.start / d) * 100}%` }}
          aria-label="시작 지점"
          onPointerDown={pointerDown('in')}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
        />
        <button
          type="button"
          className="timeline-handle out"
          style={{ left: `${(trim.end / d) * 100}%` }}
          aria-label="끝 지점"
          onPointerDown={pointerDown('out')}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
        />
      </div>
      <div className="timeline-read">
        <span>{formatClock(time)}</span>
        <span className="muted">{formatClock(trim.start)} – {formatClock(trim.end)} · {playing ? '재생' : '일시정지'}</span>
        <span>{formatClock(duration)}</span>
      </div>
    </div>
  );
}
