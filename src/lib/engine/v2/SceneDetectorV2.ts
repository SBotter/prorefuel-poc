// ─── SceneDetectorV2 ────────────────────────────────────────────────────────
// Major refactor of V1 SceneDetector with:
//   1. Adaptive percentile-based thresholds (replaces hardcoded absolute values)
//   2. Top-N candidates per scene type (replaces single winner per type)
//   3. masterScore as primary ranking signal
//   4. Zone classification (INSIDE / NEAR / FAR relative to video window)
//   5. sensor_limited flags for detectors that can't fire without specific sensors

import { ActivityPoint, IntensityResult } from '../IntensityEngine';
import { IntensityV2Result, masterScoreWindowMean } from './IntensityEngineV2';
import {
  ActivityPercentiles,
  PercentileCalculator,
} from './PercentileCalculator';

// ─── Public interfaces ────────────────────────────────────────────────────────

export type SceneType = 'CLIMB' | 'DESCENT' | 'SPRINT' | 'TECHNICAL' | 'SUFFER' | 'CONTRAST';
export type SceneZone = 'INSIDE' | 'NEAR' | 'FAR';
export type SceneConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SceneCandidateV2 {
  id:               string;            // e.g. 'C1_0', 'C1_1', 'C1_2' (type + rank within type)
  type:             SceneType;
  startIndex:       number;
  endIndex:         number;
  masterScoreAvg:   number;            // mean masterScore[start..end], [0,1]
  videoOverlapScore: number;           // filled by VideoOverlapCalculator, [0,1]
  compositeScore:   number;            // filled by CompositeScoring, [0,1]
  zone:             SceneZone;         // INSIDE/NEAR/FAR relative to video window
  confidence:       SceneConfidence;   // based on qualifying fraction and sensor coverage
  label:            string;            // display label
  metadata:         Record<string, number>;
  sensorLimited:    boolean;
  sensorLimitedReason?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum candidates returned per scene type. */
const MAX_CANDIDATES_PER_TYPE = 3;

/** Minimum gap between two candidates of the same type (30 seconds). */
const MIN_GAP_SEC = 30;

/** Context window around the video where scenes are still "NEAR" (2 minutes). */
const NEAR_MARGIN_MS = 120_000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function estimateSps(points: ActivityPoint[]): number {
  const n = points.length;
  if (n < 2) return 1;
  return (n - 1) / Math.max((points[n - 1].time - points[0].time) / 1000, 1);
}

function haversineM(p1: ActivityPoint, p2: ActivityPoint): number {
  const R = 6371e3;
  const φ1 = (p1.lat * Math.PI) / 180, φ2 = (p2.lat * Math.PI) / 180;
  const dφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dλ = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a  = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeGradients(points: ActivityPoint[]): Float32Array {
  const n = points.length;
  const g = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const d = haversineM(points[i - 1], points[i]);
    g[i] = d > 0.5 ? ((points[i].ele - points[i - 1].ele) / d) * 100 : g[i - 1];
  }
  g[0] = g[1] ?? 0;
  return g;
}

function buildPrefix(arr: Float32Array): Float64Array {
  const p = new Float64Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i];
  return p;
}

function windowFraction(prefix: Float64Array, s: number, e: number): number {
  return (prefix[e + 1] - prefix[s]) / (e - s + 1);
}

function windowMean(prefix: Float64Array, s: number, e: number): number {
  return (prefix[e + 1] - prefix[s]) / (e - s + 1);
}

/** Zone classification relative to the GoPro video time window. */
function classifyZone(
  startIdx: number,
  endIdx: number,
  points: ActivityPoint[],
  videoStart: number,
  videoEnd: number,
): SceneZone {
  const sceneStart = points[startIdx].time;
  const sceneEnd   = points[endIdx].time;

  if (sceneStart <= videoEnd && sceneEnd >= videoStart) return 'INSIDE';
  const dist = Math.max(videoStart - sceneEnd, sceneStart - videoEnd);
  return dist <= NEAR_MARGIN_MS ? 'NEAR' : 'FAR';
}

/**
 * Greedy non-maximum suppression: given a list of (startIndex, score) pairs
 * sorted by score DESC, return the top-N with at least minGapPts separation.
 */
function pickTopN(
  windows:    { start: number; score: number }[],
  n:          number,
  minGapPts:  number,
): { start: number; score: number }[] {
  const sorted  = [...windows].sort((a, b) => b.score - a.score);
  const chosen: { start: number; score: number }[] = [];

  for (const w of sorted) {
    if (chosen.length >= n) break;
    const tooClose = chosen.some(c => Math.abs(c.start - w.start) < minGapPts);
    if (!tooClose) chosen.push(w);
  }
  return chosen;
}

// ─── C1 — CLIMB ──────────────────────────────────────────────────────────────
// Adaptive V2: hr > P80_hr AND gradient > P70_gradient (percentile-based)
// Window: 20s, min qualifying fraction: 60%

function detectClimbV2(
  points:      ActivityPoint[],
  intensity:   IntensityV2Result,
  percentiles: ActivityPercentiles,
  maxCands:    number,
): SceneCandidateV2[] {
  const n = points.length;

  if (!percentiles.hr) {
    return []; // sensor_limited — no HR data
  }

  const hrThresh   = PercentileCalculator.getThreshold(percentiles.hr, 'P80', percentiles.lowVariance);
  const gradThresh = percentiles.gradient
    ? PercentileCalculator.getThreshold(percentiles.gradient, 'P70', percentiles.lowVariance)
    : 4.0; // fallback absolute

  const sps    = estimateSps(points);
  const winPts = Math.max(2, Math.round(20 * sps));
  const minGap = Math.max(1, Math.round(MIN_GAP_SEC * sps));
  const grads  = computeGradients(points);

  const hrArr = new Float32Array(n);
  for (let i = 0; i < n; i++) hrArr[i] = points[i].hr ?? 0;
  const prefixGrad = buildPrefix(grads);

  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (hrArr[i] > hrThresh && grads[i] > gradThresh) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);

  const windows: { start: number; score: number }[] = [];
  const MIN_FRAC = percentiles.lowVariance ? 0.50 : 0.60;

  for (let i = 0; i + winPts <= n; i++) {
    if (windowFraction(prefixCond, i, i + winPts - 1) < MIN_FRAC) continue;
    windows.push({ start: i, score: masterScoreWindowMean(intensity.masterScore, i, i + winPts - 1) });
  }

  return pickTopN(windows, maxCands, minGap).map((w, rank) => {
    const end     = Math.min(w.start + winPts - 1, n - 1);
    let maxHR = 0;
    for (let i = w.start; i <= end; i++) { const h = hrArr[i]; if (h > maxHR) maxHR = h; }
    const avgGradient = windowMean(prefixGrad, w.start, end);
    return {
      id: `C1_${rank}`, type: 'CLIMB' as SceneType,
      startIndex: w.start, endIndex: end,
      masterScoreAvg: w.score,
      videoOverlapScore: 0, compositeScore: 0, zone: 'FAR' as SceneZone,
      confidence: w.score > 0.7 ? 'HIGH' : w.score > 0.4 ? 'MEDIUM' : 'LOW',
      label: 'BRUTAL CLIMB',
      metadata: { maxHR, avgGradient, windowSec: 20 },
      sensorLimited: false,
    } as SceneCandidateV2;
  });
}

// ─── C2 — DESCENT ────────────────────────────────────────────────────────────
// Adaptive V2: speed > P75_speed AND |gradient| > P60_descentGrad
// Window: 15s, min qualifying fraction: 60%

function detectDescentV2(
  points:      ActivityPoint[],
  intensity:   IntensityV2Result,
  percentiles: ActivityPercentiles,
  maxCands:    number,
): SceneCandidateV2[] {
  const n = points.length;
  const grads  = computeGradients(points);
  const sps    = estimateSps(points);
  const winPts = Math.max(2, Math.round(15 * sps));
  const minGap = Math.max(1, Math.round(MIN_GAP_SEC * sps));

  const spdThresh  = percentiles.speed
    ? PercentileCalculator.getThreshold(percentiles.speed, 'P75', percentiles.lowVariance)
    : 15.0;
  const gradThresh = percentiles.descentGrad
    ? PercentileCalculator.getThreshold(percentiles.descentGrad, 'P60', percentiles.lowVariance)
    : 3.0;

  const spdArr = new Float32Array(n);
  for (let i = 0; i < n; i++) spdArr[i] = points[i].speed ?? 0;

  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (spdArr[i] > spdThresh && grads[i] < -gradThresh) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);
  const prefixGrad = buildPrefix(grads);
  const MIN_FRAC   = percentiles.lowVariance ? 0.50 : 0.60;

  const windows: { start: number; score: number }[] = [];
  for (let i = 0; i + winPts <= n; i++) {
    if (windowFraction(prefixCond, i, i + winPts - 1) < MIN_FRAC) continue;
    windows.push({ start: i, score: masterScoreWindowMean(intensity.masterScore, i, i + winPts - 1) });
  }

  return pickTopN(windows, maxCands, minGap).map((w, rank) => {
    const end = Math.min(w.start + winPts - 1, n - 1);
    let maxSpeed = 0;
    for (let i = w.start; i <= end; i++) { const s = spdArr[i]; if (s > maxSpeed) maxSpeed = s; }
    const avgGradient = windowMean(prefixGrad, w.start, end);
    return {
      id: `C2_${rank}`, type: 'DESCENT' as SceneType,
      startIndex: w.start, endIndex: end,
      masterScoreAvg: w.score,
      videoOverlapScore: 0, compositeScore: 0, zone: 'FAR' as SceneZone,
      confidence: w.score > 0.7 ? 'HIGH' : w.score > 0.4 ? 'MEDIUM' : 'LOW',
      label: 'WILD DESCENT',
      metadata: { maxSpeed, avgGradient, windowSec: 15 },
      sensorLimited: false,
    } as SceneCandidateV2;
  });
}

// ─── C3 — SPRINT ─────────────────────────────────────────────────────────────
// Adaptive V2: speed > P85_speed AND deltaSpeed over window > P70_deltaSpeed
// Window: 8s, finds highest acceleration burst

function detectSprintV2(
  points:      ActivityPoint[],
  intensity:   IntensityV2Result,
  percentiles: ActivityPercentiles,
  maxCands:    number,
): SceneCandidateV2[] {
  const n = points.length;

  if (!percentiles.speed) return [];

  const spdThresh = PercentileCalculator.getThreshold(percentiles.speed, 'P85', percentiles.lowVariance);
  const sps       = estimateSps(points);
  const winPts    = Math.max(2, Math.round(8 * sps));
  const minGap    = Math.max(1, Math.round(MIN_GAP_SEC * sps));

  const spdArr = new Float32Array(n);
  for (let i = 0; i < n; i++) spdArr[i] = points[i].speed ?? 0;

  // deltaSpeed percentile threshold
  const deltas: number[] = [];
  for (let i = 0; i + winPts < n; i++) {
    deltas.push((spdArr[i + winPts] ?? 0) - spdArr[i]);
  }
  const deltaP = PercentileCalculator.compute(deltas.filter(d => d > 0));
  const deltaThresh = deltaP
    ? PercentileCalculator.getThreshold(deltaP, 'P70', percentiles.lowVariance)
    : (spdThresh * 0.30);

  const windows: { start: number; score: number; delta: number }[] = [];
  for (let i = 0; i + winPts < n; i++) {
    const endSpd   = spdArr[i + winPts] ?? 0;
    const startSpd = spdArr[i];
    const delta    = endSpd - startSpd;
    if (endSpd < spdThresh || delta < deltaThresh) continue;
    const sc = masterScoreWindowMean(intensity.masterScore, i, i + winPts - 1);
    windows.push({ start: i, score: sc, delta });
  }

  return pickTopN(windows, maxCands, minGap).map((w, rank) => {
    const end = Math.min(w.start + winPts - 1, n - 1);
    return {
      id: `C3_${rank}`, type: 'SPRINT' as SceneType,
      startIndex: w.start, endIndex: end,
      masterScoreAvg: w.score,
      videoOverlapScore: 0, compositeScore: 0, zone: 'FAR' as SceneZone,
      confidence: w.score > 0.7 ? 'HIGH' : w.score > 0.4 ? 'MEDIUM' : 'LOW',
      label: 'SPRINT',
      metadata: { speedDelta: (w as typeof w & { delta: number }).delta, windowSec: 8 },
      sensorLimited: false,
    } as SceneCandidateV2;
  });
}

// ─── C4 — TECHNICAL ──────────────────────────────────────────────────────────
// Adaptive V2: terrain roughness (variance of accel) > P75 AND speed in mid-range
// Window: 10s, min qualifying fraction: 50%
// sensor_limited when <30% of points have accelerometer data

function detectTechnicalV2(
  points:      ActivityPoint[],
  intensity:   IntensityV2Result,
  percentiles: ActivityPercentiles,
  maxCands:    number,
): SceneCandidateV2[] {
  const n        = points.length;
  const accelCount = points.filter(p => p.accel != null).length;

  if (accelCount / n < 0.30) {
    return []; // sensor_limited
  }

  const sps    = estimateSps(points);
  const winPts = Math.max(2, Math.round(10 * sps));
  const minGap = Math.max(1, Math.round(MIN_GAP_SEC * sps));

  const accelArr = new Float32Array(n);
  const spdArr   = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    accelArr[i] = Math.abs(points[i].accel ?? 0);
    spdArr[i]   = points[i].speed ?? 0;
  }

  // Terrain roughness: use accel magnitude threshold from percentiles
  // Speed mid-range: speed in [P25_speed, P75_speed] (moderate pace on rough terrain)
  const accelThresh = percentiles.accel
    ? PercentileCalculator.getThreshold(percentiles.accel, 'P75', percentiles.lowVariance)
    : 0.5;
  const spdLow  = percentiles.speed ? percentiles.speed.P60 * 0.35 : 5;
  const spdHigh = percentiles.speed
    ? PercentileCalculator.getThreshold(percentiles.speed, 'P75', percentiles.lowVariance)
    : 30;

  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (accelArr[i] > accelThresh && spdArr[i] >= spdLow && spdArr[i] <= spdHigh) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);
  const MIN_FRAC   = percentiles.lowVariance ? 0.40 : 0.50;

  const windows: { start: number; score: number }[] = [];
  for (let i = 0; i + winPts <= n; i++) {
    if (windowFraction(prefixCond, i, i + winPts - 1) < MIN_FRAC) continue;
    windows.push({ start: i, score: masterScoreWindowMean(intensity.masterScore, i, i + winPts - 1) });
  }

  return pickTopN(windows, maxCands, minGap).map((w, rank) => {
    const end = Math.min(w.start + winPts - 1, n - 1);
    const len = end - w.start + 1;
    let sumAccel = 0, sumSpeed = 0;
    for (let i = w.start; i <= end; i++) { sumAccel += accelArr[i]; sumSpeed += spdArr[i]; }
    return {
      id: `C4_${rank}`, type: 'TECHNICAL' as SceneType,
      startIndex: w.start, endIndex: end,
      masterScoreAvg: w.score,
      videoOverlapScore: 0, compositeScore: 0, zone: 'FAR' as SceneZone,
      confidence: w.score > 0.7 ? 'HIGH' : w.score > 0.4 ? 'MEDIUM' : 'LOW',
      label: 'TECHNICAL',
      metadata: { avgAccel: sumAccel / len, avgSpeed: sumSpeed / len, windowSec: 10 },
      sensorLimited: false,
    } as SceneCandidateV2;
  });
}

// ─── C5 — SUFFER / RED ZONE ──────────────────────────────────────────────────
// Adaptive V2: hr > P88_hr AND speed < P35_speed (high HR, slow speed = pain)
// Window: 15s, min qualifying fraction: 65%
// sensor_limited when <50% of points have HR

function detectSufferV2(
  points:      ActivityPoint[],
  intensity:   IntensityV2Result,
  percentiles: ActivityPercentiles,
  maxCands:    number,
): SceneCandidateV2[] {
  const n       = points.length;
  const hrCount = points.filter(p => p.hr != null).length;

  if (!percentiles.hr || hrCount / n < 0.50) {
    return []; // sensor_limited — insufficient HR data
  }

  const hrThresh  = PercentileCalculator.getThreshold(percentiles.hr,  'P85', percentiles.lowVariance);
  const spdCeil   = percentiles.speed
    ? percentiles.speed.P60 * 0.35   // below 35th percentile of speed
    : 8.0;

  const sps    = estimateSps(points);
  const winPts = Math.max(2, Math.round(15 * sps));
  const minGap = Math.max(1, Math.round(MIN_GAP_SEC * sps));

  const hrArr  = new Float32Array(n);
  const spdArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hrArr[i]  = points[i].hr    ?? 0;
    spdArr[i] = points[i].speed ?? 0;
  }

  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (hrArr[i] > hrThresh && spdArr[i] < spdCeil) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);
  const MIN_FRAC   = percentiles.lowVariance ? 0.55 : 0.65;

  const windows: { start: number; score: number }[] = [];
  for (let i = 0; i + winPts <= n; i++) {
    if (windowFraction(prefixCond, i, i + winPts - 1) < MIN_FRAC) continue;
    windows.push({ start: i, score: masterScoreWindowMean(intensity.masterScore, i, i + winPts - 1) });
  }

  return pickTopN(windows, maxCands, minGap).map((w, rank) => {
    const end = Math.min(w.start + winPts - 1, n - 1);
    const len = end - w.start + 1;
    let sumHR = 0, sumSpd = 0;
    for (let i = w.start; i <= end; i++) { sumHR += hrArr[i]; sumSpd += spdArr[i]; }
    return {
      id: `C5_${rank}`, type: 'SUFFER' as SceneType,
      startIndex: w.start, endIndex: end,
      masterScoreAvg: w.score,
      videoOverlapScore: 0, compositeScore: 0, zone: 'FAR' as SceneZone,
      confidence: w.score > 0.7 ? 'HIGH' : w.score > 0.4 ? 'MEDIUM' : 'LOW',
      label: 'RED ZONE',
      metadata: { avgHR: sumHR / len, avgSpeed: sumSpd / len, windowSec: 15 },
      sensorLimited: false,
    } as SceneCandidateV2;
  });
}

// ─── C6 — CONTRAST / FLOW ────────────────────────────────────────────────────
// Adaptive V2: climb (gradient > P65_gradient for 20s) followed within 90s by
// descent (gradient < -P55_descentGrad for 15s).
// Returns top-N pairs by combined masterScore.

function detectContrastV2(
  points:      ActivityPoint[],
  intensity:   IntensityV2Result,
  percentiles: ActivityPercentiles,
  maxCands:    number,
): SceneCandidateV2[] {
  const n     = points.length;
  const grads = computeGradients(points);
  const sps   = estimateSps(points);

  const cWin   = Math.max(2, Math.round(20 * sps));
  const dWin   = Math.max(2, Math.round(15 * sps));
  const gapMax = Math.max(1, Math.round(90 * sps));
  const pre5   = Math.max(1, Math.round(5  * sps));
  const post10 = Math.max(1, Math.round(10 * sps));

  const climbGradThresh   = percentiles.gradient
    ? PercentileCalculator.getThreshold(percentiles.gradient, 'P60', percentiles.lowVariance)
    : 4.0;
  const descentGradThresh = percentiles.descentGrad
    ? PercentileCalculator.getThreshold(percentiles.descentGrad, 'P60', percentiles.lowVariance)
    : 3.0;

  const prefixGrad = buildPrefix(grads);

  // Collect qualifying climb windows
  type CWin = { start: number; end: number; score: number; avgGrad: number };
  const climbWins: CWin[] = [];
  for (let i = 0; i + cWin <= n; i++) {
    if (windowMean(prefixGrad, i, i + cWin - 1) > climbGradThresh) {
      climbWins.push({
        start: i, end: i + cWin - 1,
        score: masterScoreWindowMean(intensity.masterScore, i, i + cWin - 1),
        avgGrad: windowMean(prefixGrad, i, i + cWin - 1),
      });
    }
  }

  // Collect qualifying descent windows
  type DWin = { start: number; end: number; score: number; maxSpeed: number };
  const descentWins: DWin[] = [];
  const spdArr = new Float32Array(n);
  for (let i = 0; i < n; i++) spdArr[i] = points[i].speed ?? 0;
  for (let i = 0; i + dWin <= n; i++) {
    if (windowMean(prefixGrad, i, i + dWin - 1) < -descentGradThresh) {
      let maxSpd = 0;
      for (let k = i; k < i + dWin; k++) { if (spdArr[k] > maxSpd) maxSpd = spdArr[k]; }
      descentWins.push({
        start: i, end: i + dWin - 1,
        score: masterScoreWindowMean(intensity.masterScore, i, i + dWin - 1),
        maxSpeed: maxSpd,
      });
    }
  }

  if (climbWins.length === 0 || descentWins.length === 0) return [];

  // Find best pairs (climb → descent within gapMax)
  type Pair = { sceneStart: number; sceneEnd: number; score: number; cg: number; ds: number };
  const pairs: Pair[] = [];
  let di = 0;
  for (const cw of climbWins) {
    while (di < descentWins.length && descentWins[di].start <= cw.end) di++;
    for (let k = di; k < descentWins.length; k++) {
      const dw = descentWins[k];
      if (dw.start - cw.end > gapMax) break;
      pairs.push({
        sceneStart:  Math.max(0,     cw.end    - pre5),
        sceneEnd:    Math.min(n - 1, dw.start  + post10),
        score:       cw.score + dw.score,
        cg:          cw.avgGrad,
        ds:          dw.maxSpeed,
      });
    }
  }

  // Sort pairs by combined score, pick top-N with min gap between scene centers
  const minGap = Math.max(1, Math.round(MIN_GAP_SEC * sps));
  const topPairs = pickTopN(
    pairs.map(p => ({ start: p.sceneStart, score: p.score, pair: p })),
    maxCands,
    minGap,
  );

  return topPairs.map((w, rank) => {
    const p = (w as typeof w & { pair: Pair }).pair;
    return {
      id: `C6_${rank}`, type: 'CONTRAST' as SceneType,
      startIndex: p.sceneStart, endIndex: p.sceneEnd,
      masterScoreAvg: masterScoreWindowMean(intensity.masterScore, p.sceneStart, p.sceneEnd),
      videoOverlapScore: 0, compositeScore: 0, zone: 'FAR' as SceneZone,
      confidence: p.score > 1.0 ? 'HIGH' : p.score > 0.6 ? 'MEDIUM' : 'LOW',
      label: 'FLOW',
      metadata: { climbGradient: p.cg, descentSpeed: p.ds },
      sensorLimited: false,
    } as SceneCandidateV2;
  });
}

// ─── Cross-type deduplication ─────────────────────────────────────────────────
// Remove candidates from different types that heavily overlap (>50% of shorter segment).
// Keep the one with higher masterScoreAvg.

function deduplicateCrossType(candidates: SceneCandidateV2[]): SceneCandidateV2[] {
  const sorted = [...candidates].sort((a, b) => b.masterScoreAvg - a.masterScoreAvg);
  const kept:  SceneCandidateV2[] = [];

  for (const cand of sorted) {
    const dominated = kept.some(k => {
      const overlap = Math.max(
        0,
        Math.min(cand.endIndex, k.endIndex) - Math.max(cand.startIndex, k.startIndex),
      );
      const shorter = Math.min(
        cand.endIndex - cand.startIndex,
        k.endIndex    - k.startIndex,
      );
      return shorter > 0 && overlap > shorter * 0.50;
    });
    if (!dominated) kept.push(cand);
  }
  return kept;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function detectScenesV2(
  points:      ActivityPoint[],
  intensity:   IntensityV2Result,
  percentiles: ActivityPercentiles,
  videoStart?: number,
  videoEnd?:   number,
): SceneCandidateV2[] {
  if (points.length < 2) return [];

  // 1. Run all detectors with top-N candidates
  const raw: SceneCandidateV2[] = [
    ...detectClimbV2    (points, intensity, percentiles, MAX_CANDIDATES_PER_TYPE),
    ...detectDescentV2  (points, intensity, percentiles, MAX_CANDIDATES_PER_TYPE),
    ...detectSprintV2   (points, intensity, percentiles, MAX_CANDIDATES_PER_TYPE),
    ...detectTechnicalV2(points, intensity, percentiles, MAX_CANDIDATES_PER_TYPE),
    ...detectSufferV2   (points, intensity, percentiles, MAX_CANDIDATES_PER_TYPE),
    ...detectContrastV2 (points, intensity, percentiles, MAX_CANDIDATES_PER_TYPE),
  ];

  // 2. Assign zone relative to video window
  const hasVideo = videoStart !== undefined && videoEnd !== undefined && videoStart > 0;
  for (const c of raw) {
    c.zone = hasVideo
      ? classifyZone(c.startIndex, c.endIndex, points, videoStart!, videoEnd!)
      : 'FAR';
  }

  // 3. Cross-type deduplication (identical temporal windows from different detectors)
  const deduped = deduplicateCrossType(raw);

  // 4. Return sorted chronologically
  return deduped.sort((a, b) => a.startIndex - b.startIndex);
}

// ─── Sensor limitation report ─────────────────────────────────────────────────
// Used by debug output to explain which detectors were skipped.

export function getSensorLimitations(
  points:      ActivityPoint[],
  percentiles: ActivityPercentiles,
): Record<string, string | null> {
  const n        = points.length;
  const hrCount  = points.filter(p => p.hr    != null).length;
  const accCount = points.filter(p => p.accel != null).length;

  return {
    C1_CLIMB:     (!percentiles.hr || hrCount / n < 0.10) ? 'No HR data' : null,
    C4_TECHNICAL: (accCount / n < 0.30) ? 'Accelerometer coverage < 30%' : null,
    C5_SUFFER:    (!percentiles.hr || hrCount / n < 0.50) ? 'HR coverage < 50%' : null,
  };
}
