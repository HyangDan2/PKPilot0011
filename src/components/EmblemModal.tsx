import { Modal } from './Modal';
import { Segmented } from './controls';
import { EMBLEM_CHOICES, emblemLabel } from '../plate/frames';
import { IconCheck, IconChevronRight } from './Icons';
import type { SPEmblemsApi } from '../plate/engine';
import type { EmblemChoice, FrameSettings } from '../types/studio';

/** The engine paints one mark in the plate's own ink; the picker paints it in the page's. */
interface EmblemArtProps {
  /** An engine emblem id, or null for "no emblem". */
  id: string | null;
  emblems: SPEmblemsApi | null;
  /** All Black: one ink for the whole mark, brand colour and all. */
  mono: boolean;
  /** The plate the mark is printed on — brand colours have a dark variant. */
  light: boolean;
}

/**
 * One official mark, straight from the Shutterplate emblem set, so the picker
 * shows the same artwork the plate prints rather than a second impression.
 */
export function EmblemArt({ id, emblems, mono, light }: EmblemArtProps) {
  if (!id) {
    return <span className="emblem-art is-empty" aria-hidden>—</span>;
  }
  if (!emblems) {
    return <span className="emblem-art is-empty" aria-hidden>{emblemLabel(id)}</span>;
  }
  const markup = emblems.svg(id, {
    ink: 'currentColor',
    accent: mono ? 'currentColor' : '#ff824f',
    base: 'currentColor',
    light,
    mono,
  });
  return <span className="emblem-art" dangerouslySetInnerHTML={{ __html: markup }} />;
}

interface EmblemPickerProps {
  value: EmblemChoice;
  /** What `auto` resolves to for the open file, so the button shows the real mark. */
  resolved: string;
  mono: boolean;
  backdrop: 'dark' | 'light';
  emblems: SPEmblemsApi | null;
  onOpen: () => void;
  /** A caption above the button, matching the segmented controls it replaces. */
  label?: string;
  compact?: boolean;
  testId?: string;
}

/**
 * The emblem row's one control: what is printed now, as its own mark, and a
 * door into the eleven-marker window. It replaces the old Auto / HD2Lab / None
 * three-way switch — a chosen maker prints whatever the EXIF says.
 */
export function EmblemPicker({ value, resolved, mono, backdrop, emblems, onOpen, label, compact, testId }: EmblemPickerProps) {
  const shown = value === 'none' ? null : value === 'auto' ? resolved : value;
  const name = value === 'none'
    ? '엠블럼 없음'
    : value === 'auto'
      ? `EXIF 자동 · ${emblemLabel(resolved)}`
      : emblemLabel(value);
  return (
    <div className={`emblem-picker${compact ? ' compact' : ''}`}>
      {label && <span className="segmented-label">{label}</span>}
      <button
        type="button"
        className="emblem-trigger"
        onClick={onOpen}
        data-testid={testId ?? 'emblem-open'}
        data-emblem={value}
        aria-haspopup="dialog"
        title="엠블럼 11종 가운데서 고르기"
      >
        <EmblemArt id={shown} emblems={emblems} mono={mono} light={backdrop === 'light'} />
        <span className="emblem-trigger-text">
          <b>{name}</b>
          <small>11종 가운데 고르기</small>
        </span>
        <IconChevronRight size={15} />
      </button>
    </div>
  );
}

interface EmblemModalProps {
  value: EmblemChoice;
  /** The mark `auto` resolves to for the open file. */
  resolved: string;
  mono: boolean;
  backdrop: 'dark' | 'light';
  emblems: SPEmblemsApi | null;
  onPatch: (patch: Partial<FrameSettings>) => void;
  onClose: () => void;
}

/**
 * The emblem window: EXIF 자동 and 없음 at the top, the ink switch beside them,
 * then the eleven official marks as cards. Every press lands on the plate at
 * once — a chosen mark is printed regardless of the file's own EXIF.
 */
export function EmblemModal({ value, resolved, mono, backdrop, emblems, onPatch, onClose }: EmblemModalProps) {
  const light = backdrop === 'light';
  const current = value === 'none' ? '없음' : value === 'auto' ? `EXIF 자동 (${emblemLabel(resolved)})` : emblemLabel(value);

  return (
    <Modal
      kicker="EMBLEM MODAL"
      title="엠블럼 선택"
      description="판면 좌측에 인화되는 메이커 마크입니다. EXIF 자동은 파일의 카메라 정보로 고르고, 아래 11종은 그 정보와 상관없이 지정한 로고로 인화합니다."
      onClose={onClose}
      size="wide"
      testId="emblem-modal"
      footer={
        <div className="emblem-foot">
          <span className="muted">지금 판면: <b data-testid="emblem-current">{current}</b></span>
          <button type="button" className="btn primary" onClick={onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <div className="emblem-quick">
        <button
          type="button"
          className={`emblem-quick-card${value === 'auto' ? ' selected' : ''}`}
          onClick={() => onPatch({ emblem: 'auto' })}
          aria-pressed={value === 'auto'}
          data-testid="emblem-option-auto"
        >
          <EmblemArt id={resolved} emblems={emblems} mono={mono} light={light} />
          <span className="emblem-quick-text">
            <b>EXIF 자동 <em>Auto</em></b>
            <small>{resolved && resolved !== 'none' ? `${emblemLabel(resolved)} · 파일 정보` : '파일 정보에서 고르기'}</small>
          </span>
          {value === 'auto' && <span className="filter-check"><IconCheck size={14} /></span>}
        </button>
        <button
          type="button"
          className={`emblem-quick-card${value === 'none' ? ' selected' : ''}`}
          onClick={() => onPatch({ emblem: 'none' })}
          aria-pressed={value === 'none'}
          data-testid="emblem-option-none"
        >
          <EmblemArt id={null} emblems={emblems} mono={mono} light={light} />
          <span className="emblem-quick-text">
            <b>없음 <em>None</em></b>
            <small>엠블럼 없이 인화</small>
          </span>
          {value === 'none' && <span className="filter-check"><IconCheck size={14} /></span>}
        </button>
      </div>

      <div className="emblem-ink">
        <Segmented
          label="엠블럼 잉크"
          value={mono ? 'mono' : 'original'}
          options={[
            { value: 'original', label: 'Original · 브랜드 컬러' },
            { value: 'mono', label: 'All Black · 단색' },
          ]}
          onChange={(next) => onPatch({ emblemMono: next === 'mono' })}
        />
      </div>

      <section className="filter-section">
        <h3 className="section-title">메이커 11종 <small>정식 로고 · 누르면 바로 인화</small></h3>
        <div className="emblem-grid">
          {EMBLEM_CHOICES.map((choice) => {
            const selected = value === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                className={`emblem-card${selected ? ' selected' : ''}`}
                onClick={() => onPatch({ emblem: choice.id })}
                aria-pressed={selected}
                data-emblem-id={choice.id}
                title={`${choice.label} 엠블럼으로 인화`}
              >
                <EmblemArt id={choice.id} emblems={emblems} mono={mono} light={light} />
                <span className="emblem-card-name">{choice.label}</span>
                {selected && <span className="filter-check"><IconCheck size={14} /></span>}
              </button>
            );
          })}
        </div>
      </section>
    </Modal>
  );
}
