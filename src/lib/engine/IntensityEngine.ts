import { EnhancedGPSPoint } from "./TelemetryCrossRef";

// ActivityPoint is the canonical point type used throughout this engine
export type ActivityPoint = EnhancedGPSPoint;

// ─────────────────────────────────────────────────────────────────────────────

export type ActivityProfile = "CLIMB" | "DESCENT" | "MIXED";

export interface IntensityResult {
  scores: Float32Array;       // smoothed intensity score per point index (0→1)
  profile: ActivityProfile;
  maxScore: number;
  meanScore: number;
}

export interface TopWindow {
  startIndex: number;
  endIndex: number;
  score: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function haversineMeters(p1: ActivityPoint, p2: ActivityPoint): number {
  const R = 6371e3;
  const φ1 = (p1.lat * Math.PI) / 180;
  const φ2 = (p2.lat * Math.PI) / 180;
  const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const Δλ = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normalize a value to [0, 1]. Returns 0 if range is zero. */
function normalize(v: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(Math.max((v - min) / (max - min), 0), 1);
}

/** Compute per-point gradient (%) from elevation and haversine distance. */
function computeGradients(points: ActivityPoint[]): Float32Array {
  const grads = new Float32Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const dist = haversineMeters(points[i - 1], points[i]);
    if (dist > 0.5) {
      // gradient in % = (Δele / distance) * 100
      grads[i] = ((points[i].ele - points[i - 1].ele) / dist) * 100;
    } else {
      grads[i] = grads[i - 1]; // carry forward for GPS jitter
    }
  }
  grads[0] = grads[1] ?? 0;
  return grads;
}

/** Detect activity profile from mean absolute gradient. */
function detectProfile(grads: Float32Array): ActivityProfile {
  let sum = 0;
  for (let i = 0; i < grads.length; i++) sum += grads[i];
  const mean = sum / grads.length;
  if (mean > 4) return "CLIMB";
  if (mean < -4) return "DESCENT";
  return "MIXED";
}

/** Weights per metric per profile. */
const WEIGHTS: Record<ActivityProfile, Record<string, number>> = {
  CLIMB:   { hr: 0.30, speed: 0.10, gradient_abs: 0.25, accel: 0.10, power: 0.20, gyro: 0.05 },
  DESCENT: { hr: 0.15, speed: 0.30, gradient_abs: 0.20, accel: 0.20, power: 0.05, gyro: 0.10 },
  MIXED:   { hr: 0.25, speed: 0.20, gradient_abs: 0.20, accel: 0.15, power: 0.15, gyro: 0.05 },
};

/** Rolling average smoothing over a symmetric window. */
function smooth(arr: Float32Array, halfWindow: number): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(arr.length - 1, i + halfWindow);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += arr[j];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function computeIntensity(points: ActivityPoint[]): IntensityResult {
  const n = points.length;
  if (n === 0) {
    return { scores: new Float32Array(0), profile: "MIXED", maxScore: 0, meanScore: 0 };
  }

  // 1. Compute gradient per point
  const grads = computeGradients(points);
  const gradAbs = new Float32Array(n);
  for (let i = 0; i < n; i++) gradAbs[i] = Math.abs(grads[i]);

  // 2. Detect profile
  const profile = detectProfile(grads);

  // 3. Compute min/max for each metric
  let hrMin = Infinity,    hrMax = -Infinity;
  let spdMin = Infinity,   spdMax = -Infinity;
  let gradMin = Infinity,  gradMax = -Infinity;
  let accelMin = Infinity, accelMax = -Infinity;
  let powMin = Infinity,   powMax = -Infinity;
  let gyroMin = Infinity,  gyroMax = -Infinity;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const hr    = p.hr    ?? 0;
    const spd   = p.speed ?? 0;
    const ga    = gradAbs[i];
    const accel = p.accel ?? 0;
    const pow   = p.power ?? 0;
    const gyro  = p.gyro  ?? 0;

    if (hr    < hrMin)    hrMin    = hr;
    if (hr    > hrMax)    hrMax    = hr;
    if (spd   < spdMin)   spdMin   = spd;
    if (spd   > spdMax)   spdMax   = spd;
    if (ga    < gradMin)  gradMin  = ga;
    if (ga    > gradMax)  gradMax  = ga;
    if (accel < accelMin) accelMin = accel;
    if (accel > accelMax) accelMax = accel;
    if (pow   < powMin)   powMin   = pow;
    if (pow   > powMax)   powMax   = pow;
    if (gyro  < gyroMin)  gyroMin  = gyro;
    if (gyro  > gyroMax)  gyroMax  = gyro;
  }

  // 4. Compute raw weighted score per point
  const w = WEIGHTS[profile];
  const raw = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const hr_norm    = normalize(p.hr    ?? 0, hrMin,    hrMax);
    const spd_norm   = normalize(p.speed ?? 0, spdMin,   spdMax);
    const grad_norm  = normalize(gradAbs[i],   gradMin,  gradMax);
    const accel_norm = normalize(p.accel ?? 0, accelMin, accelMax);
    const pow_norm   = normalize(p.power ?? 0, powMin,   powMax);
    const gyro_norm  = normalize(p.gyro  ?? 0, gyroMin,  gyroMax);

    raw[i] =
      w.hr           * hr_norm   +
      w.speed        * spd_norm  +
      w.gradient_abs * grad_norm +
      w.accel        * accel_norm +
      w.power        * pow_norm  +
      w.gyro         * gyro_norm;
  }

  // 5. Smooth with half-window = 5 (total window = 10 as specified)
  const scores = smooth(raw, 5);

  // 6. Stats
  let maxScore = 0, sumScore = 0;
  for (let i = 0; i < n; i++) {
    if (scores[i] > maxScore) maxScore = scores[i];
    sumScore += scores[i];
  }
  const meanScore = sumScore / n;

  return { scores, profile, maxScore, meanScore };
}

// ─────────────────────────────────────────────────────────────────────────────

export function getTopWindows(
  result: IntensityResult,
  points: ActivityPoint[],
  windowSec: number,
  maxWindows: number,
  minGapSec: number,
): TopWindow[] {
  const n = points.length;
  if (n < 2 || result.scores.length === 0) return [];

  // Estimate sample rate from timestamps
  const totalSec = (points[n - 1].time - points[0].time) / 1000;
  const samplesPerSec = (n - 1) / Math.max(totalSec, 1);
  const windowPts = Math.max(1, Math.round(windowSec  * samplesPerSec));
  const minGapPts = Math.max(1, Math.round(minGapSec  * samplesPerSec));

  // Build sliding window score sums using a prefix-sum array for O(n) total
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + result.scores[i];

  // Collect all (startIndex, avgScore) pairs
  const candidates: { start: number; score: number }[] = [];
  for (let i = 0; i + windowPts <= n; i++) {
    const avg = (prefix[i + windowPts] - prefix[i]) / windowPts;
    candidates.push({ start: i, score: avg });
  }

  // Sort by score descending, then greedily pick with minGapPts separation
  candidates.sort((a, b) => b.score - a.score);

  const chosen: TopWindow[] = [];
  for (const c of candidates) {
    if (chosen.length >= maxWindows) break;
    const end = Math.min(c.start + windowPts - 1, n - 1);
    // Ensure minimum gap from every already-chosen window
    const tooClose = chosen.some(
      (w) => Math.abs(c.start - w.startIndex) < minGapPts,
    );
    if (!tooClose) {
      chosen.push({ startIndex: c.start, endIndex: end, score: c.score });
    }
  }

  // Return in chronological order (by startIndex)
  chosen.sort((a, b) => a.startIndex - b.startIndex);
  return chosen;
}
