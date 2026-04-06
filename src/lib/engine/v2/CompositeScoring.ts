// ─── CompositeScoring ────────────────────────────────────────────────────────
// Computes the final composite score used to rank all V2 candidates.
//
// Formula (floored multiplicative + additive components):
//   finalScore = (
//     0.65 × masterScore × videoOverlapScore +   ← good moment AND filmable
//     0.20 × masterScore +                        ← good moment regardless of video
//     0.15 × videoOverlapScore                    ← inside video even if moderate moment
//   ) × zoneMultiplier × narrativeWeight
//
// This ensures:
//   - No single zero factor collapses the score to zero
//   - Video overlap is important but cannot save a weak moment
//   - A strong moment near (but not inside) the video still ranks well enough for MAP use
//   - narrativeWeight allows per-act boosting in future phases

import { SceneCandidateV2, SceneZone } from './SceneDetectorV2';

// ─── Zone multipliers ─────────────────────────────────────────────────────────
// Scales the composite score by how relevant the video zone is.
// INSIDE = best, NEAR = useful for context, FAR = map only.

const ZONE_MULTIPLIER: Record<SceneZone, number> = {
  INSIDE: 1.00,
  NEAR:   0.75,
  FAR:    0.40,
};

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface CompositeScoreDetail {
  masterScoreAvg:   number;
  videoOverlapScore: number;
  zone:              SceneZone;
  zoneMultiplier:    number;
  narrativeWeight:   number;
  components: {
    filmableMoment: number;   // 0.65 × master × overlap
    rawMoment:      number;   // 0.20 × master
    videoCredit:    number;   // 0.15 × overlap
  };
  finalScore: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the composite score for one candidate.
 *
 * @param masterScoreAvg    Mean masterScore over the candidate window [0, 1]
 * @param videoOverlapScore Video overlap score [0, 1] from VideoOverlapCalculator
 * @param zone              Zone classification (INSIDE / NEAR / FAR)
 * @param narrativeWeight   Per-act multiplier (1.0 for Phase 1; Phase 2 will use 2.0 for CLIMAX etc.)
 */
export function computeCompositeScore(
  masterScoreAvg:    number,
  videoOverlapScore: number,
  zone:              SceneZone,
  narrativeWeight    = 1.0,
): CompositeScoreDetail {
  const zoneMultiplier = ZONE_MULTIPLIER[zone];

  const filmableMoment = 0.65 * masterScoreAvg * videoOverlapScore;
  const rawMoment      = 0.20 * masterScoreAvg;
  const videoCredit    = 0.15 * videoOverlapScore;

  const raw        = filmableMoment + rawMoment + videoCredit;
  const finalScore = Math.min(1.0, raw * zoneMultiplier * narrativeWeight);

  return {
    masterScoreAvg,
    videoOverlapScore,
    zone,
    zoneMultiplier,
    narrativeWeight,
    components: { filmableMoment, rawMoment, videoCredit },
    finalScore,
  };
}

/**
 * Apply composite scores to all candidates in-place.
 * Call AFTER applyVideoOverlapScores() so videoOverlapScore is populated.
 *
 * @param narrativeWeightFn  Optional per-candidate narrative weight (defaults to 1.0).
 *                           Phase 2 will pass act-specific weights (2.0 for CLIMAX, etc.)
 */
export function applyCompositeScores(
  candidates:         SceneCandidateV2[],
  narrativeWeightFn?: (c: SceneCandidateV2) => number,
): void {
  for (const c of candidates) {
    const nw = narrativeWeightFn ? narrativeWeightFn(c) : 1.0;
    const detail = computeCompositeScore(c.masterScoreAvg, c.videoOverlapScore, c.zone, nw);
    c.compositeScore = detail.finalScore;
  }
}

/**
 * Sort candidates by composite score (descending).
 * Secondary sort: masterScoreAvg (deterministic tie-breaking).
 * Tertiary sort: startIndex ascending (chronological for equal scores).
 */
export function sortByCompositeScore(candidates: SceneCandidateV2[]): SceneCandidateV2[] {
  return [...candidates].sort((a, b) => {
    if (Math.abs(a.compositeScore - b.compositeScore) > 0.001) return b.compositeScore - a.compositeScore;
    if (Math.abs(a.masterScoreAvg - b.masterScoreAvg) > 0.001) return b.masterScoreAvg - a.masterScoreAvg;
    return a.startIndex - b.startIndex;
  });
}

/**
 * Filter candidates to those with zone === 'INSIDE' (inside video window).
 * Falls back to including NEAR candidates if fewer than minCount INSIDE exist.
 */
export function filterActionCandidates(
  candidates: SceneCandidateV2[],
  minCount    = 2,
): SceneCandidateV2[] {
  const inside = candidates.filter(c => c.zone === 'INSIDE');
  if (inside.length >= minCount) return inside;
  // Not enough INSIDE candidates — include NEAR as secondary
  return candidates.filter(c => c.zone === 'INSIDE' || c.zone === 'NEAR');
}
