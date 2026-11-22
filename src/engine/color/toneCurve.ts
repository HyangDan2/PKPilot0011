/**
 * Monotone cubic spline interpolation (Fritsch-Carlson).
 * Guaranteed monotonic when data points are monotonic.
 * Avoids spline overshooting / oscillations.
 */
export function createMonotoneSpline(points: [number, number][]): (x: number) => number {
  const n = points.length;
  if (n === 0) return (x: number) => x;
  if (n === 1) return () => points[0][1];

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);

  // Slopes of secant lines between successive points
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d.push(dx !== 0 ? (ys[i + 1] - ys[i]) / dx : 0);
  }

  // Internal tangents
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m.push(0);
    } else {
      m.push((d[i - 1] + d[i]) / 2);
    }
  }
  m.push(d[n - 2]);

  // Fritsch & Carlson modifier for monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  return (x: number): number => {
    // Outside the end points' inputs the tone is held at the end point's own
    // value, so pulling the black or white point inward really does lift or
    // crush the tones beyond it.
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];

    let k = 0;
    while (x > xs[k + 1] && k < n - 2) {
      k++;
    }

    const h = xs[k + 1] - xs[k];
    if (h === 0) return ys[k];

    const u = (x - xs[k]) / h;
    const u2 = u * u;
    const u3 = u2 * u;

    const val =
      (2 * u3 - 3 * u2 + 1) * ys[k] +
      (u3 - 2 * u2 + u) * h * m[k] +
      (-2 * u3 + 3 * u2) * ys[k + 1] +
      (u3 - u2) * h * m[k + 1];

    return Math.min(1.0, Math.max(0.0, val));
  };
}

/**
 * True when the curve leaves the picture untouched — the reading the "curve is
 * in use" badge takes.
 *
 * It samples the interpolation itself instead of comparing control points:
 * a reset that lands on the identity line then always reads as identity, no
 * matter how the floats rounded on the way, and a straight line built from
 * extra points counts for what it is. An end point pulled inward changes the
 * sample (the tones past it are held at its value), so it reads as a grade.
 */
export function curveIsIdentity(points: [number, number][], tolerance = 1e-6): boolean {
  if (points.length < 2) return false;
  const sample = createMonotoneSpline(points);
  for (let i = 0; i <= 128; i += 1) {
    const x = i / 128;
    if (Math.abs(sample(x) - x) > tolerance) return false;
  }
  return true;
}
