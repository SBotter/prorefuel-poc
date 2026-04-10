/**
 * VideoGPSAnalyzer — analyzes GPS data extracted from a video file.
 * Identifies pre-lock (stale cached) vs post-lock (valid) samples,
 * calculates effective sampling rate, and estimates post-lock speed.
 */

export interface VideoGPSProfile {
  totalPoints: number;
  durationSec: number;

  // GPS lock
  hasGPSLock: boolean;
  lockLatencySec: number;      // seconds from video start to first valid GPS fix
  preLockPoints: number;       // points with stale/cached position
  postLockPoints: number;      // points with real GPS position
  preLockedPosition: { lat: number; lon: number } | null;

  // Post-lock quality
  postLockSpeedAvgKmh: number;
  postLockSpeedMaxKmh: number;
  postLockDistanceM: number;
  samplingIntervalMs: number;  // effective interval (after downsample)

  // Fix distribution
  fixDistribution: { fix0: number; fix2: number; fix3: number };
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class VideoGPSAnalyzer {
  /**
   * @param points         Downsampled GPS points from the video worker (1/sec).
   * @param gpsVideoOffsetMs  Time from video frame 0 to first GPS lock (ms).
   */
  static analyze(points: any[], gpsVideoOffsetMs: number): VideoGPSProfile {
    const empty: VideoGPSProfile = {
      totalPoints: 0, durationSec: 0,
      hasGPSLock: false, lockLatencySec: 0,
      preLockPoints: 0, postLockPoints: 0, preLockedPosition: null,
      postLockSpeedAvgKmh: 0, postLockSpeedMaxKmh: 0, postLockDistanceM: 0,
      samplingIntervalMs: 1000,
      fixDistribution: { fix0: 0, fix2: 0, fix3: 0 },
    };

    if (!points || points.length < 2) return empty;

    const totalPoints  = points.length;
    const durationSec  = (points[totalPoints - 1].time - points[0].time) / 1000;
    const lockLatencySec = gpsVideoOffsetMs / 1000;
    const hasGPSLock   = gpsVideoOffsetMs < durationSec * 1000; // lock happened within video

    // Pre-lock = points within the first gpsVideoOffsetMs ms.
    // Those positions are stale/cached from a previous session.
    const lockTime     = points[0].time + gpsVideoOffsetMs;
    const preLockPts   = points.filter(p => p.time < lockTime);
    const postLockPts  = points.filter(p => p.time >= lockTime);

    const preLockedPosition = preLockPts.length > 0
      ? { lat: preLockPts[0].lat, lon: preLockPts[0].lon }
      : null;

    // Post-lock speed (use embedded speed field if available, else compute from positions)
    let speedSum = 0, speedMax = 0, speedCount = 0, postLockDistanceM = 0;
    for (let i = 1; i < postLockPts.length; i++) {
      const p = postLockPts[i];
      const speed = (p.speed != null && p.speed > 0)
        ? p.speed
        : (() => {
            const prev = postLockPts[i - 1];
            const d    = haversineM(prev.lat, prev.lon, p.lat, p.lon);
            const dt   = (p.time - prev.time) / 1000;
            return dt > 0 && dt < 30 ? (d / dt) * 3.6 : 0;
          })();
      if (speed > 0) { speedSum += speed; speedCount++; if (speed > speedMax) speedMax = speed; }
      postLockDistanceM += haversineM(postLockPts[i-1].lat, postLockPts[i-1].lon, p.lat, p.lon);
    }

    // Effective sampling interval
    const intervals: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const dt = points[i].time - points[i - 1].time;
      if (dt > 0) intervals.push(dt);
    }
    const samplingIntervalMs = intervals.length > 0
      ? intervals.reduce((s, v) => s + v, 0) / intervals.length
      : 1000;

    // Fix distribution: infer from position change (proxy for fix field)
    // fix=0 → position identical to pre-lock cached position
    // fix≥2 → position changes
    let fix0 = 0, fix2or3 = 0;
    for (const p of points) {
      if (preLockedPosition && haversineM(p.lat, p.lon, preLockedPosition.lat, preLockedPosition.lon) < 1) {
        fix0++;
      } else {
        fix2or3++;
      }
    }

    const postLockSpeedAvgKmh = speedCount > 0 ? speedSum / speedCount : 0;

    const profile: VideoGPSProfile = {
      totalPoints, durationSec,
      hasGPSLock,
      lockLatencySec,
      preLockPoints:  preLockPts.length,
      postLockPoints: postLockPts.length,
      preLockedPosition,
      postLockSpeedAvgKmh,
      postLockSpeedMaxKmh: speedMax,
      postLockDistanceM,
      samplingIntervalMs,
      fixDistribution: { fix0, fix2: fix2or3, fix3: 0 },
    };

    console.log(`[VideoGPSAnalyzer] pts=${totalPoints} dur=${durationSec.toFixed(0)}s lock=${hasGPSLock} latency=${lockLatencySec.toFixed(1)}s`);
    console.log(`[VideoGPSAnalyzer] pre-lock=${preLockPts.length} post-lock=${postLockPts.length} avgSpeed=${postLockSpeedAvgKmh.toFixed(1)}km/h`);

    return profile;
  }
}
