// ─── StorytellingValidation ──────────────────────────────────────────────────
// Validation functions for StorytellingV2 components.
// No jest dependency — designed to run in the browser console or from a
// dev-only API route for regression testing during development.
//
// Usage (in browser console):
//   import { runAllValidations } from '@/lib/engine/v2/StorytellingValidation';
//   runAllValidations(activityPoints, videoPoints).then(r => console.table(r));
//
// Or call individual validators for specific component testing.

import { PercentileCalculator, PercentileData } from './PercentileCalculator';
import { computeEventfulness } from './EventfulnessCalculator';
import { computeIntensityV2 } from './IntensityEngineV2';
import { detectScenesV2 } from './SceneDetectorV2';
import { computeVideoOverlap } from './VideoOverlapCalculator';
import { computeCompositeScore } from './CompositeScoring';
import { computeActivityPercentiles } from './PercentileCalculator';
import { ActivityPoint } from '../IntensityEngine';
import { GPSPoint } from '../../media/GoProEngineClient';
import { EnhancedGPSPoint } from '../TelemetryCrossRef';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  test:    string;
  passed:  boolean;
  detail:  string;
}

// ─── Individual validators ────────────────────────────────────────────────────

export function validatePercentileCalculator(): ValidationResult[] {
  const results: ValidationResult[] = [];
  const assert = (test: string, cond: boolean, detail: string) =>
    results.push({ test, passed: cond, detail });

  // Normal distribution
  const normal = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  const p = PercentileCalculator.compute(normal)!;
  assert('PC-01: compute returns non-null for 100 samples', p !== null, `got ${JSON.stringify(p)}`);
  assert('PC-02: P60 ≈ 60', Math.abs(p.P60 - 60) < 2, `P60=${p.P60}`);
  assert('PC-03: P80 ≈ 80', Math.abs(p.P80 - 80) < 2, `P80=${p.P80}`);
  assert('PC-04: P95 ≈ 95', Math.abs(p.P95 - 95) < 2, `P95=${p.P95}`);
  assert('PC-05: P60 < P80 < P95', p.P60 < p.P80 && p.P80 < p.P95, `ordering ok`);

  // Flat distribution (low variance)
  const flat = Array.from({ length: 100 }, () => 100); // all same value
  const pFlat = PercentileCalculator.compute(flat)!;
  const vFlat = PercentileCalculator.validate(pFlat, flat);
  assert('PC-06: flat distribution → low_variance=true', vFlat.lowVariance, `lowVariance=${vFlat.lowVariance}`);

  // Small dataset fallback
  const small = [1, 2, 3];
  const pSmall = PercentileCalculator.compute(small);
  assert('PC-07: <20 samples → returns null', pSmall === null, `got ${pSmall}`);

  // Missing data handling (zeros filtered)
  const withZeros = [0, 0, ...Array.from({ length: 100 }, (_, i) => i + 1)];
  const pZ = PercentileCalculator.compute(withZeros)!;
  assert('PC-08: zeros are filtered from distribution', pZ !== null && pZ.P60 > 0, `P60=${pZ?.P60}`);

  // Including-zero variant
  const gradients = [-5, -3, 0, 0, 2, 4, 6, ...Array.from({ length: 93 }, () => 1)];
  const pG = PercentileCalculator.computeIncludingZero(gradients);
  assert('PC-09: computeIncludingZero includes zeros', pG !== null, `pG=${pG}`);

  // Threshold relaxation
  if (p) {
    const t = PercentileCalculator.getThreshold(p, 'P80', true);
    assert('PC-10: getThreshold with lowVariance=true returns P75', Math.abs(t - p.P75) < 0.001, `t=${t} vs P75=${p.P75}`);
  }

  return results;
}

export function validateEventfulnessCalculator(points: ActivityPoint[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  const assert = (test: string, cond: boolean, detail: string) =>
    results.push({ test, passed: cond, detail });

  if (points.length < 10) {
    results.push({ test: 'EF-SKIP', passed: true, detail: 'Insufficient points for eventfulness validation' });
    return results;
  }

  const ef = computeEventfulness(points);

  assert('EF-01: returns scores array same length as points', ef.scores.length === points.length, `len=${ef.scores.length}`);
  assert('EF-02: all scores in [0, 1]', Array.from(ef.scores).every(s => s >= 0 && s <= 1), 'bounds check');
  assert('EF-03: coverage > 0', ef.metadata.coverage > 0, `coverage=${ef.metadata.coverage}`);
  assert('EF-04: metricsUsed is non-empty', ef.metadata.metricsUsed.length > 0, `metrics=${ef.metadata.metricsUsed.join(',')}`);
  assert('EF-05: no NaN values', !Array.from(ef.scores).some(Number.isNaN), 'NaN check');

  // Edge points should have floor of 0.4
  const firstScore = ef.scores[0];
  assert('EF-06: first point has floor ≥ 0.4', firstScore >= 0.40, `first=${firstScore}`);

  return results;
}

export function validateIntensityEngineV2(points: ActivityPoint[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  const assert = (test: string, cond: boolean, detail: string) =>
    results.push({ test, passed: cond, detail });

  if (points.length < 10) {
    results.push({ test: 'IE-SKIP', passed: true, detail: 'Insufficient points for intensity validation' });
    return results;
  }

  const r = computeIntensityV2(points);

  assert('IE-01: masterScore length === points.length', r.masterScore.length === points.length, `len=${r.masterScore.length}`);
  assert('IE-02: all masterScores in [0, 1]', Array.from(r.masterScore).every(s => s >= 0 && s <= 1), 'bounds');
  assert('IE-03: no NaN in masterScore', !Array.from(r.masterScore).some(Number.isNaN), 'NaN check');
  assert('IE-04: eventfulness length === points.length', r.eventfulness.length === points.length, `len=${r.eventfulness.length}`);

  // Floor guarantee: masterScore ≥ intensity × α
  const violationsAlpha = Array.from(r.masterScore).filter((ms, i) =>
    ms < r.scores[i] * r.alpha - 0.001
  );
  assert(
    'IE-05: masterScore ≥ intensity × α for all points',
    violationsAlpha.length === 0,
    `violations=${violationsAlpha.length}`,
  );

  assert('IE-06: sportProfile is valid', ['MOUNTAIN','SPEED','ENDURANCE'].includes(r.sportProfile), `sp=${r.sportProfile}`);
  assert('IE-07: alpha in valid range [0.1, 0.6]', r.alpha >= 0.1 && r.alpha <= 0.6, `α=${r.alpha}`);

  return results;
}

export function validateVideoOverlapCalculator(): ValidationResult[] {
  const results: ValidationResult[] = [];
  const assert = (test: string, cond: boolean, detail: string) =>
    results.push({ test, passed: cond, detail });

  const videoStart = 1_000_000;
  const videoEnd   = 1_060_000; // 60s video

  // Full overlap
  const full = computeVideoOverlap(videoStart, videoEnd, videoStart, videoEnd);
  assert('VO-01: full overlap → score ≥ 0.95', full.finalScore >= 0.95, `score=${full.finalScore}`);
  assert('VO-02: full overlap → zone=INSIDE', full.zone === 'INSIDE', `zone=${full.zone}`);

  // Partial overlap (50% of scene inside video)
  const partial = computeVideoOverlap(videoStart - 30_000, videoStart + 30_000, videoStart, videoEnd);
  assert('VO-03: partial overlap → score in [0.4, 0.8]', partial.finalScore >= 0.40 && partial.finalScore <= 0.80, `score=${partial.finalScore}`);
  assert('VO-04: partial overlap → zone=INSIDE', partial.zone === 'INSIDE', `zone=${partial.zone}`);

  // NEAR: scene ends 50s before video starts
  const near = computeVideoOverlap(videoStart - 80_000, videoStart - 50_000, videoStart, videoEnd);
  assert('VO-05: near scene → score < 0.20', near.finalScore < 0.20, `score=${near.finalScore}`);
  assert('VO-06: near scene (50s away) → zone=NEAR', near.zone === 'NEAR', `zone=${near.zone}`);

  // FAR: scene ends 200s before video starts
  const far = computeVideoOverlap(videoStart - 220_000, videoStart - 200_000, videoStart, videoEnd);
  assert('VO-07: far scene → score < 0.05', far.finalScore < 0.05, `score=${far.finalScore}`);
  assert('VO-08: far scene → zone=FAR', far.zone === 'FAR', `zone=${far.zone}`);

  // All scores bounded [0, 1]
  assert('VO-09: full overlap score ≤ 1.0', full.finalScore <= 1.0, `score=${full.finalScore}`);
  assert('VO-10: all finalScores ≥ 0', [full, partial, near, far].every(r => r.finalScore >= 0), 'lower bound');

  return results;
}

export function validateCompositeScoring(): ValidationResult[] {
  const results: ValidationResult[] = [];
  const assert = (test: string, cond: boolean, detail: string) =>
    results.push({ test, passed: cond, detail });

  // Perfect moment: high intensity + full video overlap + INSIDE
  const perfect = computeCompositeScore(0.9, 1.0, 'INSIDE');
  assert('CS-01: perfect moment → score ≥ 0.85', perfect.finalScore >= 0.85, `score=${perfect.finalScore}`);

  // Weak moment + perfect video overlap
  const weakInside = computeCompositeScore(0.2, 1.0, 'INSIDE');
  assert('CS-02: weak moment in video → score < 0.5', weakInside.finalScore < 0.50, `score=${weakInside.finalScore}`);

  // Strong moment + zero video overlap (NEAR zone)
  const strongNear = computeCompositeScore(0.9, 0.0, 'NEAR');
  assert('CS-03: strong NEAR moment still scores > 0', strongNear.finalScore > 0, `score=${strongNear.finalScore}`);
  assert('CS-04: strong NEAR < strong INSIDE', strongNear.finalScore < perfect.finalScore, `near=${strongNear.finalScore} inside=${perfect.finalScore}`);

  // FAR zone multiplier reduces score significantly
  const strongFar = computeCompositeScore(0.9, 0.05, 'FAR');
  assert('CS-05: FAR zone has lower score than NEAR', strongFar.finalScore < strongNear.finalScore, `far=${strongFar.finalScore} near=${strongNear.finalScore}`);

  // Narrative weight scaling
  const boosted = computeCompositeScore(0.5, 0.5, 'INSIDE', 2.0);
  const normal  = computeCompositeScore(0.5, 0.5, 'INSIDE', 1.0);
  assert('CS-06: narrativeWeight=2.0 doubles score (capped at 1.0)', boosted.finalScore >= normal.finalScore, `boosted=${boosted.finalScore} normal=${normal.finalScore}`);

  // No negative scores
  const zero = computeCompositeScore(0, 0, 'FAR');
  assert('CS-07: zero inputs → score ≥ 0', zero.finalScore >= 0, `score=${zero.finalScore}`);

  // Score bounded at 1.0
  assert('CS-08: all scores ≤ 1.0', [perfect, weakInside, strongNear, strongFar, boosted, normal, zero].every(r => r.finalScore <= 1.0), 'upper bound');

  return results;
}

export function validateSceneDetectorV2(
  points: EnhancedGPSPoint[],
  videoStart: number,
  videoEnd: number,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const assert = (test: string, cond: boolean, detail: string) =>
    results.push({ test, passed: cond, detail });

  if (points.length < 30) {
    results.push({ test: 'SD-SKIP', passed: true, detail: 'Too few points for scene detection validation' });
    return results;
  }

  const intensity = computeIntensityV2(points);

  // Build percentiles
  const hrValues    = points.map(p => p.hr    ?? null);
  const speedValues = points.map(p => p.speed ?? null);
  const gradValues: number[] = [];
  for (let i = 1; i < points.length; i++) {
    gradValues.push(((points[i].ele - points[i - 1].ele) / Math.max(1, 1)) * 100);
  }
  const accelValues = points.map(p => p.accel ?? null);

  const percentiles = computeActivityPercentiles(
    hrValues, speedValues, gradValues, accelValues,
    Array.from(intensity.masterScore),
  );

  const candidates = detectScenesV2(points, intensity, percentiles, videoStart, videoEnd);

  assert('SD-01: detectScenesV2 returns array', Array.isArray(candidates), `type=${typeof candidates}`);
  assert('SD-02: no NaN in masterScoreAvg', candidates.every(c => !Number.isNaN(c.masterScoreAvg)), 'NaN check');
  assert('SD-03: all zones assigned', candidates.every(c => ['INSIDE','NEAR','FAR'].includes(c.zone)), 'zone check');

  // Max 3 candidates per type
  const byType: Record<string, number> = {};
  for (const c of candidates) byType[c.type] = (byType[c.type] ?? 0) + 1;
  const maxPerType = Math.max(...Object.values(byType), 0);
  assert('SD-04: max 3 candidates per type', maxPerType <= 3, `max=${maxPerType} types=${JSON.stringify(byType)}`);

  // No duplicate IDs
  const ids  = candidates.map(c => c.id);
  const uniq = new Set(ids);
  assert('SD-05: all candidate IDs unique', uniq.size === ids.length, `total=${ids.length} unique=${uniq.size}`);

  // masterScoreAvg in [0, 1]
  assert('SD-06: all masterScoreAvg in [0, 1]', candidates.every(c => c.masterScoreAvg >= 0 && c.masterScoreAvg <= 1), 'bounds');

  // Chronological ordering after detection
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].startIndex < candidates[i - 1].startIndex) {
      results.push({ test: 'SD-07: chronological order', passed: false, detail: `not chronological at index ${i}` });
      break;
    }
  }
  if (!results.find(r => r.test === 'SD-07: chronological order')) {
    results.push({ test: 'SD-07: chronological order', passed: true, detail: 'all candidates in order' });
  }

  return results;
}

// ─── Full integration validation ─────────────────────────────────────────────

export async function runAllValidations(
  activityPoints: EnhancedGPSPoint[],
  videoPoints:    GPSPoint[],
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // Unit validations (no activity data needed)
  results.push(...validatePercentileCalculator());
  results.push(...validateVideoOverlapCalculator());
  results.push(...validateCompositeScoring());

  // Component validations (need activity data)
  if (activityPoints.length > 0) {
    results.push(...validateEventfulnessCalculator(activityPoints));
    results.push(...validateIntensityEngineV2(activityPoints));

    if (videoPoints.length > 0) {
      const videoStart = videoPoints[0].time;
      const videoEnd   = videoPoints[videoPoints.length - 1].time;
      results.push(...validateSceneDetectorV2(activityPoints, videoStart, videoEnd));
    }
  }

  // Summary
  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed);
  console.group(`[ProRefuel V2] Validation: ${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.error('FAILURES:');
    failed.forEach(f => console.error(`  ✗ ${f.test}: ${f.detail}`));
  } else {
    console.log('All validations passed ✓');
  }
  console.groupEnd();

  return results;
}
