// ─── IntensityEngineV2 ───────────────────────────────────────────────────────
// Extends V1's IntensityEngine with:
//   1. Sport profile auto-detection (MOUNTAIN / SPEED / ENDURANCE)
//   2. Per-point eventfulness score (local contrast ratio)
//   3. masterScore = intensity × (α + (1-α) × eventfulness)
//
// The masterScore is the single ranking signal used throughout V2.
// It rewards moments that are BOTH intense AND changing — the best camera moments.

import { ActivityPoint, computeIntensity, IntensityResult } from '../IntensityEngine';
import { computeEventfulness, EventfulnessResult } from './EventfulnessCalculator';

// ─── Public interfaces ────────────────────────────────────────────────────────

export type SportProfile = 'MOUNTAIN' | 'SPEED' | 'ENDURANCE';

export interface IntensityV2Result extends IntensityResult {
  eventfulness:  Float32Array;   // [0, 1] per point
  masterScore:   Float32Array;   // [0, 1] per point — primary ranking signal
  sportProfile:  SportProfile;
  alpha:         number;         // weight of pure intensity vs eventfulness-modulated score
  eventfulnessMeta: EventfulnessResult['metadata'];
}

// ─── Alpha by sport ───────────────────────────────────────────────────────────
// α controls how much pure intensity matters vs eventfulness-modulated intensity.
// Higher α → intensity dominates (important for sustained climb/endurance efforts).
// Lower  α → eventfulness matters more (important for fast dynamic moments).

const ALPHA: Record<SportProfile, number> = {
  MOUNTAIN:  0.35,   // Sustained climbs must score well; eventfulness secondary
  SPEED:     0.20,   // Explosive moments and speed peaks matter most
  ENDURANCE: 0.30,   // Balance between sustained effort and dynamic changes
};

// ─── Sport profile detection ─────────────────────────────────────────────────

function detectSportProfile(points: ActivityPoint[]): SportProfile {
  const n = points.length;
  if (n < 2) return 'ENDURANCE';

  let maxSpeed = 0;
  let sumAbsEle = 0;
  let eleCount  = 0;

  for (let i = 1; i < n; i++) {
    const s = points[i].speed ?? 0;
    if (s > maxSpeed) maxSpeed = s;

    if (points[i].ele !== undefined && points[i - 1].ele !== undefined) {
      sumAbsEle += Math.abs(points[i].ele - points[i - 1].ele);
      eleCount++;
    }
  }

  // Mean absolute elevation change per GPS step (proxy for hilliness)
  const meanAbsEle = eleCount > 0 ? sumAbsEle / eleCount : 0;

  // Rule-based auto-detection:
  // SPEED:    fast (max speed > 40 km/h) + relatively flat (< 0.8m/step avg ele change)
  // MOUNTAIN: slow OR very hilly (lots of elevation change)
  // ENDURANCE: everything else (trail running, long steady efforts)
  if (maxSpeed > 40 && meanAbsEle < 0.8) return 'SPEED';
  if (maxSpeed < 18 || meanAbsEle > 1.5) return 'MOUNTAIN';
  return 'ENDURANCE';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function computeIntensityV2(points: ActivityPoint[]): IntensityV2Result {
  // 1. V1 intensity scores (unchanged — profile-adaptive weighted sum, smoothed)
  const v1 = computeIntensity(points);

  // 2. Eventfulness (local contrast ratio — separate from intensity)
  const eventfulnessResult = computeEventfulness(points);

  // 3. Sport profile and alpha
  const sportProfile = detectSportProfile(points);
  const alpha        = ALPHA[sportProfile];

  // 4. masterScore = intensity × (α + (1-α) × eventfulness)
  //    Floor guarantee: masterScore ≥ intensity × α (intense moments never collapse to zero)
  //    Ceiling: clamped at 1.0
  const n = points.length;
  const masterScore = new Float32Array(n);
  const ef = eventfulnessResult.scores;

  for (let i = 0; i < n; i++) {
    masterScore[i] = Math.min(1.0, v1.scores[i] * (alpha + (1 - alpha) * ef[i]));
  }

  return {
    ...v1,
    eventfulness:     ef,
    masterScore,
    sportProfile,
    alpha,
    eventfulnessMeta: eventfulnessResult.metadata,
  };
}

// ─── masterScore window mean ──────────────────────────────────────────────────
// Used by SceneDetectorV2 to score candidate windows.

export function masterScoreWindowMean(
  masterScore: Float32Array,
  startIndex: number,
  endIndex: number,
): number {
  if (startIndex > endIndex) return 0;
  let sum = 0;
  for (let i = startIndex; i <= endIndex; i++) sum += masterScore[i];
  return sum / (endIndex - startIndex + 1);
}
