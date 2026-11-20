import { Slider, Toggle } from './controls';
import { DEFAULT_SHARPENING, type SharpeningSettings } from '../types/sharpening';
import { IconCamera, IconPalette, IconRefresh, IconSliders, IconSpline } from './Icons';
import type { AdjustmentSettings } from '../types/film';
import type { MediaKind, TrimRange } from '../types/studio';

interface RightSidebarProps {
  filterLabel: string;
  adjustments: AdjustmentSettings;
  sharpening: SharpeningSettings;
  mediaKind: MediaKind;
  duration: number;
  fps: number;
  inputGuard: 0 | 1;
  trim: TrimRange;
  active: { mixer: boolean; curves: boolean; curveOpen: boolean; camera: boolean };
  onAdjustments: (patch: Partial<AdjustmentSettings>) => void;
  onSharpening: (patch: Partial<SharpeningSettings>) => void;
  onTrim: (trim: TrimRange) => void;
  onInputGuard: (guard: 0 | 1) => void;
  onReset: () => void;
  onOpenColorLab: () => void;
  onOpenCamera: () => void;
  onToggleCurve: () => void;
}

/**
 * The right rail: everything the old 세부 보정 sheet held, laid out flat so a
 * slider is one wheel away instead of one window away. Color Lab, Tone Curve
 * and Camera Effects keep their own rooms — they are doors at the foot of the
 * rail, with the reset that clears the whole grade beside the title.
 */
export function RightSidebar(props: RightSidebarProps) {
  const adj = props.adjustments;
  return (
    <aside className="pc-side pc-right" data-testid="pc-right-sidebar" aria-label="세부 보정">
      <header className="right-head">
        <div>
          <p className="right-kicker">GRADE</p>
          <h2>세부 보정</h2>
        </div>
        <button type="button" className="btn ghost small" onClick={props.onReset} data-testid="grade-reset">
          <IconRefresh size={13} /> 전체 초기화
        </button>
      </header>

      <div className="right-scroll">
        <section className="right-section" data-testid="grade-light">
          <h3 className="section-title">빛 <small>{props.filterLabel} 위에</small></h3>
          <Slider label="노출" value={adj.exposure} min={-3} max={3} step={0.05} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`} onChange={(v) => props.onAdjustments({ exposure: v })} />
          <Slider label="대비" value={adj.contrast} min={-100} max={100} onChange={(v) => props.onAdjustments({ contrast: v })} />
          <Slider label="하이라이트" value={adj.highlights} min={-100} max={100} onChange={(v) => props.onAdjustments({ highlights: v })} />
          <Slider label="섀도우" value={adj.shadows} min={-100} max={100} onChange={(v) => props.onAdjustments({ shadows: v })} />
          <Slider label="화이트" value={adj.whites ?? 0} min={-100} max={100} onChange={(v) => props.onAdjustments({ whites: v })} />
          <Slider label="블랙" value={adj.blacks ?? 0} min={-100} max={100} onChange={(v) => props.onAdjustments({ blacks: v })} />
        </section>

        <section className="right-section" data-testid="grade-color">
          <h3 className="section-title">색 <small>필름 강도 포함</small></h3>
          <Slider label="색온도" value={adj.temperature} min={-100} max={100} onChange={(v) => props.onAdjustments({ temperature: v })} hint="파랑 ← → 앰버" />
          <Slider label="틴트" value={adj.tint} min={-100} max={100} onChange={(v) => props.onAdjustments({ tint: v })} hint="그린 ← → 마젠타" />
          <Slider label="채도" value={adj.saturation} min={-100} max={100} onChange={(v) => props.onAdjustments({ saturation: v })} />
          <Slider label="필름 강도" value={adj.filmStrength} min={0} max={100} defaultValue={100} format={(v) => `${Math.round(v)}%`} onChange={(v) => props.onAdjustments({ filmStrength: v })} />
        </section>

        <section className="right-section" data-testid="grade-texture">
          <h3 className="section-title">질감 <small>그레인 · 샤프닝</small></h3>
          <Slider label="그레인" value={adj.grain} min={0} max={100} onChange={(v) => props.onAdjustments({ grain: v })} hint={props.mediaKind === 'video' ? '영상에서는 24fps로 움직입니다.' : undefined} />
          <Slider label="비네트" value={adj.vignette} min={0} max={100} onChange={(v) => props.onAdjustments({ vignette: v })} />
          <div className="right-sub">
            <Slider label="샤프닝 양" value={props.sharpening.amount} min={0} max={150} defaultValue={DEFAULT_SHARPENING.amount} onChange={(v) => props.onSharpening({ amount: v })} />
            <Slider label="샤프닝 반경" value={props.sharpening.radius} min={0.5} max={3} step={0.1} defaultValue={DEFAULT_SHARPENING.radius} format={(v) => v.toFixed(1)} onChange={(v) => props.onSharpening({ radius: v })} />
            <Slider label="샤프닝 디테일" value={props.sharpening.detail} min={0} max={100} defaultValue={DEFAULT_SHARPENING.detail} onChange={(v) => props.onSharpening({ detail: v })} />
            <Slider label="샤프닝 마스킹" value={props.sharpening.masking} min={0} max={100} defaultValue={0} onChange={(v) => props.onSharpening({ masking: v })} />
          </div>
        </section>

        {props.mediaKind === 'video' && (
          <section className="right-section" data-testid="grade-video">
            <h3 className="section-title">영상 <small>{props.fps} fps</small></h3>
            <Toggle
              label="HDR / HLG 안전 가드"
              hint="HDR 클립이 회색으로 뜨거나 하이라이트가 날아갈 때 켭니다."
              checked={props.inputGuard === 1}
              onChange={(value) => props.onInputGuard(value ? 1 : 0)}
            />
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
            <p className="side-note">내보낼 길이 {Math.max(0, props.trim.end - props.trim.start).toFixed(2)}초</p>
          </section>
        )}

        <section className="right-section" data-testid="grade-tools">
          <h3 className="section-title">도구 <small>세 가지 색 작업</small></h3>
          <div className="right-tools">
            <button
              type="button"
              className={`right-tool${props.active.mixer ? ' on' : ''}`}
              onClick={props.onOpenColorLab}
              data-testid="side-colorlab"
            >
              <IconPalette size={16} />
              <span>Color Lab</span>
              <small>8대역 · 포인트 컬러</small>
              {props.active.mixer && <span className="dot-active" aria-hidden />}
            </button>
            <button
              type="button"
              className={`right-tool${props.active.curves || props.active.curveOpen ? ' on' : ''}`}
              onClick={props.onToggleCurve}
              aria-pressed={props.active.curveOpen}
              data-testid="side-tonecurve"
            >
              <IconSpline size={16} />
              <span>Tone Curve</span>
              <small>스테이지 위에서 조절</small>
              {props.active.curves && <span className="dot-active" aria-hidden />}
            </button>
            <button
              type="button"
              className={`right-tool${props.active.camera ? ' on' : ''}`}
              onClick={props.onOpenCamera}
              data-testid="side-cameraeffects"
            >
              <IconCamera size={16} />
              <span>Camera Effects</span>
              <small>날짜 인화 · 광학</small>
              {props.active.camera && <span className="dot-active" aria-hidden />}
            </button>
          </div>
          <p className="side-note"><IconSliders size={12} /> 값은 모두 실시간으로 반영됩니다.</p>
        </section>
      </div>
    </aside>
  );
}
