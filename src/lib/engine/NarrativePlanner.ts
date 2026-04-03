import { ActivityPoint, IntensityResult, getTopWindows, TopWindow } from "./IntensityEngine";
import { SceneCandidate } from "./SceneDetector";

// ─── Public interfaces ────────────────────────────────────────────────────────

export type ActType = "INTRO" | "BUILD" | "TENSION" | "CLIMAX" | "RELIEF" | "OUTRO";
export type EditingRhythm = "FAST" | "MEDIUM" | "SLOW";

export interface NarrativeAct {
  act: ActType;
  scenes: SceneCandidate[];
  targetDurationSec: number;
}

export interface NarrativePlan {
  acts: NarrativeAct[];
  totalDurationSec: number;
  editingRhythm: EditingRhythm;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function estimateSps(points: ActivityPoint[]): number {
  const n = points.length;
  if (n < 2) return 1;
  const totalSec = (points[n - 1].time - points[0].time) / 1000;
  return (n - 1) / Math.max(totalSec, 1);
}

// ─── PASSO 1 — EditingRhythm from HR data ────────────────────────────────────

function resolveRhythm(points: ActivityPoint[]): EditingRhythm {
  let hrMax = 0, hrSum = 0, hrCount = 0;
  for (const p of points) {
    const hr = p.hr;
    if (hr == null) continue;
    hrCount++;
    hrSum += hr;
    if (hr > hrMax) hrMax = hr;
  }
  if (hrMax === 0 || hrCount === 0) return "MEDIUM";

  const hrMean  = hrSum / hrCount;
  const hrRatio = hrMean / hrMax;

  if (hrRatio > 0.80) return "FAST";
  if (hrRatio >= 0.60) return "MEDIUM";
  return "SLOW";
}

// ─── PASSO 2 — Act target durations ──────────────────────────────────────────

interface ActDurations {
  BUILD: number;
  TENSION: number;
  CLIMAX: number;
  RELIEF: number;
}

function resolveActDurations(targetVideoSec: number): ActDurations {
  const BOOKEND_SEC = 0; // bookends (INTRO + BRAND) are managed by StorytellingProcessor
  const remaining = Math.max(0, targetVideoSec - BOOKEND_SEC);
  return {
    BUILD:   remaining * 0.20,
    TENSION: remaining * 0.25,
    CLIMAX:  remaining * 0.35,
    RELIEF:  remaining * 0.20,
  };
}

// ─── PASSO 3 — Scene selector ─────────────────────────────────────────────────

function scenesForAct(
  available: SceneCandidate[],
  minScore: number,
  maxScore: number,
  preferTypes: SceneCandidate["type"][],
  maxCount: number,
  used: Set<string>,
): SceneCandidate[] {
  // Filter by score range and not already used
  const eligible = available.filter(
    s => s.score >= minScore && s.score <= maxScore && !used.has(s.id),
  );

  // Partition into preferred and rest, both sorted by score desc
  const preferred = eligible
    .filter(s => preferTypes.includes(s.type))
    .sort((a, b) => b.score - a.score);

  const rest = eligible
    .filter(s => !preferTypes.includes(s.type))
    .sort((a, b) => b.score - a.score);

  const selected = [...preferred, ...rest].slice(0, maxCount);

  for (const s of selected) used.add(s.id);
  return selected;
}

// ─── PASSO 3b — Scene selector with progressive score relaxation ─────────────
// Tries original range, then relaxes minScore by 15% and 30% before falling back.

function scenesWithFallback(
  act: "BUILD" | "TENSION" | "CLIMAX",
  available: SceneCandidate[],
  minScore: number,
  maxScore: number,
  preferTypes: SceneCandidate["type"][],
  maxCount: number,
  used: Set<string>,
  intensity: IntensityResult,
  points: ActivityPoint[],
  targetDurationSec: number,
): SceneCandidate[] {
  // Attempt 1: original relative range
  let result = scenesForAct(available, minScore, maxScore, preferTypes, maxCount, used);
  if (result.length > 0) return result;

  // Attempt 2: relax minScore by 15%
  result = scenesForAct(available, minScore * 0.85, maxScore, preferTypes, maxCount, used);
  if (result.length > 0) return result;

  // Attempt 3: relax minScore by 30%
  result = scenesForAct(available, minScore * 0.70, maxScore, preferTypes, maxCount, used);
  if (result.length > 0) return result;

  // Final fallback: getTopWindows with half-duration windows (smaller window = more candidates)
  return fallbackScenes(act, intensity, points, targetDurationSec / 2);
}

// ─── PASSO 4 — Fallback: TopWindow → minimal SceneCandidate ──────────────────

function fallbackScenes(
  act: "BUILD" | "TENSION" | "CLIMAX",
  intensity: IntensityResult,
  points: ActivityPoint[],
  targetDurationSec: number,
): SceneCandidate[] {
  const typeMap: Record<"BUILD" | "TENSION" | "CLIMAX", SceneCandidate["type"]> = {
    CLIMAX:  "CLIMB",
    TENSION: "TECHNICAL",
    BUILD:   "SPRINT",
  };

  const windows: TopWindow[] = getTopWindows(intensity, points, targetDurationSec, 2, 30);

  return windows.map((tw, i): SceneCandidate => ({
    id:         `FB_${act}_${i}`,
    type:       typeMap[act],
    startIndex: tw.startIndex,
    endIndex:   tw.endIndex,
    score:      tw.score,
    label:      "DESTAQUE",
    metadata:   {},
  }));
}

// ─── PASSO 5 — Synthetic INTRO / OUTRO candidates ────────────────────────────

function makeIntro(points: ActivityPoint[]): SceneCandidate {
  const sps     = estimateSps(points);
  const endIndex = Math.min(Math.round(5 * sps), points.length - 1);
  return {
    id: "INTRO_0", type: "CLIMB",
    startIndex: 0, endIndex,
    score: 0, label: "INTRO", metadata: {},
  };
}

function makeOutro(points: ActivityPoint[]): SceneCandidate {
  const sps        = estimateSps(points);
  const startIndex = Math.max(0, points.length - 1 - Math.round(5 * sps));
  return {
    id: "OUTRO_0", type: "DESCENT",
    startIndex, endIndex: points.length - 1,
    score: 0, label: "ENCERRAMENTO", metadata: {},
  };
}

// ─── Main function ────────────────────────────────────────────────────────────

export function buildNarrativePlan(
  scenes: SceneCandidate[],
  points: ActivityPoint[],
  intensity: IntensityResult,
  targetVideoSec: number,
): NarrativePlan {

  // PASSO 1
  const editingRhythm = resolveRhythm(points);

  // PASSO 2
  const dur = resolveActDurations(targetVideoSec);

  // Track used scene ids to prevent cross-act repetition
  const used = new Set<string>();

  // PASSO 3 — select scenes per act with thresholds relative to activity's peak score
  // Relative ranges guarantee candidates always exist regardless of absolute score distribution
  const peak = intensity.maxScore || 1;

  const buildScenes = scenesWithFallback(
    "BUILD",
    scenes, peak * 0.40, peak * 0.70, ["TECHNICAL", "SUFFER"], 2, used,
    intensity, points, dur.BUILD,
  );

  const tensionScenes = scenesWithFallback(
    "TENSION",
    scenes, peak * 0.60, peak * 0.82, ["SUFFER", "TECHNICAL"], 2, used,
    intensity, points, dur.TENSION,
  );

  const climaxScenes = scenesWithFallback(
    "CLIMAX",
    scenes, peak * 0.78, peak * 1.00, ["CLIMB", "DESCENT"], 2, used,
    intensity, points, dur.CLIMAX,
  );

  // RELIEF: prefer CONTRAST scenes first, regardless of score; then relative fallback
  let reliefScenes: SceneCandidate[] = scenes.filter(
    s => s.type === "CONTRAST" && !used.has(s.id),
  );
  if (reliefScenes.length > 0) {
    for (const s of reliefScenes) used.add(s.id);
    reliefScenes = reliefScenes.slice(0, 1);
  } else {
    reliefScenes = scenesForAct(scenes, peak * 0.20, peak * 0.60, [], 1, used);
  }

  // scenesWithFallback already handles all fallback logic internally — no PASSO 4 needed
  const resolvedBuild   = buildScenes;
  const resolvedTension = tensionScenes;
  const resolvedClimax  = climaxScenes;

  // PASSO 5 — synthetic bookends
  const introScene = makeIntro(points);
  const outroScene = makeOutro(points);

  // PASSO 6 — assemble acts (always include INTRO and OUTRO)
  const candidateActs: NarrativeAct[] = [
    { act: "INTRO",   scenes: [introScene],       targetDurationSec: 0 },
    { act: "BUILD",   scenes: resolvedBuild,       targetDurationSec: dur.BUILD },
    { act: "TENSION", scenes: resolvedTension,     targetDurationSec: dur.TENSION },
    { act: "CLIMAX",  scenes: resolvedClimax,      targetDurationSec: dur.CLIMAX },
    { act: "RELIEF",  scenes: reliefScenes,        targetDurationSec: dur.RELIEF },
    { act: "OUTRO",   scenes: [outroScene],        targetDurationSec: 0 },
  ];

  // Omit acts (except INTRO/OUTRO) with no scenes
  const acts = candidateActs.filter(
    a => a.act === "INTRO" || a.act === "OUTRO" || a.scenes.length > 0,
  );

  // Clamp total to targetVideoSec + 2s tolerance
  const rawTotal = acts.reduce((s, a) => s + a.targetDurationSec, 0);
  const maxTotal = targetVideoSec + 2;

  let totalDurationSec = rawTotal;
  if (rawTotal > maxTotal) {
    // Scale down non-fixed acts proportionally
    // INTRO and OUTRO have targetDurationSec = 0, so fixed = 0
    const fixed      = 0;
    const scalable   = rawTotal - fixed;
    const allowance  = maxTotal - fixed;
    const scale      = scalable > 0 ? allowance / scalable : 1;
    for (const a of acts) {
      if (a.act === "INTRO" || a.act === "OUTRO") continue;
      a.targetDurationSec = a.targetDurationSec * scale;
    }
    totalDurationSec = acts.reduce((s, a) => s + a.targetDurationSec, 0);
  }

  return { acts, totalDurationSec, editingRhythm };
}
