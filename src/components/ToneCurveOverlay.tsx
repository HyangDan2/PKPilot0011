import { useCallback, useEffect, useRef, useState } from 'react';
import { createMonotoneSpline } from '../engine/color/toneCurve';
import {
  CURVE_CHANNELS,
  CURVE_MIN_GAP,
  defaultCurves,
  identityPoints,
  moveCurvePoint,
  type CurveChannel,
  type CurvePoint,
  type ToneCurves,
} from '../types/curves';
import { IconClose, IconTrash } from './Icons';

/** The four channels' inks: white for the composite, then R, G, B. */
const CHANNEL_COLOUR: Record<CurveChannel, string> = {
  white: '#f1f5f9',
  red: '#f87171',
  green: '#4ade80',
  blue: '#60a5fa',
};

const CHANNEL_LABEL: Record<CurveChannel, string> = { white: 'W', red: 'R', green: 'G', blue: 'B' };
const CHANNEL_NAME: Record<CurveChannel, string> = { white: 'RGB', red: 'R', green: 'G', blue: 'B' };

/** The curve's own box, and the breathing room the end points need in the viewBox. */
const BOX = 256;
const PAD = 8;
const VIEW = BOX + PAD * 2;

/** True when any channel has left the identity line — the button badge reads this. */
export function curvesTouched(curves: ToneCurves): boolean {
  const identity = identityPoints();
  return CURVE_CHANNELS.some((channel) => {
    const points = curves[channel];
    if (points.length !== 2) return true;
    return points[0][0] !== identity[0][0] || points[0][1] !== identity[0][1]
      || points[1][0] !== identity[1][0] || points[1][1] !== identity[1][1];
  });
}

interface ToneCurveOverlayProps {
  curves: ToneCurves;
  onCurves: (curves: ToneCurves) => void;
  onClose: () => void;
}

/**
 * Tone Curve as it was meant to be seen: a transparent overlay over the live
 * stage, laid on the plate itself. The graded picture keeps showing through the
 * graph, so a point is dragged against the photograph rather than against an
 * opaque sheet that hides it.
 *
 * Everything that can be touched — a point, a chip, a number field — stops the
 * pointer from reaching the stage, so a drag never turns into the long-press
 * compare or a double-click play.
 */
export function ToneCurveOverlay({ curves, onCurves, onClose }: ToneCurveOverlayProps) {
  const [channel, setChannel] = useState<CurveChannel>('white');
  const [selected, setSelected] = useState(1);
  const drag = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const points = curves[channel];
  const index = Math.min(Math.max(0, selected), points.length - 1);
  const point = points[index] ?? [0, 0];
  const colour = CHANNEL_COLOUR[channel];

  // Esc closes the overlay, exactly like the sheets it replaced.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // A channel that loses points must not leave the selection past its end.
  useEffect(() => {
    if (selected > points.length - 1) setSelected(Math.max(0, points.length - 1));
  }, [points.length, selected]);

  const spline = createMonotoneSpline(points);
  let path = `M0,${BOX}`;
  for (let i = 1; i <= 128; i += 1) {
    const x = i / 128;
    path += ` L${(x * BOX).toFixed(2)},${(BOX - Math.max(0, Math.min(1, spline(x))) * BOX).toFixed(2)}`;
  }

  /** Client point → curve coordinates (0..1 on both axes, y up). */
  const toCurve = useCallback((clientX: number, clientY: number): CurvePoint => {
    const element = svgRef.current;
    if (!element) return [0, point[1]];
    const rect = element.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * VIEW - PAD;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * VIEW - PAD;
    return [
      Math.max(0, Math.min(1, x / BOX)),
      Math.max(0, Math.min(1, 1 - y / BOX)),
    ];
  }, [point]);

  const setPoints = (next: CurvePoint[]) => onCurves({ ...curves, [channel]: next });

  const nearest = (x: number, y: number): number => {
    let best = -1;
    let bestDistance = 0.07;
    points.forEach((candidate, i) => {
      const distance = Math.hypot(candidate[0] - x, candidate[1] - y);
      if (distance < bestDistance) { best = i; bestDistance = distance; }
    });
    return best;
  };

  const move = (i: number, x: number, y: number) => {
    // The two ends keep their input: a curve that no longer starts at 0 or ends
    // at 1 leaves the darkest and brightest tones ungraded.
    const locked = i === 0 ? 0 : i === points.length - 1 ? 1 : x;
    setPoints(moveCurvePoint(points, i, locked, y));
  };

  const remove = () => {
    if (index <= 0 || index >= points.length - 1) return;
    setPoints(points.filter((_, i) => i !== index));
    setSelected(Math.max(0, index - 1));
  };

  return (
    <section
      id="tone-curve-overlay"
      data-testid="tonecurve-overlay"
      className="tonecurve-overlay"
      role="group"
      aria-label="Tone Curve editor"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="tonecurve-bar">
        <div className="tonecurve-bar-top">
          <span className="tonecurve-title">Tone Curve · {CHANNEL_NAME[channel]}</span>
          <button
            type="button"
            className="tonecurve-chip tonecurve-close"
            aria-label="Tone Curve 닫기"
            title="닫기"
            onClick={onClose}
          >
            <IconClose size={14} />
          </button>
        </div>
        <div className="tonecurve-tools">
          <div className="tonecurve-channels" role="group" aria-label="채널 선택">
            {CURVE_CHANNELS.map((id) => (
              <button
                key={id}
                type="button"
                className={`tonecurve-channel${channel === id ? ' is-on' : ''}`}
                style={{ '--channel': CHANNEL_COLOUR[id] } as React.CSSProperties}
                aria-label={`${id === 'white' ? 'White' : id.toUpperCase()} 채널`}
                aria-pressed={channel === id}
                data-channel={id}
                onClick={() => { setChannel(id); setSelected(1); }}
              >
                {CHANNEL_LABEL[id]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="tonecurve-chip"
            aria-label="이 채널 초기화"
            title="이 채널 초기화"
            onClick={() => setPoints(identityPoints())}
          >
            초기화
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        className="tonecurve-graph"
        data-testid="tonecurve-graph"
        viewBox={`${-PAD} ${-PAD} ${VIEW} ${VIEW}`}
        role="group"
        aria-label="톤 커브 그래프"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const [x, y] = toCurve(event.clientX, event.clientY);
          let hit = nearest(x, y);
          if (hit < 0) {
            if (points.length >= 16) return;
            if (points.some((candidate) => Math.abs(candidate[0] - x) < CURVE_MIN_GAP)) return;
            const next = [...points, [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
            hit = next.findIndex((candidate) => candidate[0] === x && candidate[1] === y);
            if (hit <= 0 || hit >= next.length - 1) return;
            setPoints(next);
          }
          drag.current = hit;
          setSelected(hit);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current === null) return;
          event.stopPropagation();
          const [x, y] = toCurve(event.clientX, event.clientY);
          move(drag.current, x, y);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (drag.current === null) return;
          drag.current = null;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already gone */ }
          // One more pass at the settled position, so the release is the value.
          const [x, y] = toCurve(event.clientX, event.clientY);
          move(Math.min(Math.max(0, selected), points.length - 1), x, y);
        }}
        onPointerCancel={() => { drag.current = null; }}
      >
        {[0, 64, 128, 192, 256].map((value) => (
          <g key={value} className="tonecurve-grid" stroke="#e2e8f0" strokeOpacity="0.5" strokeWidth="1">
            <path d={`M ${value} 0 V ${BOX} M 0 ${value} H ${BOX}`} />
          </g>
        ))}
        <path d={`M0 ${BOX} L${BOX} 0`} stroke="#94a3b8" strokeDasharray="4 5" strokeOpacity="0.35" fill="none" />
        <path
          className="tonecurve-line"
          data-testid="tonecurve-line"
          d={path}
          fill="none"
          stroke={colour}
          strokeWidth="2"
          strokeLinecap="round"
        />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            data-testid="tonecurve-point"
            data-index={i}
            cx={x * BOX}
            cy={BOX - y * BOX}
            r={i === index ? 6 : 4.5}
            fill={i === index ? colour : '#10141d'}
            stroke={colour}
            strokeWidth="2"
            style={{ cursor: 'grab' }}
          />
        ))}
      </svg>

      <div className="tonecurve-foot">
        <label className="tonecurve-field">
          Input
          <input
            type="number"
            min={0}
            max={255}
            step={1}
            aria-label="Curve Input"
            value={Math.round(point[0] * 255)}
            onChange={(event) => {
              if (event.target.value === '') return;
              const value = Math.max(0, Math.min(255, Number(event.target.value)));
              move(index, value / 255, point[1]);
            }}
          />
        </label>
        <label className="tonecurve-field">
          Output
          <input
            type="number"
            min={0}
            max={255}
            step={1}
            aria-label="Curve Output"
            value={Math.round(point[1] * 255)}
            onChange={(event) => {
              if (event.target.value === '') return;
              const value = Math.max(0, Math.min(255, Number(event.target.value)));
              move(index, point[0], value / 255);
            }}
          />
        </label>
        <button
          type="button"
          className="tonecurve-chip icon"
          aria-label="점 삭제"
          title="점 삭제"
          disabled={index <= 0 || index >= points.length - 1}
          onClick={remove}
        >
          <IconTrash size={13} />
        </button>
      </div>

      <div className="tonecurve-foot">
        <span className="tonecurve-hint">탭으로 점 추가 · 드래그로 조정</span>
        <button
          type="button"
          className="tonecurve-chip accent"
          onClick={() => onCurves(defaultCurves())}
        >
          전체 초기화
        </button>
      </div>
    </section>
  );
}
