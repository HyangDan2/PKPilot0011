import { Modal } from './Modal';
import { Field, Segmented, Slider, Toggle } from './controls';
import { DEFAULT_CAMERA, localCalendarDate, type CameraSettings } from '../types/camera';
import { RETRO_OPTICS } from '../filters/catalog';

interface CameraEffectsModalProps {
  camera: CameraSettings;
  filmId: string;
  onDateStamp: (patch: Partial<CameraSettings['dateStamp']>) => void;
  onOptics: (patch: Partial<CameraSettings['optics']>) => void;
  onClose: () => void;
}

/**
 * Camera effects on their own sheet: the 7-segment date imprint and the lens
 * optics (glow, halation, softness). Both ride on the graded pixels rather than
 * on the plate, so they are kept apart from the light and colour sliders.
 */
export function CameraEffectsModal({ camera, filmId, onDateStamp, onOptics, onClose }: CameraEffectsModalProps) {
  const retro = filmId === 'FS-010';
  const reset = () => {
    onDateStamp({ ...DEFAULT_CAMERA.dateStamp });
    onOptics({ ...DEFAULT_CAMERA.optics, quality: camera.optics.quality });
  };

  return (
    <Modal
      kicker="CAMERA EFFECTS"
      title="Camera Effects"
      description="필름 카메라의 날짜 인화와 렌즈 광학 효과입니다. 조정하는 즉시 스테이지에 반영됩니다."
      onClose={onClose}
      size="sheet"
      testId="cameraeffects-modal"
      footer={
        <div className="adjust-foot">
          <button type="button" className="btn ghost" onClick={reset}>효과 초기화</button>
          <button type="button" className="btn primary" onClick={onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <div className="panel-stack">
        <section className="lab open">
          <h3 className="section-title">날짜 각인 <small>7세그먼트 데이트 인화</small></h3>
          <Toggle
            label="날짜 스탬프"
            hint="필름 카메라의 7세그먼트 데이트 인화"
            checked={camera.dateStamp.enabled}
            onChange={(value) => onDateStamp({ enabled: value, date: camera.dateStamp.date || localCalendarDate() })}
          />
          <div className="panel-grid">
            <Field label="날짜">
              <input
                type="date"
                value={camera.dateStamp.date}
                onChange={(event) => onDateStamp({ date: event.target.value, enabled: !!event.target.value })}
              />
            </Field>
            <Segmented
              label="형식"
              compact
              value={camera.dateStamp.format}
              options={[{ value: 'compact', label: "'26 3 8" }, { value: 'padded', label: '26 03 08' }, { value: 'full', label: '2026 03 08' }]}
              onChange={(value) => onDateStamp({ format: value })}
            />
            <Segmented
              label="위치"
              compact
              value={camera.dateStamp.position}
              options={[{ value: 'bottom-right', label: '오른쪽 아래' }, { value: 'bottom-left', label: '왼쪽 아래' }]}
              onChange={(value) => onDateStamp({ position: value })}
            />
            <Slider label="크기" value={camera.dateStamp.size} min={1} max={6} step={0.5} defaultValue={DEFAULT_CAMERA.dateStamp.size} onChange={(v) => onDateStamp({ size: v })} />
            <Slider label="불투명도" value={camera.dateStamp.opacity} min={0} max={100} defaultValue={85} onChange={(v) => onDateStamp({ opacity: v })} />
            <Slider label="글로우" value={camera.dateStamp.glow} min={0} max={100} defaultValue={DEFAULT_CAMERA.dateStamp.glow} onChange={(v) => onDateStamp({ glow: v })} />
            <Field label="색">
              <input type="color" value={camera.dateStamp.color} onChange={(event) => onDateStamp({ color: event.target.value })} />
            </Field>
          </div>
        </section>

        <section className="lab open">
          <h3 className="section-title">광학 효과 <small>{retro ? 'RETRO 90 전용' : 'RETRO 90에서 기본값이 켜집니다'}</small></h3>
          <div className="panel-grid">
            <Slider label="하이라이트 글로우" value={camera.optics.glow} min={0} max={100} defaultValue={RETRO_OPTICS.glow} onChange={(v) => onOptics({ glow: v })} />
            <Slider label="할레이션" value={camera.optics.halation} min={0} max={100} defaultValue={RETRO_OPTICS.halation} onChange={(v) => onOptics({ halation: v })} />
            <Slider label="소프트니스" value={camera.optics.softness} min={0} max={100} defaultValue={RETRO_OPTICS.softness} onChange={(v) => onOptics({ softness: v })} />
          </div>
          <Segmented
            label="광학 품질"
            value={camera.optics.quality}
            options={[{ value: 'standard', label: 'Standard · 빠름' }, { value: 'high', label: 'High · 부드러움' }]}
            onChange={(value) => onOptics({ quality: value as 'standard' | 'high' })}
          />
          <p className="note">High는 샘플 수를 두 배로 잡습니다 — 내보내기가 조금 느려지지만 큰 판면에서 매끄럽습니다.</p>
        </section>
      </div>
    </Modal>
  );
}
