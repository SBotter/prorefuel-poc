// ─── StorytellingDebug ───────────────────────────────────────────────────────
// Structured debug output schema for StorytellingV2.
// Captures all decisions made during the pipeline so every output can be
// explained, diagnosed, and A/B tested against V1.
//
// Engineering use: understand why a specific candidate was selected/rejected.
// Product use: surface confidence level and video quality ratio to the user.

import { ActivityPercentiles } from './PercentileCalculator';
import { SceneCandidateV2, SceneType } from './SceneDetectorV2';
import { SportProfile } from './IntensityEngineV2';

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface CandidateDebug {
  id:                string;
  type:              SceneType;
  startIndex:        number;
  endIndex:          number;
  scores: {
    masterScoreAvg:    number;
    videoOverlapScore: number;
    compositeScore:    number;
  };
  zone:              string;
  confidence:        string;
  sensorLimited:     boolean;
  metadata:          Record<string, number>;
}

export interface ActDebug {
  act:           string;
  selected:      CandidateDebug | null;
  candidates:    CandidateDebug[];   // all considered
  fallbackUsed:  boolean;
  fallbackReason: string | null;
}

export interface StorytellingV2Debug {
  version:  '2.0';
  timestamp: number;

  activity: {
    totalPoints:     number;
    durationSec:     number;
    profile:         string;    // CLIMB / DESCENT / MIXED
    sportProfile:    SportProfile;
    alpha:           number;
    missingSensors:  string[];
    lowVariance:     boolean;
    percentileSummary: {
      hrP80?:        number;
      speedP75?:     number;
      masterP80?:    number;
    };
  };

  video: {
    durationSec:          number;
    videoStartMs:         number;
    videoEndMs:           number;
    overlapWithActivity:  number;   // fraction of video that has matching activity points
    zone:                 'well_covered' | 'edge' | 'outside';
    videoMainEventScore:  number;   // best compositeScore of INSIDE candidates
    globalPeakScore:      number;   // best masterScoreAvg across entire activity
    videoQualityRatio:    number;   // videoMainEvent / globalPeak — confidence signal
  };

  detection: {
    totalCandidates:       number;
    candidatesByType:      Record<string, number>;
    insideCandidates:      number;
    nearCandidates:        number;
    farCandidates:         number;
    sensorLimitations:     Record<string, string | null>;
    detectionMs:           number;   // wall-clock time for detection pass
  };

  candidates: {
    all:      CandidateDebug[];   // all detected, sorted by compositeScore
    selected: CandidateDebug[];   // selected for ACTION segments
    rejected: Array<{ candidate: CandidateDebug; reason: string }>;
  };

  narrative: {
    thresholdRelaxations:   string[];
    fallbacksUsed:          string[];
    confidence:             'HIGH' | 'MEDIUM' | 'LOW';
    confidenceReason:       string;
  };

  plan: {
    totalSegments:    number;
    actionSegments:   number;
    mapSegments:      number;
    totalDurationSec: number;
    actionDurationSec: number;
  };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

function toCandidateDebug(c: SceneCandidateV2): CandidateDebug {
  return {
    id:            c.id,
    type:          c.type,
    startIndex:    c.startIndex,
    endIndex:      c.endIndex,
    scores: {
      masterScoreAvg:    +c.masterScoreAvg.toFixed(4),
      videoOverlapScore: +c.videoOverlapScore.toFixed(4),
      compositeScore:    +c.compositeScore.toFixed(4),
    },
    zone:          c.zone,
    confidence:    c.confidence,
    sensorLimited: c.sensorLimited,
    metadata:      c.metadata,
  };
}

export function buildStorytellingDebug(params: {
  totalPoints:        number;
  activityDurationSec: number;
  activityProfile:    string;
  sportProfile:       SportProfile;
  alpha:              number;
  percentiles:        ActivityPercentiles;
  missingSensors:     string[];
  videoStartMs:       number;
  videoEndMs:         number;
  allCandidates:      SceneCandidateV2[];
  selectedCandidates: SceneCandidateV2[];
  rejectedCandidates: Array<{ candidate: SceneCandidateV2; reason: string }>;
  sensorLimitations:  Record<string, string | null>;
  thresholdRelaxations: string[];
  fallbacksUsed:      string[];
  detectionMs:        number;
  totalSegments:      number;
  actionSegments:     number;
  mapSegments:        number;
  totalDurationSec:   number;
  actionDurationSec:  number;
}): StorytellingV2Debug {
  const {
    totalPoints, activityDurationSec, activityProfile, sportProfile, alpha,
    percentiles, missingSensors, videoStartMs, videoEndMs,
    allCandidates, selectedCandidates, rejectedCandidates,
    sensorLimitations, thresholdRelaxations, fallbacksUsed, detectionMs,
    totalSegments, actionSegments, mapSegments, totalDurationSec, actionDurationSec,
  } = params;

  const videoDurationSec = (videoEndMs - videoStartMs) / 1000;

  // Video quality
  const insideCands        = allCandidates.filter(c => c.zone === 'INSIDE');
  const videoMainEventScore = insideCands.length > 0
    ? Math.max(...insideCands.map(c => c.compositeScore))
    : 0;
  const globalPeakScore    = allCandidates.length > 0
    ? Math.max(...allCandidates.map(c => c.masterScoreAvg))
    : 0;
  const videoQualityRatio  = globalPeakScore > 0 ? videoMainEventScore / globalPeakScore : 0;

  // Video zone
  const videoZone: 'well_covered' | 'edge' | 'outside' =
    insideCands.length >= 2 ? 'well_covered' :
    insideCands.length >= 1 ? 'edge'         :
    'outside';

  // Confidence
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  let confidenceReason: string;
  if (videoQualityRatio >= 0.70 && insideCands.length >= 2) {
    confidence       = 'HIGH';
    confidenceReason = 'Strong video coverage with multiple high-quality candidates';
  } else if (videoQualityRatio >= 0.50 || insideCands.length >= 1) {
    confidence       = 'MEDIUM';
    confidenceReason = 'Acceptable video coverage — strongest moment may be outside video';
  } else {
    confidence       = 'LOW';
    confidenceReason = 'No strong candidates inside video window — fallback used';
  }

  if (fallbacksUsed.length > 0) {
    confidence       = confidence === 'HIGH' ? 'MEDIUM' : 'LOW';
    confidenceReason += '. Fallback detection used: ' + fallbacksUsed.join(', ');
  }

  // Candidate type breakdown
  const candidatesByType: Record<string, number> = {};
  for (const c of allCandidates) {
    candidatesByType[c.type] = (candidatesByType[c.type] ?? 0) + 1;
  }

  const allDebug      = allCandidates.map(toCandidateDebug)
    .sort((a, b) => b.scores.compositeScore - a.scores.compositeScore);
  const selectedDebug = selectedCandidates.map(toCandidateDebug);
  const rejectedDebug = rejectedCandidates.map(r => ({
    candidate: toCandidateDebug(r.candidate),
    reason:    r.reason,
  }));

  return {
    version:   '2.0',
    timestamp: Date.now(),

    activity: {
      totalPoints,
      durationSec:     activityDurationSec,
      profile:         activityProfile,
      sportProfile,
      alpha,
      missingSensors,
      lowVariance:     percentiles.lowVariance,
      percentileSummary: {
        hrP80:     percentiles.hr?.P80,
        speedP75:  percentiles.speed?.P75,
        masterP80: percentiles.masterScore?.P80,
      },
    },

    video: {
      durationSec:         videoDurationSec,
      videoStartMs,
      videoEndMs,
      overlapWithActivity: Math.min(1, Math.max(0, videoDurationSec / Math.max(1, activityDurationSec))),
      zone:                videoZone,
      videoMainEventScore: +videoMainEventScore.toFixed(4),
      globalPeakScore:     +globalPeakScore.toFixed(4),
      videoQualityRatio:   +videoQualityRatio.toFixed(4),
    },

    detection: {
      totalCandidates:    allCandidates.length,
      candidatesByType,
      insideCandidates:   insideCands.length,
      nearCandidates:     allCandidates.filter(c => c.zone === 'NEAR').length,
      farCandidates:      allCandidates.filter(c => c.zone === 'FAR').length,
      sensorLimitations,
      detectionMs:        +detectionMs.toFixed(1),
    },

    candidates: {
      all:      allDebug,
      selected: selectedDebug,
      rejected: rejectedDebug,
    },

    narrative: {
      thresholdRelaxations,
      fallbacksUsed,
      confidence,
      confidenceReason,
    },

    plan: {
      totalSegments,
      actionSegments,
      mapSegments,
      totalDurationSec:  +totalDurationSec.toFixed(1),
      actionDurationSec: +actionDurationSec.toFixed(1),
    },
  };
}

/** Pretty-print the debug output to console (structured, collapsible). */
export function logStorytellingDebug(debug: StorytellingV2Debug): void {
  const pfx = '[ProRefuel V2]';
  console.group(`${pfx} Storytelling Debug — confidence: ${debug.narrative.confidence}`);

  console.group('Activity');
  console.log(`Profile: ${debug.activity.profile} | Sport: ${debug.activity.sportProfile} | α=${debug.activity.alpha}`);
  console.log(`Points: ${debug.activity.totalPoints} | Duration: ${debug.activity.durationSec.toFixed(0)}s | LowVariance: ${debug.activity.lowVariance}`);
  if (debug.activity.missingSensors.length > 0)
    console.warn(`Missing sensors: ${debug.activity.missingSensors.join(', ')}`);
  console.groupEnd();

  console.group('Video');
  console.log(`Duration: ${debug.video.durationSec.toFixed(0)}s | Zone: ${debug.video.zone} | ActivityOverlap: ${(debug.video.overlapWithActivity * 100).toFixed(1)}%`);
  console.log(`Start: ${new Date(debug.video.videoStartMs).toISOString()} → End: ${new Date(debug.video.videoEndMs).toISOString()}`);
  console.log(`VideoMainEvent: ${debug.video.videoMainEventScore.toFixed(3)} | GlobalPeak: ${debug.video.globalPeakScore.toFixed(3)} | QualityRatio: ${debug.video.videoQualityRatio.toFixed(3)}`);
  if (debug.video.zone === 'outside') {
    console.warn(`Video zone=OUTSIDE: video timestamps do not overlap with any V2 candidate. Check timestamp alignment between activity GPX and GoPro video.`);
  }
  console.groupEnd();

  console.group(`Candidates (${debug.detection.totalCandidates} total)`);
  console.log(`INSIDE: ${debug.detection.insideCandidates} | NEAR: ${debug.detection.nearCandidates} | FAR: ${debug.detection.farCandidates}`);
  console.log('By type:', debug.detection.candidatesByType);
  const lim = Object.entries(debug.detection.sensorLimitations).filter(([, v]) => v !== null);
  if (lim.length > 0) console.warn('Sensor limited:', Object.fromEntries(lim));
  // Show top FAR candidates when there are no INSIDE/NEAR (helps diagnose timestamp issues)
  if (debug.detection.insideCandidates === 0 && debug.detection.nearCandidates === 0 && debug.candidates.all.length > 0) {
    const topFar = debug.candidates.all.slice(0, 3);
    console.warn(`No INSIDE/NEAR candidates. Top FAR candidates (by composite score):`);
    for (const c of topFar) {
      console.warn(`  ${c.id} [${c.type}] idx=[${c.startIndex}..${c.endIndex}] master=${c.scores.masterScoreAvg.toFixed(3)} composite=${c.scores.compositeScore.toFixed(3)}`);
    }
  }
  console.groupEnd();

  console.group(`Selected (${debug.candidates.selected.length})`);
  for (const c of debug.candidates.selected) {
    console.log(`  ${c.id} [${c.type}] zone=${c.zone} composite=${c.scores.compositeScore.toFixed(3)} master=${c.scores.masterScoreAvg.toFixed(3)} overlap=${c.scores.videoOverlapScore.toFixed(3)}`);
  }
  console.groupEnd();

  if (debug.candidates.rejected.length > 0) {
    console.group(`Rejected (${debug.candidates.rejected.length})`);
    for (const r of debug.candidates.rejected) {
      console.log(`  ${r.candidate.id} [${r.candidate.type}]: ${r.reason}`);
    }
    console.groupEnd();
  }

  if (debug.narrative.thresholdRelaxations.length > 0)
    console.warn(`Threshold relaxations: ${debug.narrative.thresholdRelaxations.join('; ')}`);
  if (debug.narrative.fallbacksUsed.length > 0)
    console.warn(`Fallbacks used: ${debug.narrative.fallbacksUsed.join('; ')}`);

  console.log(`Confidence: ${debug.narrative.confidence} — ${debug.narrative.confidenceReason}`);
  console.groupEnd();
}
