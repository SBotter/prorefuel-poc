import { GPSPoint } from "../media/GoProEngineClient";
import { ActionSegment, EnhancedGPSPoint } from "./TelemetryCrossRef";
import { computeIntensity, IntensityResult } from "./IntensityEngine";
import { detectScenes, SceneCandidate } from "./SceneDetector";
import { buildNarrativePlan, NarrativePlan } from "./NarrativePlanner";
import type { StorytellingV2Debug } from "./v2/StorytellingDebug";
import { UnitSystem, SPEED_LABEL } from "../utils/units";

// ─── Feature flag ─────────────────────────────────────────────────────────────
// Set to "V2" to use the new Storytelling V2 engine.
// Set to "V1" to revert to the original engine.
export const STORYTELLING_VERSION: "V1" | "V2" =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_STORYTELLING_V === "V1")
    ? "V1"
    : "V2"; // V2 is now the default

export interface StorySegment {
  type: "INTRO" | "ACTION" | "BRAND";
  startIndex: number;
  endIndex: number;
  videoStartTime?: number;  // In seconds relative to MP4
  durationSec: number;      // How long this segment stays on screen
  title?: string;
  value?: string;
}

// ── Activity Portrait data — GPX aggregate stats for WhatsApp template ────────
export interface ActivityPortraitData {
  totalDistanceM:  number;
  durationSec:     number;
  avgSpeedKmh:     number;
  maxSpeedKmh:     number | null;  // null when GPS data is insufficient to compute reliably
  elevationGainM:  number;
  hasHeartRate:    boolean;
  hrAvg:           number | null;
  hrMax:           number | null;
}

// ── Render quality levels ─────────────────────────────────────────────────────
// Set during story generation. Shown to the user as a friendly notification
// in the READY screen so they understand why the output may differ from ideal.
export type RenderQuality =
  | 'perfect'            // Full GPS sync + scenes selected + full duration
  | 'no_scenes'          // No highlight moments found → full video, no cuts
  | 'alternative_segment'// HEVC probe selected a different section of the video
  | 'portrait_fallback'  // No GPS sync → Activity Portrait (template 2)
  | 'emergency_portrait';// All render attempts failed → Portrait as last resort

export const RENDER_QUALITY_MESSAGES: Record<RenderQuality, { icon: string; text: string; detail: string }> = {
  perfect:             { icon: '', text: '', detail: '' },
  no_scenes:           { icon: '📍', text: 'No highlight moments detected', detail: 'We showed the full video with GPS data instead of selected clips.' },
  alternative_segment: { icon: '⚡', text: 'Video section optimised for your device', detail: 'A different section of your video was used to ensure smooth rendering.' },
  portrait_fallback:   { icon: 'ℹ️', text: 'Activity summary mode', detail: 'The video could not be synced to your GPS track. Showing activity overview instead.' },
  emergency_portrait:  { icon: '⚠️', text: 'Render required an adjustment', detail: 'The selected video section exceeded device limits. Showing activity overview with your video.' },
};

export interface StoryPlan {
  totalBudgetSec: number;
  segments: StorySegment[];
  activityPoints: EnhancedGPSPoint[];
  narrativePlan: NarrativePlan;
  intensityScores: Float32Array;
  detectedScenes: SceneCandidate[];
  /** Quality level set during processing — drives the user-facing notification. */
  renderQuality?: RenderQuality;
  v2Debug?: StorytellingV2Debug;  // populated only when STORYTELLING_VERSION === "V2"
  /** 'activity_portrait' for WhatsApp videos — drives a different rendering path. */
  templateId?: 'standard' | 'activity_portrait';
  /** Populated when templateId === 'activity_portrait'. */
  portraitData?: ActivityPortraitData;
}

// Local extension — carries normalized intensity score from detectAllPeaks to generatePlan
type ScoredActionSegment = ActionSegment & { normalizedScore: number };

export class StorytellingProcessor {
  static generatePlan(activityPoints: EnhancedGPSPoint[], videoPoints: GPSPoint[], unit: UnitSystem = 'metric', clockOffsetMs: number = 0, gpsVideoOffsetMs: number = 0, videoDurationSec: number = 0): StoryPlan {

    // ── V2 routing ───────────────────────────────────────────────────────────
    if (STORYTELLING_VERSION === "V2") {
      const { StorytellingProcessorV2 } = require("./v2/StorytellingProcessorV2");
      return StorytellingProcessorV2.generatePlan(activityPoints, videoPoints, unit, clockOffsetMs, gpsVideoOffsetMs, videoDurationSec);
    }

    const INTRO_SEC     = 6.5;
    const BRAND_SEC     = 3.5;
    const ACTION_BUDGET = 49; // max content budget (59 - 6.5 - 3.5)

    // If the supplied video is shorter than the max budget, honour that — the
    // output will be INTRO + actual_footage + BRAND (< 59s).  When the video is
    // long enough we use the full 49s budget unchanged.
    const effectiveActionBudget = videoDurationSec > 0
      ? Math.min(ACTION_BUDGET, videoDurationSec)
      : ACTION_BUDGET;

    // Short-video fast path: when the video is shorter than the action budget,
    // highlight selection is meaningless — show the full video as-is.
    if (videoDurationSec > 0 && videoDurationSec < ACTION_BUDGET) {
      const videoStart    = videoPoints.length > 0 ? videoPoints[0].time : 0;
      const videoEnd      = videoPoints.length > 0 ? videoPoints[videoPoints.length - 1].time : 0;
      const videoStartGPS = videoStart - clockOffsetMs;
      const videoEndGPS   = videoEnd   - clockOffsetMs;
      const totalPoints   = activityPoints.length;

      const intensity     = computeIntensity(activityPoints);
      const scenes        = detectScenes(activityPoints, intensity, videoStartGPS, videoEndGPS);
      const narrativePlan = buildNarrativePlan(scenes, activityPoints, intensity, ACTION_BUDGET);

      const firstActionIndex = videoStartGPS > 0
        ? Math.max(0, activityPoints.findIndex(p => p.time >= videoStartGPS))
        : Math.floor(totalPoints / 2);
      const vidEndIdx = (() => {
        if (videoEndGPS <= 0) return Math.min(firstActionIndex + 60, totalPoints - 1);
        const idx = activityPoints.findIndex((p, i) => i > firstActionIndex && p.time >= videoEndGPS);
        return idx >= 0 ? idx : Math.min(firstActionIndex + 60, totalPoints - 1);
      })();

      const segments: StorySegment[] = [];
      segments.push({ type: 'INTRO', startIndex: 0, endIndex: 0, durationSec: INTRO_SEC });

      segments.push({
        type: 'ACTION', startIndex: firstActionIndex, endIndex: vidEndIdx,
        videoStartTime: 0, durationSec: Math.min(videoDurationSec, ACTION_BUDGET),
        title: 'FULL RIDE', value: '',
      });
      segments.push({ type: 'BRAND', startIndex: totalPoints - 1, endIndex: totalPoints - 1, durationSec: BRAND_SEC });

      const totalBudgetSec = segments.reduce((s, seg) => s + seg.durationSec, 0);
      console.log(`[ProRefuel] Short-video path: video=${videoDurationSec.toFixed(1)}s → output=${totalBudgetSec.toFixed(1)}s`);
      return { totalBudgetSec, segments, activityPoints, narrativePlan, intensityScores: intensity.scores, detectedScenes: scenes };
    }

    if (activityPoints.length === 0) {
        throw new Error("Activity points required for storytelling.");
    }

    // 1. TIMESTAMPS SYNC
    // videoStart/videoEnd are camera RTC. Activity uses GPS satellite time.
    // videoStartGPS = GPS time at video frame 0.
    const videoStart    = videoPoints.length > 0 ? videoPoints[0].time : 0;
    const videoEnd      = videoPoints.length > 0 ? videoPoints[videoPoints.length - 1].time : 0;
    const videoStartGPS = videoStart - clockOffsetMs;
    const videoEndGPS   = videoEnd   - clockOffsetMs;

    // 2a. INTENSITY ENGINE + SCENE DETECTOR + NARRATIVE PLANNER
    const intensity     = computeIntensity(activityPoints);
    const scenes        = detectScenes(activityPoints, intensity, videoStartGPS, videoEndGPS);
    const narrativePlan = buildNarrativePlan(scenes, activityPoints, intensity, effectiveActionBudget);

    console.log("[ProRefuel] Intensity profile:", intensity.profile);
    console.log("[ProRefuel] Scenes detected:", scenes.map(s => `${s.id}(${s.label})`).join(", "));
    console.log("[ProRefuel] Narrative rhythm:", narrativePlan.editingRhythm);
    console.log("[ProRefuel] Acts:", narrativePlan.acts.map(a => a.act).join(" → "));

    // 2b. PEAK DETECTION — rhythm drives variable clip window size
    const rhythmFactor = narrativePlan.editingRhythm === "FAST" ? 0.8
                       : narrativePlan.editingRhythm === "SLOW" ? 1.3 : 1.0;
    const rawSegments: ScoredActionSegment[] = this.detectAllPeaks(activityPoints, videoStartGPS, videoEndGPS, rhythmFactor, unit, clockOffsetMs, gpsVideoOffsetMs);

    // 3. BUDGET ALLOCATION & STRATEGY SELECTION
    // Calculate required travel speed for a continuous journey
    const totalPoints = activityPoints.length;
    const segments: StorySegment[] = [];

    // Helper: derive display value from scene metadata
    const spdLbl = SPEED_LABEL[unit];
    const valueFromScene = (s: SceneCandidate): string => {
      const m = s.metadata;
      switch (s.id) {
        case "C1": return `${(m.avgGradient  ?? 0).toFixed(1)}%`;
        case "C2": return `${(m.maxSpeed     ?? 0).toFixed(1)} ${spdLbl}`;
        case "C3": return `+${(m.speedDelta  ?? 0).toFixed(1)} ${spdLbl}`;
        case "C4": return `${(m.avgSpeed     ?? 0).toFixed(1)} ${spdLbl}`;
        case "C5": return `${Math.round(m.avgHR ?? 0)} BPM`;
        case "C6": return `${(m.climbGradient ?? 0).toFixed(1)}% → ${(m.descentSpeed ?? 0).toFixed(1)} ${spdLbl}`;
        default:   return "";
      }
    };

    segments.push({ type: "INTRO", startIndex: 0, endIndex: 0, durationSec: INTRO_SEC });

    const firstActionIndex = rawSegments.length > 0
      ? rawSegments[0].startIndex
      : (videoStart > 0
          ? Math.max(0, activityPoints.findIndex(p => p.time >= videoStart))
          : Math.floor(totalPoints / 2));

    let reclaimedBudget = 0;

    for (const narrativeAct of narrativePlan.acts) {
      if (narrativeAct.act === "INTRO" || narrativeAct.act === "OUTRO") continue;

      if (narrativeAct.act === "CLIMAX") {
        if (rawSegments.length > 0) {
          const MIN_CLIP_SEC = 3;
          const MAX_CLIP_SEC = 12;
          const climaxBudget = Math.min(narrativeAct.targetDurationSec, effectiveActionBudget);

          // Budget is the only hard cap — use all detected peaks, best scores first
          const selectedSegs = [...rawSegments]
            .sort((a, b) => b.normalizedScore - a.normalizedScore)
            .filter((_, i) => i * MIN_CLIP_SEC < climaxBudget)
            .sort((a, b) => a.startIndex - b.startIndex); // restore chronological order

          // Proportional budget — higher score = more screen time
          const totalScore = selectedSegs.reduce((s, seg) => s + seg.normalizedScore, 0) || 1;
          let distributed = selectedSegs.map(seg => ({
            seg,
            durationSec: Math.min(MAX_CLIP_SEC, (climaxBudget * seg.normalizedScore) / totalScore),
          }));

          // Remove clips below MIN_CLIP_SEC and redistribute their budget
          const tooShort = distributed.filter(d => d.durationSec < MIN_CLIP_SEC);
          if (tooShort.length > 0) {
            const reclaimedBudget = tooShort.reduce((s, d) => s + d.durationSec, 0);
            distributed = distributed.filter(d => d.durationSec >= MIN_CLIP_SEC);
            const remainScore = distributed.reduce((s, d) => s + d.seg.normalizedScore, 0) || 1;
            distributed = distributed.map(d => ({
              seg: d.seg,
              durationSec: Math.min(MAX_CLIP_SEC, d.durationSec + reclaimedBudget * d.seg.normalizedScore / remainScore),
            }));
          }

          // Budget fill: extend last clip up to the effective budget, but never
          // past the end of the video file.
          const allocatedTotal = distributed.reduce((s, d) => s + d.durationSec, 0);
          const fillGap = climaxBudget - allocatedTotal;
          if (fillGap > 0.1 && distributed.length > 0) {
            const last = distributed[distributed.length - 1];
            if (videoDurationSec > 0) {
              // seekEnd = where this clip ends in the video file
              const seekStart = (gpsVideoOffsetMs / 1000) + (last.seg.videoStartTime ?? 0);
              const canExtend = Math.max(0, videoDurationSec - seekStart - last.durationSec);
              last.durationSec += Math.min(fillGap, canExtend);
            } else {
              last.durationSec += fillGap;
            }
          }

          for (const { seg, durationSec } of distributed) {
            segments.push({
              type:           "ACTION",
              startIndex:     seg.startIndex,
              endIndex:       seg.endIndex,
              videoStartTime: seg.videoStartTime,
              durationSec,
              title:          seg.title,
              value:          seg.value,
            });
          }
        }
      } else {
        reclaimedBudget += narrativeAct.targetDurationSec;
      }
    }

    // Redistribute non-CLIMAX act budget proportionally to ACTION clips
    if (reclaimedBudget > 0) {
      const actionSegs = segments.filter(s => s.type === "ACTION");
      const totalActionDur = actionSegs.reduce((s, seg) => s + seg.durationSec, 0) || 1;
      for (const seg of actionSegs) {
        seg.durationSec += reclaimedBudget * (seg.durationSec / totalActionDur);
      }
    }

    // Fallback: no ACTION segments — use full video with 1.5s trim at each end
    // so the user always receives a rendered output even on short or flat activities.
    if (segments.filter(s => s.type === "ACTION").length === 0 && videoPoints.length > 0) {
      const TRIM_SEC = 1.5;
      const vidIdx = videoStart > 0
        ? Math.max(0, activityPoints.findIndex(p => p.time >= videoStart))
        : Math.floor(activityPoints.length / 2);
      const trimmedDur = videoDurationSec > 0
        ? Math.max(0, videoDurationSec - 2 * TRIM_SEC)
        : effectiveActionBudget;
      const fallbackDur = Math.min(trimmedDur, effectiveActionBudget);
      segments.push({
        type: "ACTION",
        startIndex: vidIdx,
        endIndex: Math.min(vidIdx + 60, activityPoints.length - 1),
        videoStartTime: TRIM_SEC,
        durationSec: fallbackDur,
        title: "RIDE",
        value: "ACTION"
      });
    }

    // --- FINAL SEGMENT: BRAND (unchanged) ---
    segments.push({
      type: "BRAND",
      startIndex: totalPoints - 1,
      endIndex: totalPoints - 1,
      durationSec: BRAND_SEC
    });

    const totalBudgetSec = segments.reduce((s, seg) => s + seg.durationSec, 0);
    return {
      totalBudgetSec,
      segments,
      activityPoints,
      narrativePlan,
      intensityScores: intensity.scores,
      detectedScenes: scenes,
    };
  }

  private static detectAllPeaks(
    activityPoints: EnhancedGPSPoint[],
    videoStart: number,   // GPS satellite time of video start
    videoEnd: number,     // GPS satellite time of video end
    rhythmFactor: number,
    unit: UnitSystem = 'metric',
    clockOffsetMs: number = 0,
    gpsVideoOffsetMs: number = 0,
  ): ScoredActionSegment[] {
    if (activityPoints.length === 0 || videoStart === 0) return [];
    const spdLbl = SPEED_LABEL[unit];

    // 1. Calculate Global Averages for Normalization
    let sumSpeed = 0, sumHr = 0, sumPower = 0, countHr = 0, countPower = 0;
    activityPoints.forEach(p => {
        sumSpeed += (p.speed || 0);
        if (p.hr) { sumHr += p.hr; countHr++; }
        if (p.power) { sumPower += p.power; countPower++; }
    });
    const avgSpeed = sumSpeed / activityPoints.length || 10;
    const avgHr = countHr > 0 ? (sumHr / countHr) : 130;
    const avgPower = countPower > 0 ? (sumPower / countPower) : 200;

    // 2. Filter Action Range (where video exists)
    const actionRange = activityPoints.filter(p => p.time >= videoStart && p.time <= videoEnd);
    if (actionRange.length < 15) return [];

    // 3. Pre-process Elevation (Smoothing)
    const smoothedEle = actionRange.map((p, i) => {
        let sum = 0, count = 0;
        for (let j = Math.max(0, i-2); j <= Math.min(actionRange.length-1, i+2); j++) {
            sum += actionRange[j].ele;
            count++;
        }
        return sum / count;
    });

    // 4. Calculate Intensity Score & Grade per Point
    interface ScoredPoint extends EnhancedGPSPoint {
        intensity: number;
        grade: number;
        hrDelta: number;
    }
    const scoredPoints: ScoredPoint[] = actionRange.map((p, i) => {
        const prev = actionRange[Math.max(0, i-10)];
        const eleDiff = smoothedEle[i] - smoothedEle[Math.max(0, i-10)];
        const distDiff = this.crudeDistance(p, prev);
        const grade = distDiff > 10 ? (eleDiff / distDiff) * 100 : 0;
        const hrDelta = (p.hr || 0) - (prev.hr || 0);

        // MOTION ANALYSIS: Accelerometer Z-axis (Bumps) and Gyro (Turns)
        // Magnitude of deviation from gravity (approx 9.8 or 0 if centered)
        const accelMotion = p.accel ? Math.abs(p.accel - 9.8) : 0;
        const gyroMotion = p.gyro ? Math.abs(p.gyro) : 0;
        const motionBonus = (accelMotion * 0.2) + (gyroMotion * 0.05);

        const speedRatio  = (p.speed || 0) / avgSpeed;
        const hrRatio     = p.hr    ? (p.hr    / avgHr)    : 1;
        const powerRatio  = p.power ? (p.power / avgPower) : 1;

        // Base formula: speed × grade bonus + HR + power + motion
        let intensity = (speedRatio * (1 + Math.abs(grade) / 12)) + (hrRatio * 0.3) + (powerRatio * 0.3) + motionBonus;

        // Technical descent bonus: slow speed on negative grade = braking / difficult terrain.
        // Without this, low speedRatio suppresses the score even on steep descents.
        // Target weight: equal to or higher than a fast descent (DOWNHILL FLYER).
        //   DOWNHILL FLYER example (speed=1.5×, grade=-5%) base ≈ 2.7
        //   Tech descent  example (speed=0.6×, grade=-8%) base ≈ 1.6 → with bonus ≈ 3.3
        if (grade < -3 && speedRatio < 0.9) {
            const gradeBonus  = (Math.abs(grade) / 8) * 1.4;   // steeper = much higher bonus
            const brakeBonus  = (1 - speedRatio) * 0.7;        // slower relative to avg = harder braking
            intensity += gradeBonus + brakeBonus;
        }

        return { ...p, intensity, grade, hrDelta, accelMotion };
    });

    // 5. Detect Candidates (Multiple Local Maxima)
    // We search for centers of high-intensity windows across the entire range
    const candidates: { pt: ScoredPoint; title: string; value: string; score: number }[] = [];
    
    for (let i = 25; i < scoredPoints.length - 25; i++) {
        const p = scoredPoints[i];
        
        // Local Maxima detection: is this point the highest in its +/- 20s neighborhood?
        let isLocalMax = true;
        for (let j = i - 20; j <= i + 20; j++) {
            if (scoredPoints[j] && scoredPoints[j].intensity > p.intensity) {
                isLocalMax = false;
                break;
            }
        }

        if (isLocalMax && p.intensity > 1.3) {
            // "Boring Filter": Reject slow climbs unless they have extreme HR or other factors
            const isSlowClimb = p.grade > 4 && (p.speed || 0) < (avgSpeed * 0.8);
            if (isSlowClimb && p.intensity < 2.5) continue; 

            // Identify Scenario
            let title = "ACTION DYNAMICS";
            let value = `${(p.intensity * 10).toFixed(0)} SCORE`;

            if (p.grade < -4 && (p.speed || 0) > avgSpeed * 1.5) {
                title = "DOWNHILL FLYER";
                value = `${(p.speed || 0).toFixed(1)} ${spdLbl} (${p.grade.toFixed(1)}%)`;
            } else if (p.grade < -3 && (p.speed || 0) < avgSpeed * 0.9) {
                // Slow speed + negative grade = braking on descent = technical/cinematic
                title = "TECHNICAL DESCENT";
                value = `${Math.abs(p.grade).toFixed(1)}% — ${(p.speed || 0).toFixed(1)} ${spdLbl}`;
            } else if (p.grade > 4 && (p.speed || 0) > avgSpeed * 1.1) {
                title = "POWER ATTACK";
                value = `${(p.speed || 0).toFixed(1)} ${spdLbl} (${p.grade.toFixed(1)}%)`;
            } else if (p.grade < -5 && p.hrDelta > 2) {
                // HR rising on descent = emergency braking or very technical corner
                title = "TECHNICAL DESCENT";
                value = `${p.hr} BPM (${p.grade.toFixed(1)}%)`;
            } else if (p.grade > 8) {
                title = "STEEP CLIMB";
                value = `${p.grade.toFixed(1)}% GRADE`;
            }

            candidates.push({ pt: p, title, value, score: p.intensity });
        }
    }

    // 6. Winner Selection (Editorial Selection)
    // Sort by intensity score and pick top N while keeping a minimum distance between them
    candidates.sort((a, b) => b.score - a.score);

    const winners: { pt: ScoredPoint; title: string; value: string; score: number }[] = [];
    const MIN_GAP_MS = 10000; // 10s minimum gap between clip centers — allow dense coverage

    candidates.forEach(c => {
        const tooClose = winners.some(w => Math.abs(w.pt.time - c.pt.time) < MIN_GAP_MS);
        if (!tooClose && winners.length < 15) {
            winners.push(c);
        }
    });

    // Normalize winner scores to [0, 1] for clip duration and budget weighting
    const maxWinScore = winners.length > 0 ? Math.max(...winners.map(w => w.score)) : 1;
    const minWinScore = winners.length > 0 ? Math.min(...winners.map(w => w.score)) : 0;
    const scoreRange  = Math.max(maxWinScore - minWinScore, 0.01);

    const segments: ScoredActionSegment[] = [];
    const createSeg = (w: { pt: ScoredPoint; title: string; value: string; score: number }) => {
        const normalizedScore = (w.score - minWinScore) / scoreRange;
        // Clip window: 4s (low intensity) to 12s (max), scaled by rhythm — shorter = more clips
        const clipSec = Math.round((4 + normalizedScore * 8) * rhythmFactor);
        const radiusMs = (clipSec / 2) * 1000;

        const tStart = w.pt.time - radiusMs;
        const tEnd = w.pt.time + radiusMs;

        const sIdx = activityPoints.findIndex(p => p.time >= tStart);
        const eIdx = activityPoints.findIndex(p => p.time >= tEnd);

        if (sIdx !== -1 && eIdx !== -1) {
            segments.push({
                startIndex: sIdx,
                endIndex: eIdx,
                startPoint: activityPoints[sIdx],
                endPoint: activityPoints[eIdx],
                // videoStart is GPS satellite time; activityPoints[sIdx].time also GPS satellite.
                // Both same domain → (GPS_time - videoStart_GPS) / 1000 = video seek in seconds.
                // Do NOT clamp to gpsVideoOffsetMs — breaks startIndex/videoStartTime invariant.
                videoStartTime: Math.max(0, (activityPoints[sIdx].time - videoStart) / 1000),
                duration: clipSec,
                normalizedScore,
                title: w.title,
                value: w.value
            });
        }
    };

    winners.forEach(w => createSeg(w));

    // Clean up overflows/overlaps if any
    const unique: ScoredActionSegment[] = [];
    segments.sort((a,b) => a.startIndex - b.startIndex).forEach(s => {
       const overlap = unique.some(u => s.startIndex < u.endIndex && s.endIndex > u.startIndex);
       if (!overlap) unique.push(s);
    });

    return unique;
  }



  private static crudeDistance(p1: GPSPoint, p2: GPSPoint): number {
    const R = 6371e3;
    const φ1 = (p1.lat * Math.PI) / 180;
    const φ2 = (p2.lat * Math.PI) / 180;
    const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
    const Δλ = ((p2.lon - p1.lon) * Math.PI) / 180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

