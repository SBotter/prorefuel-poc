/**
 * SyncEngine — signal-based cross-correlation sync between video telemetry and activity GPS.
 *
 * Problem: GoPro internal RTC clock drifts 2–4 s from Garmin GPS clock.
 * When GPS never locks (fix=0), position-based alignment fails.
 * Solution: cross-correlate speed (or ACCL) signals to find the temporal offset.
 */

export interface TelemetryPoint {
  time: number;    // Unix ms
  lat?: number;
  lon?: number;
  speed?: number;  // km/h (optional — will be derived from lat/lon if absent)
  accel?: number;  // m/s² magnitude (optional)
}

export interface SyncResult {
  offsetMs: number;      // ms to add to video timestamps to align with activity
  confidence: number;    // 0–1
  method: 'correlation-speed' | 'correlation-accel' | 'position' | 'none';
  debug: {
    signalUsed: string[];
    bestScore: number;
    testedRange: [number, number];
    stepMs: number;
    warnings: string[];
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fills in `speed` (km/h) from consecutive lat/lon positions for points that
 * don't already have a non-zero speed. Skips gaps > 30 s (rider stopped / data hole).
 */
function enrichWithSpeed(points: TelemetryPoint[]): TelemetryPoint[] {
  const out = points.map(p => ({ ...p }));
  for (let i = 1; i < out.length; i++) {
    if ((out[i].speed ?? 0) > 0) continue; // already has speed
    const a = out[i - 1], b = out[i];
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    const dt = (b.time - a.time) / 1000; // seconds
    if (dt <= 0 || dt > 30) continue;
    const d = haversineM(a.lat, a.lon, b.lat, b.lon);
    out[i].speed = (d / dt) * 3.6; // m/s → km/h
  }
  return out;
}

function resample(points: TelemetryPoint[], getVal: (p: TelemetryPoint) => number, intervalMs: number): Float32Array {
  if (points.length < 2) return new Float32Array(0);
  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const n = Math.floor((t1 - t0) / intervalMs) + 1;
  const out = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * intervalMs;
    while (j < points.length - 2 && points[j + 1].time <= t) j++;
    const a = points[j], b = points[j + 1];
    const frac = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
    out[i] = getVal(a) + frac * (getVal(b) - getVal(a));
  }
  return out;
}

function smooth(arr: Float32Array, half: number): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, cnt = 0;
    for (let w = Math.max(0, i - half); w <= Math.min(arr.length - 1, i + half); w++) {
      sum += arr[w]; cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

function zScore(arr: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < arr.length; i++) mean += arr[i];
  mean /= arr.length;
  let variance = 0;
  for (let i = 0; i < arr.length; i++) variance += (arr[i] - mean) ** 2;
  const std = Math.sqrt(variance / arr.length);
  if (std < 1e-6) return new Float32Array(arr.length);
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - mean) / std;
  return out;
}

/** Normalized Cross-Correlation of template `a` against subsequence of `b` starting at bStart. */
function ncc(a: Float32Array, b: Float32Array, bStart: number, n: number): number {
  if (bStart < 0 || bStart + n > b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[bStart + i];
    normA += a[i] * a[i];
    normB += b[bStart + i] * b[bStart + i];
  }
  const denom = Math.sqrt(normA * normB);
  return denom < 1e-9 ? 0 : dot / denom;
}

/** Confidence: peak z-score vs background (excluding ±3 steps around peak). */
function computeConfidence(scores: number[], bestIdx: number): number {
  const bg = scores.filter((_, i) => Math.abs(i - bestIdx) > 3);
  if (bg.length < 5) return 0;
  const bgMean = bg.reduce((a, b) => a + b, 0) / bg.length;
  const bgStd = Math.sqrt(bg.reduce((s, v) => s + (v - bgMean) ** 2, 0) / bg.length);
  if (bgStd < 1e-9) return 0;
  return Math.min(1, Math.max(0, (scores[bestIdx] - bgMean) / bgStd / 6));
}

/** Numerical derivative of speed signal → acceleration proxy. */
function derivative(points: TelemetryPoint[]): TelemetryPoint[] {
  const out: TelemetryPoint[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const dt = (points[i + 1].time - points[i - 1].time) / 1000;
    if (dt <= 0) continue;
    const dv = ((points[i + 1].speed ?? 0) - (points[i - 1].speed ?? 0)) / 3.6; // km/h → m/s
    out.push({ time: points[i].time, accel: Math.abs(dv / dt) });
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

const STEP_MS    = 200;      // 200 ms step — finer step at wider range is too slow
const RANGE_MS   = 60_000;  // ±60 s — covers all practical camera clock drifts
const INTERVAL   = 200;     // resample to 5 Hz
const SMOOTH_WIN = 2;       // ±2 samples = 800 ms smoothing window

export class SyncEngine {
  /**
   * Estimates the clock offset between video telemetry and activity GPS.
   *
   * @param videoPoints    GPS/ACCL points from the GoPro video (time = camera RTC)
   * @param activityPoints GPS points from Garmin activity (time = GPS-synced UTC)
   * @returns SyncResult.offsetMs — add this to video timestamps to align with activity
   */
  static estimateOffsetByCorrelation(
    videoPoints: TelemetryPoint[],
    activityPoints: TelemetryPoint[],
  ): SyncResult {
    const warnings: string[] = [];

    const noSync: SyncResult = {
      offsetMs: 0, confidence: 0, method: 'none',
      debug: { signalUsed: [], bestScore: 0, testedRange: [-RANGE_MS, RANGE_MS], stepMs: STEP_MS, warnings: ['insufficient data'] },
    };

    if (videoPoints.length < 10 || activityPoints.length < 10) return noSync;

    // Enrich both tracks with position-derived speed (fills blanks; doesn't overwrite existing)
    const vEnriched = enrichWithSpeed(videoPoints);
    const aEnriched = enrichWithSpeed(activityPoints);

    const vSpeedCount = vEnriched.filter(p => (p.speed ?? 0) > 0.5).length;
    const aSpeedCount = aEnriched.filter(p => (p.speed ?? 0) > 0.5).length;

    console.log(`[SyncEngine] Speed signal: video=${vSpeedCount}pts activity=${aSpeedCount}pts`);

    // ── 1. Speed-based correlation ────────────────────────────────────────────
    if (vSpeedCount > 10 && aSpeedCount > 10) {
      const result = this._correlate(
        vEnriched, p => p.speed ?? 0,
        aEnriched, p => p.speed ?? 0,
        RANGE_MS, STEP_MS, INTERVAL, SMOOTH_WIN, warnings,
      );
      if (result !== null && result.confidence > 0.25) {
        console.log(`[SyncEngine] Speed NCC → offset=${result.offsetMs}ms confidence=${result.confidence.toFixed(3)}`);
        return { ...result, method: 'correlation-speed', debug: { ...result.debug, signalUsed: ['speed-video', 'speed-activity'] } };
      }
      if (result !== null) warnings.push(`speed correlation low confidence=${result.confidence.toFixed(3)}`);
    } else {
      if (vSpeedCount <= 10) warnings.push(`video speed flat (${vSpeedCount} moving pts, GPS not locked?)`);
      if (aSpeedCount <= 10) warnings.push(`activity speed flat (${aSpeedCount} pts)`);
    }

    // ── 2. ACCL-based correlation (fallback when GPS never locked) ────────────
    const vAccelCount = vEnriched.filter(p => (p.accel ?? 0) > 0.1).length;
    const aSpeedForDeriv = aEnriched.filter(p => (p.speed ?? 0) > 0.5).length;

    if (vAccelCount > 10 && aSpeedForDeriv > 10) {
      const actDeriv = derivative(aEnriched);
      const result = this._correlate(
        vEnriched, p => p.accel ?? 0,
        actDeriv, p => p.accel ?? 0,
        RANGE_MS, STEP_MS, INTERVAL, SMOOTH_WIN, warnings,
      );
      if (result !== null && result.confidence > 0.25) {
        console.log(`[SyncEngine] ACCL NCC → offset=${result.offsetMs}ms confidence=${result.confidence.toFixed(3)}`);
        return { ...result, method: 'correlation-accel', debug: { ...result.debug, signalUsed: ['accel-video', 'accel-deriv-activity'] } };
      }
      if (result !== null) warnings.push(`ACCL correlation low confidence=${result.confidence.toFixed(3)}`);
    } else {
      if (vAccelCount <= 10) warnings.push(`video ACCL unavailable (${vAccelCount} pts)`);
      if (aSpeedForDeriv <= 10) warnings.push('activity speed insufficient for derivative');
    }

    console.log(`[SyncEngine] No confident correlation. Warnings: ${warnings.join('; ')}`);
    return { ...noSync, debug: { ...noSync.debug, warnings } };
  }

  private static _correlate(
    videoPts: TelemetryPoint[], videoFn: (p: TelemetryPoint) => number,
    actPts:   TelemetryPoint[], actFn:   (p: TelemetryPoint) => number,
    rangeMs: number, stepMs: number, intervalMs: number, smoothWin: number,
    warnings: string[],
  ): (Omit<SyncResult, 'method'> & { debug: SyncResult['debug'] }) | null {
    const vRaw = resample(videoPts, videoFn, intervalMs);
    const aRaw = resample(actPts,   actFn,   intervalMs);
    const vSig = zScore(smooth(vRaw, smoothWin));
    const aSig = zScore(smooth(aRaw, smoothWin));

    if (vSig.length < 5 || aSig.length < 5) {
      warnings.push('signal too short after resampling');
      return null;
    }
    const vEnergy = vSig.reduce((s, v) => s + v * v, 0);
    const aEnergy = aSig.reduce((s, v) => s + v * v, 0);
    if (vEnergy < 1e-6 || aEnergy < 1e-6) {
      warnings.push('flat signal (no variance)');
      return null;
    }

    const steps = Math.floor(rangeMs / stepMs);
    const scores: number[] = [];
    const offsets: number[] = [];

    const vLen   = vSig.length;
    const aLen   = aSig.length;
    const videoT0 = videoPts[0].time;
    const actT0   = actPts[0].time;

    for (let d = -steps; d <= steps; d++) {
      const offsetMs  = d * stepMs;
      // Camera timestamps adjusted by offsetMs → (videoT0 - offsetMs) should align with actT0
      const bStart = Math.round((videoT0 - offsetMs - actT0) / intervalMs);
      const n = Math.min(vLen, aLen - bStart);
      if (n < 10 || bStart < 0) { scores.push(0); offsets.push(offsetMs); continue; }
      scores.push(ncc(vSig, aSig, bStart, n));
      offsets.push(offsetMs);
    }

    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIdx]) bestIdx = i;
    }

    const confidence = computeConfidence(scores, bestIdx);

    return {
      offsetMs: offsets[bestIdx],
      confidence,
      debug: {
        signalUsed: [],
        bestScore: scores[bestIdx],
        testedRange: [-rangeMs, rangeMs],
        stepMs,
        warnings,
      },
    };
  }
}
