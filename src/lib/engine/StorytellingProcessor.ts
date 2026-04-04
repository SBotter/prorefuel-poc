import { GPSPoint } from "../media/GoProEngineClient";
import { ActionSegment, EnhancedGPSPoint } from "./TelemetryCrossRef";
import { computeIntensity, IntensityResult } from "./IntensityEngine";
import { detectScenes, SceneCandidate } from "./SceneDetector";
import { buildNarrativePlan, NarrativePlan } from "./NarrativePlanner";

export interface StorySegment {
  type: "INTRO" | "ACTION" | "MAP" | "BRAND";
  startIndex: number;
  endIndex: number;
  videoStartTime?: number;  // In seconds relative to MP4
  durationSec: number;      // How long this segment stays on screen
  mapSpeedFactor?: number;  // realDurationSec / durationSec — how fast the map must fly
  title?: string;
  value?: string;
}

export interface StoryPlan {
  totalBudgetSec: number;
  isLongActivity: boolean;
  segments: StorySegment[];
  activityPoints: EnhancedGPSPoint[];
  narrativePlan: NarrativePlan;
  intensityScores: Float32Array;
  detectedScenes: SceneCandidate[];
}

// Local extension — carries normalized intensity score from detectAllPeaks to generatePlan
type ScoredActionSegment = ActionSegment & { normalizedScore: number };

export class StorytellingProcessor {
  static generatePlan(activityPoints: EnhancedGPSPoint[], videoPoints: GPSPoint[]): StoryPlan {
    const TOTAL_BUDGET = 59;
    const INTRO_SEC = 6.5;
    const BRAND_SEC = 3.5;
    const ACTION_BUDGET = TOTAL_BUDGET - INTRO_SEC - BRAND_SEC; // 49s

    if (activityPoints.length === 0) {
        throw new Error("Activity points required for storytelling.");
    }

    // 1. TIMESTAMPS SYNC
    const videoStart = videoPoints.length > 0 ? videoPoints[0].time : 0;
    const videoEnd = videoPoints.length > 0 ? videoPoints[videoPoints.length - 1].time : 0;

    // 2a. INTENSITY ENGINE + SCENE DETECTOR + NARRATIVE PLANNER
    const intensity = computeIntensity(activityPoints);
    const scenes    = detectScenes(activityPoints, intensity, videoStart, videoEnd);
    // Pass ACTION_BUDGET (49s) — NarrativePlanner fills exactly this; INTRO+BRAND are added by this class
    const narrativePlan = buildNarrativePlan(scenes, activityPoints, intensity, ACTION_BUDGET);

    console.log("[ProRefuel] Intensity profile:", intensity.profile);
    console.log("[ProRefuel] Scenes detected:", scenes.map(s => `${s.id}(${s.label})`).join(", "));
    console.log("[ProRefuel] Narrative rhythm:", narrativePlan.editingRhythm);
    console.log("[ProRefuel] Acts:", narrativePlan.acts.map(a => a.act).join(" → "));

    // 2b. PEAK DETECTION — rhythm drives variable clip window size
    const rhythmFactor = narrativePlan.editingRhythm === "FAST" ? 0.8
                       : narrativePlan.editingRhythm === "SLOW" ? 1.3 : 1.0;
    const rawSegments: ScoredActionSegment[] = this.detectAllPeaks(activityPoints, videoStart, videoEnd, rhythmFactor);

    // 3. BUDGET ALLOCATION & STRATEGY SELECTION
    // Calculate required travel speed for a continuous journey
    const totalPoints = activityPoints.length;
    const highlightPointsCount = rawSegments.reduce((acc, s) => acc + (s.endIndex - s.startIndex), 0);
    const mapPointsCount = Math.max(0, totalPoints - highlightPointsCount);
    const availableMapTime = ACTION_BUDGET - (highlightPointsCount / 1); // assumes 1Hz action
    const mapSpeed = availableMapTime > 0 ? (mapPointsCount / availableMapTime) : 100;
    
    const isLongActivity = mapSpeed > 10;
    const segments: StorySegment[] = [];

    // Helper: derive display value from scene metadata
    const valueFromScene = (s: SceneCandidate): string => {
      const m = s.metadata;
      switch (s.id) {
        case "C1": return `${(m.avgGradient  ?? 0).toFixed(1)}%`;
        case "C2": return `${(m.maxSpeed     ?? 0).toFixed(1)} KM/H`;
        case "C3": return `+${(m.speedDelta  ?? 0).toFixed(1)} KM/H`;
        case "C4": return `${(m.avgSpeed     ?? 0).toFixed(1)} KM/H`;
        case "C5": return `${Math.round(m.avgHR ?? 0)} BPM`;
        case "C6": return `${(m.climbGradient ?? 0).toFixed(1)}% → ${(m.descentSpeed ?? 0).toFixed(1)} KM/H`;
        default:   return "";
      }
    };

    // --- SEGMENT 0: INTRO (unchanged) ---
    segments.push({
      type: "INTRO",
      startIndex: 0,
      endIndex: 0,
      durationSec: INTRO_SEC
    });

    // --- JOURNEY ANCHORS for MAP segments ---
    // firstActionIndex: activity point where the first video clip begins
    // lastActionEndIndex: activity point where the last video clip ends
    // MAP acts before CLIMAX fly the map 0 → firstActionIndex (approaching the video)
    // MAP acts after CLIMAX fly the map lastActionEndIndex → end (riding away)
    const firstActionIndex = rawSegments.length > 0
      ? rawSegments[0].startIndex
      : (videoStart > 0
          ? Math.max(0, activityPoints.findIndex(p => p.time >= videoStart))
          : Math.floor(totalPoints / 2));
    const lastActionEndIndex = rawSegments.length > 0
      ? rawSegments[rawSegments.length - 1].endIndex
      : Math.min(firstActionIndex + 60, totalPoints - 1);

    // Total budget of MAP acts before CLIMAX — drives proportional journey slicing
    const preclimaxMapBudget = narrativePlan.acts.reduce((sum, a) => {
      if (a.act === "INTRO" || a.act === "OUTRO" || a.act === "CLIMAX" || a.act === "RELIEF") return sum;
      return sum + a.targetDurationSec;
    }, 0);

    let seenClimax           = false;
    let preclimaxCursor      = 0;   // running start index within 0→firstActionIndex
    let preclimaxFracUsed    = 0;   // cumulative fraction of preclimaxMapBudget consumed
    // MAP segments skipped due to isLongActivity — budget returned to ACTION clips
    let reclaimedMapBudget   = 0;

    // --- NARRATIVE ACTS → StorySegments ---
    // MAP acts: journey-based linear fly-through toward/away from the video
    // CLIMAX:   rawSegments from detectAllPeaks (guaranteed inside video window)
    for (const narrativeAct of narrativePlan.acts) {
      if (narrativeAct.act === "INTRO" || narrativeAct.act === "OUTRO") continue;

      if (narrativeAct.act === "CLIMAX") {
        seenClimax = true;

        // ACTION clips from detectAllPeaks — within video window, budget-aware
        if (rawSegments.length > 0) {
          const MIN_CLIP_SEC = 4;
          const MAX_CLIP_SEC = 20;
          const climaxBudget = narrativeAct.targetDurationSec;

          // Cap clip count so every clip gets at least MIN_CLIP_SEC on screen
          const maxClips = Math.max(1, Math.floor(climaxBudget / MIN_CLIP_SEC));
          const selectedSegs = [...rawSegments]
            .sort((a, b) => b.normalizedScore - a.normalizedScore)
            .slice(0, maxClips)
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
        // If rawSegments is empty, the fallback below handles it

      } else {
        // MAP segment — linear journey, not arbitrary scene positions

        // Long activity guard: if the map would need to fly faster than 8× real speed,
        // it produces a disorienting blur. Discard the MAP segment and return its budget
        // to ACTION clips. The mini-map widget already shows position during ACTION.
        if (isLongActivity) {
          reclaimedMapBudget += narrativeAct.targetDurationSec;
          // Keep cursor in sync even though we skip
          if (!seenClimax) {
            const actFrac = preclimaxMapBudget > 0
              ? narrativeAct.targetDurationSec / preclimaxMapBudget : 1;
            preclimaxFracUsed += actFrac;
            preclimaxCursor = Math.min(Math.round(firstActionIndex * preclimaxFracUsed), firstActionIndex);
          }
          continue;
        }

        let segStartIndex: number;
        let segEndIndex: number;

        if (!seenClimax) {
          // Pre-CLIMAX: proportional slice of 0 → firstActionIndex
          const actFrac   = preclimaxMapBudget > 0
            ? narrativeAct.targetDurationSec / preclimaxMapBudget
            : 1;
          const cumFrac   = preclimaxFracUsed + actFrac;
          segStartIndex   = preclimaxCursor;
          segEndIndex     = Math.min(Math.round(firstActionIndex * cumFrac), firstActionIndex);
          preclimaxFracUsed = cumFrac;
          preclimaxCursor   = segEndIndex;
        } else {
          // Post-CLIMAX (RELIEF): map shows the ride continuing after the video
          segStartIndex = lastActionEndIndex;
          segEndIndex   = totalPoints - 1;
        }

        // Skip degenerate segments
        if (segEndIndex - segStartIndex < 2) continue;

        // Compute how fast the map must fly to cover this real-world distance in durationSec
        const realSec        = (activityPoints[segEndIndex].time - activityPoints[segStartIndex].time) / 1000;
        const mapSpeedFactor = realSec > 0 ? realSec / narrativeAct.targetDurationSec : 1;

        segments.push({
          type:           "MAP",
          startIndex:     segStartIndex,
          endIndex:       segEndIndex,
          durationSec:    narrativeAct.targetDurationSec,
          mapSpeedFactor,
          value:          narrativeAct.scenes[0] ? valueFromScene(narrativeAct.scenes[0]) : undefined,
        });
      }
    }

    // Redistribute MAP budget reclaimed from long-activity skips → ACTION clips get more screen time
    if (reclaimedMapBudget > 0) {
      const actionSegs = segments.filter(s => s.type === "ACTION");
      const totalActionDur = actionSegs.reduce((s, seg) => s + seg.durationSec, 0) || 1;
      for (const seg of actionSegs) {
        seg.durationSec += reclaimedMapBudget * (seg.durationSec / totalActionDur);
      }
      console.log(`[ProRefuel] Long activity: redistributed ${reclaimedMapBudget.toFixed(1)}s from MAP → ${actionSegs.length} ACTION clips`);
    }

    // Fallback: no ACTION segments (rawSegments empty = no video GPS or no peaks found)
    if (segments.filter(s => s.type === "ACTION").length === 0 && videoPoints.length > 0) {
      // Anchor the activity index to the start of the video so map/telemetry stay in sync
      const vidIdx = videoStart > 0
        ? Math.max(0, activityPoints.findIndex(p => p.time >= videoStart))
        : Math.floor(activityPoints.length / 2);
      segments.push({
        type: "ACTION",
        startIndex: vidIdx,
        endIndex: Math.min(vidIdx + 60, activityPoints.length - 1),
        videoStartTime: 0,
        durationSec: narrativePlan.acts.find(a => a.act === "CLIMAX")?.targetDurationSec ?? Math.round(ACTION_BUDGET * 0.30),
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

    return {
      totalBudgetSec: TOTAL_BUDGET,
      isLongActivity,
      segments,
      activityPoints,
      narrativePlan,
      intensityScores: intensity.scores,
      detectedScenes: scenes,
    };
  }

  private static detectAllPeaks(
    activityPoints: EnhancedGPSPoint[],
    videoStart: number,
    videoEnd: number,
    rhythmFactor: number,
  ): ScoredActionSegment[] {
    if (activityPoints.length === 0 || videoStart === 0) return [];
    
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

        // FORMULA 2.0: Intensity = SpeedRatio * (1 + absGrade/15) + HrRatio + MotionBonus
        const speedRatio = (p.speed || 0) / avgSpeed;
        const hrRatio = p.hr ? (p.hr / avgHr) : 1;
        const powerRatio = p.power ? (p.power / avgPower) : 1;
        
        // Motion and Speed are the primary "Action" drivers
        let intensity = (speedRatio * (1 + Math.abs(grade)/12)) + (hrRatio * 0.3) + (powerRatio * 0.3) + motionBonus;

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
                value = `${(p.speed || 0).toFixed(1)} KM/H (${p.grade.toFixed(1)}%)`;
            } else if (p.grade > 4 && (p.speed || 0) > avgSpeed * 1.1) {
                title = "POWER ATTACK";
                value = `${(p.speed || 0).toFixed(1)} KM/H (${p.grade.toFixed(1)}%)`;
            } else if (p.grade < -5 && p.hrDelta > 2) {
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
    // Sort by intensity score and pick top N while keeping a distance of 30s between them
    candidates.sort((a, b) => b.score - a.score);
    
    const winners: { pt: ScoredPoint; title: string; value: string; score: number }[] = [];
    const MIN_GAP_MS = 25000; // 25s gap between clip centers

    candidates.forEach(c => {
        const tooClose = winners.some(w => Math.abs(w.pt.time - c.pt.time) < MIN_GAP_MS);
        if (!tooClose && winners.length < 8) {
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
        // MUDANÇA 1: variable clip window — 8s (low intensity) to 18s (max), scaled by rhythm
        const clipSec = Math.round((8 + normalizedScore * 10) * rhythmFactor);
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
                videoStartTime: (activityPoints[sIdx].time - videoStart) / 1000,
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

