import { useState } from 'react';
import { Modal } from './Modal';
import { Slider, Toggle } from './controls';
import { MIXER_COLORS, defaultColorMixer, type ColorMixerSettings, type HSL } from '../types/colorMixer';

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

interface ColorLabModalProps {
  mixer: ColorMixerSettings;
  onMixer: (mixer: ColorMixerSettings) => void;
  onClose: () => void;
}

/**
 * Color Lab on its own: the eight-band spectrum, the up-to-eight colour focus
 * points and the RGB base. Lifted out of the adjustment sheet so a colourer can
 * work on colour without walking past exposure on the way.
 */
export function ColorLabModal({ mixer, onMixer, onClose }: ColorLabModalProps) {
  const [band, setBand] = useState<(typeof MIXER_COLORS)[number]>('red');

  const patchBand = (patch: Partial<ColorMixerSettings['bands'][typeof band]>) => {
    onMixer({ ...mixer, bands: { ...mixer.bands, [band]: { ...mixer.bands[band], ...patch } } });
  };

  const addPoint = () => {
    if (mixer.points.length >= 8) return;
    const id = `color-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    onMixer({
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
      kicker="COLOR LAB"
      title="Color Lab"
      description="8대역 스펙트럼과 포인트 컬러, RGB 베이스. 조정하는 즉시 스테이지에 반영됩니다."
      onClose={onClose}
      size="wide"
      testId="colorlab-modal"
      footer={
        <div className="adjust-foot">
          <button type="button" className="btn ghost" onClick={() => onMixer(defaultColorMixer())}>Color Lab 초기화</button>
          <button type="button" className="btn primary" onClick={onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <div className="panel-stack">
        <section className="lab open">
          <h3 className="section-title">Spectrum <small>8대역 HSL</small></h3>
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
        </section>

        <section className="lab">
          <h3 className="section-title">Color Focus <small>{mixer.points.length}/8</small></h3>
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
                      onMixer({ ...mixer, points });
                    }}
                  />
                  <span>{point.name}</span>
                  <Toggle label="" checked={point.enabled} onChange={(value) => {
                    const points = mixer.points.map((item, i) => i === index ? { ...item, enabled: value } : item);
                    onMixer({ ...mixer, points });
                  }} />
                  <button type="button" className="icon-btn tiny" aria-label="색 제거" onClick={() => onMixer({ ...mixer, points: mixer.points.filter((_, i) => i !== index) })}>✕</button>
                </div>
                <div className="panel-grid tight">
                  <Slider label="색상 이동" value={point.shift.hue} min={-100} max={100} onChange={(value) => onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, shift: { ...item.shift, hue: value } } : item) })} />
                  <Slider label="채도 이동" value={point.shift.saturation} min={-100} max={100} onChange={(value) => onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, shift: { ...item.shift, saturation: value } } : item) })} />
                  <Slider label="휘도 이동" value={point.shift.luminance} min={-100} max={100} onChange={(value) => onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, shift: { ...item.shift, luminance: value } } : item) })} />
                  <Slider label="범위" value={point.range.hue} min={1} max={180} defaultValue={25} onChange={(value) => onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, range: { ...item.range, hue: value } } : item) })} />
                  <Slider label="페더" value={point.feather} min={1} max={100} defaultValue={50} onChange={(value) => onMixer({ ...mixer, points: mixer.points.map((item, i) => i === index ? { ...item, feather: value } : item) })} />
                </div>
              </div>
            );
          })}
          <button type="button" className="btn ghost small" onClick={addPoint} disabled={mixer.points.length >= 8}>+ 색 추가</button>
        </section>

        <section className="lab">
          <h3 className="section-title">RGB Base</h3>
          <div className="panel-grid">
            {(['red', 'green', 'blue'] as const).map((primary) => (
              <div key={primary} className="base-block">
                <span className="base-name">{primary.toUpperCase()}</span>
                <Slider label="색상 회전" value={mixer.rgbBase.primaries[primary].hue} min={-100} max={100} onChange={(value) => onMixer({ ...mixer, rgbBase: { ...mixer.rgbBase, primaries: { ...mixer.rgbBase.primaries, [primary]: { ...mixer.rgbBase.primaries[primary], hue: value } } } })} />
                <Slider label="채도 배율" value={mixer.rgbBase.primaries[primary].saturation} min={-100} max={100} onChange={(value) => onMixer({ ...mixer, rgbBase: { ...mixer.rgbBase, primaries: { ...mixer.rgbBase.primaries, [primary]: { ...mixer.rgbBase.primaries[primary], saturation: value } } } })} />
              </div>
            ))}
            <Slider label="섀도우 틴트" value={mixer.rgbBase.shadowsTint} min={-100} max={100} onChange={(value) => onMixer({ ...mixer, rgbBase: { ...mixer.rgbBase, shadowsTint: value } })} />
          </div>
        </section>
      </div>
    </Modal>
  );
}
