/**
 * GPXAnalyzer — deep structural analysis of a GPX file.
 * Device-agnostic: works with any GPX from any creator.
 * Produces a GPXProfile used by SyncStrategySelector to choose
 * the right sync method and thresholds.
 */

export interface SamplingStats {
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  isRegular: boolean; // true if p95 < 3× median (regular 1Hz vs smart recording)
}

export interface GPXGap {
  startIdx: number;
  endIdx: number;
  durationSec: number;
  distanceM: number;
}

export interface GPXSensors {
  hasHeartRate: boolean;
  hasCadence: boolean;
  hasPower: boolean;
  hasTemperature: boolean;
  hasHDOP: boolean;
  hasExplicitSpeed: boolean;
}

export interface GPXProfile {
  // Identity
  creator: string;
  activityStart: Date | null;

  // Volume
  totalPoints: number;
  durationSec: number;
  totalDistanceM: number;
  avgSpeedKmh: number;

  // Sampling quality — CRITICAL for sync threshold selection
  samplingInterval: SamplingStats;
  gaps: GPXGap[];                  // gaps > 10 s
  totalGapSec: number;

  // Position quality
  boundingBox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  hdopStats: { available: boolean; mean: number; max: number };

  // Sensors present
  sensors: GPXSensors;

  // Derived recommendations for sync engine
  recommendedSyncThresholdM: number;  // dynamic, based on interval + speed
  recommendedTimeWindowMs: number;    // dynamic, based on p95 gap
}

// ── Haversine (metres) ────────────────────────────────────────────────────────
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ── Extension helpers ─────────────────────────────────────────────────────────
function extVal(trkpt: Element, ...tags: string[]): number | null {
  for (const tag of tags) {
    // Direct child (e.g. <hdop>)
    const direct = trkpt.querySelector(tag);
    if (direct?.textContent) return parseFloat(direct.textContent);
    // Extension child with namespace prefix (e.g. gpxtpx:hr → local name "hr")
    for (const el of Array.from(trkpt.getElementsByTagName('*'))) {
      if (el.localName === tag && el.textContent) return parseFloat(el.textContent);
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export class GPXAnalyzer {
  static analyze(xmlText: string): GPXProfile {
    const dom    = new DOMParser().parseFromString(xmlText, 'text/xml');
    const gpxEl  = dom.querySelector('gpx');
    const creator = gpxEl?.getAttribute('creator') ?? 'unknown';

    // Activity start from <metadata><time>
    const metaTime = dom.querySelector('metadata > time')?.textContent;
    const activityStart = metaTime ? new Date(metaTime) : null;

    // All track points
    const trkpts = Array.from(dom.querySelectorAll('trkpt'));
    const totalPoints = trkpts.length;

    if (totalPoints < 2) {
      return this._empty(creator, activityStart);
    }

    // ── Parse all points ───────────────────────────────────────────────────
    type RawPt = { lat: number; lon: number; ele: number; time: number; hdop: number | null };
    const pts: RawPt[] = trkpts.map(tp => ({
      lat:  parseFloat(tp.getAttribute('lat') ?? '0'),
      lon:  parseFloat(tp.getAttribute('lon') ?? '0'),
      ele:  parseFloat(tp.querySelector('ele')?.textContent ?? '0'),
      time: new Date(tp.querySelector('time')?.textContent ?? '').getTime(),
      hdop: extVal(tp, 'hdop'),
    })).filter(p => isFinite(p.time) && isFinite(p.lat));

    if (pts.length < 2) return this._empty(creator, activityStart);

    // ── Sampling intervals ────────────────────────────────────────────────
    const intervals: number[] = [];
    const distances: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const dt = pts[i].time - pts[i - 1].time;
      const dm = haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
      if (dt > 0) intervals.push(dt);
      distances.push(dm);
    }
    const sortedIntervals = [...intervals].sort((a, b) => a - b);
    const medianMs  = percentile(sortedIntervals, 0.5);
    const p95Ms     = percentile(sortedIntervals, 0.95);
    const samplingInterval: SamplingStats = {
      minMs:     sortedIntervals[0],
      maxMs:     sortedIntervals[sortedIntervals.length - 1],
      meanMs:    intervals.reduce((s, v) => s + v, 0) / intervals.length,
      medianMs,
      p95Ms,
      isRegular: p95Ms < medianMs * 3,
    };

    // ── Gaps (> 10 s) ─────────────────────────────────────────────────────
    const GAP_THRESHOLD_MS = 10_000;
    const gaps: GPXGap[] = [];
    let totalGapSec = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = pts[i].time - pts[i - 1].time;
      if (dt > GAP_THRESHOLD_MS) {
        const durSec = dt / 1000;
        const distM  = haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
        gaps.push({ startIdx: i - 1, endIdx: i, durationSec: durSec, distanceM: distM });
        totalGapSec += durSec;
      }
    }

    // ── Bounding box ──────────────────────────────────────────────────────
    let minLat = pts[0].lat, maxLat = pts[0].lat;
    let minLon = pts[0].lon, maxLon = pts[0].lon;
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    // ── Total distance & speed ─────────────────────────────────────────────
    const totalDistanceM = distances.reduce((s, v) => s + v, 0);
    const durationSec    = (pts[pts.length - 1].time - pts[0].time) / 1000;
    const avgSpeedKmh    = durationSec > 0 ? (totalDistanceM / durationSec) * 3.6 : 0;

    // ── HDOP stats ────────────────────────────────────────────────────────
    const hdopVals = pts.map(p => p.hdop).filter((v): v is number => v !== null);
    const hdopStats = hdopVals.length > 0
      ? { available: true, mean: hdopVals.reduce((s, v) => s + v, 0) / hdopVals.length, max: Math.max(...hdopVals) }
      : { available: false, mean: 0, max: 0 };

    // ── Sensors — check first 50 points to detect availability ────────────
    const sampleTrkpts = trkpts.slice(0, Math.min(50, trkpts.length));
    const sensors: GPXSensors = {
      hasHeartRate:     sampleTrkpts.some(tp => extVal(tp, 'hr', 'heartrate') !== null),
      hasCadence:       sampleTrkpts.some(tp => extVal(tp, 'cad', 'cadence') !== null),
      hasPower:         sampleTrkpts.some(tp => extVal(tp, 'power', 'watts') !== null),
      hasTemperature:   sampleTrkpts.some(tp => extVal(tp, 'atemp', 'temp', 'temperature') !== null),
      hasHDOP:          hdopStats.available,
      hasExplicitSpeed: sampleTrkpts.some(tp => extVal(tp, 'speed') !== null),
    };

    // ── Sync recommendations ──────────────────────────────────────────────
    // threshold = max distance a GPS point can travel between two consecutive
    // GPX samples. At the median interval and average speed, this is the
    // spatial "gap" we need to bridge. Add 50% margin for GPS noise.
    const avgSpeedMs = avgSpeedKmh / 3.6;
    const rawThreshold = (medianMs / 1000) * avgSpeedMs * 1.5;
    // Floor at 10m (combined GPS noise floor), ceil at 60m.
    const recommendedSyncThresholdM = Math.max(10, Math.min(60, rawThreshold));
    // Time window: at least 30s (covers clock drifts ≤15s), or 3× p95 if larger.
    const recommendedTimeWindowMs = Math.max(30_000, p95Ms * 3);

    const profile: GPXProfile = {
      creator, activityStart,
      totalPoints: pts.length, durationSec, totalDistanceM, avgSpeedKmh,
      samplingInterval, gaps, totalGapSec,
      boundingBox: { minLat, maxLat, minLon, maxLon },
      hdopStats, sensors,
      recommendedSyncThresholdM, recommendedTimeWindowMs,
    };

    console.log(`[GPXAnalyzer] creator="${creator}" pts=${pts.length} dur=${Math.round(durationSec)}s`);
    console.log(`[GPXAnalyzer] interval: median=${medianMs}ms p95=${p95Ms}ms regular=${samplingInterval.isRegular}`);
    console.log(`[GPXAnalyzer] gaps=${gaps.length} avgSpeed=${avgSpeedKmh.toFixed(1)}km/h dist=${(totalDistanceM/1000).toFixed(1)}km`);
    console.log(`[GPXAnalyzer] sensors: HR=${sensors.hasHeartRate} cad=${sensors.hasCadence} pwr=${sensors.hasPower} hdop=${sensors.hasHDOP}`);
    console.log(`[GPXAnalyzer] → sync threshold=${recommendedSyncThresholdM.toFixed(1)}m window=${recommendedTimeWindowMs}ms`);

    return profile;
  }

  private static _empty(creator: string, activityStart: Date | null): GPXProfile {
    return {
      creator, activityStart,
      totalPoints: 0, durationSec: 0, totalDistanceM: 0, avgSpeedKmh: 0,
      samplingInterval: { minMs: 0, maxMs: 0, meanMs: 0, medianMs: 1000, p95Ms: 1000, isRegular: true },
      gaps: [], totalGapSec: 0,
      boundingBox: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      hdopStats: { available: false, mean: 0, max: 0 },
      sensors: { hasHeartRate: false, hasCadence: false, hasPower: false, hasTemperature: false, hasHDOP: false, hasExplicitSpeed: false },
      recommendedSyncThresholdM: 10,
      recommendedTimeWindowMs: 30_000,
    };
  }
}
