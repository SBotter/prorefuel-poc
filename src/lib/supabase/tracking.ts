import type { GpxSessionInsert, ProcessingSessionInsert, VideoExportInsert, VideoUploadInsert } from "./types";

const APP_VERSION = "1.0.29";
const GPX_GAP_THRESHOLD_S = 30;

/**
 * Logs a processing session to Supabase via the /api/track route.
 * Returns the created record ID so child records (gpx_sessions) can link to it.
 * Never throws — returns null on failure.
 */
export async function trackProcessingSession(
  data: Omit<ProcessingSessionInsert, "app_version" | "user_agent">
): Promise<string | null> {
  try {
    const res = await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, app_version: APP_VERSION }),
    });
    if (!res.ok) {
      console.warn("[track] /api/track responded", res.status);
      return null;
    }
    const json = await res.json();
    return json?.id ?? null;
  } catch (err) {
    console.warn("[track] Failed to record processing session:", err);
    return null;
  }
}

// ── GPX metrics computation ───────────────────────────────────────────────────

interface RawPoint {
  lat: number;
  lon: number;
  ele: number;
  time: number;
  hr?: number;
  cad?: number;
  power?: number;
  speed?: number;
}

function haversineM(a: RawPoint, b: RawPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function computeGpxMetrics(
  pts: RawPoint[],
  meta: { creator?: string; activityType?: string; activityName?: string; activityLocation?: string }
): Omit<GpxSessionInsert, "app_version"> {
  if (pts.length === 0) {
    return {
      creator: meta.creator ?? null,
      activity_type: meta.activityType ?? null,
      activity_name: meta.activityName ?? null,
      activity_start_at: null,
      activity_location: meta.activityLocation ?? null,
      total_points: 0,
      avg_sample_interval_s: null,
      has_all_timestamps: false,
      gap_count: 0,
      invalid_point_count: 0,
      duration_s: null,
      distance_m: null,
      elevation_gain_m: null,
      elevation_loss_m: null,
      altitude_max_m: null,
      altitude_min_m: null,
      has_hr: false,
      has_cadence: false,
      has_power: false,
      has_speed: false,
      hr_avg: null,
      hr_max: null,
      power_avg: null,
      power_max: null,
      processing_session_id: null,
    };
  }

  const validPts = pts.filter((p) => !isNaN(p.time));
  const sorted   = [...validPts].sort((a, b) => a.time - b.time);

  // Timestamps
  const hasAllTimestamps = pts.every((p) => !isNaN(p.time));

  // Intervals between consecutive points
  const intervals: number[] = [];
  let gapCount = 0;
  let distanceM = 0;
  let elevationGain = 0;
  let elevationLoss = 0;

  for (let i = 1; i < sorted.length; i++) {
    const dtS = (sorted[i].time - sorted[i - 1].time) / 1000;
    if (dtS > 0) intervals.push(dtS);
    if (dtS > GPX_GAP_THRESHOLD_S) gapCount++;
    distanceM += haversineM(sorted[i - 1], sorted[i]);
    const dEle = sorted[i].ele - sorted[i - 1].ele;
    if (dEle > 0) elevationGain += dEle;
    else elevationLoss += Math.abs(dEle);
  }

  const avgInterval = avg(intervals);
  const eles = pts.map((p) => p.ele).filter((e) => !isNaN(e));
  const invalidCount = pts.filter((p) => p.lat === 0 || p.lon === 0).length;

  // Performance metrics
  const hrValues    = pts.map((p) => p.hr!).filter((v) => v !== undefined && !isNaN(v));
  const powerValues = pts.map((p) => p.power!).filter((v) => v !== undefined && !isNaN(v));

  const firstTime = sorted[0]?.time;
  const lastTime  = sorted[sorted.length - 1]?.time;

  return {
    creator:               meta.creator ?? null,
    activity_type:         meta.activityType ?? null,
    activity_name:         meta.activityName ?? null,
    activity_start_at:     firstTime ? new Date(firstTime).toISOString() : null,
    activity_location:     meta.activityLocation ?? null,
    total_points:          pts.length,
    avg_sample_interval_s: avgInterval !== null ? Math.round(avgInterval * 10) / 10 : null,
    has_all_timestamps:    hasAllTimestamps,
    gap_count:             gapCount,
    invalid_point_count:   invalidCount,
    duration_s:            firstTime && lastTime ? Math.round((lastTime - firstTime) / 1000) : null,
    distance_m:            Math.round(distanceM),
    elevation_gain_m:      Math.round(elevationGain),
    elevation_loss_m:      Math.round(elevationLoss),
    altitude_max_m:        eles.length ? Math.max(...eles) : null,
    altitude_min_m:        eles.length ? Math.min(...eles) : null,
    has_hr:                hrValues.length > 0,
    has_cadence:           pts.some((p) => p.cad !== undefined),
    has_power:             powerValues.length > 0,
    has_speed:             pts.some((p) => p.speed !== undefined),
    hr_avg:                avg(hrValues) !== null ? Math.round(avg(hrValues)!) : null,
    hr_max:                hrValues.length ? Math.max(...hrValues) : null,
    power_avg:             avg(powerValues) !== null ? Math.round(avg(powerValues)!) : null,
    power_max:             powerValues.length ? Math.max(...powerValues) : null,
    processing_session_id: null, // filled in after processing_sessions is created
  };
}

/**
 * Logs a video upload + GPS telemetry to Supabase via /api/track-video.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function trackVideoUpload(
  data: Omit<VideoUploadInsert, "app_version">
): Promise<void> {
  try {
    const res = await fetch("/api/track-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, app_version: APP_VERSION }),
    });
    if (!res.ok) console.warn("[track] track-video responded", res.status);
  } catch (err) {
    console.warn("[track] Failed to record video upload:", err);
  }
}

/**
 * Logs a video export event to Supabase via the /api/track-export route.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function trackVideoExport(
  data: Omit<VideoExportInsert, "app_version">
): Promise<void> {
  try {
    const res = await fetch("/api/track-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, app_version: APP_VERSION }),
    });
    if (!res.ok) console.warn("[track] track-export responded", res.status);
  } catch (err) {
    console.warn("[track] Failed to record video export:", err);
  }
}

/**
 * Logs a GPX session to Supabase via the /api/track-gpx route.
 * Requires processing_session_id — always called after trackProcessingSession.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function trackGpxSession(
  data: Omit<GpxSessionInsert, "app_version">
): Promise<void> {
  try {
    const res = await fetch("/api/track-gpx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, app_version: APP_VERSION }),
    });
    if (!res.ok) console.warn("[track] track-gpx responded", res.status);
  } catch (err) {
    console.warn("[track] Failed to record GPX session:", err);
  }
}
