// ─── StorytellingProcessorV2 ─────────────────────────────────────────────────
// New main pipeline for Storytelling Phase 1.
//
// WHAT CHANGED vs V1:
//   1. IntensityEngineV2: masterScore = intensity × (α + (1-α) × eventfulness)
//   2. SceneDetectorV2:   adaptive percentile thresholds, top-3 per type
//   3. VideoOverlapCalculator: hybrid overlap score (IoU + centrality + decay)
//   4. CompositeScoring: floored multiplicative formula
//   5. ACTION clip selection: uses V2 composite-scored candidates instead of V1's detectAllPeaks
//
// WHAT STAYS THE SAME (Phase 1 is low-risk):
//   - MAP segment structure (NarrativePlanner V1 still drives MAP budget allocation)
//   - Time budget (59s total: 6.5s INTRO, ~49s ACTION, 3.5s BRAND)
//   - Output interface (StoryPlan) — fully compatible with MapEngine.tsx
//
// V2 debug output is attached as optional field: storyPlan.v2Debug

import { GPSPoint } from '../../media/GoProEngineClient';
import { ActionSegment, EnhancedGPSPoint } from '../TelemetryCrossRef';
import { UnitSystem, SPEED_LABEL } from '../../utils/units';
import { computeIntensity } from '../IntensityEngine';
import { detectScenes } from '../SceneDetector';
import { buildNarrativePlan } from '../NarrativePlanner';
import { StoryPlan, StorySegment } from '../StorytellingProcessor';

import { computeIntensityV2, IntensityV2Result }       from './IntensityEngineV2';
import { computeActivityPercentiles }                  from './PercentileCalculator';
import { detectScenesV2, SceneCandidateV2, getSensorLimitations } from './SceneDetectorV2';
import { applyVideoOverlapScores }                     from './VideoOverlapCalculator';
import { applyCompositeScores, sortByCompositeScore, filterActionCandidates } from './CompositeScoring';
import { buildStorytellingDebug, logStorytellingDebug, StorytellingV2Debug } from './StorytellingDebug';

// ─── V2 action segment type ───────────────────────────────────────────────────

type ScoredActionSegmentV2 = ActionSegment & { normalizedScore: number };

// ─── Internal: format display values from V2 candidates ───────────────────────

function labelFromCandidate(c: SceneCandidateV2, unit: UnitSystem): { title: string; value: string } {
  const m = c.metadata;
  const spdLbl = SPEED_LABEL[unit];
  switch (c.type) {
    case 'CLIMB':    return { title: 'BRUTAL CLIMB',      value: `${(m.avgGradient  ?? 0).toFixed(1)}%`                                                    };
    case 'DESCENT':  return { title: 'WILD DESCENT',      value: `${(m.maxSpeed     ?? 0).toFixed(1)} ${spdLbl}`                                           };
    case 'SPRINT':   return { title: 'SPRINT',            value: `+${(m.speedDelta  ?? 0).toFixed(1)} ${spdLbl}`                                           };
    case 'TECHNICAL':return { title: 'TECHNICAL',         value: `${(m.avgSpeed     ?? 0).toFixed(1)} ${spdLbl}`                                           };
    case 'SUFFER':   return { title: 'RED ZONE',          value: `${Math.round(m.avgHR ?? 0)} BPM`                                                         };
    case 'CONTRAST': return { title: 'FLOW',              value: `${(m.climbGradient ?? 0).toFixed(1)}% → ${(m.descentSpeed ?? 0).toFixed(1)} ${spdLbl}`  };
    default:         return { title: c.label,             value: ''                                                                                         };
  }
}

// ─── Internal: Haversine distance ─────────────────────────────────────────────

function crudeDistance(p1: GPSPoint, p2: GPSPoint): number {
  const R = 6371e3;
  const φ1 = (p1.lat * Math.PI) / 180, φ2 = (p2.lat * Math.PI) / 180;
  const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const Δλ = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Internal: video-window cinematic scan ────────────────────────────────────
// When no typed V2 candidates fall INSIDE the video window, scan the video
// window directly for the best cinematic moments.
//
// Scoring formula (per 10s window):
//   cinematicScore = 0.50 × normPeakSpeed     ← fast moments look great on camera
//                  + 0.30 × normAbsGradient   ← climbs & descents = dramatic
//                  + 0.20 × masterScoreMean   ← V2 intensity signal as tiebreaker
//
// All components normalized to [0,1] relative to the video window's own P90/P10
// so the scorer is adaptive to how fast/hilly this particular video segment is.
//
// Labeled clips:
//   - If peak speed ≥ P85 of window AND gradient < -2%  → "DESCENT"
//   - If peak speed ≥ P85 of window AND gradient ≥  0%  → "SPRINT"
//   - If abs gradient mean > 5%                         → "CLIMB"
//   - Otherwise                                         → "RIDE"

function selectClipsFromVideoWindow(
  activityPoints:   EnhancedGPSPoint[],
  intensityV2:      IntensityV2Result,
  videoStart:       number,
  videoEnd:         number,
  actionBudget:     number,
  unit:             UnitSystem,
  gpsVideoOffsetMs: number = 0,
): { clips: ScoredActionSegmentV2[]; reason: string } {

  // ── 1. Extract activity points inside the video time window ──────────────
  const videoSlice = activityPoints
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.time >= videoStart && p.time <= videoEnd);

  console.log(`[ProRefuel V2] Cinematic scan: ${videoSlice.length} pts in [${new Date(videoStart).toISOString()} → ${new Date(videoEnd).toISOString()}]`);

  if (videoSlice.length < 4) {
    const actStart = activityPoints.length > 0 ? new Date(activityPoints[0].time).toISOString() : 'n/a';
    const actEnd   = activityPoints.length > 0 ? new Date(activityPoints[activityPoints.length - 1].time).toISOString() : 'n/a';
    console.warn(`[ProRefuel V2] Cinematic scan: insufficient overlap. Activity: [${actStart} → ${actEnd}], Video: [${new Date(videoStart).toISOString()} → ${new Date(videoEnd).toISOString()}]`);
    return { clips: [], reason: 'insufficient activity points inside video window' };
  }

  const n       = videoSlice.length;
  const first   = videoSlice[0];
  const last    = videoSlice[n - 1];
  const spanSec = Math.max(1, (last.p.time - first.p.time) / 1000);
  const sps     = (n - 1) / spanSec;

  const WIN_PTS  = Math.max(2, Math.round(10 * sps)); // 10s window
  const MIN_GAP  = Math.max(1, Math.round(30 * sps)); // 30s min gap between clips
  const MAX_CLIPS = Math.max(1, Math.floor(actionBudget / 8)); // ~6 clips for 49s

  // ── 2. Per-point signals ─────────────────────────────────────────────────
  const speedArr  = new Float32Array(n);
  const gradArr   = new Float32Array(n); // % gradient, signed
  const masterArr = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    speedArr[i]  = videoSlice[i].p.speed ?? 0;
    masterArr[i] = intensityV2.masterScore[videoSlice[i].i] ?? 0;
  }

  // Gradient: elevation change / horizontal distance
  for (let i = 1; i < n; i++) {
    const p1 = videoSlice[i - 1].p, p2 = videoSlice[i].p;
    const R  = 6371e3;
    const φ1 = (p1.lat * Math.PI) / 180, φ2 = (p2.lat * Math.PI) / 180;
    const dφ = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dλ = ((p2.lon - p1.lon) * Math.PI) / 180;
    const a  = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    const d  = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    gradArr[i] = d > 0.5 ? ((p2.ele - p1.ele) / d) * 100 : gradArr[i - 1];
  }
  gradArr[0] = gradArr[1] ?? 0;

  // ── 3. Normalization anchors (P10 / P85 / P90 relative to this video window) ─
  const sortedSpeed = [...speedArr].sort((a, b) => a - b);
  const p85Speed    = sortedSpeed[Math.floor(n * 0.85)] ?? sortedSpeed[sortedSpeed.length - 1];
  const p10Speed    = sortedSpeed[Math.floor(n * 0.10)] ?? 0;
  const speedRange  = Math.max(1, p85Speed - p10Speed);

  const absGrads    = [...gradArr].map(Math.abs).sort((a, b) => a - b);
  const p90Grad     = absGrads[Math.floor(n * 0.90)] ?? absGrads[absGrads.length - 1];
  const gradRange   = Math.max(0.1, p90Grad);

  const sortedMaster = [...masterArr].sort((a, b) => a - b);
  const p90Master    = sortedMaster[Math.floor(n * 0.90)] ?? 1;
  const masterRange  = Math.max(0.01, p90Master);

  // ── 4. Prefix sums for fast window aggregates ─────────────────────────────
  const prefixSpeed  = new Float64Array(n + 1);
  const prefixGrad   = new Float64Array(n + 1); // sum of |gradient|
  const prefixMaster = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefixSpeed[i + 1]  = prefixSpeed[i]  + speedArr[i];
    prefixGrad[i + 1]   = prefixGrad[i]   + Math.abs(gradArr[i]);
    prefixMaster[i + 1] = prefixMaster[i] + masterArr[i];
  }
  const winMean = (prefix: Float64Array, s: number, e: number) =>
    (prefix[e + 1] - prefix[s]) / (e - s + 1);

  // Peak speed in window (max, not mean — captures acceleration bursts)
  const winPeakSpeed = (s: number, e: number) => {
    let mx = 0;
    for (let k = s; k <= e; k++) if (speedArr[k] > mx) mx = speedArr[k];
    return mx;
  };

  // Mean signed gradient in window (positive = climb, negative = descent)
  const winMeanGrad = (s: number, e: number) => {
    let sum = 0;
    for (let k = s; k <= e; k++) sum += gradArr[k];
    return sum / (e - s + 1);
  };

  // ── 5. Score every window ─────────────────────────────────────────────────
  const windows: { localStart: number; score: number; peakSpd: number; meanGrad: number }[] = [];

  for (let i = 0; i + WIN_PTS <= n; i++) {
    const e          = i + WIN_PTS - 1;
    const peakSpd    = winPeakSpeed(i, e);
    const absGrdMean = winMean(prefixGrad, i, e);
    const masterMean = winMean(prefixMaster, i, e);

    const normSpd    = Math.min(1, Math.max(0, (peakSpd    - p10Speed)  / speedRange));
    const normGrad   = Math.min(1, Math.max(0,  absGrdMean              / gradRange));
    const normMaster = Math.min(1, Math.max(0,  masterMean              / masterRange));

    const score = 0.50 * normSpd + 0.30 * normGrad + 0.20 * normMaster;
    windows.push({ localStart: i, score, peakSpd, meanGrad: winMeanGrad(i, e) });
  }

  if (windows.length === 0) {
    return { clips: [], reason: 'video window too short for cinematic scan' };
  }

  // ── 6. Greedy top-N with minimum gap ─────────────────────────────────────
  const sorted = [...windows].sort((a, b) => b.score - a.score);
  const chosen: typeof windows[number][] = [];
  for (const w of sorted) {
    if (chosen.length >= MAX_CLIPS) break;
    if (chosen.some(c => Math.abs(c.localStart - w.localStart) < MIN_GAP)) continue;
    chosen.push(w);
  }

  if (chosen.length === 0) {
    return { clips: [], reason: 'greedy picker returned no windows' };
  }

  // ── 7. Label each clip by its dominant characteristic ─────────────────────
  const spdLbl = SPEED_LABEL[unit];
  function clipLabel(w: typeof chosen[number]): { title: string; value: string } {
    if (w.peakSpd >= p85Speed && w.meanGrad < -2)
      return { title: 'DESCENT', value: `${w.peakSpd.toFixed(1)} ${spdLbl}` };
    if (w.peakSpd >= p85Speed && w.meanGrad >= 0)
      return { title: 'SPRINT',  value: `${w.peakSpd.toFixed(1)} ${spdLbl}` };
    if (Math.abs(w.meanGrad) > 5)
      return { title: w.meanGrad > 0 ? 'CLIMB' : 'DESCENT', value: `${w.meanGrad.toFixed(1)}%` };
    return { title: 'RIDE', value: `${w.peakSpd.toFixed(1)} ${spdLbl}` };
  }

  // ── 8. Build clips — proportional budget by score ─────────────────────────
  const totalScore   = chosen.reduce((s, w) => s + w.score, 0) || 1;
  const MIN_CLIP_SEC = 4;
  const MAX_CLIP_SEC = 15;

  const clips: ScoredActionSegmentV2[] = chosen
    .sort((a, b) => a.localStart - b.localStart) // chronological
    .map(w => {
      const localEnd = Math.min(w.localStart + WIN_PTS - 1, n - 1);
      const startIdx = videoSlice[w.localStart].i;
      const endIdx   = videoSlice[localEnd].i;
      const startPt  = activityPoints[startIdx];
      const endPt    = activityPoints[endIdx];
      const dur      = Math.min(MAX_CLIP_SEC, Math.max(MIN_CLIP_SEC,
        (actionBudget * w.score) / totalScore,
      ));
      const { title, value } = clipLabel(w);
      return {
        startIndex:      startIdx,
        endIndex:        endIdx,
        startPoint:      startPt,
        endPoint:        endPt,
        // videoStart is GPS satellite time at GPS lock (videoLockGPS).
        // startPt.time is GPS satellite time.
        // (startPt - videoStart) = seconds from GPS lock.
        // Add gpsVideoOffsetMs/1000 to convert to seconds from video frame 0.
        videoStartTime:  gpsVideoOffsetMs / 1000 + Math.max(0, (startPt.time - videoStart) / 1000),
        duration:        dur,
        normalizedScore: w.score,
        title,
        value,
      };
    });

  // Fill any remaining budget by extending the last clip
  const allocated = clips.reduce((s, c) => s + c.duration, 0);
  const fillGap   = actionBudget - allocated;
  if (fillGap > 0.1) clips[clips.length - 1].duration += fillGap;

  // Log selected clips for debug
  console.log(
    `[ProRefuel V2] Cinematic scan: ${clips.length} clips | ` +
    clips.map(c => `${c.title}@${c.videoStartTime.toFixed(0)}s(${c.duration.toFixed(1)}s)`).join(', ')
  );

  return {
    clips,
    reason: `cinematic scan (${videoSlice.length} pts, ${clips.length} clips)`,
  };
}

// ─── Internal: ACTION clip selection using V2 candidates ──────────────────────
// Replaces V1's detectAllPeaks. Uses compositeScore-ranked candidates instead
// of raw local-maxima intensity peaks.

function selectActionClipsV2(
  candidates:       SceneCandidateV2[],
  activityPoints:   EnhancedGPSPoint[],
  videoStart:       number,
  videoEnd:         number,
  actionBudget:     number,
  rhythmFactor:     number,
  unit:             UnitSystem,
  gpsVideoOffsetMs: number = 0,
): { clips: ScoredActionSegmentV2[]; rejected: Array<{ candidate: SceneCandidateV2; reason: string }> } {

  const rejected: Array<{ candidate: SceneCandidateV2; reason: string }> = [];

  // 1. Only INSIDE candidates are filmable — they have confirmed temporal overlap
  //    with the video. NEAR candidates (within 2 min but no overlap) are excluded
  //    here because their videoStartTime would be negative (clamped to 0), causing
  //    the wrong video segment to play.
  const pool = candidates.filter(c => c.zone === 'INSIDE');

  if (pool.length === 0) {
    candidates.forEach(c => rejected.push({
      candidate: c,
      reason: c.zone === 'NEAR'
        ? 'zone=NEAR — no temporal overlap with video (scene outside recorded window)'
        : 'zone=FAR — outside video window',
    }));
    return { clips: [], rejected };
  }

  // 2. Sort by compositeScore descending
  const sorted = sortByCompositeScore(pool);

  // 3. Greedy selection with 10s minimum gap between clip centers
  const MIN_GAP_MS  = 10_000;
  const MIN_CLIP_SEC = 3;
  const MAX_CLIP_SEC = rhythmFactor > 1.1 ? 15 : 12; // longer clips for SLOW rhythm

  const selected: SceneCandidateV2[] = [];

  for (const cand of sorted) {
    const ptS = activityPoints[cand.startIndex];
    const ptE = activityPoints[cand.endIndex];
    if (!ptS || !ptE) {
      rejected.push({ candidate: cand, reason: 'invalid index reference' });
      continue;
    }

    const candCenter = (ptS.time + ptE.time) / 2;
    const tooClose = selected.some(s => {
      const sCenter = (activityPoints[s.startIndex].time + activityPoints[s.endIndex].time) / 2;
      return Math.abs(sCenter - candCenter) < MIN_GAP_MS;
    });

    if (tooClose) {
      rejected.push({ candidate: cand, reason: 'too close to an already-selected clip (<10s)' });
      continue;
    }

    selected.push(cand);

    // Stop when we have enough candidates to fill the budget with MIN_CLIP_SEC clips
    if (selected.length * MIN_CLIP_SEC >= actionBudget) break;
  }

  // Reject anything not selected
  const selectedIds = new Set(selected.map(s => s.id));
  for (const cand of sorted) {
    if (!selectedIds.has(cand.id) && !rejected.find(r => r.candidate.id === cand.id)) {
      rejected.push({ candidate: cand, reason: 'budget exhausted — lower-scoring candidate not needed' });
    }
  }

  if (selected.length === 0) {
    return { clips: [], rejected };
  }

  // 4. Proportional budget allocation by compositeScore
  const totalScore = selected.reduce((s, c) => s + c.compositeScore, 0) || 1;
  const distributed = selected.map(c => ({
    cand:        c,
    durationSec: Math.min(MAX_CLIP_SEC, Math.max(MIN_CLIP_SEC,
      (actionBudget * c.compositeScore) / totalScore
    )),
  }));

  // 5. Remove clips below MIN_CLIP_SEC and redistribute their budget
  const tooShort = distributed.filter(d => d.durationSec < MIN_CLIP_SEC);
  if (tooShort.length > 0) {
    const reclaimed     = tooShort.reduce((s, d) => s + d.durationSec, 0);
    const valid         = distributed.filter(d => d.durationSec >= MIN_CLIP_SEC);
    const remainScore   = valid.reduce((s, d) => s + d.cand.compositeScore, 0) || 1;
    for (const d of valid) {
      d.durationSec = Math.min(MAX_CLIP_SEC,
        d.durationSec + reclaimed * d.cand.compositeScore / remainScore
      );
    }
    for (const d of tooShort) {
      rejected.push({ candidate: d.cand, reason: `allocated duration ${d.durationSec.toFixed(1)}s < MIN_CLIP_SEC=${MIN_CLIP_SEC}s` });
    }
    distributed.length = 0;
    distributed.push(...valid);
  }

  // 6. Budget fill: if total < actionBudget, extend last clip to close the gap
  const allocated = distributed.reduce((s, d) => s + d.durationSec, 0);
  const fillGap   = actionBudget - allocated;
  if (fillGap > 0.1 && distributed.length > 0) {
    distributed[distributed.length - 1].durationSec += fillGap;
  }

  // 7. Convert to ScoredActionSegmentV2 (chronological order)
  const clips: ScoredActionSegmentV2[] = distributed
    .sort((a, b) => a.cand.startIndex - b.cand.startIndex)
    .map(({ cand, durationSec }) => {
      const startPt = activityPoints[cand.startIndex];
      const endPt   = activityPoints[cand.endIndex];
      const { title, value } = labelFromCandidate(cand, unit);

      return {
        startIndex:     cand.startIndex,
        endIndex:       cand.endIndex,
        startPoint:     startPt,
        endPoint:       endPt,
        // videoStart is GPS satellite time; startPt.time is also GPS satellite time.
        // Do NOT clamp to gpsVideoOffsetMs — breaks startIndex/videoStartTime invariant.
        // videoStart is GPS satellite time at GPS lock (= videoLockGPS).
        // startPt.time is also GPS satellite time.
        // (startPt.time - videoStart) = seconds from GPS lock in GPS time.
        // Add lockSeekSec to convert to seconds from video frame 0.
        videoStartTime: gpsVideoOffsetMs / 1000 + Math.max(0, (startPt.time - videoStart) / 1000),
        duration:       durationSec,
        normalizedScore: cand.compositeScore,
        title,
        value,
      };
    });

  return { clips, rejected };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class StorytellingProcessorV2 {
  static generatePlan(
    activityPoints:   EnhancedGPSPoint[],
    videoPoints:      GPSPoint[],
    unit:             UnitSystem = 'metric',
    clockOffsetMs:    number    = 0,
    gpsVideoOffsetMs: number    = 0,
  ): StoryPlan & { v2Debug?: StorytellingV2Debug } {

    const t0 = performance.now();

    const TOTAL_BUDGET  = 59;
    const INTRO_SEC     = 6.5;
    const BRAND_SEC     = 3.5;
    const ACTION_BUDGET = TOTAL_BUDGET - INTRO_SEC - BRAND_SEC; // 49s

    if (activityPoints.length === 0) {
      throw new Error('[V2] Activity points required for storytelling.');
    }

    // ── 1. Timestamps ────────────────────────────────────────────────────────
    // videoStart/videoEnd are camera RTC. Activity timestamps are GPS satellite.
    // GPS lock latency: first gpsVideoOffsetMs ms of video GPS are stale.
    // Effective video window for telemetry starts at the GPS lock moment.
    const videoStart    = videoPoints.length > 0 ? videoPoints[0].time : 0;
    const videoEnd      = videoPoints.length > 0 ? videoPoints[videoPoints.length - 1].time : 0;
    const videoLockRTC  = videoStart + gpsVideoOffsetMs;          // camera RTC at GPS lock
    const videoStartGPS = videoLockRTC > 0 ? videoLockRTC - clockOffsetMs : 0; // GPS satellite
    const videoEndGPS   = videoEnd     > 0 ? videoEnd     - clockOffsetMs : 0;
    const lockSeekSec   = gpsVideoOffsetMs / 1000; // video seek position at GPS lock

    // ── Window slice: scope all detection to the video window ────────────────
    // Running detection on a 3-hour activity finds the most intense scenes globally
    // (e.g. at 16:00 or 17:57) even when the video covers only 17:29–17:34.
    // Slicing ensures:
    //   a) All candidates are INSIDE the window — no score penalties needed.
    //   b) Percentiles reflect the intensity distribution of THIS segment, not the full activity.
    const winStartIdx = (() => {
      if (videoStartGPS <= 0) return 0;
      let lo = 0, hi = activityPoints.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (activityPoints[mid].time < videoStartGPS) lo = mid + 1; else hi = mid; }
      return lo;
    })();
    const winEndIdx = (() => {
      if (videoEndGPS <= 0) return activityPoints.length - 1;
      let lo = 0, hi = activityPoints.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (activityPoints[mid].time < videoEndGPS) lo = mid + 1; else hi = mid; }
      return lo;
    })();
    const windowPts  = videoStartGPS > 0 && winEndIdx > winStartIdx + 10
      ? activityPoints.slice(winStartIdx, winEndIdx + 1)
      : activityPoints;
    const useWindow  = windowPts !== activityPoints;
    // Helper: remap window-relative index → absolute activity index
    const toAbsIdx = (relIdx: number) => useWindow ? relIdx + winStartIdx : relIdx;

    // ── 2. V2 Intensity + Eventfulness + MasterScore ─────────────────────────
    const intensityV2 = computeIntensityV2(windowPts);

    // ── 3. Build Percentiles ─────────────────────────────────────────────────
    const hrValues    = windowPts.map(p => p.hr    ?? null);
    const speedValues = windowPts.map(p => p.speed ?? null);
    const gradValues: number[] = [];
    for (let i = 1; i < windowPts.length; i++) {
      const d = crudeDistance(windowPts[i - 1], windowPts[i]);
      gradValues.push(d > 0.5 ? ((windowPts[i].ele - windowPts[i - 1].ele) / d) * 100 : 0);
    }
    const accelValues   = windowPts.map(p => p.accel  ?? null);
    const masterValues  = Array.from(intensityV2.masterScore);

    const percentiles = computeActivityPercentiles(hrValues, speedValues, gradValues, accelValues, masterValues);

    // ── 4. V2 Scene Detection (window-scoped) ────────────────────────────────
    // No videoStart/End proximity params needed — all candidates are inside by construction.
    const rawCandidates = detectScenesV2(windowPts, intensityV2, percentiles, 0, 0, unit);
    // Remap indices to absolute activityPoints positions
    const candidates = rawCandidates.map(c => ({
      ...c,
      startIndex:        toAbsIdx(c.startIndex),
      endIndex:          toAbsIdx(c.endIndex),
      zone:              'INSIDE' as const,  // all are inside the window by construction
      videoOverlapScore: 1.0,               // 100% overlap — detected within window slice
    }));

    // ── 5. Video Overlap Scores — all INSIDE, no penalty adjustments needed ──
    // (skipped — candidates already have zone=INSIDE; applyVideoOverlapScores
    //  would just confirm overlap=1.0 for all of them)

    // ── 6. Composite Scores ───────────────────────────────────────────────────
    applyCompositeScores(candidates);

    const detectionMs = performance.now() - t0;

    // ── 7. V1 NarrativePlanner (MAP budget allocation — window-scoped) ────────
    const v1Intensity   = computeIntensity(windowPts);
    const v1RawScenes   = detectScenes(windowPts, v1Intensity);
    // Remap V1 scene indices to absolute before passing to NarrativePlanner
    const v1Scenes      = v1RawScenes.map(s => ({ ...s, startIndex: toAbsIdx(s.startIndex), endIndex: toAbsIdx(s.endIndex) }));
    const narrativePlan = buildNarrativePlan(v1Scenes, activityPoints, v1Intensity, ACTION_BUDGET);

    const rhythmFactor  = narrativePlan.editingRhythm === 'FAST' ? 0.8
                        : narrativePlan.editingRhythm === 'SLOW' ? 1.3 : 1.0;

    // ── 8. V2 ACTION Clip Selection ───────────────────────────────────────────
    // Cast to SceneCandidateV2[] so zone comparison works (we set zone='INSIDE' for all window-scoped candidates)
    const allCandidates = candidates as SceneCandidateV2[];
    const insideCandCount = allCandidates.filter(c => c.zone === 'INSIDE').length;
    const nearCandCount   = allCandidates.filter(c => c.zone === 'NEAR').length;

    console.log(`[ProRefuel V2] Sport: ${intensityV2.sportProfile} | α=${intensityV2.alpha} | Profile: ${intensityV2.profile}`);
    console.log(`[ProRefuel V2] Activity: ${activityPoints.length} pts | [${new Date(activityPoints[0].time).toISOString()} → ${new Date(activityPoints[activityPoints.length - 1].time).toISOString()}]`);
    console.log(`[ProRefuel V2] Window:   [${winStartIdx}→${winEndIdx}] (${windowPts.length} pts) | scoped=${useWindow}`);
    console.log(`[ProRefuel V2] Video:    [${videoStart > 0 ? new Date(videoStart).toISOString() : 'n/a'} → ${videoEnd > 0 ? new Date(videoEnd).toISOString() : 'n/a'}]`);
    console.log(`[ProRefuel V2] Candidates: ${allCandidates.length} total | INSIDE: ${insideCandCount} | NEAR: ${nearCandCount} | FAR: ${allCandidates.filter(c => c.zone === 'FAR').length}`);

    let rawSegments: ScoredActionSegmentV2[] = [];
    let rejected:    Array<{ candidate: SceneCandidateV2; reason: string }> = [];
    let windowScanFallbackReason = '';

    if (videoStartGPS > 0) {
      // Pass GPS-corrected times so videoStartTime formulas inside produce correct seek positions
      const v2Result = selectActionClipsV2(allCandidates, activityPoints, videoStartGPS, videoEndGPS, ACTION_BUDGET, rhythmFactor, unit, gpsVideoOffsetMs);
      rawSegments = v2Result.clips;
      rejected    = v2Result.rejected;

      // If V2 typed candidates yielded nothing (all FAR), scan the video window by intensity
      if (rawSegments.length === 0) {
        console.warn(`[ProRefuel V2] No INSIDE typed candidates — running cinematic scan on video window`);
        const scanResult = selectClipsFromVideoWindow(activityPoints, intensityV2, videoStartGPS, videoEndGPS, ACTION_BUDGET, unit, gpsVideoOffsetMs);
        rawSegments = scanResult.clips;
        windowScanFallbackReason = scanResult.reason;
      }
    }

    console.log(`[ProRefuel V2] Selected clips: ${rawSegments.length} | Editing: ${narrativePlan.editingRhythm}`);

    // ── 9. Segment Assembly (same MAP/ACTION logic as V1) ────────────────────
    const totalPoints      = activityPoints.length;
    const isLongActivity   = this.detectLongActivity(activityPoints, rawSegments, ACTION_BUDGET);
    const segments: StorySegment[] = [];

    const firstActionIndex = rawSegments.length > 0
      ? rawSegments[0].startIndex
      : (videoStartGPS > 0
          ? Math.max(0, activityPoints.findIndex(p => p.time >= videoStartGPS))
          : Math.floor(totalPoints / 2));
    const lastActionEndIndex = rawSegments.length > 0
      ? rawSegments[rawSegments.length - 1].endIndex
      : Math.min(firstActionIndex + 60, totalPoints - 1);

    const preclimaxMapBudget = narrativePlan.acts.reduce((sum, a) => {
      if (a.act === 'INTRO' || a.act === 'OUTRO' || a.act === 'CLIMAX' || a.act === 'RELIEF') return sum;
      return sum + a.targetDurationSec;
    }, 0);

    let seenClimax        = false;
    let preclimaxCursor   = 0;
    let preclimaxFracUsed = 0;
    let reclaimedMapBudget = 0;

    // INTRO
    segments.push({ type: 'INTRO', startIndex: 0, endIndex: 0, durationSec: INTRO_SEC });

    for (const narrativeAct of narrativePlan.acts) {
      if (narrativeAct.act === 'INTRO' || narrativeAct.act === 'OUTRO') continue;

      if (narrativeAct.act === 'CLIMAX') {
        seenClimax = true;

        if (rawSegments.length > 0) {
          const climaxBudget = isLongActivity ? ACTION_BUDGET : narrativeAct.targetDurationSec;

          // V2: clips already have their durationSec from proportional allocation
          // Re-scale proportionally if climaxBudget differs from ACTION_BUDGET
          const totalAllocated = rawSegments.reduce((s, r) => s + r.duration, 0);
          const scale          = totalAllocated > 0 ? climaxBudget / totalAllocated : 1;

          for (const seg of rawSegments) {
            segments.push({
              type:           'ACTION',
              startIndex:     seg.startIndex,
              endIndex:       seg.endIndex,
              videoStartTime: seg.videoStartTime,
              durationSec:    seg.duration * scale,
              title:          seg.title,
              value:          seg.value,
            });
          }
        }
      } else {
        // MAP segment logic (identical to V1)
        if (isLongActivity) {
          reclaimedMapBudget += narrativeAct.targetDurationSec;
          if (!seenClimax) {
            const actFrac = preclimaxMapBudget > 0
              ? narrativeAct.targetDurationSec / preclimaxMapBudget : 1;
            preclimaxFracUsed += actFrac;
            preclimaxCursor = Math.min(Math.round(firstActionIndex * preclimaxFracUsed), firstActionIndex);
          }
          continue;
        }

        let segStart: number;
        let segEnd:   number;

        if (!seenClimax) {
          const actFrac = preclimaxMapBudget > 0
            ? narrativeAct.targetDurationSec / preclimaxMapBudget : 1;
          const cumFrac = preclimaxFracUsed + actFrac;
          segStart             = preclimaxCursor;
          segEnd               = Math.min(Math.round(firstActionIndex * cumFrac), firstActionIndex);
          preclimaxFracUsed    = cumFrac;
          preclimaxCursor      = segEnd;
        } else {
          segStart = lastActionEndIndex;
          segEnd   = totalPoints - 1;
        }

        if (segEnd - segStart < 2) continue;

        const realSec        = (activityPoints[segEnd].time - activityPoints[segStart].time) / 1000;
        const mapSpeedFactor = realSec > 0 ? realSec / narrativeAct.targetDurationSec : 1;

        segments.push({
          type:           'MAP',
          startIndex:     segStart,
          endIndex:       segEnd,
          durationSec:    narrativeAct.targetDurationSec,
          mapSpeedFactor,
        });
      }
    }

    // Redistribute reclaimed MAP budget to ACTION clips
    if (reclaimedMapBudget > 0 && !isLongActivity) {
      const actionSegs    = segments.filter(s => s.type === 'ACTION');
      const totalActionDur = actionSegs.reduce((s, seg) => s + seg.durationSec, 0) || 1;
      for (const seg of actionSegs) {
        seg.durationSec += reclaimedMapBudget * (seg.durationSec / totalActionDur);
      }
    }

    // Collect fallback reasons for debug output
    const fallbacksUsed: string[] = [];
    if (windowScanFallbackReason) {
      fallbacksUsed.push(`video-window intensity scan used: ${windowScanFallbackReason}`);
    }

    // Last-resort fallback: if even the video-window scan returned nothing, use
    // a single full-video clip (videoStartTime: 0, entire video duration).
    if (segments.filter(s => s.type === 'ACTION').length === 0 && videoPoints.length > 0) {
      fallbacksUsed.push('last-resort: no intensity data in video window — full video clip');
      console.error(`[ProRefuel V2] Last-resort fallback triggered — check activity/video timestamp alignment`);
      const vidIdx      = videoStartGPS > 0
        ? Math.max(0, activityPoints.findIndex(p => p.time >= videoStartGPS))
        : Math.floor(activityPoints.length / 2);
      const videoDurSec = videoEndGPS > videoStartGPS ? (videoEndGPS - videoStartGPS) / 1000 : ACTION_BUDGET;
      segments.push({
        type:           'ACTION',
        startIndex:     vidIdx,
        endIndex:       Math.min(vidIdx + Math.round(videoDurSec), activityPoints.length - 1),
        videoStartTime: 0,
        durationSec:    ACTION_BUDGET,
        title:          'RIDE',
        value:          'ACTION',
      });
    }

    // BRAND
    segments.push({ type: 'BRAND', startIndex: totalPoints - 1, endIndex: totalPoints - 1, durationSec: BRAND_SEC });

    // ── 10. Build debug output ────────────────────────────────────────────────
    const missingSensors: string[] = [];
    if (!activityPoints.some(p => (p.hr ?? 0) > 0))    missingSensors.push('hr');
    if (!activityPoints.some(p => (p.accel ?? 0) !== 0)) missingSensors.push('accel');
    if (!activityPoints.some(p => (p.power ?? 0) > 0))  missingSensors.push('power');

    const sensorLimitations = getSensorLimitations(activityPoints, percentiles);
    const actionSegCount    = segments.filter(s => s.type === 'ACTION').length;
    const mapSegCount       = segments.filter(s => s.type === 'MAP').length;
    const totalDurSec       = segments.reduce((s, seg) => s + seg.durationSec, 0);
    const actionDurSec      = segments.filter(s => s.type === 'ACTION').reduce((s, seg) => s + seg.durationSec, 0);

    const v2Debug = buildStorytellingDebug({
      totalPoints,
      activityDurationSec: (activityPoints[activityPoints.length - 1].time - activityPoints[0].time) / 1000,
      activityProfile:     intensityV2.profile,
      sportProfile:        intensityV2.sportProfile,
      alpha:               intensityV2.alpha,
      percentiles,
      missingSensors,
      videoStartMs:        videoStart,
      videoEndMs:          videoEnd,
      allCandidates:       candidates,
      selectedCandidates:  candidates.filter(c => rawSegments.some(s => s.startIndex === c.startIndex)),
      rejectedCandidates:  rejected,
      sensorLimitations,
      thresholdRelaxations: percentiles.lowVariance ? ['All thresholds relaxed by one percentile level (low-variance activity)'] : [],
      fallbacksUsed,
      detectionMs,
      totalSegments:       segments.length,
      actionSegments:      actionSegCount,
      mapSegments:         mapSegCount,
      totalDurationSec:    totalDurSec,
      actionDurationSec:   actionDurSec,
    });

    logStorytellingDebug(v2Debug);

    return {
      totalBudgetSec:  TOTAL_BUDGET,
      isLongActivity,
      segments,
      activityPoints,
      narrativePlan,
      intensityScores: intensityV2.masterScore,  // V2: use masterScore for altimetry visualization
      detectedScenes:  v1Scenes,                  // V1 scenes kept for UI compatibility
      v2Debug,
    };
  }

  private static detectLongActivity(
    activityPoints: EnhancedGPSPoint[],
    rawSegments:    ScoredActionSegmentV2[],
    actionBudget:   number,
  ): boolean {
    const totalPoints          = activityPoints.length;
    const highlightPointsCount = rawSegments.reduce((acc, s) => acc + (s.endIndex - s.startIndex), 0);
    const mapPointsCount       = Math.max(0, totalPoints - highlightPointsCount);
    const availableMapTime     = actionBudget - highlightPointsCount;
    const mapSpeed             = availableMapTime > 0 ? mapPointsCount / availableMapTime : 100;
    return mapSpeed > 10;
  }
}
