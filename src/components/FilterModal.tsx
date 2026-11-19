import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Slider } from './controls';
import { ALL_FILTERS, FILM_FILTERS, MARGARINE_GROUPS, MARGARINE_FILTERS, NEUTRAL_FILTER, RETRO90_FILTER, type FilterOption } from '../filters/catalog';
import type { FilterSelection } from '../types/studio';
import { IconCheck } from './Icons';

interface FilterModalProps {
  selection: FilterSelection;
  strength: number;
  thumbs: Record<string, string>;
  onSelect: (filter: FilterOption) => void;
  onStrength: (value: number) => void;
  onClose: () => void;
}

/** HD2Lab Film (Neutral + nine stocks), then the Margarine groups, then RETRO 90. */
const SECTIONS: { id: string; label: string; filters: FilterOption[] }[] = [
  { id: 'hd2lab', label: 'HD2Lab Film', filters: [NEUTRAL_FILTER, ...FILM_FILTERS] },
  ...MARGARINE_GROUPS.map((group) => ({
    id: group,
    label: `Margarine · ${group}`,
    filters: MARGARINE_FILTERS.filter((filter) => filter.group === group),
  })),
  { id: 'filterset', label: 'Filter Set · RETRO 90', filters: [RETRO90_FILTER] },
];

export function FilterModal({ selection, strength, thumbs, onSelect, onStrength, onClose }: FilterModalProps) {
  const [tab, setTab] = useState('all');
  const activeKey = selection.kind === 'margarine' ? `mg-${selection.presetId}` : selection.filmId;
  const visible = useMemo(
    () => (tab === 'all' ? SECTIONS : SECTIONS.filter((section) => section.id === tab)),
    [tab],
  );

  return (
    <Modal
      kicker="FILTER MODAL"
      title="필터 선택"
      description="지금 화면의 프레임에 각 필터를 입힌 라이브 썸네일입니다. 누르면 바로 적용됩니다."
      onClose={onClose}
      size="wide"
      testId="filter-modal"
      footer={
        <div className="filter-foot">
          <Slider
            label="필터 강도"
            value={strength}
            min={0}
            max={100}
            step={1}
            defaultValue={100}
            format={(value) => `${Math.round(value)}%`}
            onChange={onStrength}
            hint="0%는 원본에 가깝게, 100%는 스톡 그대로입니다."
          />
          <button type="button" className="btn primary" onClick={onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <div className="chip-row sticky">
        <button type="button" className={`chip${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>
          전체 <span>{ALL_FILTERS.length}</span>
        </button>
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`chip${tab === section.id ? ' on' : ''}`}
            onClick={() => setTab(section.id)}
          >
            {section.label.replace('Margarine · ', '')} <span>{section.filters.length}</span>
          </button>
        ))}
      </div>

      {visible.map((section) => (
        <section className="filter-section" key={section.id}>
          <h3 className="section-title">
            {section.label}
            <small>{section.filters.length}종</small>
          </h3>
          <div className="filter-grid">
            {section.filters.map((filter) => {
              const url = thumbs[filter.key];
              const selected = activeKey === filter.key || (filter.kind === 'film' && selection.kind === 'film' && selection.filmId === filter.filmId && filter.presetId === null);
              return (
                <button
                  key={filter.key}
                  type="button"
                  className={`filter-card${selected ? ' selected' : ''}`}
                  onClick={() => onSelect(filter)}
                  data-filter-key={filter.key}
                  aria-pressed={selected}
                >
                  <span className="filter-thumb">
                    {url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-shimmer" />}
                    {selected && <span className="filter-check"><IconCheck size={14} /></span>}
                  </span>
                  <span className="filter-name">{filter.name}</span>
                  <span className="filter-detail">{filter.detail}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </Modal>
  );
}
