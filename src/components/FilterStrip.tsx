import { FILM_FILTERS, NEUTRAL_FILTER, type FilterOption } from '../filters/catalog';
import type { FilterSelection } from '../types/studio';
import { IconFilm } from './Icons';

export const STRIP_FILTERS: FilterOption[] = [NEUTRAL_FILTER, ...FILM_FILTERS];

interface FilterStripProps {
  selection: FilterSelection;
  /** Graded previews keyed by filter key; a card shows its code until one lands. */
  thumbs: Record<string, string>;
  margarineName: string | null;
  onSelect: (filter: FilterOption) => void;
  onOpenAll: () => void;
}

function isSelected(selection: FilterSelection, filter: FilterOption): boolean {
  if (filter.kind === 'neutral') return selection.kind === 'neutral';
  return selection.kind === 'film' && selection.filmId === filter.filmId && !selection.presetId;
}

/**
 * The film strip along the bottom: eleven stocks, one tap each, no window in
 * the way. The full shelf (58 Margarine looks and the strength slider) stays
 * behind the Margarine card at the end and the dock's filter button.
 */
export function FilterStrip({ selection, thumbs, margarineName, onSelect, onOpenAll }: FilterStripProps) {
  return (
    <div className="filter-strip" role="listbox" aria-label="필름 스트립" data-testid="filter-strip">
      {STRIP_FILTERS.map((filter) => {
        const selected = isSelected(selection, filter);
        const thumb = thumbs[filter.key];
        return (
          <button
            key={filter.key}
            type="button"
            role="option"
            aria-selected={selected}
            className={`strip-card${selected ? ' on' : ''}`}
            onClick={() => onSelect(filter)}
            data-filter-key={filter.key}
            title={`${filter.name} · ${filter.detail}`}
          >
            <span className="strip-thumb">
              {thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="strip-swatch">{filter.kind === 'neutral' ? 'RAW' : filter.key}</span>}
            </span>
            <span className="strip-text">
              <b>{filter.name}</b>
              <small>{filter.detail}</small>
            </span>
          </button>
        );
      })}

      <button type="button" className="strip-card margarine" onClick={onOpenAll} title="Margarine 58종 모두 보기">
        <span className="strip-thumb">
          <IconFilm size={16} />
        </span>
        <span className="strip-text">
          <b>Margarine · 58종</b>
          <small>{margarineName ?? '전체 필터 열기'}</small>
        </span>
      </button>
    </div>
  );
}
