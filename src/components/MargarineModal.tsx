import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Slider } from './controls';
import { MARGARINE_FILTERS, MARGARINE_GROUPS, type FilterOption } from '../filters/catalog';
import type { FilterSelection } from '../types/studio';
import { IconCheck, IconSearch } from './Icons';

interface MargarineModalProps {
  selection: FilterSelection;
  strength: number;
  /** Live graded stills keyed by filter key (`mg-…`). */
  thumbs: Record<string, string>;
  onSelect: (filter: FilterOption) => void;
  onStrength: (value: number) => void;
  onClose: () => void;
}

const TOTAL = MARGARINE_FILTERS.length;

/**
 * The 58 Margarine looks, on their own shelf. The film strip and the film
 * shelf keep the ten HD2Lab stocks and RETRO 90; every Margarine look opens
 * here, so neither list has to carry a catalogue it never shows at a glance.
 */
export function MargarineModal({ selection, strength, thumbs, onSelect, onStrength, onClose }: MargarineModalProps) {
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return MARGARINE_FILTERS.filter((filter) => {
      if (group !== 'all' && filter.group !== group) return false;
      if (!needle) return true;
      return `${filter.name} ${filter.detail} ${filter.key}`.toLowerCase().includes(needle);
    });
  }, [group, search]);

  const activeKey = selection.kind === 'margarine' ? `mg-${selection.presetId}` : null;

  return (
    <Modal
      kicker="MARGARINE MODAL"
      title="마가린 필터 58종"
      description="지금 화면의 프레임에 각 룩을 입힌 라이브 썸네일입니다. 누르면 바로 적용되고, 강도는 아래에서 한 번에 조절합니다."
      onClose={onClose}
      size="wide"
      testId="margarine-modal"
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
            hint="0%는 원본에 가깝게, 100%는 룩 그대로입니다."
          />
          <button type="button" className="btn primary" onClick={onClose}>닫고 계속 편집</button>
        </div>
      }
    >
      <div className="margarine-tools">
        <label className="side-search margarine-search">
          <IconSearch size={14} />
          <input
            type="search"
            value={search}
            placeholder="룩 이름 · 설명 검색"
            aria-label="마가린 필터 검색"
            data-testid="margarine-search"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="chip-row sticky margarine-tabs" role="group" aria-label="마가린 그룹">
          <button
            type="button"
            className={`chip${group === 'all' ? ' on' : ''}`}
            onClick={() => setGroup('all')}
            data-testid="margarine-tab-all"
          >
            전체 <span>{TOTAL}</span>
          </button>
          {MARGARINE_GROUPS.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip${group === name ? ' on' : ''}`}
              onClick={() => setGroup(name)}
              data-testid={`margarine-tab-${name.toLowerCase()}`}
            >
              {name} <span>{MARGARINE_FILTERS.filter((filter) => filter.group === name).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-grid">
        {visible.map((filter) => {
          const url = thumbs[filter.key];
          const selected = activeKey === filter.key;
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
      {!visible.length && <p className="side-empty">검색에 맞는 마가린 룩이 없습니다.</p>}
    </Modal>
  );
}
