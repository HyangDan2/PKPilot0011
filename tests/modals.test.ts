import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MargarineModal } from '../src/components/MargarineModal';
import { EmblemModal, EmblemPicker } from '../src/components/EmblemModal';
import { MARGARINE_FILTERS, MARGARINE_GROUPS } from '../src/filters/catalog';
import { DEFAULT_FRAME, type EmblemChoice, type FrameSettings } from '../src/types/studio';

const noop = () => {};

/**
 * The two windows as the visitor gets them: the Margarine shelf carries only
 * the 58 looks, and the emblem window shows EXIF 자동 / 없음 plus the eleven
 * official marks — never a three-way switch.
 */
describe('the Margarine window', () => {
  const markup = renderToStaticMarkup(createElement(MargarineModal, {
    selection: { kind: 'film', filmId: 'FS-004', presetId: null },
    strength: 100,
    thumbs: {},
    onSelect: noop,
    onStrength: noop,
    onClose: noop,
  }));

  it('opens as its own sheet', () => {
    expect(markup).toContain('data-testid="margarine-modal"');
    expect(markup).toContain('마가린 필터 58종');
    expect(markup).toContain('data-testid="margarine-search"');
  });

  it('counts 58 looks and keeps the catalogue\'s six groups', () => {
    expect(MARGARINE_FILTERS).toHaveLength(58);
    const cards = markup.match(/data-filter-key="mg-/g) ?? [];
    expect(cards).toHaveLength(58);
    expect(markup).toContain('data-testid="margarine-tab-all"');
    for (const group of MARGARINE_GROUPS) {
      expect(markup).toContain(`data-testid="margarine-tab-${group.toLowerCase()}"`);
      const count = MARGARINE_FILTERS.filter((filter) => filter.group === group).length;
      expect(markup).toContain(`${group} <span>${count}</span>`);
    }
    expect(MARGARINE_GROUPS).toEqual(['Light', 'Cafe', 'Color', 'Vintage', 'Portrait', 'Nature']);
  });

  it('keeps the strength slider in its footer', () => {
    expect(markup).toContain('필터 강도');
    expect(markup).toContain('aria-label="필터 강도"');
  });
});

describe('the emblem window', () => {
  const frame = DEFAULT_FRAME;
  const markup = renderToStaticMarkup(createElement(EmblemModal, {
    value: 'auto',
    resolved: 'sony',
    mono: false,
    backdrop: 'dark',
    emblems: null,
    onPatch: noop,
    onClose: noop,
  }));

  it('offers EXIF 자동 and 없음 above the marks', () => {
    expect(markup).toContain('data-testid="emblem-modal"');
    expect(markup).toContain('data-testid="emblem-option-auto"');
    expect(markup).toContain('data-testid="emblem-option-none"');
    // Auto says what it will print for this file.
    expect(markup).toContain('Sony · 파일 정보');
  });

  it('shows all eleven marks as cards', () => {
    const cards = markup.match(/data-emblem-id="/g) ?? [];
    expect(cards).toHaveLength(11);
    for (const label of ['HD2Lab', 'Sony', 'Canon', 'Nikon', 'Fujifilm', 'Samsung', 'Leica', 'Hasselblad', 'Apple', 'Lumix', 'OM System']) {
      expect(markup).toContain(label);
    }
  });

  it('switches the ink between brand colour and All Black', () => {
    expect(markup).toContain('Original · 브랜드 컬러');
    expect(markup).toContain('All Black · 단색');
    expect(markup).toContain('aria-pressed="true"'); // the current choice is pressed
  });

  it('marks the chosen mark, not a chosen colour', () => {
    const picked = renderToStaticMarkup(createElement(EmblemModal, {
      value: 'nikon' as EmblemChoice,
      resolved: 'sony',
      mono: true,
      backdrop: 'light',
      emblems: null,
      onPatch: noop,
      onClose: noop,
    }));
    expect(picked).toContain('지금 판면: <b data-testid="emblem-current">Nikon</b>');
  });

  it('the row control reports the current state in words', () => {
    const row = (value: EmblemChoice, resolved: string) => renderToStaticMarkup(createElement(EmblemPicker, {
      value,
      resolved,
      mono: false,
      backdrop: 'dark' as FrameSettings['backdrop'],
      emblems: null,
      onOpen: noop,
      label: '엠블럼',
      testId: 'emblem-open-test',
    }));
    expect(row('auto', 'apple')).toContain('EXIF 자동 · Apple');
    expect(row('none', 'apple')).toContain('엠블럼 없음');
    expect(row('canon', 'apple')).toContain('Canon');
    expect(row('canon', 'apple')).toContain('data-testid="emblem-open-test"');
    expect(row('auto', 'apple')).toContain('data-emblem="auto"');
    // The frame's own defaults keep Auto and the brand-colour ink.
    expect(frame.emblem).toBe('auto');
    expect(frame.emblemMono).toBe(false);
  });
});
