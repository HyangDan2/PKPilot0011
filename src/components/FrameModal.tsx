import { Modal } from './Modal';
import { Segmented, Slider, Toggle } from './controls';
import { FRAME_MAP, FYRA_THEME_LABELS, SINGLE_FRAME_DEFS } from '../plate/frames';
import { Field } from './controls';
import { IconCheck } from './Icons';
import type { FrameId, FrameSettings, MediaKind, PlateMeta } from '../types/studio';

interface FrameModalProps {
  frame: FrameSettings;
  mediaKind: MediaKind;
  thumbs: Record<string, string>;
  onPatch: (patch: Partial<FrameSettings>) => void;
  meta: PlateMeta;
  onMeta: (patch: Partial<PlateMeta>) => void;
  onClose: () => void;
  /** The frame's own default margin, so the "기본값" slider position is honest. */
  defaultPad: number;
}

/** The eleven single-cut signatures. The two 4-up plates live in their own window. */
const SINGLE = SINGLE_FRAME_DEFS;

export function FrameModal({ frame, mediaKind, thumbs, onPatch, meta, onMeta, onClose, defaultPad }: FrameModalProps) {
  const padValue = frame.padPct ?? defaultPad;
  return (
    <Modal
      kicker="FRAME MODAL"
      title="프레임 선택"
      description="지금 필터가 입혀진 화면으로 그린 단일 11종 플레이트입니다. 프레임을 끄면 여백 없이 사진만 저장하고, 여백과 잉크는 여기서 바로 바꿉니다."
      onClose={onClose}
      size="wide"
      testId="frame-modal"
      footer={
        <div className="frame-foot">
          <span className="muted">여백은 프레임마다 다르게 저장됩니다.</span>
          <button type="button" className="btn primary" onClick={onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <section className="frame-enable">
        <Toggle
          label="프레임 사용"
          hint="끄면 여백·메타 인화 없이 필터·보정된 원본 화면만 출력"
          checked={frame.enabled}
          testId="frame-enabled-toggle"
          onChange={(value) => onPatch({ enabled: value })}
        />
      </section>

      {/* Off keeps every choice underneath it, only out of reach: switching
          back on restores the same style, margin and ink at once. */}
      <fieldset className={`frame-scope${frame.enabled ? '' : ' is-off'}`} disabled={!frame.enabled}>
      <section className="filter-section">
        <h3 className="section-title">단일 11종 <small>사진 · 영상</small></h3>
        <div className="frame-grid">
          {SINGLE.map((item) => {
            const url = thumbs[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={`frame-card${frame.style === item.id ? ' selected' : ''}`}
                onClick={() => onPatch({ style: item.id as FrameId })}
                aria-pressed={frame.style === item.id}
                data-frame-id={item.id}
                title={item.blurb}
              >
                <span className="frame-thumb">
                  {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-shimmer" />}
                  {frame.style === item.id && <span className="frame-check"><IconCheck size={13} /></span>}
                </span>
                <span className="frame-name">{FRAME_MAP[item.id].label}</span>
                <span className="frame-tag">{item.tag}</span>
              </button>
            );
          })}
        </div>
        <p className="note">
          4컷 플레이트 2종(Contact Sheet · FYRA 04)은 우측 하단의 4컷 버튼에서 엽니다.
          {mediaKind === 'video' ? ' 영상은 단일 11종으로 인화합니다.' : ''}
        </p>
      </section>

      <section className="frame-options">
        <h3 className="section-title">프레임 옵션</h3>
        <Segmented
          label="배경"
          value={frame.backdrop}
          options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
          onChange={(value) => onPatch({ backdrop: value })}
        />
        <Slider
          label="여백"
          value={padValue}
          min={0}
          max={12}
          step={0.1}
          defaultValue={defaultPad}
          format={(value) => `${value.toFixed(1)}%`}
          onChange={(value) => onPatch({ padPct: value })}
          hint={`이 프레임의 기본 여백은 ${defaultPad.toFixed(1)}%입니다.`}
        />
        <Segmented
          label="엠블럼"
          value={frame.emblem}
          options={[
            { value: 'auto', label: 'Auto · 메이커' },
            { value: 'hd2lab', label: 'HD2Lab' },
            { value: 'none', label: '없음' },
          ]}
          onChange={(value) => onPatch({ emblem: value })}
        />
        <Segmented
          label="엠블럼 잉크"
          value={frame.emblemMono ? 'mono' : 'original'}
          options={[
            { value: 'original', label: 'Original' },
            { value: 'mono', label: 'All Black' },
          ]}
          onChange={(value) => onPatch({ emblemMono: value === 'mono' })}
        />
        <div className="toggle-row">
          <Toggle label="촬영 정보" hint="카메라 · 렌즈 · 노출" checked={frame.showSpec} onChange={(value) => onPatch({ showSpec: value })} />
          <Toggle label="캡션" hint="직접 쓴 한 줄" checked={frame.showCaption} onChange={(value) => onPatch({ showCaption: value })} />
        </div>
        <div className="meta-grid">
          <Field label="카메라" hint="비우면 엠블럼은 HD2Lab으로 인쇄됩니다.">
            <input value={[meta.make, meta.model].filter(Boolean).join(' ')} onChange={(event) => {
              const [make, ...rest] = event.target.value.split(' ');
              onMeta({ make: make ?? '', model: rest.join(' ') });
            }} placeholder="SONY ILCE-7M4" />
          </Field>
          <Field label="렌즈">
            <input value={meta.lens} onChange={(event) => onMeta({ lens: event.target.value })} placeholder="FE 35mm F1.8" />
          </Field>
          <Field label="노출" hint="f/1.8 · 1/250s · ISO 100">
            <div className="triple">
              <input value={meta.aperture} onChange={(event) => onMeta({ aperture: event.target.value })} placeholder="f/1.8" aria-label="조리개" />
              <input value={meta.shutter} onChange={(event) => onMeta({ shutter: event.target.value })} placeholder="1/250s" aria-label="셔터" />
              <input value={meta.iso} onChange={(event) => onMeta({ iso: event.target.value })} placeholder="ISO 100" aria-label="ISO" />
            </div>
          </Field>
          <Field label="촬영일">
            <input value={meta.datetime} onChange={(event) => onMeta({ datetime: event.target.value })} placeholder="2026-11-19 18:04:31" />
          </Field>
          <Field label="캡션">
            <input value={meta.caption} onChange={(event) => onMeta({ caption: event.target.value })} placeholder="한 줄 캡션" maxLength={80} />
          </Field>
        </div>
        {frame.style === 'fyra04' && (
          <Segmented
            label="FYRA 테마"
            compact
            value={frame.fyraTheme}
            options={FYRA_THEME_LABELS.map((theme) => ({ value: theme.id, label: theme.label }))}
            onChange={(value) => onPatch({ fyraTheme: value })}
          />
        )}
      </section>
      </fieldset>
    </Modal>
  );
}
