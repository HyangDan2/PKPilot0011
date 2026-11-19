import { useCallback, useEffect, useRef } from 'react';
import { createMonotoneSpline } from '../engine/color/toneCurve';
import type { CurvePoint } from '../types/curves';

interface CurveEditorProps {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  height?: number;
}

const PAD = 12;
const MIN_GAP = 1 / 1024;

/** A small, honest tone-curve editor: drag a point, tap empty space to add. */
export function CurveEditor({ points, onChange, height = 170 }: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(80, rect.width);
    const h = Math.max(80, height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, 0, width, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const x = PAD + ((width - PAD * 2) * i) / 4;
      const y = PAD + ((h - PAD * 2) * i) / 4;
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, h - PAD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(width - PAD, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(PAD, h - PAD); ctx.lineTo(width - PAD, PAD); ctx.stroke();

    const spline = createMonotoneSpline(points);
    ctx.strokeStyle = '#ffb37a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 64; i += 1) {
      const x = i / 64;
      const y = spline(x);
      const px = PAD + x * (width - PAD * 2);
      const py = h - PAD - y * (h - PAD * 2);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    points.forEach(([x, y]) => {
      const px = PAD + x * (width - PAD * 2);
      const py = h - PAD - y * (h - PAD * 2);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#11131c';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffb37a';
      ctx.stroke();
    });
  }, [points, height]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  const toCurve = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left - PAD) / (rect.width - PAD * 2)));
    const y = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top - PAD) / (height - PAD * 2)));
    return { x, y };
  };

  const nearest = (x: number, y: number): number => {
    let best = -1;
    let bestDistance = 0.045;
    points.forEach((point, index) => {
      const distance = Math.hypot(point[0] - x, point[1] - y);
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    });
    return best;
  };

  return (
    <canvas
      ref={canvasRef}
      className="curve-canvas"
      style={{ height }}
      aria-label="톤 커브 편집기"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x, y } = toCurve(event);
        const hit = nearest(x, y);
        if (hit >= 0) {
          dragRef.current = hit;
          return;
        }
        if (points.length >= 16) return;
        const minX = x - MIN_GAP;
        const maxX = x + MIN_GAP;
        if (points.some((point) => point[0] > minX && point[0] < maxX)) return;
        const next = [...points, [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
        dragRef.current = next.findIndex((point) => point[0] === x && point[1] === y);
        onChange(next);
      }}
      onPointerMove={(event) => {
        if (dragRef.current === null) return;
        const { x, y } = toCurve(event);
        const index = dragRef.current;
        const next = points.map((point) => [...point] as CurvePoint);
        const min = index === 0 ? 0 : next[index - 1][0] + MIN_GAP;
        const max = index === next.length - 1 ? 1 : next[index + 1][0] - MIN_GAP;
        next[index] = [Math.max(min, Math.min(max, x)), y];
        onChange(next);
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      onDoubleClick={(event) => {
        const { x, y } = toCurve(event as unknown as React.PointerEvent<HTMLCanvasElement>);
        const hit = nearest(x, y);
        if (hit > 0 && hit < points.length - 1) onChange(points.filter((_, index) => index !== hit));
      }}
    />
  );
}
