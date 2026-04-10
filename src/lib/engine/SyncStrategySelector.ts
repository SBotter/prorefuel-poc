/**
 * SyncStrategySelector — selects the optimal synchronization method and
 * parameters based on the GPX profile and video GPS profile.
 *
 * Decision logic:
 *  1. If video GPS locked AND GPX has dense recording → position-match (tight)
 *  2. If video GPS locked AND GPX has sparse recording → position-match (loose)
 *  3. If video GPS locked but match confidence low → speed-correlation
 *  4. If video GPS never locked → accel-correlation
 *  5. Fallback: none (offset = 0)
 */

import { GPXProfile } from './GPXAnalyzer';
import { VideoGPSProfile } from './VideoGPSAnalyzer';

export interface SyncPlan {
  method: 'position-match' | 'speed-correlation' | 'accel-correlation' | 'none';
  distanceThresholdM: number;
  timeWindowMs: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

export class SyncStrategySelector {
  static select(gpx: GPXProfile, video: VideoGPSProfile): SyncPlan {
    const { samplingInterval, avgSpeedKmh, recommendedSyncThresholdM, recommendedTimeWindowMs } = gpx;

    // ── 1. Video GPS never locked → signal-based only ────────────────────
    if (!video.hasGPSLock || video.postLockPoints < 10) {
      const hasAccel = true; // GoPro always has ACCL
      return {
        method: hasAccel ? 'accel-correlation' : 'none',
        distanceThresholdM: recommendedSyncThresholdM,
        timeWindowMs: recommendedTimeWindowMs,
        confidence: 'LOW',
        reason: `GPS never locked (${video.postLockPoints} post-lock pts) → ACCL correlation`,
      };
    }

    // ── 2. Post-lock speed too low → rider was stopped, position match unreliable
    if (video.postLockSpeedAvgKmh < 3) {
      return {
        method: 'speed-correlation',
        distanceThresholdM: recommendedSyncThresholdM,
        timeWindowMs: recommendedTimeWindowMs,
        confidence: 'LOW',
        reason: `Post-lock avg speed ${video.postLockSpeedAvgKmh.toFixed(1)} km/h — rider stopped, position ambiguous`,
      };
    }

    // ── 3. GPX HDOP is poor → position data is noisy ────────────────────
    if (gpx.hdopStats.available && gpx.hdopStats.max > 8) {
      return {
        method: 'speed-correlation',
        distanceThresholdM: recommendedSyncThresholdM,
        timeWindowMs: recommendedTimeWindowMs,
        confidence: 'MEDIUM',
        reason: `GPX HDOP max=${gpx.hdopStats.max.toFixed(1)} (poor) → speed correlation preferred`,
      };
    }

    // ── 4. Position-match — confidence depends on GPX sampling density ────
    // At the GPX median interval, how far does the rider travel?
    const avgSpeedMs   = Math.max(avgSpeedKmh, video.postLockSpeedAvgKmh) / 3.6;
    const distPerSample = (samplingInterval.medianMs / 1000) * avgSpeedMs;

    // Tight match: threshold < 2 sample-distances (sub-2s error per pair)
    const isTight    = recommendedSyncThresholdM < distPerSample * 2;
    const isRegular  = samplingInterval.isRegular;

    if (isRegular && isTight) {
      return {
        method: 'position-match',
        distanceThresholdM: recommendedSyncThresholdM,
        timeWindowMs: recommendedTimeWindowMs,
        confidence: 'HIGH',
        reason: `Regular GPX @${samplingInterval.medianMs}ms, threshold=${recommendedSyncThresholdM.toFixed(1)}m (<${(distPerSample*2).toFixed(0)}m = 2 samples)`,
      };
    }

    if (!isRegular) {
      // Smart recording: larger threshold needed, but still do position-match
      // Use 2 sample-distances as threshold (covers the gap between sparse points)
      const looseThreshold = Math.max(recommendedSyncThresholdM, Math.min(60, distPerSample * 2));
      return {
        method: 'position-match',
        distanceThresholdM: looseThreshold,
        timeWindowMs: recommendedTimeWindowMs,
        confidence: 'MEDIUM',
        reason: `Irregular GPX (smart recording, p95=${samplingInterval.p95Ms}ms), loose threshold=${looseThreshold.toFixed(1)}m`,
      };
    }

    // Fallback: position-match with recommended threshold
    return {
      method: 'position-match',
      distanceThresholdM: recommendedSyncThresholdM,
      timeWindowMs: recommendedTimeWindowMs,
      confidence: 'MEDIUM',
      reason: `Default position-match, threshold=${recommendedSyncThresholdM.toFixed(1)}m`,
    };
  }
}
