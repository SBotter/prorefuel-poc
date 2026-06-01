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

// ── Aggregate stats from raw activity points ───────────────────────────────────
function computePortraitData(points: EnhancedGPSPoint[]): ActivityPortraitData {
  let totalDistanceM = 0;
  let maxSpeedKmh    = 0;
  let elevationGainM = 0;
  let hrSum          = 0;
  let hrCount        = 0;
  let hrMax          = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i] as any;

    // Distance
    if (i > 0) {
      const prev = points[i - 1];
      totalDistanceM += haversineM(prev.lat, prev.lon, p.lat, p.lon);
    }

    // Speed
    const spd = (p.speed ?? p.speedSmoothed ?? 0) as number;
    if (spd > maxSpeedKmh) maxSpeedKmh = spd;

    // Elevation gain (only positive deltas)
    if (i > 0) {
      const dEle = p.ele - (points[i - 1] as any).ele;
      if (dEle > 0) elevationGainM += dEle;
    }

    // Heart rate
    const hr = (p.hr ?? 0) as number;
    if (hr > 0) {
      hrSum += hr;
      hrCount++;
      if (hr > hrMax) hrMax = hr;
    }
  }

  const durationSec = points.length > 1
    ? (points[points.length - 1].time - points[0].time) / 1000
    : 0;

  const avgSpeedKmh = durationSec > 0
    ? (totalDistanceM / 1000) / (durationSec / 3600)
    : 0;

  return {
    totalDistanceM:  Math.round(totalDistanceM),
    durationSec:     Math.round(durationSec),
    avgSpeedKmh:     Math.round(avgSpeedKmh * 10) / 10,
    maxSpeedKmh:     Math.round(maxSpeedKmh * 10) / 10,
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
