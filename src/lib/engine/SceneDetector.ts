import { ActivityPoint, IntensityResult } from "./IntensityEngine";

// ─── Public interface ─────────────────────────────────────────────────────────

export interface SceneCandidate {
  id: string;
  type: "CLIMB" | "DESCENT" | "SPRINT" | "TECHNICAL" | "SUFFER" | "CONTRAST";
  startIndex: number;
  endIndex: number;
  score: number;        // set by detectScenes — mean intensity.scores[start..end]
  label: string;
  metadata: Record<string, number>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function haversineM(p1: ActivityPoint, p2: ActivityPoint): number {
  const R = 6371e3;
  const φ1 = (p1.lat * Math.PI) / 180, φ2 = (p2.lat * Math.PI) / 180;
  const dφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dλ = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateSps(points: ActivityPoint[]): number {
  const n = points.length;
  if (n < 2) return 1;
  const totalSec = (points[n - 1].time - points[0].time) / 1000;
  return (n - 1) / Math.max(totalSec, 1);
}

/** Per-point signed gradient in % via haversine. */
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

/**
 * Normalize `raw` to [0,1].
 * If `maskZero` is true, only non-zero values participate in min/max
 * (points with no sensor reading are mapped to 0).
 */
function normalizeArr(raw: Float32Array, maskZero = false): Float32Array {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    if (maskZero && raw[i] === 0) continue;
    if (raw[i] < mn) mn = raw[i];
    if (raw[i] > mx) mx = raw[i];
  }
  const out = new Float32Array(raw.length);
  const range = mx - mn;
  if (!isFinite(range) || range === 0) return out;
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i] === 0 && maskZero ? 0 : (raw[i] - mn) / range;
  }
  return out;
}

/** Build prefix-sum array (length n+1) for O(1) window counts/means. */
function buildPrefix(arr: Float32Array): Float64Array {
  const p = new Float64Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i];
  return p;
}

/** Fraction of 1s in a boolean-valued Float32Array window [s, e] inclusive. */
function windowFraction(prefix: Float64Array, s: number, e: number): number {
  return (prefix[e + 1] - prefix[s]) / (e - s + 1);
}

/** Mean of a Float32Array window [s, e] inclusive. */
function windowMean(prefix: Float64Array, s: number, e: number): number {
  return (prefix[e + 1] - prefix[s]) / (e - s + 1);
}

/** Mean of intensity.scores over [s, e]. */
function windowScore(scores: Float32Array, s: number, e: number): number {
  let sum = 0;
  for (let i = s; i <= e; i++) sum += scores[i];
  return sum / (e - s + 1);
}

// ─── C1 — detectClimb ────────────────────────────────────────────────────────
// 20s window where ≥60% of points satisfy: hr_norm > 0.85 AND gradient > 5%
// Pick window with highest qualifying fraction; ties broken by intensity score.

export function detectClimb(
  points: ActivityPoint[],
  intensity: IntensityResult,
): SceneCandidate | null {
  const n = points.length;
  if (!points.some(p => (p.hr ?? 0) > 0)) return null;

  const sps     = estimateSps(points);
  const winPts  = Math.max(2, Math.round(20 * sps));
  const grads   = computeGradients(points);

  const hrRaw  = new Float32Array(n);
  const spdRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) { hrRaw[i] = points[i].hr ?? 0; spdRaw[i] = points[i].speed ?? 0; }
  const hrNorm  = normalizeArr(hrRaw);

  // Boolean condition array: 1 if point qualifies, 0 otherwise
  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (hrNorm[i] > 0.85 && grads[i] > 5) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);
  const prefixGrad = buildPrefix(grads);

  let bestStart = -1, bestFrac = 0, bestScore = 0;
  for (let i = 0; i + winPts <= n; i++) {
    const frac = windowFraction(prefixCond, i, i + winPts - 1);
    if (frac < 0.6) continue;
    const sc = windowScore(intensity.scores, i, i + winPts - 1);
    if (frac > bestFrac || (frac === bestFrac && sc > bestScore)) {
      bestFrac = frac; bestScore = sc; bestStart = i;
    }
  }
  if (bestStart < 0) return null;

  const end = Math.min(bestStart + winPts - 1, n - 1);
  let maxHR = 0;
  for (let i = bestStart; i <= end; i++) { const h = points[i].hr ?? 0; if (h > maxHR) maxHR = h; }
  const avgGradient = windowMean(prefixGrad, bestStart, end);

  return {
    id: "C1", type: "CLIMB",
    startIndex: bestStart, endIndex: end,
    score: 0,   // filled by detectScenes
    label: "SUBIDA BRUTAL",
    metadata: { maxHR, avgGradient, windowSec: 20 },
  };
}

// ─── C2 — detectDescent ──────────────────────────────────────────────────────
// 15s window where ≥60% of points satisfy: speed_norm > 0.75 AND gradient < -4%

export function detectDescent(
  points: ActivityPoint[],
  intensity: IntensityResult,
): SceneCandidate | null {
  const n = points.length;
  const sps    = estimateSps(points);
  const winPts = Math.max(2, Math.round(15 * sps));
  const grads  = computeGradients(points);

  const spdRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) spdRaw[i] = points[i].speed ?? 0;
  const spdNorm = normalizeArr(spdRaw);

  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (spdNorm[i] > 0.75 && grads[i] < -4) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);
  const prefixGrad = buildPrefix(grads);

  let bestStart = -1, bestFrac = 0, bestScore = 0;
  for (let i = 0; i + winPts <= n; i++) {
    const frac = windowFraction(prefixCond, i, i + winPts - 1);
    if (frac < 0.6) continue;
    const sc = windowScore(intensity.scores, i, i + winPts - 1);
    if (frac > bestFrac || (frac === bestFrac && sc > bestScore)) {
      bestFrac = frac; bestScore = sc; bestStart = i;
    }
  }
  if (bestStart < 0) return null;

  const end = Math.min(bestStart + winPts - 1, n - 1);
  let maxSpeed = 0;
  for (let i = bestStart; i <= end; i++) { const s = points[i].speed ?? 0; if (s > maxSpeed) maxSpeed = s; }
  const avgGradient = windowMean(prefixGrad, bestStart, end);

  return {
    id: "C2", type: "DESCENT",
    startIndex: bestStart, endIndex: end,
    score: 0,
    label: "DESCIDA SELVAGEM",
    metadata: { maxSpeed, avgGradient, windowSec: 15 },
  };
}

// ─── C3 — detectSprint ───────────────────────────────────────────────────────
// Fixed 8s window. delta = speed[end] − speed[start]. Find max delta > 60% of speed_max.

export function detectSprint(
  points: ActivityPoint[],
  intensity: IntensityResult,
): SceneCandidate | null {
  const n = points.length;
  let speedMax = 0;
  for (let i = 0; i < n; i++) { const s = points[i].speed ?? 0; if (s > speedMax) speedMax = s; }
  if (speedMax === 0) return null;

  const sps      = estimateSps(points);
  const winPts   = Math.max(2, Math.round(8 * sps));
  const threshold = speedMax * 0.60;

  let bestStart = -1, bestDelta = 0;
  for (let i = 0; i + winPts - 1 < n; i++) {
    const end   = i + winPts - 1;
    const delta = (points[end].speed ?? 0) - (points[i].speed ?? 0);
    if (delta > threshold && delta > bestDelta) {
      bestDelta = delta; bestStart = i;
    }
  }
  if (bestStart < 0) return null;

  const end = bestStart + winPts - 1;
  const durationSec = (points[end].time - points[bestStart].time) / 1000;
  return {
    id: "C3", type: "SPRINT",
    startIndex: bestStart, endIndex: end,
    score: 0,
    label: "SPRINT",
    metadata: { speedDelta: bestDelta, durationSec: 8 },
  };
}

// ─── C4 — detectTechnical ────────────────────────────────────────────────────
// Requires accel in ≥30% of points.
// 10s window where ≥50% of points satisfy: accel_norm > 0.7 AND speed_norm ∈ [0.2, 0.6]
// accel_norm computed only over points that have accel.

export function detectTechnical(
  points: ActivityPoint[],
  intensity: IntensityResult,
): SceneCandidate | null {
  const n = points.length;
  const accelCount = points.filter(p => p.accel != null).length;
  if (accelCount / n < 0.30) return null;

  const sps    = estimateSps(points);
  const winPts = Math.max(2, Math.round(10 * sps));

  const accelRaw = new Float32Array(n);
  const spdRaw   = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    accelRaw[i] = Math.abs(points[i].accel ?? 0);
    spdRaw[i]   = points[i].speed ?? 0;
  }
  // accel_norm: min/max only from points that have accel (maskZero)
  const accelNorm = normalizeArr(accelRaw, true);
  const spdNorm   = normalizeArr(spdRaw);

  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (accelNorm[i] > 0.7 && spdNorm[i] >= 0.2 && spdNorm[i] <= 0.6) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);

  let bestStart = -1, bestFrac = 0, bestScore = 0;
  for (let i = 0; i + winPts <= n; i++) {
    const frac = windowFraction(prefixCond, i, i + winPts - 1);
    if (frac < 0.5) continue;
    const sc = windowScore(intensity.scores, i, i + winPts - 1);
    if (frac > bestFrac || (frac === bestFrac && sc > bestScore)) {
      bestFrac = frac; bestScore = sc; bestStart = i;
    }
  }
  if (bestStart < 0) return null;

  const end = Math.min(bestStart + winPts - 1, n - 1);
  const len = end - bestStart + 1;
  let sumAccel = 0, sumSpeed = 0;
  for (let i = bestStart; i <= end; i++) {
    sumAccel += points[i].accel ?? 0;
    sumSpeed += points[i].speed ?? 0;
  }
  return {
    id: "C4", type: "TECHNICAL",
    startIndex: bestStart, endIndex: end,
    score: 0,
    label: "TÉCNICO",
    metadata: { avgAccel: sumAccel / len, avgSpeed: sumSpeed / len, windowSec: 10 },
  };
}

// ─── C5 — detectSuffer ───────────────────────────────────────────────────────
// Requires hr in ≥50% of points.
// 15s window where ≥65% of points satisfy: hr_norm > 0.88 AND speed_norm < 0.30
// hr_norm computed only over points that have hr.

export function detectSuffer(
  points: ActivityPoint[],
  intensity: IntensityResult,
): SceneCandidate | null {
  const n = points.length;
  const hrCount = points.filter(p => p.hr != null).length;
  if (hrCount / n < 0.50) return null;

  const sps    = estimateSps(points);
  const winPts = Math.max(2, Math.round(15 * sps));

  const hrRaw  = new Float32Array(n);
  const spdRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hrRaw[i]  = points[i].hr    ?? 0;
    spdRaw[i] = points[i].speed ?? 0;
  }
  // hr_norm: min/max only from points that have hr (maskZero)
  const hrNorm  = normalizeArr(hrRaw, true);
  const spdNorm = normalizeArr(spdRaw);

  const cond = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cond[i] = (hrNorm[i] > 0.88 && spdNorm[i] < 0.30) ? 1 : 0;
  }
  const prefixCond = buildPrefix(cond);

  let bestStart = -1, bestFrac = 0, bestScore = 0;
  for (let i = 0; i + winPts <= n; i++) {
    const frac = windowFraction(prefixCond, i, i + winPts - 1);
    if (frac < 0.65) continue;
    const sc = windowScore(intensity.scores, i, i + winPts - 1);
    if (frac > bestFrac || (frac === bestFrac && sc > bestScore)) {
      bestFrac = frac; bestScore = sc; bestStart = i;
    }
  }
  if (bestStart < 0) return null;

  const end = Math.min(bestStart + winPts - 1, n - 1);
  const len = end - bestStart + 1;
  let sumHR = 0, sumSpd = 0;
  for (let i = bestStart; i <= end; i++) {
    sumHR  += points[i].hr    ?? 0;
    sumSpd += points[i].speed ?? 0;
  }
  return {
    id: "C5", type: "SUFFER",
    startIndex: bestStart, endIndex: end,
    score: 0,
    label: "ZONA VERMELHA",
    metadata: { avgHR: sumHR / len, avgSpeed: sumSpd / len, windowSec: 15 },
  };
}

// ─── C6 — detectContrast ─────────────────────────────────────────────────────
// Find a 20s climb (mean gradient > 4%) followed within 60s by a 15s descent
// (mean gradient < -3%). Scene = [climbEnd − 5s … descentStart + 10s].
// Pick the pair with highest combined (climbScore + descentScore).

export function detectContrast(
  points: ActivityPoint[],
  intensity: IntensityResult,
): SceneCandidate | null {
  const n      = points.length;
  const sps    = estimateSps(points);
  const cWin   = Math.max(2, Math.round(20 * sps));  // climb window
  const dWin   = Math.max(2, Math.round(15 * sps));  // descent window
  const gapMax = Math.max(1, Math.round(60 * sps));  // max gap between them
  const pre5   = Math.max(1, Math.round(5  * sps));
  const post10 = Math.max(1, Math.round(10 * sps));

  const grads      = computeGradients(points);
  const prefixGrad = buildPrefix(grads);

  // Collect all valid climb window ends
  type ClimbWin = { start: number; end: number; score: number; avgGrad: number };
  const climbWins: ClimbWin[] = [];
  for (let i = 0; i + cWin <= n; i++) {
    const meanGrad = windowMean(prefixGrad, i, i + cWin - 1);
    if (meanGrad > 4) {
      climbWins.push({
        start: i, end: i + cWin - 1,
        score: windowScore(intensity.scores, i, i + cWin - 1),
        avgGrad: meanGrad,
      });
    }
  }

  // Collect all valid descent window starts
  type DescentWin = { start: number; end: number; score: number; maxSpeed: number };
  const descentWins: DescentWin[] = [];
  for (let i = 0; i + dWin <= n; i++) {
    const meanGrad = windowMean(prefixGrad, i, i + dWin - 1);
    if (meanGrad < -3) {
      let maxSpd = 0;
      for (let k = i; k < i + dWin; k++) { const s = points[k].speed ?? 0; if (s > maxSpd) maxSpd = s; }
      descentWins.push({
        start: i, end: i + dWin - 1,
        score: windowScore(intensity.scores, i, i + dWin - 1),
        maxSpeed: maxSpd,
      });
    }
  }

  if (climbWins.length === 0 || descentWins.length === 0) return null;

  // Find pair with highest combined score where descentStart is within 60s after climbEnd
  let bestPair: {
    sceneStart: number; sceneEnd: number;
    combinedScore: number; cg: number; ds: number; gapSec: number;
  } | null = null;

  let di = 0;
  for (const cw of climbWins) {
    // Advance descent pointer to first descent that starts after climbEnd
    while (di < descentWins.length && descentWins[di].start <= cw.end) di++;
    for (let k = di; k < descentWins.length; k++) {
      const dw = descentWins[k];
      if (dw.start - cw.end > gapMax) break;
      const combined = cw.score + dw.score;
      if (!bestPair || combined > bestPair.combinedScore) {
        const gapSec = (points[dw.start].time - points[cw.end].time) / 1000;
        bestPair = {
          sceneStart: Math.max(0,     cw.end    - pre5),
          sceneEnd:   Math.min(n - 1, dw.start  + post10),
          combinedScore: combined,
          cg: cw.avgGrad,
          ds: dw.maxSpeed,
          gapSec,
        };
      }
    }
  }
  if (!bestPair) return null;

  return {
    id: "C6", type: "CONTRAST",
    startIndex: bestPair.sceneStart, endIndex: bestPair.sceneEnd,
    score: 0,
    label: "ALÍVIO",
    metadata: {
      climbGradient: bestPair.cg,
      descentSpeed:  bestPair.ds,
      gapSec:        bestPair.gapSec,
    },
  };
}

// ─── Video proximity classification ──────────────────────────────────────────
// Classifies a scene relative to the GoPro recording window.
// INSIDE: scene overlaps the video → most relevant, no score penalty
// NEAR:   scene is within VIDEO_MARGIN_MS of the video → slight penalty
// FAR:    scene is far from the video → strong penalty (still usable for MAP overview)

function classifyScene(
  scene: SceneCandidate,
  points: ActivityPoint[],
  videoStart: number,
  videoEnd: number,
  marginMs: number,
): "INSIDE" | "NEAR" | "FAR" {
  const sceneStartTime = points[scene.startIndex].time;
  const sceneEndTime   = points[scene.endIndex].time;

  // Scene window overlaps video window
  if (sceneStartTime <= videoEnd && sceneEndTime >= videoStart) return "INSIDE";

  // Distance from scene to the nearest edge of the video window
  const distToVideo = Math.max(
    videoStart - sceneEndTime,   // positive = scene ends before video starts
    sceneStartTime - videoEnd,   // positive = scene starts after video ends
  );
  if (distToVideo <= marginMs) return "NEAR";
  return "FAR";
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateScenes(scenes: SceneCandidate[]): SceneCandidate[] {
  // Sort by score descending; greedily keep non-overlapping
  const sorted = [...scenes].sort((a, b) => b.score - a.score);
  const kept: SceneCandidate[] = [];
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
      return overlap > shorter * 0.5;
    });
    if (!dominated) kept.push(cand);
  }
  return kept.sort((a, b) => a.startIndex - b.startIndex);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function detectScenes(
  points: ActivityPoint[],
  intensity: IntensityResult,
  videoStart?: number,  // timestamp ms UTC — GoPro recording start
  videoEnd?: number,    // timestamp ms UTC — GoPro recording end
): SceneCandidate[] {
  if (points.length < 2) return [];

  // 1. Run all detectors
  const raw = [
    detectClimb    (points, intensity),
    detectDescent  (points, intensity),
    detectSprint   (points, intensity),
    detectTechnical(points, intensity),
    detectSuffer   (points, intensity),
    detectContrast (points, intensity),
  ];

  // 2. Filter nulls
  const candidates = raw.filter((c): c is SceneCandidate => c !== null);

  // 3. Assign score = mean intensity.scores over [startIndex, endIndex]
  for (const c of candidates) {
    c.score = windowScore(intensity.scores, c.startIndex, c.endIndex);
  }

  // 4. Adjust scores by proximity to the GoPro video window (MUDANÇA 3 + 4)
  // Scenes inside/near the video always win deduplication and act selection.
  // FAR scenes are kept but penalized — still useful for MAP overview segments.
  if (videoStart !== undefined && videoEnd !== undefined && videoStart > 0) {
    const VIDEO_MARGIN_MS = 120_000; // 2-minute tolerance around the video window
    for (const c of candidates) {
      const zone = classifyScene(c, points, videoStart, videoEnd, VIDEO_MARGIN_MS);
      if (zone === "NEAR") c.score *= 0.75;
      else if (zone === "FAR") c.score *= 0.40;
      // INSIDE: score unchanged — already the most relevant
    }
  }

  // 5. Deduplicate (uses adjusted scores as tie-breaker)
  // 6. Return sorted chronologically
  return deduplicateScenes(candidates);
}
