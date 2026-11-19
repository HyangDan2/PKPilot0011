import { useState } from 'react';
import { Modal } from './Modal';
import { Field, Segmented, Slider, Toggle } from './controls';
import { CurveEditor } from './CurveEditor';
import { MIXER_COLORS, type ColorMixerSettings, type HSL } from '../types/colorMixer';
import { CURVE_CHANNELS, identityPoints, type CurveChannel, type ToneCurves } from '../types/curves';
import { DEFAULT_CAMERA, localCalendarDate, type CameraSettings } from '../types/camera';
import { DEFAULT_SHARPENING, type SharpeningSettings } from '../types/sharpening';
import type { AdjustmentSettings } from '../types/film';
import type { MediaKind, TrimRange } from '../types/studio';
import { RETRO_OPTICS } from '../filters/catalog';

type Tab = 'light' | 'color' | 'curves' | 'texture' | 'date' | 'video';

interface AdjustModalProps {
  filmId: string;
  filterLabel: string;
  adjustments: AdjustmentSettings;
  camera: CameraSettings;
  curves: ToneCurves;
  mixer: ColorMixerSettings;
  sharpening: SharpeningSettings;
  mediaKind: MediaKind;
  duration: number;
  fps: number;
  inputGuard: 0 | 1;
  trim: TrimRange;
  onAdjustments: (patch: Partial<AdjustmentSettings>) => void;
  onDateStamp: (patch: Partial<CameraSettings['dateStamp']>) => void;
  onOptics: (patch: Partial<CameraSettings['optics']>) => void;
  onCurves: (curves: ToneCurves) => void;
  onMixer: (mixer: ColorMixerSettings) => void;
  onSharpening: (patch: Partial<SharpeningSettings>) => void;
  onTrim: (trim: TrimRange) => void;
  onInputGuard: (guard: 0 | 1) => void;
  onReset: () => void;
  onClose: () => void;
}

const BAND_LABELS: Record<(typeof MIXER_COLORS)[number], string> = {
  red: '레드', orange: '오렌지', yellow: '옐로', green: '그린',
  aqua: '아쿠아', blue: '블루', purple: '퍼플', magenta: '마젠타',
};

const BAND_SWATCH: Record<string, string> = {
  red: '#e2574c', orange: '#e08a3c', yellow: '#dfc341', green: '#6fae57',
  aqua: '#4fb3ae', blue: '#5a86d6', purple: '#8a6fd1', magenta: '#c05eae',
};

function hexToHsl(hex: string): HSL {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h / 6) % 1 + 1) % 1, d / Math.max(1e-6, 1 - Math.abs(2 * l - 1)), l];
}

export function AdjustModal(props: AdjustModalProps) {
  const [tab, setTab] = useState<Tab>('light');
  const [channel, setChannel] = useState<CurveChannel>('white');
  const [band, setBand] = useState<(typeof MIXER_COLORS)[number]>('red');
  const { adjustments: adj, camera, mixer, sharpening } = props;
  const retro = props.filmId === 'FS-010';

  const patchBand = (patch: Partial<ColorMixerSettings['bands'][typeof band]>) => {
    props.onMixer({
      ...mixer,
      bands: { ...mixer.bands, [band]: { ...mixer.bands[band], ...patch } },
    });
  };

  const addPoint = () => {
    if (mixer.points.length >= 8) return;
    const id = `color-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    props.onMixer({
      ...mixer,
      points: [...mixer.points, {
        id,
        name: `Color ${mixer.points.length + 1}`,
        color: hexToHsl('#c96a4a'),
        enabled: true,
        shift: { hue: 0, saturation: 0, luminance: 0 },
        range: { hue: 25, saturation: 35, luminance: 35 },
        feather: 50,
      }],
    });
  };

  return (
    <Modal
      kicker="GRADE PANEL"
      title="세부 보정"
      description={`${props.filterLabel} 위에 얹는 보정입니다. 값은 모두 실시간으로 반영됩니다.`}
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
          ['curves', '커브'],
          ['texture', '질감'],
          ['date', '날짜'],
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

          <details className="lab" open>
            <summary>Colour Lab · Spectrum</summary>
            <div className="band-row">
              {MIXER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`band-dot${band === color ? ' on' : ''}`}
                  style={{ background: BAND_SWATCH[color] }}
                  onClick={() => setBand(color)}
                  aria-label={BAND_LABELS[color]}
                  title={BAND_LABELS[color]}
                />
              ))}
              <span className="band-name">{BAND_LABELS[band]}</span>
            </div>
            <div className="panel-grid">
              <Slider label="색상" value={mixer.bands[band].hue} min={-100} max={100} onChange={(v) => patchBand({ hue: v })} />
              <Slider label="채도" value={mixer.bands[band].saturation} min={-100} max={100} onChange={(v) => patchBand({ saturation: v })} />
              <Slider label="휘도" value={mixer.bands[band].luminance} min={-100} max={100} onChange={(v) => patchBand({ luminance: v })} />
            </div>
          </details>

          <details className="lab">
            <summary>Colour Lab · Color Focus <small>{mixer.points.length}/8</small></summary>
            <p className="note">장면에서 뽑은 색 하나만 옮깁니다. 색을 고르고 색상/채도/휘도를 조정하세요.</p>
            {mixer.points.map((point, index) => {
              const hex = `#${point.color.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}`;
              return (
                <div className="point-row" key={point.id}>
                  <div className="point-head">
                    <input
                      type="color"
                      value={hex}
                      aria-label={`${point.name} 색`}
                      onChange={(event) => {
                        const points = mixer.points.map((item, i) => i === index ? { ...item, color: hexToHsl(event.target.value) } : item);
                        props.onMixer({ ...mixer, points });
                      }}
                    />
                    <span>{point.name}</span>
                    <Toggle label="" checked={point.enabled} onChange={(value) => {
                      const points = mixer.points.map((item, i) => i === index ? { ...item, enabled: value } : item);
                      props.onMixer({ ...mixer, points });
                    }} />
                    <button type="button" className="icon-btn tiny" aria-label="색 제거" onClick={() => props.onMixer({ ...mixer, points: mixer.points.filter((_, i) => i !== index) })}>✕</button>
                  </div>
                  <div className="panel-grid tight">
                    <Slider label="색상 이동" value={point.shift.hue} min={-100} max={100} onChange={(value) => props.onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, shift: { ...item.shift, hue: value } } : item) })} />
                    <Slider label="채도 이동" value={point.shift.saturation} min={-100} max={100} onChange={(value) => props.onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, shift: { ...item.shift, saturation: value } } : item) })} />
                    <Slider label="휘도 이동" value={point.shift.luminance} min={-100} max={100} onChange={(value) => props.onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, shift: { ...item.shift, luminance: value } } : item) })} />
                    <Slider label="범위" value={point.range.hue} min={1} max={180} defaultValue={25} onChange={(value) => props.onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, range: { ...item.range, hue: value } } : item) })} />
                    <Slider label="페더" value={point.feather} min={1} max={100} defaultValue={50} onChange={(value) => props.onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, feather: value } : item) })} />
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn ghost small" onClick={addPoint} disabled={mixer.points.length >= 8}>+ 색 추가</button>
          </details>

          <details className="lab">
            <summary>Colour Lab · RGB Base</summary>
            <div className="panel-grid">
              {(['red', 'green', 'blue'] as const).map((primary) => (
                <div key={primary} className="base-block">
                  <span className="base-name">{primary.toUpperCase()}</span>
                  <Slider label="색상 회전" value={mixer.rgbBase.primaries[primary].hue} min={-100} max={100} onChange={(value) => props.onMixer({ ...mixer, rgbBase: { ...mixer.rgbBase, primaries: { ...mixer.rgbBase.primaries, [primary]: { ...mixer.rgbBase.primaries[primary], hue: value } } } })} />
                  <Slider label="채도 배율" value={mixer.rgbBase.primaries[primary].saturation} min={-100} max={100} onChange={(value) => props.onMixer({ ...mixer, rgbBase: { ...mixer.rgbBase, primaries: { ...mixer.rgbBase.primaries, [primary]: { ...mixer.rgbBase.primaries[primary], saturation: value } } } })} />
                </div>
              ))}
              <Slider label="섀도우 틴트" value={mixer.rgbBase.shadowsTint} min={-100} max={100} onChange={(value) => props.onMixer({ ...mixer, rgbBase: { ...mixer.rgbBase, shadowsTint: value } })} />
            </div>
          </details>
        </div>
      )}

      {tab === 'curves' && (
        <div className="panel-stack">
          <Segmented
            label="채널"
            value={channel}
            options={CURVE_CHANNELS.map((id) => ({ value: id, label: id === 'white' ? 'W' : id[0].toUpperCase() }))}
            onChange={setChannel}
          />
          <CurveEditor
            points={props.curves[channel]}
            onChange={(points) => props.onCurves({ ...props.curves, [channel]: points })}
          />
          <div className="row-between">
            <span className="note">점을 끌어 곡선을 만들고, 빈 곳을 눌러 점을 추가합니다. 더블클릭으로 제거.</span>
            <button type="button" className="btn ghost small" onClick={() => props.onCurves({ ...props.curves, [channel]: identityPoints() })}>
              이 채널 초기화
            </button>
          </div>
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
              <Slider label="양" value={sharpening.amount} min={0} max={150} defaultValue={DEFAULT_SHARPENING.amount} onChange={(v) => props.onSharpening({ amount: v })} />
              <Slider label="반경" value={sharpening.radius} min={0.5} max={3} step={0.1} defaultValue={DEFAULT_SHARPENING.radius} format={(v) => v.toFixed(1)} onChange={(v) => props.onSharpening({ radius: v })} />
              <Slider label="디테일" value={sharpening.detail} min={0} max={100} defaultValue={DEFAULT_SHARPENING.detail} onChange={(v) => props.onSharpening({ detail: v })} />
              <Slider label="마스킹" value={sharpening.masking} min={0} max={100} defaultValue={0} onChange={(v) => props.onSharpening({ masking: v })} />
            </div>
          </details>
          <details className="lab" open={retro}>
            <summary>광학 효과 <small>{retro ? 'RETRO 90 전용' : 'RETRO 90에서 켜집니다'}</small></summary>
            <div className="panel-grid">
              <Slider label="글로우" value={camera.optics.glow} min={0} max={100} defaultValue={RETRO_OPTICS.glow} onChange={(v) => props.onOptics({ glow: v })} />
              <Slider label="할레이션" value={camera.optics.halation} min={0} max={100} defaultValue={RETRO_OPTICS.halation} onChange={(v) => props.onOptics({ halation: v })} />
              <Slider label="소프트니스" value={camera.optics.softness} min={0} max={100} defaultValue={RETRO_OPTICS.softness} onChange={(v) => props.onOptics({ softness: v })} />
            </div>
          </details>
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

      {tab === 'date' && (
        <div className="panel-stack">
          <Toggle
            label="날짜 스탬프"
            hint="필름 카메라의 7세그먼트 데이트 인화"
            checked={camera.dateStamp.enabled}
            onChange={(value) => props.onDateStamp({ enabled: value, date: camera.dateStamp.date || localCalendarDate() })}
          />
          <div className="panel-grid">
            <Field label="날짜">
              <input
                type="date"
                value={camera.dateStamp.date}
                onChange={(event) => props.onDateStamp({ date: event.target.value, enabled: !!event.target.value })}
              />
            </Field>
            <Segmented
              label="형식"
              compact
              value={camera.dateStamp.format}
              options={[{ value: 'compact', label: "'26 3 8" }, { value: 'padded', label: '26 03 08' }, { value: 'full', label: '2026 03 08' }]}
              onChange={(value) => props.onDateStamp({ format: value })}
            />
            <Segmented
              label="위치"
              compact
              value={camera.dateStamp.position}
              options={[{ value: 'bottom-right', label: '오른쪽 아래' }, { value: 'bottom-left', label: '왼쪽 아래' }]}
              onChange={(value) => props.onDateStamp({ position: value })}
            />
            <Slider label="크기" value={camera.dateStamp.size} min={1} max={6} step={0.5} defaultValue={DEFAULT_CAMERA.dateStamp.size} onChange={(v) => props.onDateStamp({ size: v })} />
            <Slider label="불투명도" value={camera.dateStamp.opacity} min={0} max={100} defaultValue={85} onChange={(v) => props.onDateStamp({ opacity: v })} />
            <Field label="색">
              <input type="color" value={camera.dateStamp.color} onChange={(event) => props.onDateStamp({ color: event.target.value })} />
            </Field>
          </div>
        </div>
      )}
    </Modal>
  );
}
