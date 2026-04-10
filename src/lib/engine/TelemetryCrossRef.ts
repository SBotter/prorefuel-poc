import { GPSPoint } from "../media/GoProEngineClient";
import { computeIntensity } from "./IntensityEngine";
import { detectScenes, SceneCandidate } from "./SceneDetector";
import { UnitSystem, SPEED_FACTOR, SPEED_LABEL } from "../utils/units";

export interface HighlightSegment {
  startPoint: GPSPoint;
  endPoint: GPSPoint;
  startIndex: number;
  endIndex: number;
  videoStartTime: number; // In seconds, relative to the mp4 file
  duration: number; // In seconds
}

export interface EnhancedGPSPoint extends GPSPoint {
  hr?: number;
  cad?: number;
  power?: number;
  speed?: number; // km/h in metric, mph in imperial
  accel?: number; // m/s^2 (Z-axis)
  gyro?: number;  // rad/s (Yaw)
}


export interface ActionSegment extends HighlightSegment {
  title: string;
  value: string;
}

export class TelemetryCrossRef {
  /**
   * Estimates the clock offset between the GoPro camera's internal clock and
   * the Garmin GPS clock (activity file).
   *
   * Two strategies:
   *  A) GPS was locked during the video → positions change → position-based
   *     matching: pair each video GPS point with the nearest activity GPS point
   *     in space (within 100 m and ±60 s), collect (vpt.time − act.time) deltas,
   *     return the median.  Positive = camera clock ahead of Garmin.
   *
   *  B) GPS never locked → all video positions identical → search the full
   *     activity for any point within 300 m of the stuck position that is also
   *     within ±10 min of the video start.  Works when the camera is turned on
   *     at/near the same location where it last had a GPS lock.
   *
   * Returns 0 when neither strategy can find a confident match.
   */
  static estimateClockOffset(
    videoPoints: GPSPoint[],
    activityPoints: GPSPoint[],
    distanceThresholdM: number = 10,
    timeWindowMs: number = 30_000,
    gpsVideoOffsetMs: number = 0,
  ): number {
    if (videoPoints.length < 2 || activityPoints.length < 2) return 0;

    // Time-based lock boundary: points before this timestamp are pre-lock (stale cached GPS).
    // This is more reliable than position-based filtering (GPS noise can be 2-5m even without a fix).
    const lockTime = videoPoints[0].time + gpsVideoOffsetMs;

    const allSame = videoPoints.every(
      p => p.lat === videoPoints[0].lat && p.lon === videoPoints[0].lon,
    );

    // ── Strategy A: Temporal-constrained histogram ──────────────────────────────
    //
    // For each post-lock video GPS point, find the nearest Garmin GPS point
    // within ±TIME_WINDOW_MS (camera RTC vs GPS satellite time).  Record
    // delta = camera_RTC − garmin_GPS_time.  Build histogram → dominant bin.
    //
    // Why temporal constraint is REQUIRED:
    //   A global spatial search (no time window) matches video GPS points to
    //   the WRONG traversal of the same road — observed: 4/41 votes for
    //   bin=-84000ms, completely wrong.  At 21 km/h, 84s of riding = 500m;
    //   a ±120s window limits false candidates to within 710m of the correct
    //   time, and the 30m spatial threshold eliminates all of those.
    //
    // Window = ±120s covers camera clock drifts up to 2 minutes, which
    // is the worst-case drift for user-set camera clocks.
    if (!allSame) {
      const postLock = videoPoints.filter(p => p.time >= lockTime);
      const TIME_WINDOW_MS    = 120_000; // ±120 s — covers up to 2 min clock drift
      const SPATIAL_THRESHOLD = 50;      // m — GoPro GPS spikes 30-50m in canopy/urban; 50m covers 99th pct noise

      if (postLock.length >= 5) {
        const deltas: number[] = [];

        for (const vpt of postLock) {
          let minDist = Infinity, bestApt: GPSPoint | null = null;
          for (const apt of activityPoints) {
            // Temporal constraint: only consider Garmin points within ±120s of camera time.
            // Eliminates matches to the same road traversed at a different part of the ride.
            if (Math.abs(apt.time - vpt.time) > TIME_WINDOW_MS) continue;
            const d = this.getDistance(vpt, apt);
            if (d < minDist) { minDist = d; bestApt = apt; }
          }
          if (bestApt && minDist < SPATIAL_THRESHOLD) {
            deltas.push(vpt.time - bestApt.time);
          }
        }

        console.log(`[Sync] Histogram: ${deltas.length}/${postLock.length} pts matched within ${SPATIAL_THRESHOLD}m (±${TIME_WINDOW_MS/1000}s window)`,
          deltas.length > 0 ? `deltas=[${deltas.slice(0,5).map(d=>(d/1000).toFixed(2)).join(',')}…]s` : '');

        if (deltas.length >= 3) {
          // 5-second bins: at 15 km/h, GPS noise ≈ ±7s per match.
          // With 1s bins, votes scatter across ~14 bins → ~7% each (can't hit any threshold).
          // With 5s bins, all votes land in ~3 bins → ~33% each → easily detected.
          const BIN_MS = 5_000;
          const bins = new Map<number, number[]>();
          for (const d of deltas) {
            const bin = Math.round(d / BIN_MS) * BIN_MS;
            if (!bins.has(bin)) bins.set(bin, []);
            bins.get(bin)!.push(d);
          }

          let bestBin = 0, bestCount = 0;
          for (const [bin, votes] of bins) {
            if (votes.length > bestCount) { bestCount = votes.length; bestBin = bin; }
          }

          // Require ≥10% of good matches to agree.
          // With 5s bins, the correct bin typically gets ~33% → well above this.
          const MIN_VOTE_SHARE = 0.10;
          if (bestCount >= Math.max(3, deltas.length * MIN_VOTE_SHARE)) {
            const cluster = bins.get(bestBin)!;
            cluster.sort((a, b) => a - b);
            const offset = cluster[Math.floor(cluster.length / 2)];
            console.log(`[Sync] Histogram winner: bin=${bestBin}ms votes=${bestCount}/${deltas.length} (${(bestCount/deltas.length*100).toFixed(0)}%) offset=${offset}ms`);
            return offset;
          }
          console.log(`[Sync] Histogram too sparse: best=${bestBin}ms only ${bestCount}/${deltas.length} votes (<10%) — returning 0`);
        }
      }
    }

    // ── Strategy B: GPS stuck → search activity near stuck position ──────────
    // ONLY valid when GPS truly never locked (allSame=true).
    // For GPS-locked cameras, videoPoints[0] is a stale pre-lock cached position
    // from a PREVIOUS session → gives garbage offsets. Skip it entirely.
    if (allSame) {
      const stuckLat2 = videoPoints[0].lat;
      const stuckLon2 = videoPoints[0].lon;
      const videoStartMs = videoPoints[0].time;
      const WINDOW_MS = 10 * 60_000;
      let bestDist = Infinity;
      let bestAct: GPSPoint | null = null;
      for (const p of activityPoints) {
        if (Math.abs(p.time - videoStartMs) > WINDOW_MS) continue;
        const d = this.getDistance(p, { lat: stuckLat2, lon: stuckLon2, ele: p.ele, time: p.time });
        if (d < 300 && d < bestDist) { bestDist = d; bestAct = p; }
      }
      if (bestAct) {
        const offset = videoStartMs - bestAct.time;
        console.log(`[Sync] Strategy B (stuck-position match ${bestDist.toFixed(0)}m): offset=${offset}ms`);
        return offset;
      }
    }

    console.log(`[Sync] No clock offset detected — using 0`);
    return 0;
  }

  static getDistance(p1: GPSPoint, p2: GPSPoint) {
    const R = 6371e3;
    const φ1 = (p1.lat * Math.PI) / 180;
    const φ2 = (p2.lat * Math.PI) / 180;
    const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
    const Δλ = ((p2.lon - p1.lon) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * @param clockOffsetMs   Camera RTC − GPS satellite clock (ms). Positive = camera ahead.
   *                        Used to convert between time domains when computing videoStartTime.
   * @param gpsVideoOffsetMs  Time from video frame 0 to first valid GPS sample (startup latency).
   *                          Used as minimum video seek position to skip the unlocked period.
   */
  static findHighlights(
    activityPoints: EnhancedGPSPoint[],
    videoPoints: GPSPoint[],
    unit: UnitSystem = 'metric',
    clockOffsetMs: number = 0,
    gpsVideoOffsetMs: number = 0,
  ): ActionSegment[] {
    if (videoPoints.length === 0 || activityPoints.length === 0) return [];

    // ── Binary-search helper: first activity index where time >= targetMs ──────
    const actIdxAt = (targetMs: number): number => {
      let lo = 0, hi = activityPoints.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (activityPoints[mid].time < targetMs) lo = mid + 1; else hi = mid;
      }
      return lo;
    };

    // ── Time-domain clarification ─────────────────────────────────────────────
    // gopro-telemetry derives sample.date from GPSU — the GPS UTC string embedded
    // in the GPMF stream by the GPS receiver (see timeKLV.js → fillGPSTime →
    // GPSUtoDate). This is the same GPS satellite clock used by Garmin/Wahoo.
    // There is NO separate camera RTC domain to correct for.
    //
    // ❌ clockOffsetMs is deprecated and has NO effect on the calculation below.
    //    Passing a non-zero value is a no-op; the parameter is kept only for
    //    backwards compatibility with existing call sites.
    //
    // ✅ Only gpsVideoOffsetMs matters: it is the CTS of the first valid GPS fix,
    //    i.e. the number of ms from video frame 0 to when position data becomes
    //    valid. We must not seek before this point.
    if (clockOffsetMs !== 0) {
      console.warn(`[TelemetryCrossRef] clockOffsetMs=${clockOffsetMs}ms is deprecated — sample.date is GPS UTC; value ignored.`);
    }

    const videoStart    = videoPoints[0].time;
    const videoEnd      = videoPoints[videoPoints.length - 1].time;
    // GPS time at GPS lock moment (= first valid position)
    const videoStartGPS = videoStart + gpsVideoOffsetMs;
    // GPS time at video end (videoEnd is already GPS UTC)
    const videoEndGPS   = videoEnd;
    // Seek position corresponding to the GPS lock moment (seconds from video frame 0)
    const lockSeekSec   = gpsVideoOffsetMs / 1000;

    console.log(`[TelemetryCrossRef] timeModel: videoStart=${new Date(videoStart).toISOString()} gpsOffset=${gpsVideoOffsetMs}ms effectiveStart=${new Date(videoStartGPS).toISOString()}`);

    // ── Speed smoothing (unchanged — needed before IntensityEngine) ───────────
    for (let i = 1; i < activityPoints.length; i++) {
      if (!activityPoints[i].speed) {
        const d = this.getDistance(activityPoints[i - 1], activityPoints[i]);
        const t = (activityPoints[i].time - activityPoints[i - 1].time) / 1000;
        if (t > 0 && t < 10) activityPoints[i].speed = (d / t) * SPEED_FACTOR[unit];
      }
    }
    const WINDOW = 5;
    const rawSpeeds = activityPoints.map(p => p.speed ?? 0);
    for (let i = 0; i < activityPoints.length; i++) {
      if (!activityPoints[i].speed) {
        let sum = 0, count = 0;
        for (let w = Math.max(0, i - WINDOW); w <= Math.min(activityPoints.length - 1, i + WINDOW); w++) {
          sum += rawSpeeds[w]; count++;
        }
        activityPoints[i].speed = sum / count;
      }
    }

    // ── Scope scene detection to video window ────────────────────────────────
    // Running detectScenes on the full 3-hour activity finds scenes at 16:00 or 17:57
    // that have nothing to do with the 4-minute video window (17:29–17:34).
    // Slicing to the window ensures:
    //   a) All detected scenes are guaranteed inside the window — no overlap filter needed.
    //   b) Percentiles (speed, HR, gradient) are relative to the video segment, not the full activity.
    //      A modest sprint within a steady 15km/h section registers as "intense" for that window.
    const winStart   = actIdxAt(videoStartGPS);
    const winEnd     = actIdxAt(videoEndGPS);
    const windowPts  = activityPoints.slice(winStart, winEnd + 1);
    const useWindow  = windowPts.length >= 10;

    const detectionPts = useWindow ? windowPts : activityPoints;
    const intensity    = computeIntensity(detectionPts);
    const rawScenes    = detectScenes(detectionPts, intensity);

    // Re-map relative indices → absolute activityPoints indices
    const scenes = useWindow
      ? rawScenes.map(s => ({ ...s, startIndex: s.startIndex + winStart, endIndex: s.endIndex + winStart }))
      : rawScenes;

    console.log(`[TelemetryCrossRef] Profile: ${intensity.profile} | videoWindow (GPS): ${new Date(videoStartGPS).toISOString()} → ${new Date(videoEndGPS).toISOString()}`);
    console.log(`[TelemetryCrossRef] Window slice: [${winStart}→${winEnd}] (${windowPts.length} pts) | Scenes: ${scenes.length}`);
    scenes.forEach(s => console.log(`  ${s.id} ${s.label} [${s.startIndex}→${s.endIndex}] t=${new Date(activityPoints[s.startIndex].time).toISOString()} score=${s.score.toFixed(3)}`));

    // ── Map SceneCandidate → ActionSegment ────────────────────────────────────
    const spdLbl = SPEED_LABEL[unit];
    const labelFor = (s: SceneCandidate): { title: string; value: string } => {
      const m = s.metadata;
      switch (s.id) {
        case "C1": return { title: "BRUTAL CLIMB",   value: `${m.avgGradient?.toFixed(1)}%` };
        case "C2": return { title: "WILD DESCENT",   value: `${m.maxSpeed?.toFixed(1)} ${spdLbl}` };
        case "C3": return { title: "SPRINT",         value: `+${m.speedDelta?.toFixed(1)} ${spdLbl}` };
        case "C4": return { title: "TECHNICAL",      value: `${m.avgSpeed?.toFixed(1)} ${spdLbl}` };
        case "C5": return { title: "RED ZONE",       value: `${Math.round(m.avgHR ?? 0)} BPM` };
        case "C6": return { title: "FLOW",           value: `${m.climbGradient?.toFixed(1)}% → ${m.descentSpeed?.toFixed(1)} ${spdLbl}` };
        default:   return { title: s.label,            value: "" };
      }
    };

    const segments: ActionSegment[] = [];

    // All scenes are inside the window by construction — no overlap filter needed.
    // Just clamp to exact video bounds and compute seek positions.
    for (const scene of scenes) {
      const ptStart = activityPoints[scene.startIndex];
      const ptEnd   = activityPoints[scene.endIndex];

      // Clamp to video window (GPS satellite time, starting from GPS lock moment)
      const clampedStartGPS = Math.max(ptStart.time, videoStartGPS);
      const clampedEndGPS   = Math.min(ptEnd.time,   videoEndGPS);

      // video seek position in seconds from video frame 0:
      //   seek = (GPS_time - videoPoints[0].time) / 1000
      // Since videoPoints[0].time and activity points share the same GPS UTC domain,
      // this is a direct subtraction — no clock correction needed.
      // Clamped to lockSeekSec so we never seek into the pre-lock stale-position period.
      const videoStartTimeSecs = Math.max(
        (clampedStartGPS - videoStart) / 1000,
        lockSeekSec,
      );
      const duration = Math.max(1, (clampedEndGPS - clampedStartGPS) / 1000);

      const { title, value } = labelFor(scene);

      segments.push({
        startPoint:     ptStart,
        endPoint:       ptEnd,
        startIndex:     scene.startIndex,
        endIndex:       scene.endIndex,
        videoStartTime: videoStartTimeSecs,
        duration,
        title,
        value,
      });
    }

    // ── Fallback: nothing detected → play from GPS lock to end of video ────────
    if (segments.length === 0) {
      console.log("[TelemetryCrossRef] No scenes detected. Playing from GPS lock.");
      const s = actIdxAt(videoStartGPS);
      const e = actIdxAt(videoEndGPS);
      segments.push({
        startPoint:     activityPoints[s],
        endPoint:       activityPoints[e],
        startIndex:     s,
        endIndex:       e,
        videoStartTime: lockSeekSec,                                     // start at GPS lock, not frame 0
        duration:       (videoEnd - videoStart - gpsVideoOffsetMs) / 1000, // ms of valid (post-lock) video
        title:          "",
        value:          "",
      });
    }

    return segments;
  }
}
