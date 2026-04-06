// ─── VideoOverlapCalculator ──────────────────────────────────────────────────
// Computes a [0, 1] score measuring how well a scene candidate aligns with
// the GoPro video time window.
//
// Uses the hybrid "Option F" formula recommended in the design analysis:
//   score = 0.5 × IoU-style ratio + 0.3 × centrality + 0.2 × base credit
//   (only for overlapping scenes; non-overlapping use an exponential decay)
//
// Why IoU-style (min denominator) instead of scene_duration or video_duration:
//   Prevents over-rewarding large scenes that barely touch the video edge,
//   AND prevents under-rewarding short scenes fully inside the video.

import { ActivityPoint } from '../IntensityEngine';
import { SceneCandidateV2 } from './SceneDetectorV2';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface VideoOverlapDetail {
  overlapMs:        number;   // raw temporal overlap in milliseconds
  overlapFraction:  number;   // overlapMs / min(scene_duration, video_duration)
  centrality:       number;   // [0,1] how centered the scene is within the video
  distanceMs:       number;   // 0 if overlapping; distance to nearest video edge otherwise
  finalScore:       number;   // [0,1]
  zone:             'INSIDE' | 'NEAR' | 'FAR';
}

// ─── Internal constants ───────────────────────────────────────────────────────

/** Exponential decay half-life for non-overlapping scenes (120 seconds). */
const DECAY_TAU_MS = 120_000;

/** Maximum score a non-overlapping (NEAR) scene can achieve. */
const MAX_NEAR_SCORE = 0.20;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the hybrid video overlap score for a single scene candidate.
 *
 * @param sceneStartMs  Scene start timestamp (UTC ms)
 * @param sceneEndMs    Scene end timestamp (UTC ms)
 * @param videoStartMs  Video start timestamp (UTC ms)
 * @param videoEndMs    Video end timestamp (UTC ms)
 */
export function computeVideoOverlap(
  sceneStartMs: number,
  sceneEndMs:   number,
  videoStartMs: number,
  videoEndMs:   number,
): VideoOverlapDetail {
  const sceneDur  = Math.max(1, sceneEndMs   - sceneStartMs);
  const videoDur  = Math.max(1, videoEndMs   - videoStartMs);

  // ── Temporal intersection ────────────────────────────────────────────────
  const overlapStart = Math.max(sceneStartMs, videoStartMs);
  const overlapEnd   = Math.min(sceneEndMs,   videoEndMs);
  const overlapMs    = Math.max(0, overlapEnd - overlapStart);

  if (overlapMs > 0) {
    // ── INSIDE or partial overlap ─────────────────────────────────────────

    // IoU-style ratio: use shorter of the two durations as denominator
    // → avoids size bias in both directions
    const overlapFraction = clamp01(overlapMs / Math.min(sceneDur, videoDur));

    // Centrality: how close is the scene center to the video center?
    // 1.0 = scene center == video center, 0.0 = scene center at video edge
    const sceneCenter = (sceneStartMs + sceneEndMs) / 2;
    const videoCenter = (videoStartMs + videoEndMs) / 2;
    const halfVideo   = videoDur / 2;
    const centrality  = halfVideo > 0
      ? clamp01(1 - Math.abs(sceneCenter - videoCenter) / halfVideo)
      : 1.0;

    const finalScore = clamp01(
      0.50 * overlapFraction +
      0.30 * centrality      +
      0.20 * 1.0             // base credit for any overlap at all
    );

    return {
      overlapMs,
      overlapFraction,
      centrality,
      distanceMs: 0,
      finalScore,
      zone: 'INSIDE',
    };

  } else {
    // ── Non-overlapping: exponential decay by distance to nearest video edge ─

    const distToVideo = Math.max(
      videoStartMs - sceneEndMs,    // scene ends before video starts
      sceneStartMs - videoEndMs,    // scene starts after video ends
    );

    const decayScore  = clamp01(MAX_NEAR_SCORE * Math.exp(-distToVideo / DECAY_TAU_MS));
    const zone        = distToVideo <= 120_000 ? 'NEAR' : 'FAR';

    // FAR scenes get additional 50% penalty beyond the decay
    const finalScore  = zone === 'FAR' ? decayScore * 0.50 : decayScore;

    return {
      overlapMs:       0,
      overlapFraction: 0,
      centrality:      0,
      distanceMs:      distToVideo,
      finalScore,
      zone,
    };
  }
}

/**
 * Apply video overlap scores to all candidates in-place.
 * Updates each candidate's .videoOverlapScore and .zone fields.
 */
export function applyVideoOverlapScores(
  candidates:  SceneCandidateV2[],
  points:      ActivityPoint[],
  videoStartMs: number,
  videoEndMs:   number,
): void {
  for (const c of candidates) {
    if (points[c.startIndex] == null || points[c.endIndex] == null) continue;

    const detail = computeVideoOverlap(
      points[c.startIndex].time,
      points[c.endIndex].time,
      videoStartMs,
      videoEndMs,
    );

    c.videoOverlapScore = detail.finalScore;
    c.zone              = detail.zone;
  }
}
