// ─── EventfulnessCalculator ─────────────────────────────────────────────────
// Computes a per-point "eventfulness" score [0, 1] that measures how much
// is changing at each moment, relative to its surrounding context.
//
// This is SEPARATE from intensity_score (V1) which measures "how hard/fast/steep".
// Eventfulness answers: "how much was changing at this point?"
//
// The two are complementary:
//   - High intensity + low eventfulness  → sustained plateau (grinding climb, steady effort)
//   - High intensity + high eventfulness → explosive peak (best camera moments)
//   - Low  intensity + high eventfulness → transition (interesting even if effort is low)
//
// Method: local contrast ratio (inner 10s window vs outer 60s context window).
// Ratio > 1.0 means this moment is more intense than its surroundings.
// Normalized to [0, 1].

import { ActivityPoint } from '../IntensityEngine';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface EventfulnessResult {
  scores: Float32Array;    // [0, 1] per point
  metadata: {
    metricsUsed: string[];
    innerWindowSec: number;
    outerWindowSec: number;
    coverage: number;      // fraction of points with full context (not near edges)
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function estimateSps(points: ActivityPoint[]): number {
  const n = points.length;
  if (n < 2) return 1;
  return (n - 1) / Math.max((points[n - 1].time - points[0].time) / 1000, 1);
}

/**
 * Build prefix-sum and count arrays for masked window means.
 * When maskZero = true, zero values are excluded from sums and counts
 * (they represent missing sensor data, not actual zero effort).
 */
function buildPrefix(
  arr: Float32Array,
  maskZero: boolean,
): { sum: Float64Array; count: Float64Array } {
  const n = arr.length;
  const sum   = new Float64Array(n + 1);
  const count = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const skip = maskZero && arr[i] === 0;
    sum[i + 1]   = sum[i]   + (skip ? 0 : arr[i]);
    count[i + 1] = count[i] + (skip ? 0 : 1);
  }
  return { sum, count };
}

function windowMean(
  prefix: { sum: Float64Array; count: Float64Array },
  s: number,
  e: number,
): number {
  const cnt = prefix.count[e + 1] - prefix.count[s];
  if (cnt === 0) return 0;
  return (prefix.sum[e + 1] - prefix.sum[s]) / cnt;
}

/**
 * Contrast ratio for point i: mean of inner window / mean of outer window.
 * Raw ratio range: [0.5, 2.0] (clamped to avoid extremes from noisy data).
 * Normalized to [0, 1]: (ratio - 0.5) / 1.5
 *
 * Interpretation:
 *   0.0 (ratio 0.5): this window is half the intensity of surroundings → dull
 *   0.33 (ratio 1.0): same as surroundings → neutral/plateau
 *   1.0 (ratio 2.0): twice the intensity of surroundings → sharp peak
 */
function contrastRatio(
  prefix: { sum: Float64Array; count: Float64Array },
  i: number,
  n: number,
  innerHalf: number,
  outerHalf: number,
): number {
  const iS = Math.max(0, i - innerHalf);
  const iE = Math.min(n - 1, i + innerHalf);
  const oS = Math.max(0, i - outerHalf);
  const oE = Math.min(n - 1, i + outerHalf);

  const innerMean = windowMean(prefix, iS, iE);
  const outerMean = windowMean(prefix, oS, oE);

  // No context → return neutral (0.33 = ratio 1.0)
  if (outerMean < 1e-6) return 0.33;

  const ratio = Math.min(Math.max(innerMean / outerMean, 0.5), 2.0);
  return (ratio - 0.5) / 1.5;
}

// ─── Gradient array builder ───────────────────────────────────────────────────

function buildGradientArray(points: ActivityPoint[]): Float32Array {
  const n = points.length;
  const arr = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dEle = (points[i].ele ?? 0) - (points[i - 1].ele ?? 0);
    arr[i] = Math.abs(dEle);   // absolute elevation change per step
  }
  arr[0] = arr[1] ?? 0;
  return arr;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute per-point eventfulness scores.
 *
 * @param points     Activity GPS points with optional telemetry
 * @param innerSec   Inner context window half-width (default: 10s total → 5s each side)
 * @param outerSec   Outer context window half-width (default: 60s total → 30s each side)
 */
export function computeEventfulness(
  points: ActivityPoint[],
  innerSec = 10,
  outerSec = 60,
): EventfulnessResult {
  const n = points.length;

  if (n < 4) {
    return {
      scores: new Float32Array(n).fill(0.33),
      metadata: { metricsUsed: [], innerWindowSec: innerSec, outerWindowSec: outerSec, coverage: 0 },
    };
  }

  const sps = estimateSps(points);
  const innerHalf = Math.max(1, Math.round((innerSec / 2) * sps));
  const outerHalf = Math.max(1, Math.round((outerSec / 2) * sps));

  // ── Build per-metric arrays ────────────────────────────────────────────────
  const speedArr = new Float32Array(n);
  const hrArr    = new Float32Array(n);
  const gradArr  = buildGradientArray(points);

  for (let i = 0; i < n; i++) {
    speedArr[i] = points[i].speed ?? 0;
    hrArr[i]    = points[i].hr    ?? 0;
  }

  const hasSpeed = speedArr.some(v => v > 0);
  const hasHR    = hrArr.some(v => v > 0);

  const metricsUsed: string[] = ['gradient'];
  if (hasSpeed) metricsUsed.push('speed');
  if (hasHR)   metricsUsed.push('hr');

  // ── Build prefix sums (mask zeros for sensor data, not gradient) ──────────
  const prefixSpeed = buildPrefix(speedArr, true);
  const prefixHR    = buildPrefix(hrArr,    true);
  const prefixGrad  = buildPrefix(gradArr,  false);

  // ── Compute per-point eventfulness ────────────────────────────────────────
  const scores  = new Float32Array(n);
  let covered   = 0;

  for (let i = 0; i < n; i++) {
    const hasFullContext = i >= innerHalf && i < n - innerHalf;

    let sum   = 0;
    let count = 0;

    // Gradient: always used (even without HR/speed, elevation changes are visible)
    sum += contrastRatio(prefixGrad, i, n, innerHalf, outerHalf);
    count++;

    if (hasSpeed) {
      sum += contrastRatio(prefixSpeed, i, n, innerHalf, outerHalf);
      count++;
    }

    if (hasHR) {
      sum += contrastRatio(prefixHR, i, n, innerHalf, outerHalf);
      count++;
    }

    const raw = count > 0 ? sum / count : 0.33;

    // Edge points (near start/end) don't have full context — apply a floor
    // so they're not unfairly treated as dull moments.
    scores[i] = hasFullContext ? raw : Math.max(raw, 0.40);

    if (hasFullContext) covered++;
  }

  return {
    scores,
    metadata: {
      metricsUsed,
      innerWindowSec: innerSec,
      outerWindowSec: outerSec,
      coverage: n > 0 ? covered / n : 0,
    },
  };
}
