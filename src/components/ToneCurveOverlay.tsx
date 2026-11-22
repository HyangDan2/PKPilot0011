import { useCallback, useEffect, useRef, useState } from 'react';
import { createMonotoneSpline, curveIsIdentity } from '../engine/color/toneCurve';
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

/** The buttons that toggle the overlay themselves — a press on one must not
 *  also be read as a press outside that closes it, or the press would close and
 *  the button's own toggle would open it straight back up. */
const TOGGLE_SELECTOR = '[data-testid="tonecurve-fab"], [data-testid="side-tonecurve"]';

/** True when any channel is doing something — the button badge reads this. */
export function curvesTouched(curves: ToneCurves): boolean {
  return CURVE_CHANNELS.some((channel) => !curveIsIdentity(curves[channel] ?? []));
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
  const overlayRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const points = curves[channel];
  const index = Math.min(Math.max(0, selected), points.length - 1);
  const point = points[index] ?? [0, 0];
  const colour = CHANNEL_COLOUR[channel];

  // Esc closes the overlay, exactly like the sheets it replaced.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A press anywhere off the overlay closes it — the stage behind it, the
  // utility bar, the page around the stage. The press is caught in the capture
  // phase so the stage's own long-press compare and double-click play never get
  // to act on it first; a press on the overlay itself, or on either of the two
  // buttons that toggle the curve, is left to them. The fab still opens and
  // closes on one tap because its toggle runs after this closes, and the guard
  // above keeps the two from firing against each other.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (overlayRef.current?.contains(target)) return;
      if (target.closest(TOGGLE_SELECTOR)) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // A channel that loses points must not leave the selection past its end.
  useEffect(() => {
    if (selected > points.length - 1) setSelected(Math.max(0, points.length - 1));
  }, [points.length, selected]);

  // The end points may sit off 0 and 1 now, so the graph is drawn the way the
  // picture is graded: a flat run up to the first point, the spline between the
  // points, then a flat run out to white.
  const spline = createMonotoneSpline(points);
  const first = points[0] ?? [0, 0];
  const last = points[points.length - 1] ?? [1, 1];
  const xBox = (value: number) => (Math.max(0, Math.min(1, value)) * BOX).toFixed(2);
  const yBox = (value: number) => (BOX - Math.max(0, Math.min(1, value)) * BOX).toFixed(2);
  let path = `M0,${yBox(first[1])} L${xBox(first[0])},${yBox(first[1])}`;
  for (let i = 1; i <= 128; i += 1) {
    const x = first[0] + (last[0] - first[0]) * (i / 128);
    path += ` L${xBox(x)},${yBox(spline(x))}`;
  }
  path += ` L${xBox(last[0])},${yBox(last[1])} L${BOX},${yBox(last[1])}`;

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
    // Both ends move along the input axis too: pulling the black point right or
    // the white point left is how a curve is clipped, and `moveCurvePoint`
    // keeps the order and the minimum gap while doing it.
    setPoints(moveCurvePoint(points, i, x, y));
  };

  const remove = () => {
    if (index <= 0 || index >= points.length - 1) return;
    setPoints(points.filter((_, i) => i !== index));
    setSelected(Math.max(0, index - 1));
  };

  return (
    <section
      id="tone-curve-overlay"
      ref={overlayRef}
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
            <IconClose size={18} />
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
          const dragged = drag.current;
          if (dragged === null) return;
          drag.current = null;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already gone */ }
          // One more pass at the settled position, so the release is the value.
          const [x, y] = toCurve(event.clientX, event.clientY);
          move(dragged, x, y);
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
