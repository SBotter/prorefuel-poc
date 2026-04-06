// ─── PercentileCalculator ───────────────────────────────────────────────────
// Computes per-metric percentile thresholds used by SceneDetectorV2.
// Replaces the hardcoded absolute thresholds in V1 (hrNorm > 0.85, etc.)
// with data-driven percentile bands that adapt to the specific activity.

export interface PercentileData {
  P60: number;
  P70: number;
  P75: number;
  P80: number;
  P85: number;
  P90: number;
  P95: number;
}

export interface PercentileValidation {
  isValid: boolean;
  lowVariance: boolean;   // spread P95-P60 < 10% of max value
  sampleSize: number;
  reason: string | null;
}

/** Minimum number of non-zero samples needed for reliable percentile estimation. */
const MIN_SAMPLES = 20;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Linear-interpolation percentile on a pre-sorted array. */
function lerp(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

function buildPercentiles(sorted: number[]): PercentileData {
  return {
    P60: lerp(sorted, 0.60),
    P70: lerp(sorted, 0.70),
    P75: lerp(sorted, 0.75),
    P80: lerp(sorted, 0.80),
    P85: lerp(sorted, 0.85),
    P90: lerp(sorted, 0.90),
    P95: lerp(sorted, 0.95),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class PercentileCalculator {
  /**
   * Compute percentiles from an array of values.
   * Filters out null, undefined, NaN, and zero values (treated as missing sensor data).
   * Returns null when fewer than MIN_SAMPLES valid values exist —
   * callers should fall back to absolute thresholds in that case.
   */
  static compute(values: (number | null | undefined)[]): PercentileData | null {
    const valid = (values as (number | null | undefined)[])
      .filter((v): v is number => v != null && !Number.isNaN(v) && v > 0);
    if (valid.length < MIN_SAMPLES) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    return buildPercentiles(sorted);
  }

  /**
   * Compute percentiles including zero values (e.g. gradient where 0 is meaningful).
   * Returns null when fewer than MIN_SAMPLES values exist.
   */
  static computeIncludingZero(values: (number | null | undefined)[]): PercentileData | null {
    const valid = (values as (number | null | undefined)[])
      .filter((v): v is number => v != null && !Number.isNaN(v));
    if (valid.length < MIN_SAMPLES) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    return buildPercentiles(sorted);
  }

  /**
   * Compute percentiles for the NEGATIVE side of a signed metric (e.g. downhill gradient).
   * Takes absolute values of all negative numbers; used for descent detection.
   */
  static computeNegative(values: (number | null | undefined)[]): PercentileData | null {
    const valid = (values as (number | null | undefined)[])
      .filter((v): v is number => v != null && !Number.isNaN(v) && v < 0)
      .map(v => Math.abs(v));
    if (valid.length < MIN_SAMPLES) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    return buildPercentiles(sorted);
  }

  /**
   * Validate a PercentileData object for ordering and variance.
   * Returns lowVariance = true when the spread is less than 10% of the max value —
   * in that case callers should use getThreshold() which relaxes by one level.
   */
  static validate(
    percentiles: PercentileData,
    originalValues: (number | null | undefined)[],
  ): PercentileValidation {
    const valid = (originalValues as (number | null | undefined)[])
      .filter((v): v is number => v != null && !Number.isNaN(v) && v > 0);
    const sampleSize = valid.length;

    if (percentiles.P95 < percentiles.P75 - 0.001) {
      return { isValid: false, lowVariance: false, sampleSize, reason: 'P95 < P75 — ordering error' };
    }

    const spread = percentiles.P95 - percentiles.P60;
    const absMax = valid.length > 0 ? Math.max(...valid) : 0;
    const lowVariance = absMax > 0 && spread / absMax < 0.10;

    return {
      isValid: true,
      lowVariance,
      sampleSize,
      reason: lowVariance ? 'Low-variance activity — thresholds relaxed by one percentile level' : null,
    };
  }

  /**
   * Get effective threshold with automatic low-variance relaxation.
   * When lowVariance is true, returns the next lower percentile level.
   * This prevents overly strict thresholds on flat/uniform activities.
   */
  static getThreshold(
    percentiles: PercentileData,
    level: keyof PercentileData,
    lowVariance: boolean,
  ): number {
    if (!lowVariance) return percentiles[level];
    const fallback: Record<keyof PercentileData, keyof PercentileData> = {
      P95: 'P90',
      P90: 'P85',
      P85: 'P80',
      P80: 'P75',
      P75: 'P70',
      P70: 'P60',
      P60: 'P60',
    };
    return percentiles[fallback[level]];
  }
}

// ─── ActivityPercentiles ──────────────────────────────────────────────────────
// Convenience container for all per-metric percentile distributions
// computed from the full activity before scene detection runs.

export interface ActivityPercentiles {
  hr:           PercentileData | null;   // bpm, zero-filtered
  speed:        PercentileData | null;   // km/h, zero-filtered
  gradient:     PercentileData | null;   // %, including zero (flat = 0)
  descentGrad:  PercentileData | null;   // abs(negative gradient)
  accel:        PercentileData | null;   // m/s² abs, zero-filtered
  masterScore:  PercentileData | null;   // [0,1], zero-filtered
  lowVariance:  boolean;                 // true if activity has very uniform intensity
}

export function computeActivityPercentiles(
  hrValues:       (number | null | undefined)[],
  speedValues:    (number | null | undefined)[],
  gradientValues: (number | null | undefined)[],  // signed (negative = descent)
  accelValues:    (number | null | undefined)[],
  masterScores:   (number | null | undefined)[],
): ActivityPercentiles {
  const hrP       = PercentileCalculator.compute(hrValues);
  const speedP    = PercentileCalculator.compute(speedValues);
  const gradP     = PercentileCalculator.computeIncludingZero(gradientValues);
  const descentP  = PercentileCalculator.computeNegative(gradientValues);
  const accelP    = PercentileCalculator.compute(accelValues);
  const masterP   = PercentileCalculator.compute(masterScores);

  // Low-variance detection based on masterScore distribution
  const validation = masterP
    ? PercentileCalculator.validate(masterP, masterScores)
    : { isValid: false, lowVariance: false, sampleSize: 0, reason: null };

  return {
    hr:          hrP,
    speed:       speedP,
    gradient:    gradP,
    descentGrad: descentP,
    accel:       accelP,
    masterScore: masterP,
    lowVariance: validation.lowVariance,
  };
}
