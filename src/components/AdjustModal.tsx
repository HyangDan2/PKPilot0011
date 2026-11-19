import { useState } from 'react';
import { Modal } from './Modal';
import { Slider, Toggle } from './controls';
import { DEFAULT_SHARPENING, type SharpeningSettings } from '../types/sharpening';
import type { AdjustmentSettings } from '../types/film';
import type { MediaKind, TrimRange } from '../types/studio';

type Tab = 'light' | 'color' | 'texture' | 'video';

interface AdjustModalProps {
  filmId: string;
  filterLabel: string;
  adjustments: AdjustmentSettings;
  sharpening: SharpeningSettings;
  mediaKind: MediaKind;
  duration: number;
  fps: number;
  inputGuard: 0 | 1;
  trim: TrimRange;
  onAdjustments: (patch: Partial<AdjustmentSettings>) => void;
  onSharpening: (patch: Partial<SharpeningSettings>) => void;
  onTrim: (trim: TrimRange) => void;
  onInputGuard: (guard: 0 | 1) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * The core grade: light, colour, texture and the clip's own trim. Colour Lab,
 * Tone Curve and Camera Effects each have their own window in the corner
 * cluster, so this sheet stays a set of sliders you can work through.
 */
export function AdjustModal(props: AdjustModalProps) {
  const [tab, setTab] = useState<Tab>('light');
  const adj = props.adjustments;

  return (
    <Modal
      kicker="GRADE PANEL"
      title="세부 보정"
      description={`${props.filterLabel} 위에 얹는 빛·색·질감입니다. 값은 모두 실시간으로 반영됩니다.`}
      onClose={props.onClose}
      size="wide"
      testId="adjust-modal"
      footer={
        <div className="adjust-foot">
          <button type="button" className="btn ghost" onClick={props.onReset}>보정 초기화</button>
          <button type="button" className="btn primary" onClick={props.onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <div className="chip-row sticky">
        {([
          ['light', '빛'],
          ['color', '색'],
          ['texture', '질감'],
          ...(props.mediaKind === 'video' ? [['video', '영상'] as [Tab, string]] : []),
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" className={`chip${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'light' && (
        <div className="panel-grid">
          <Slider label="노출" value={adj.exposure} min={-3} max={3} step={0.05} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`} onChange={(v) => props.onAdjustments({ exposure: v })} />
          <Slider label="대비" value={adj.contrast} min={-100} max={100} onChange={(v) => props.onAdjustments({ contrast: v })} />
          <Slider label="하이라이트" value={adj.highlights} min={-100} max={100} onChange={(v) => props.onAdjustments({ highlights: v })} />
          <Slider label="섀도우" value={adj.shadows} min={-100} max={100} onChange={(v) => props.onAdjustments({ shadows: v })} />
          <Slider label="화이트" value={adj.whites ?? 0} min={-100} max={100} onChange={(v) => props.onAdjustments({ whites: v })} />
          <Slider label="블랙" value={adj.blacks ?? 0} min={-100} max={100} onChange={(v) => props.onAdjustments({ blacks: v })} />
        </div>
      )}

      {tab === 'color' && (
        <div className="panel-stack">
          <div className="panel-grid">
            <Slider label="색온도" value={adj.temperature} min={-100} max={100} onChange={(v) => props.onAdjustments({ temperature: v })} hint="파랑 ← → 앰버" />
            <Slider label="틴트" value={adj.tint} min={-100} max={100} onChange={(v) => props.onAdjustments({ tint: v })} hint="그린 ← → 마젠타" />
            <Slider label="채도" value={adj.saturation} min={-100} max={100} onChange={(v) => props.onAdjustments({ saturation: v })} />
            <Slider label="필름 강도" value={adj.filmStrength} min={0} max={100} defaultValue={100} format={(v) => `${Math.round(v)}%`} onChange={(v) => props.onAdjustments({ filmStrength: v })} />
          </div>
          <p className="note">8대역 스펙트럼·포인트 컬러는 우측 하단의 [Color Lab] 버튼에서 엽니다.</p>
        </div>
      )}

      {tab === 'texture' && (
        <div className="panel-stack">
          <div className="panel-grid">
            <Slider label="그레인" value={adj.grain} min={0} max={100} onChange={(v) => props.onAdjustments({ grain: v })} hint="영상에서는 24fps로 움직입니다." />
            <Slider label="비네트" value={adj.vignette} min={0} max={100} onChange={(v) => props.onAdjustments({ vignette: v })} />
          </div>
          <details className="lab" open>
            <summary>샤프닝 <small>2패스</small></summary>
            <div className="panel-grid">
              <Slider label="양" value={props.sharpening.amount} min={0} max={150} defaultValue={DEFAULT_SHARPENING.amount} onChange={(v) => props.onSharpening({ amount: v })} />
              <Slider label="반경" value={props.sharpening.radius} min={0.5} max={3} step={0.1} defaultValue={DEFAULT_SHARPENING.radius} format={(v) => v.toFixed(1)} onChange={(v) => props.onSharpening({ radius: v })} />
              <Slider label="디테일" value={props.sharpening.detail} min={0} max={100} defaultValue={DEFAULT_SHARPENING.detail} onChange={(v) => props.onSharpening({ detail: v })} />
              <Slider label="마스킹" value={props.sharpening.masking} min={0} max={100} defaultValue={0} onChange={(v) => props.onSharpening({ masking: v })} />
            </div>
          </details>
          <p className="note">날짜 인화와 광학 효과는 우측 하단의 [Camera Effects] 버튼에서 엽니다.</p>
        </div>
      )}

      {tab === 'video' && props.mediaKind === 'video' && (
        <div className="panel-stack">
          <Toggle
            label="HDR / HLG 안전 가드"
            hint="휴대폰 HDR 클립이 회색으로 뜨거나 하이라이트가 날아갈 때 켭니다. 16–235 범위를 0–255로 펴고 하이라이트를 부드럽게 마감합니다."
            checked={props.inputGuard === 1}
            onChange={(value) => props.onInputGuard(value ? 1 : 0)}
          />
          <div className="panel-grid">
            <Slider
              label="트림 시작"
              value={props.trim.start}
              min={0}
              max={Math.max(0.2, props.duration - 0.2)}
              step={0.05}
              format={(value) => `${value.toFixed(2)}s`}
              onChange={(value) => props.onTrim({ start: Math.min(value, props.trim.end - 0.2), end: props.trim.end })}
            />
            <Slider
              label="트림 끝"
              value={props.trim.end}
              min={0.2}
              max={Math.max(0.2, props.duration)}
              step={0.05}
              format={(value) => `${value.toFixed(2)}s`}
              onChange={(value) => props.onTrim({ start: props.trim.start, end: Math.max(value, props.trim.start + 0.2) })}
            />
          </div>
          <dl className="export-table">
            <div><dt>원본 프레임레이트</dt><dd>{props.fps} fps</dd></div>
            <div><dt>내보낼 길이</dt><dd>{Math.max(0, props.trim.end - props.trim.start).toFixed(2)}초</dd></div>
            <div><dt>그레인</dt><dd>{props.inputGuard === 1 ? 'HDR 가드 적용' : 'sRGB 그대로'} · 24fps 동적</dd></div>
          </dl>
        </div>
      )}
    </Modal>
  );
}
