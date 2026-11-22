import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildCurveTexture, CURVE_SAMPLES } from '../src/engine/color/userCurves';
import { createMonotoneSpline, curveIsIdentity } from '../src/engine/color/toneCurve';
import { curvesTouched, ToneCurveOverlay } from '../src/components/ToneCurveOverlay';
import {
  CURVE_MIN_GAP,
  defaultCurves,
  identityPoints,
  moveCurvePoint,
  type CurvePoint,
  type ToneCurves,
} from '../src/types/curves';

const noop = () => {};

/** A channel with one extra point dragged off the identity line. */
const touched = (): ToneCurves => {
  const curves = defaultCurves();
  curves.white = [[0, 0], [0.45, 0.62], [1, 1]];
  return curves;
};

describe('curve points', () => {
  it('moves an inside point freely between its neighbours', () => {
    const points: CurvePoint[] = [[0, 0], [0.4, 0.4], [1, 1]];
    const next = moveCurvePoint(points, 1, 0.7, 0.9);
    expect(next[1][0]).toBeCloseTo(0.7, 6);
    expect(next[1][1]).toBeCloseTo(0.9, 6);
    // The source array is left alone: the reducer owns the new points.
    expect(points[1]).toEqual([0.4, 0.4]);
  });

  it('lets the black end slide right and the white end slide left', () => {
    const points: CurvePoint[] = [[0, 0], [0.5, 0.5], [1, 1]];
    const black = moveCurvePoint(points, 0, 0.25, 0.2);
    expect(black[0][0]).toBeCloseTo(0.25, 6);
    expect(black[0][1]).toBeCloseTo(0.2, 6);
    expect(black).toHaveLength(3);

    const white = moveCurvePoint(points, 2, 0.8, 0.9);
    expect(white[2][0]).toBeCloseTo(0.8, 6);
    expect(white[2][1]).toBeCloseTo(0.9, 6);
    expect(white).toHaveLength(3);
  });

  it('keeps the ends inside the input range and clear of their neighbour', () => {
    const points: CurvePoint[] = [[0.2, 0.2], [0.4, 0.4], [0.6, 0.6]];
    // The black end cannot cross its neighbour, nor leave the range at 0.
    expect(moveCurvePoint(points, 0, 0.9, 0.2)[0][0]).toBeCloseTo(0.4 - CURVE_MIN_GAP, 9);
    expect(moveCurvePoint(points, 0, -0.3, 0.2)[0][0]).toBeCloseTo(0, 9);
    // The white end cannot cross its neighbour either, nor pass 1.
    expect(moveCurvePoint(points, 2, 0.1, 0.6)[2][0]).toBeCloseTo(0.4 + CURVE_MIN_GAP, 9);
    expect(moveCurvePoint(points, 2, 1.4, 0.6)[2][0]).toBeCloseTo(1, 9);
  });
});

describe('what a curve does to the picture', () => {
  it('holds the tones beyond a pulled-in end point at that point', () => {
    const sample = createMonotoneSpline([[0.25, 0.3], [0.75, 0.8]]);
    expect(sample(0)).toBeCloseTo(0.3, 6);
    expect(sample(0.1)).toBeCloseTo(0.3, 6);
    expect(sample(0.5)).toBeCloseTo(0.55, 6);
    expect(sample(0.9)).toBeCloseTo(0.8, 6);
    expect(sample(1)).toBeCloseTo(0.8, 6);
  });

  it('reads the identity as identity, however the points were built', () => {
    expect(curveIsIdentity(identityPoints())).toBe(true);
    // A straight line through extra points grades nothing.
    expect(curveIsIdentity([[0, 0], [0.5, 0.5], [1, 1]])).toBe(true);
    // …and float noise from a reset is not a grade either.
    expect(curveIsIdentity([[0, 1e-12], [1, 1 - 1e-12]])).toBe(true);
  });

  it('reads a real grade as a grade, including a moved end point', () => {
    expect(curveIsIdentity([[0, 0], [0.45, 0.62], [1, 1]])).toBe(false);
    expect(curveIsIdentity([[0.2, 0.2], [1, 1]])).toBe(false);
    expect(curveIsIdentity([[0, 0], [0.8, 0.8]])).toBe(false);
    expect(curveIsIdentity([[0, 0.1], [1, 0.9]])).toBe(false);
    expect(curveIsIdentity([])).toBe(false);
  });
});

describe('the badge and the shader agree', () => {
  it('is off for every kind of identity', () => {
    expect(curvesTouched(defaultCurves())).toBe(false);
    const collinear = defaultCurves();
    collinear.red = [[0, 0], [0.3, 0.3], [1, 1]];
    expect(curvesTouched(collinear)).toBe(false);
  });

  it('is on once a point, or an end, leaves the line', () => {
    expect(curvesTouched(touched())).toBe(true);
    const clipped = defaultCurves();
    clipped.blue = [[0.2, 0.2], [1, 1]];
    expect(curvesTouched(clipped)).toBe(true);
  });

  it('turns the badge off the moment every channel is reset', () => {
    const curves = touched();
    const reset: ToneCurves = { white: identityPoints(), red: identityPoints(), green: identityPoints(), blue: identityPoints() };
    expect(curvesTouched(curves)).toBe(true);
    expect(curvesTouched(reset)).toBe(false);
  });

  it('feeds the shader the same reading, and clamps past the end points', () => {
    expect(buildCurveTexture(defaultCurves()).enabled).toBe(false);

    const clipped = defaultCurves();
    clipped.white = [[0.25, 0.3], [1, 1]];
    const texture = buildCurveTexture(clipped);
    expect(texture.enabled).toBe(true);
    // The darkest tones are held at the black point's own output.
    expect(texture.data[0]).toBeCloseTo(0.3, 3);
    expect(texture.data[(CURVE_SAMPLES - 1) * 4]).toBeCloseTo(1, 3);
  });
});

describe('the overlay as it is drawn', () => {
  it('runs flat from black to a pulled-in black end, then flat out to white', () => {
    const curves = defaultCurves();
    curves.white = [[0.25, 0.3], [0.75, 0.8]];
    const markup = renderToStaticMarkup(createElement(ToneCurveOverlay, {
      curves,
      onCurves: noop,
      onClose: noop,
    }));
    const path = /class="tonecurve-line"[^>]*d="([^"]+)"/.exec(markup)?.[1]
      ?? /d="([^"]+)"[^>]*class="tonecurve-line"/.exec(markup)?.[1];
    expect(path).toBeTruthy();
    // BOX is 256: black end at x 64, y 0.3 → 179.20; white end at x 192, y 0.8 → 51.20.
    expect(path!.startsWith('M0,179.20 L64.00,179.20')).toBe(true);
    expect(path!.endsWith('L192.00,51.20 L256,51.20')).toBe(true);
  });

  it('offers a close button a thumb can hit', () => {
    const markup = renderToStaticMarkup(createElement(ToneCurveOverlay, {
      curves: defaultCurves(),
      onCurves: noop,
      onClose: noop,
    }));
    expect(markup).toContain('class="tonecurve-chip tonecurve-close"');
    expect(markup).toContain('aria-label="Tone Curve 닫기"');
  });
});
