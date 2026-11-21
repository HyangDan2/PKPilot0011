import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { Segmented, Slider, Toggle } from './controls';
import { Field } from './controls';
import { FRAME_MAP, FYRA_THEME_LABELS, MULTI_FRAME_DEFS } from '../plate/frames';
import { IconCheck, IconImage, IconTrash } from './Icons';
import { MYNDA_URL, customStyleOf, type ShutterFrameSpec } from '../plate/custom';
import type { FrameId, FrameSettings, MediaInfo, PlateMeta } from '../types/studio';

export interface FourCutModalProps {
  frame: FrameSettings;
  /** The photographs on the stage, in slot order. Videos are never here. */
  photos: MediaInfo[];
  thumbs: Record<string, string>;
  thumbsLoading: boolean;
  meta: PlateMeta;
  defaultPad: number;
  busy: boolean | string;
  /** Custom `.shutterframe.json` frames on the shared shelf. */
  customFrames: ShutterFrameSpec[];
  customThumbs: Record<string, string>;
  onPatch: (patch: Partial<FrameSettings>) => void;
  onMeta: (patch: Partial<PlateMeta>) => void;
  onAddFiles: (files: File[]) => void;
  onReplaceSlot: (index: number, file: File) => void;
  onRemoveSlot: (index: number) => void;
  onImportCustom: (file: File) => void;
  onPasteCustom: (text: string) => void;
  onDeleteCustom: (id: string) => void;
  onApply: () => void;
  onClose: () => void;
}

/**
 * The four-cut window: two plates, four slots and the frame's own options, all
 * in one place. It is opened from the strip of floating buttons in the corner,
 * so a single photograph, a clip, or nothing at all can become a 4-up plate
 * without ever visiting the single-frame library.
 */
export function FourCutModal(props: FourCutModalProps) {
  const { frame, photos, meta } = props;
  const addInput = useRef<HTMLInputElement | null>(null);
  const replaceInput = useRef<HTMLInputElement | null>(null);
  const customInput = useRef<HTMLInputElement | null>(null);
  const replaceIndex = useRef<number>(0);
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const padValue = frame.padPct ?? props.defaultPad;
  const isCustom = String(frame.style).startsWith('custom:');
  const slots = Array.from({ length: 4 }, (_, index) => photos[index] ?? null);

  const pickReplace = (index: number) => {
    replaceIndex.current = index;
    replaceInput.current?.click();
  };

  return (
    <Modal
      kicker="FOUR-CUT"
      title="4컷 프레임"
      description="네 장을 한 장에 붙이는 두 플레이트와, 직접 만든 커스텀 프레임입니다. 슬롯을 채우고 적용하면 에디터가 그 프레임으로 전환됩니다."
      onClose={props.onClose}
      size="wide"
      testId="fourcut-modal"
      footer={
        <div className="fourcut-foot">
          <span className="muted">
            {photos.length < 4
              ? `사진 ${photos.length} / 4 — 빈 슬롯은 여백으로 인화됩니다.`
              : '네 슬롯이 모두 찼습니다.'}
          </span>
          <button type="button" className="btn primary" onClick={props.onApply} disabled={!photos.length || !!props.busy}>
            <IconCheck size={15} /> 이 프레임으로 적용
          </button>
        </div>
      }
    >
      <section className="filter-section">
        <h3 className="section-title">4컷 플레이트 2종 <small>사진 전용</small></h3>
        <div className="frame-grid fourcut">
          {MULTI_FRAME_DEFS.map((item) => {
            const url = props.thumbs[item.id];
            const selected = frame.style === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`frame-card${selected ? ' selected' : ''}`}
                onClick={() => props.onPatch({ style: item.id as FrameId })}
                aria-pressed={selected}
                data-frame-id={item.id}
              >
                <span className="frame-thumb">
                  {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-shimmer" />}
                  {selected && <span className="frame-check"><IconCheck size={13} /></span>}
                </span>
                <span className="frame-name">{FRAME_MAP[item.id].label}</span>
                <span className="frame-tag">{item.tag}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="filter-section" data-testid="custom-frame-section">
        <h3 className="section-title">커스텀 프레임 <small>.shutterframe.json</small></h3>
        <div className="frame-grid fourcut">
          {props.customFrames.map((spec) => {
            const style = customStyleOf(spec);
            const selected = frame.style === style;
            const url = props.customThumbs[spec.id];
            return (
              <div key={spec.id} className={`frame-card-wrap${selected ? ' selected' : ''}`} data-custom-frame={spec.id}>
                <button
                  type="button"
                  className={`frame-card${selected ? ' selected' : ''}`}
                  onClick={() => props.onPatch({ style: style as FrameId, enabled: true })}
                  aria-pressed={selected}
                  data-frame-id={style}
                >
                  <span className="frame-thumb">
                    {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-shimmer" />}
                    {selected && <span className="frame-check"><IconCheck size={13} /></span>}
                  </span>
                  <span className="frame-name">{spec.name}</span>
                  <span className="frame-tag">{spec.canvas.width}×{spec.canvas.height}</span>
                </button>
                <button
                  type="button"
                  className="frame-remove"
                  aria-label={`${spec.name} 삭제`}
                  title="보관함에서 삭제"
                  onClick={() => props.onDeleteCustom(spec.id)}
                >
                  <IconTrash size={12} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="frame-card custom-import"
            onClick={() => customInput.current?.click()}
            data-testid="custom-frame-import"
          >
            <span className="frame-thumb import-mark">+</span>
            <span className="frame-name">커스텀 프레임</span>
            <span className="frame-tag">.shutterframe.json</span>
          </button>
        </div>
        <div className="fourcut-actions custom-actions">
          <button type="button" className="btn ghost small" onClick={() => setPasteOpen((value) => !value)}>
            링크 / JSON 붙여넣기
          </button>
          <a className="btn ghost small" href={MYNDA_URL} target="_blank" rel="noreferrer" data-testid="mynda-open">
            Mynda Ljósa로 새 프레임 만들기 ↗
          </a>
        </div>
        {pasteOpen && (
          <div className="custom-paste">
            <textarea
              rows={3}
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              placeholder="https://hyangdan2.github.io/PKPilot0003/#frame=… 또는 .shutterframe.json 내용"
              aria-label="커스텀 프레임 링크 또는 JSON"
            />
            <button
              type="button"
              className="btn primary small"
              disabled={!paste.trim()}
              onClick={() => { props.onPasteCustom(paste); setPaste(''); setPasteOpen(false); }}
            >
              불러오기
            </button>
          </div>
        )}
        {props.customFrames.length === 0 && (
          <p className="note">아직 커스텀 프레임이 없습니다. Mynda Ljósa에서 만들거나, 파일·링크로 불러오세요.</p>
        )}
        <input
          ref={customInput}
          type="file"
          accept=".json,application/json,*/*"
          hidden
          data-testid="custom-frame-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onImportCustom(file);
            event.target.value = '';
          }}
        />
      </section>

      <section className="filter-section">
        <h3 className="section-title">사진 슬롯 <small>SLOT 1 → 4 · 왼쪽 위부터</small></h3>
        <div className="fourcut-slots">
          {slots.map((item, index) => (
            <div key={item?.url ?? `empty-${index}`} className={`fourcut-slot${item ? ' filled' : ''}`}>
              {item ? (
                <>
                  <img src={item.url} alt={`슬롯 ${index + 1}`} draggable={false} />
                  <span className="fourcut-badge">SLOT {index + 1}</span>
                  <div className="fourcut-slot-actions">
                    <button type="button" className="chip" onClick={() => pickReplace(index)}>교체</button>
                    <button type="button" className="chip" onClick={() => props.onRemoveSlot(index)} aria-label={`슬롯 ${index + 1} 비우기`}>
                      <IconTrash size={12} /> 삭제
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="fourcut-empty" onClick={() => addInput.current?.click()}>
                  <IconImage size={20} />
                  <span>SLOT {index + 1}</span>
                  <small>사진 추가</small>
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="fourcut-actions">
          <button type="button" className="btn ghost small" onClick={() => addInput.current?.click()} disabled={photos.length >= 4 || !!props.busy}>
            + 사진 넣기 (최대 4장)
          </button>
          <span className="muted">한 번에 여러 장을 고르면 순서대로 채웁니다.</span>
        </div>
      </section>

      <section className="frame-options">
        <h3 className="section-title">프레임 옵션</h3>
        <Segmented
          label="배경"
          value={frame.backdrop}
          options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
          onChange={(value) => props.onPatch({ backdrop: value })}
        />
        {frame.style === 'fyra04' && (
          <Segmented
            label="FYRA 테마"
            compact
            value={frame.fyraTheme}
            options={FYRA_THEME_LABELS.map((theme) => ({ value: theme.id, label: theme.label }))}
            onChange={(value) => props.onPatch({ fyraTheme: value })}
          />
        )}
        {isCustom ? (
          <p className="note">여백 · 엠블럼 · 텍스트는 Mynda Ljósa에서 디자인한 그대로 인화됩니다.</p>
        ) : (
        <>
        <Slider
          label="여백"
          value={padValue}
          min={0}
          max={12}
          step={0.1}
          defaultValue={props.defaultPad}
          format={(value) => `${value.toFixed(1)}%`}
          onChange={(value) => props.onPatch({ padPct: value })}
          hint={`이 프레임의 기본 여백은 ${props.defaultPad.toFixed(1)}%입니다.`}
        />
        <Segmented
          label="엠블럼"
          value={frame.emblem}
          options={[
            { value: 'auto', label: 'Auto · 메이커' },
            { value: 'hd2lab', label: 'HD2Lab' },
            { value: 'none', label: '없음' },
          ]}
          onChange={(value) => props.onPatch({ emblem: value })}
        />
        <Segmented
          label="엠블럼 잉크"
          value={frame.emblemMono ? 'mono' : 'original'}
          options={[
            { value: 'original', label: 'Original' },
            { value: 'mono', label: 'All Black' },
          ]}
          onChange={(value) => props.onPatch({ emblemMono: value === 'mono' })}
        />
        <div className="toggle-row">
          <Toggle label="촬영 정보" hint="카메라 · 렌즈 · 노출" checked={frame.showSpec} onChange={(value) => props.onPatch({ showSpec: value })} />
          <Toggle label="캡션" hint="직접 쓴 한 줄" checked={frame.showCaption} onChange={(value) => props.onPatch({ showCaption: value })} />
        </div>
        </>
        )}
        <div className="meta-grid">
          <Field label="촬영일">
            <input value={meta.datetime} onChange={(event) => props.onMeta({ datetime: event.target.value })} placeholder="2026-11-19 18:04:31" />
          </Field>
          <Field label="캡션">
            <input value={meta.caption} onChange={(event) => props.onMeta({ caption: event.target.value })} placeholder="한 줄 캡션" maxLength={80} />
          </Field>
        </div>
      </section>

      <input
        ref={addInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) props.onAddFiles(files);
          event.target.value = '';
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) props.onReplaceSlot(replaceIndex.current, file);
          event.target.value = '';
        }}
      />
    </Modal>
  );
}
