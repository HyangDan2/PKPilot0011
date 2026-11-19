import { useState } from 'react';
import { Modal } from './Modal';
import { Segmented } from './controls';
import { CurveEditor } from './CurveEditor';
import { CURVE_CHANNELS, defaultCurves, identityPoints, type CurveChannel, type ToneCurves } from '../types/curves';

interface ToneCurveModalProps {
  curves: ToneCurves;
  onCurves: (curves: ToneCurves) => void;
  onClose: () => void;
}

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

/**
 * Tone Curve on its own sheet: white / R / G / B splines over the live stage.
 * The window is deliberately a compact sheet so the plate behind it stays in
 * sight while a point is dragged.
 */
export function ToneCurveModal({ curves, onCurves, onClose }: ToneCurveModalProps) {
  const [channel, setChannel] = useState<CurveChannel>('white');
  return (
    <Modal
      kicker="TONE CURVE"
      title="Tone Curve"
      description="채널별 스플라인으로 톤을 잡습니다. 점을 끌어 곡선을 만들고, 빈 곳을 눌러 점을 추가합니다."
      onClose={onClose}
      size="sheet"
      testId="tonecurve-modal"
      footer={
        <div className="adjust-foot">
          <button type="button" className="btn ghost" onClick={() => onCurves(defaultCurves())}>커브 초기화</button>
          <button type="button" className="btn primary" onClick={onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <div className="panel-stack">
        <Segmented
          label="채널"
          value={channel}
          options={CURVE_CHANNELS.map((id) => ({ value: id, label: id === 'white' ? 'White' : id.toUpperCase() }))}
          onChange={setChannel}
        />
        <CurveEditor
          points={curves[channel]}
          onChange={(points) => onCurves({ ...curves, [channel]: points })}
        />
        <div className="row-between">
          <span className="note">Double-click a point to remove it.</span>
          <button type="button" className="btn ghost small" onClick={() => onCurves({ ...curves, [channel]: identityPoints() })}>
            이 채널 초기화
          </button>
        </div>
      </div>
    </Modal>
  );
}
