/**
 * iPhoneVideoGPSAnalyzer — builds a VideoGPSProfile for iPhone MOV files.
 *
 * The standard VideoGPSAnalyzer is designed for GoPro GPMF data:
 *   • 18 Hz GPS track with fix quality field
 *   • Accelerometer and gyroscope streams
 *   • Pre-lock / post-lock concept (GPS startup latency)
 *
 * iPhone MOV files have none of that. This analyzer builds an equivalent
 * VideoGPSProfile from CreateDate + Duration metadata instead.
 *
 * ── Key differences from GoPro VideoGPSAnalyzer ──────────────────────────────
 *   • hasGPSLock = true  — iPhone CreateDate is NTP-synced UTC (reliable timestamp)
 *   • lockLatencySec = 0 — Recording starts exactly at CreateDate
 *   • postLockPoints = 2 — Synthetic boundary points only
 *   • postLockSpeedAvgKmh = 15 (nominal) — No GPS track to compute real speed
 *   • samplingIntervalMs = durationMs — Distance between the 2 synthetic points
 *   • fixDistribution = { fix0: 0, fix2: 2, fix3: 0 } — Reported as 2D-valid
 *
 * ── Why postLockSpeedAvgKmh = 15 ────────────────────────────────────────────
 * SyncStrategySelector checks if avgSpeed < 3 km/h to detect "rider stopped".
 * For iPhone, speed is unknown. Setting 15 km/h avoids a false "stopped" fallback
 * and routes the selector towards position-match / speed-correlation. Since
 * clockOffsetMs is always 0 for iPhone regardless of sync method, the selector
 * result only affects the log / analytics — not the actual seek computation.
 */

import type { VideoGPSProfile } from '../VideoGPSAnalyzer';

export class iPhoneVideoGPSAnalyzer {
  /**
   * @param createDateMs  Unix ms of video recording start (from QuickTime CreateDate).
   * @param durationMs    Video length in milliseconds.
   * @param hasStartGPS   Whether iPhone had a GPS starting coordinate.
   */
  static analyze(
    createDateMs: number,
    durationMs:   number,
    hasStartGPS:  boolean,
  ): VideoGPSProfile {
    const durationSec = durationMs / 1000;

    console.log(
      `[iPhoneVideoGPSAnalyzer] createDate=${new Date(createDateMs).toISOString()} ` +
      `duration=${durationSec.toFixed(0)}s hasStartGPS=${hasStartGPS}`,
    );

    return {
      totalPoints: 2,
      durationSec,

      // iPhone CreateDate is NTP-synced UTC — treat as an authoritative timestamp.
      // There is no "GPS startup latency" concept for iPhone.
      hasGPSLock:        true,
      lockLatencySec:    0,
      preLockPoints:     0,
      postLockPoints:    2,
      preLockedPosition: null,

      // Nominal speed — avoids "rider stopped" branch in SyncStrategySelector.
      // Actual speed is unknown (no GPS track from video).
      postLockSpeedAvgKmh: 15,
      postLockSpeedMaxKmh: 15,
      postLockDistanceM:   0,

      // Two synthetic points span the full video — interval = entire duration.
      samplingIntervalMs: durationMs,

      // No fix field on iPhone. Report boundary points as "2D valid" (fix2 equivalent).
      fixDistribution: { fix0: 0, fix2: 2, fix3: 0 },
    };
  }
}
