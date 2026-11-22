import { FILM_FILTERS, MARGARINE_FILTERS, NEUTRAL_FILTER, RETRO90_FILTER, type FilterOption } from '../filters/catalog';
import type { FilterSelection } from '../types/studio';
import { IconFilm } from './Icons';

/** Everything the strip's previews are built for, in shelf order. */
export const STRIP_FILTERS: FilterOption[] = [NEUTRAL_FILTER, ...FILM_FILTERS, RETRO90_FILTER];

/** Neutral and the nine stocks: the cards that sit left of the Margarine door. */
const SHELF: FilterOption[] = [NEUTRAL_FILTER, ...FILM_FILTERS];

interface FilterStripProps {
  selection: FilterSelection;
  /** Graded previews keyed by filter key; a card shows its code until one lands. */
  thumbs: Record<string, string>;
  margarineName: string | null;
  onSelect: (filter: FilterOption) => void;
  /** The Margarine card opens the 58-look window, not the film window. */
  onOpenMargarine: () => void;
}

function isSelected(selection: FilterSelection, filter: FilterOption): boolean {
  if (filter.kind === 'neutral') return selection.kind === 'neutral';
  return selection.kind === 'film' && selection.filmId === filter.filmId && !selection.presetId;
}

/**
 * The film strip along the bottom: ten stocks, one tap each, no window in the
 * way. The Margarine catalogue (58 looks) opens from its own card, and RETRO 90
 * closes the shelf after it. A Margarine look in use leads the strip as its own
 * selected card, so the strip never hides what is actually printed.
 */
export function FilterStrip({ selection, thumbs, margarineName, onSelect, onOpenMargarine }: FilterStripProps) {
  const activeLook = selection.kind === 'margarine'
    ? MARGARINE_FILTERS.find((filter) => filter.key === `mg-${selection.presetId}`) ?? null
    : null;

  const card = (filter: FilterOption, selected?: boolean) => {
    const on = selected ?? isSelected(selection, filter);
    const thumb = thumbs[filter.key];
    return (
      <button
        key={filter.key}
        type="button"
        role="option"
        aria-selected={on}
        className={`strip-card${on ? ' on' : ''}`}
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
  };

  return (
    <div className="filter-strip" role="listbox" aria-label="필름 스트립" data-testid="filter-strip">
      {activeLook && card(activeLook, true)}

      {SHELF.map((filter) => card(filter))}

      <button
        type="button"
        className={`strip-card margarine${activeLook ? ' on' : ''}`}
        onClick={onOpenMargarine}
        data-testid="margarine-door"
        title="Margarine 58종 전용 모달 열기"
      >
        <span className="strip-thumb">
          <IconFilm size={16} />
        </span>
        <span className="strip-text">
          <b>Margarine · 58종</b>
          <small>{margarineName ? `적용 중 · ${margarineName}` : '전용 모달 열기'}</small>
        </span>
      </button>

      {card(RETRO90_FILTER)}
    </div>
  );
}
