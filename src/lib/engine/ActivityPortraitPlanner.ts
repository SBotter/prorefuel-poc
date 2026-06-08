/**
 * ActivityPortraitPlanner — generates a StoryPlan for WhatsApp videos.
 *
 * WhatsApp videos have no telemetry and cannot be synced to the GPX track.
 * Instead of selecting highlight windows, this planner:
 *   1. Computes aggregate stats from activityPoints (distance, speed, elevation, HR)
 *   2. Produces a single ACTION segment covering the entire clip (capped to budget)
 *   3. Sets templateId = 'activity_portrait' so MapEngine uses the portrait renderer
 *
 * The GPX data tells the full story. The WA clip is the emotional B-roll window.
 */

import type { StoryPlan, StorySegment, ActivityPortraitData } from './StorytellingProcessor';
import type { EnhancedGPSPoint }                              from './TelemetryCrossRef';
import type { NarrativePlan }                                 from './NarrativePlanner';

const INTRO_SEC        = 6.5;
const BRAND_SEC        = 3.5;
const ACTION_BUDGET    = 49;   // seconds — same ceiling as standard template

// ── Haversine (metres) ─────────────────────────────────────────────────────────
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R  = 6_371_000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a  = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GPS spike cap: any single-segment speed above this is noise (applies to all sports)
const GPS_SPEED_CAP_KMH = 150;

// ── Aggregate stats from raw activity points ───────────────────────────────────
function computePortraitData(points: EnhancedGPSPoint[]): ActivityPortraitData {
  let totalDistanceM    = 0;
  let maxSpeedExplicit  = 0;   // from p.speed / p.speedSmoothed fields
  let hasExplicitSpeed  = false;
  let elevationGainM    = 0;
  let hrSum             = 0;
  let hrCount           = 0;
  let hrMax             = 0;
  const gpsSpeedsKmh: number[] = [];  // derived from position deltas

  for (let i = 0; i < points.length; i++) {
    const p    = points[i] as any;
    const prev = i > 0 ? points[i - 1] as any : null;

    // Distance + GPS-derived speed
    if (prev) {
      const distM  = haversineM(prev.lat, prev.lon, p.lat, p.lon);
      const dtSec  = (p.time - prev.time) / 1000;
      totalDistanceM += distM;
      if (dtSec > 0 && dtSec <= 30) {
        const spdKmh = (distM / 1000) / (dtSec / 3600);
        if (spdKmh < GPS_SPEED_CAP_KMH) gpsSpeedsKmh.push(spdKmh);
      }
    }

    // Explicit speed field (m/s converted to km/h in GPX parser, or already km/h)
    const spd = (p.speed ?? p.speedSmoothed ?? 0) as number;
    if (spd > 0) { hasExplicitSpeed = true; if (spd > maxSpeedExplicit) maxSpeedExplicit = spd; }

    // Elevation gain (positive deltas only)
    if (prev) {
      const dEle = p.ele - prev.ele;
      if (dEle > 0) elevationGainM += dEle;
    }

    // Heart rate
    const hr = (p.hr ?? 0) as number;
    if (hr > 0) { hrSum += hr; hrCount++; if (hr > hrMax) hrMax = hr; }
  }

  const durationSec = points.length > 1
    ? (points[points.length - 1].time - points[0].time) / 1000
    : 0;

  const avgSpeedKmh = durationSec > 0
    ? (totalDistanceM / 1000) / (durationSec / 3600)
    : 0;

  // Max speed: prefer explicit field; fallback to 98th-percentile of GPS-derived speeds.
  // 98th-percentile filters isolated GPS spikes without discarding the true peak.
  // Returns null when both sources yield 0 (insufficient data to show meaningfully).
  let maxSpeedKmh: number | null = null;
  if (hasExplicitSpeed && maxSpeedExplicit > 0) {
    maxSpeedKmh = Math.round(maxSpeedExplicit * 10) / 10;
  } else if (gpsSpeedsKmh.length > 0) {
    gpsSpeedsKmh.sort((a, b) => a - b);
    const p98 = gpsSpeedsKmh[Math.min(Math.floor(gpsSpeedsKmh.length * 0.98), gpsSpeedsKmh.length - 1)];
    if (p98 > 0) maxSpeedKmh = Math.round(p98 * 10) / 10;
  }

  return {
    totalDistanceM:  Math.round(totalDistanceM),
    durationSec:     Math.round(durationSec),
    avgSpeedKmh:     Math.round(avgSpeedKmh * 10) / 10,
    maxSpeedKmh,
    elevationGainM:  Math.round(elevationGainM),
    hasHeartRate:    hrCount > 0,
    hrAvg:           hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    hrMax:           hrMax > 0   ? hrMax                       : null,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class ActivityPortraitPlanner {
  /**
   * @param activityPoints  Full array of GPX points (from page.tsx state)
   * @param clipDurationSec Duration of the WA video clip in seconds
   */
  static generatePlan(
    activityPoints: EnhancedGPSPoint[],
    clipDurationSec: number,
  ): StoryPlan {
    const portraitData = computePortraitData(activityPoints);

    // Clip must not exceed the ACTION budget
    const actionDurationSec = Math.min(clipDurationSec, ACTION_BUDGET);

    const segments: StorySegment[] = [
      {
        type:          'INTRO',
        startIndex:    0,
        endIndex:      0,
        durationSec:   INTRO_SEC,
      },
      {
        type:            'ACTION',
        startIndex:      0,
        endIndex:        Math.max(0, activityPoints.length - 1),
        videoStartTime:  0,   // play clip from the very beginning — no seek
        durationSec:     actionDurationSec,
      },
      {
        type:        'BRAND',
        startIndex:  Math.max(0, activityPoints.length - 1),
        endIndex:    Math.max(0, activityPoints.length - 1),
        durationSec: BRAND_SEC,
      },
    ];

    // Minimal NarrativePlan — portrait template does not use acts
    const narrativePlan: NarrativePlan = {
      acts:             [],
      totalDurationSec: INTRO_SEC + actionDurationSec + BRAND_SEC,
      editingRhythm:    'MEDIUM',
    };

    return {
      totalBudgetSec:  INTRO_SEC + actionDurationSec + BRAND_SEC,
      segments,
      activityPoints:  activityPoints as EnhancedGPSPoint[],
      narrativePlan,
      intensityScores: new Float32Array(activityPoints.length),
      detectedScenes:  [],
      templateId:      'activity_portrait',
      portraitData,
    };
  }
}
