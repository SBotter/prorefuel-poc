import { createServerClient } from "./server";

const db = () => createServerClient();

export async function getKPIs() {
  const client = db();
  const [sessions, exports_, avgRender, avgProcess] = await Promise.all([
    client.from("processing_sessions").select("id", { count: "exact", head: true }),
    client.from("video_exports").select("id", { count: "exact", head: true }).eq("completed_download", true),
    client.from("video_exports").select("render_duration_ms").eq("render_status", "success"),
    client.from("processing_sessions").select("processing_time_ms").eq("status", "success"),
  ]);

  const totalUploads   = sessions.count ?? 0;
  const totalDownloads = exports_.count ?? 0;
  const conversionRate = totalUploads > 0 ? Math.round((totalDownloads / totalUploads) * 100) : 0;

  const renderTimes   = (avgRender.data ?? []).map((r) => r.render_duration_ms).filter(Boolean) as number[];
  const processTimes  = (avgProcess.data ?? []).map((r) => r.processing_time_ms).filter(Boolean) as number[];
  const avgRenderSec  = renderTimes.length  ? Math.round(renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length / 1000) : 0;
  const avgProcessSec = processTimes.length ? Math.round(processTimes.reduce((a, b) => a + b, 0) / processTimes.length / 1000) : 0;

  return { totalUploads, totalDownloads, conversionRate, avgRenderSec, avgProcessSec };
}

export async function getSessionsOverTime() {
  const { data } = await db()
    .from("processing_sessions")
    .select("created_at")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at");

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const day = r.created_at.slice(0, 10);
    map[day] = (map[day] ?? 0) + 1;
  });

  return Object.entries(map).map(([day, count]) => ({ day, count }));
}

export async function getSessionSuccessOverTime() {
  const { data } = await db()
    .from("processing_sessions")
    .select("created_at, status")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at");

  const map: Record<string, { success: number; error: number }> = {};
  (data ?? []).forEach((r) => {
    const day = r.created_at.slice(0, 10);
    if (!map[day]) map[day] = { success: 0, error: 0 };
    if (r.status === "success") map[day].success++;
    else map[day].error++;
  });

  return Object.entries(map).map(([day, v]) => ({ day, ...v }));
}

export async function getFunnel() {
  const client = db();
  const [uploads, reached, downloaded] = await Promise.all([
    client.from("processing_sessions").select("id", { count: "exact", head: true }),
    // Count only the "click Generate" record (completed_download=false) to avoid
    // double-counting: each completed download creates 2 records with reached_experience=true
    // (one at click time, one at completion). Counting the click record gives unique sessions.
    client.from("video_exports").select("id", { count: "exact", head: true })
      .eq("clicked_record", true)
      .eq("completed_download", false),
    client.from("video_exports").select("id", { count: "exact", head: true }).eq("completed_download", true),
  ]);

  return [
    { name: "Uploaded Files",    value: uploads.count   ?? 0 },
    { name: "Reached Preview",   value: reached.count   ?? 0 },
    { name: "Downloaded Video",  value: downloaded.count ?? 0 },
  ];
}

export async function getRenderStatus() {
  const { data } = await db()
    .from("video_exports")
    .select("render_status")
    .not("render_status", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const k = r.render_status ?? "unknown";
    map[k] = (map[k] ?? 0) + 1;
  });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export async function getRenderDurationBuckets() {
  const { data } = await db()
    .from("video_exports")
    .select("render_duration_ms")
    .not("render_duration_ms", "is", null);

  const buckets: Record<string, number> = { "< 30s": 0, "30–60s": 0, "1–2 min": 0, "> 2 min": 0 };
  (data ?? []).forEach((r) => {
    const ms = r.render_duration_ms ?? 0;
    if (ms < 30_000)       buckets["< 30s"]++;
    else if (ms < 60_000)  buckets["30–60s"]++;
    else if (ms < 120_000) buckets["1–2 min"]++;
    else                   buckets["> 2 min"]++;
  });
  return Object.entries(buckets).map(([name, value]) => ({ name, value }));
}

export async function getCameraModels() {
  const { data } = await db()
    .from("video_uploads")
    .select("camera_model")
    .not("camera_model", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { const k = r.camera_model!; map[k] = (map[k] ?? 0) + 1; });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));
}

export async function getGpsDevices() {
  // Fetch all sessions — filter empty/null in JS to avoid missing entries
  // stored as empty string "" (not SQL NULL) when GPX has no creator attribute.
  const { data } = await db()
    .from("gpx_sessions")
    .select("creator, gps_device_brand, gps_device_model");

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    let key: string | null = null;
    if (r.gps_device_brand && r.gps_device_model) {
      key = `${r.gps_device_brand} ${r.gps_device_model}`;   // e.g. "Garmin Edge 530"
    } else if (r.gps_device_brand) {
      key = r.gps_device_brand;                               // e.g. "Garmin"
    } else if (r.creator?.trim()) {
      key = r.creator.trim();                                 // raw creator fallback
    }
    if (key) map[key] = (map[key] ?? 0) + 1;                 // skip null/empty — no info to show
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, value]) => ({ name, value }));
}

// ── GPS device models breakdown (specific hardware) ───────────────────────────

export async function getGpsDeviceModels() {
  const { data } = await db()
    .from("gpx_sessions")
    .select("gps_device_brand, gps_device_model")
    .not("gps_device_model", "is", null); // only rows where we have a real model

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    if (r.gps_device_model) {
      const k = r.gps_device_brand ? `${r.gps_device_brand} ${r.gps_device_model}` : r.gps_device_model;
      map[k] = (map[k] ?? 0) + 1;
    }
  });

  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, value]) => ({ name, value }));
}

// ── GPS brand breakdown ───────────────────────────────────────────────────────

export async function getGpsDeviceBrands() {
  const { data } = await db()
    .from("gpx_sessions")
    .select("gps_device_brand")
    .not("gps_device_brand", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { if (r.gps_device_brand) map[r.gps_device_brand] = (map[r.gps_device_brand] ?? 0) + 1; });

  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }));
}

export async function getGpsLockStats() {
  const { data } = await db().from("video_uploads").select("has_gps_lock");
  const locked   = (data ?? []).filter((r) => r.has_gps_lock === true).length;
  const noLock   = (data ?? []).filter((r) => r.has_gps_lock === false).length;
  return [
    { name: "GPS Lock", value: locked },
    { name: "No Lock",  value: noLock },
  ];
}

export async function getSyncStrategies() {
  const { data } = await db()
    .from("processing_sessions")
    .select("sync_strategy")
    .not("sync_strategy", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { const k = r.sync_strategy!; map[k] = (map[k] ?? 0) + 1; });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export async function getGpxFieldsPresence() {
  const { data } = await db()
    .from("gpx_sessions")
    .select("has_hr, has_cadence, has_power, has_speed");

  const rows = data ?? [];
  const count = (key: "has_hr" | "has_cadence" | "has_power" | "has_speed") =>
    rows.filter((r) => r[key] === true).length;

  return [
    { name: "Speed (GPS-derived)", value: count("has_speed") },
    { name: "Heart Rate",          value: count("has_hr") },
    { name: "Cadence",             value: count("has_cadence") },
    { name: "Power (Watts)",       value: count("has_power") },
  ];
}

export async function getActivityTypes() {
  const { data } = await db()
    .from("gpx_sessions")
    .select("activity_type")
    .not("activity_type", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { const k = r.activity_type!; map[k] = (map[k] ?? 0) + 1; });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export async function getUnitSystem() {
  const { data } = await db()
    .from("processing_sessions")
    .select("unit_system")
    .not("unit_system", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { const k = r.unit_system!; map[k] = (map[k] ?? 0) + 1; });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export async function getTopLocations() {
  const { data } = await db()
    .from("processing_sessions")
    .select("activity_location")
    .not("activity_location", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { const k = r.activity_location!; map[k] = (map[k] ?? 0) + 1; });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));
}

export async function getTimeOnReady() {
  const { data } = await db()
    .from("video_exports")
    .select("time_on_ready_ms")
    .not("time_on_ready_ms", "is", null);

  const buckets: Record<string, number> = { "< 10s": 0, "10–30s": 0, "30–60s": 0, "> 60s": 0 };
  (data ?? []).forEach((r) => {
    const s = (r.time_on_ready_ms ?? 0) / 1000;
    if (s < 10)      buckets["< 10s"]++;
    else if (s < 30) buckets["10–30s"]++;
    else if (s < 60) buckets["30–60s"]++;
    else             buckets["> 60s"]++;
  });
  return Object.entries(buckets).map(([name, value]) => ({ name, value }));
}

// ── Error Analytics ───────────────────────────────────────────────────────────

export async function getErrorsByCode() {
  const { data } = await db()
    .from("error_events")
    .select("error_code");

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const k = r.error_code ?? "UNKNOWN";
    map[k] = (map[k] ?? 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
}

export async function getErrorsBySource() {
  const { data } = await db()
    .from("error_events")
    .select("error_source");

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const k = r.error_source ?? "unknown";
    map[k] = (map[k] ?? 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
}

export async function getErrorsByDevice() {
  const { data } = await db()
    .from("error_events")
    .select("error_message, error_source");

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const msg = r.error_message ?? "";

    // GPX device: "Device: "Suunto app 2.0.51""
    const deviceMatch = msg.match(/Device:\s*"([^"]+)"/);
    // Unsupported camera: "DJI" or "Insta360"
    const cameraMatch = msg.match(/Unsupported camera:\s*"([^"]+)"/);

    let device: string | null = null;
    if (deviceMatch) {
      const parts = deviceMatch[1].trim().split(/\s+/);
      // Normalize to max 3 tokens to group versions: "Suunto app 5.12.1" → "Suunto app"
      device = parts.length > 2 ? parts.slice(0, 2).join(" ") : parts.join(" ");
    } else if (cameraMatch) {
      device = cameraMatch[1].trim();
    }

    if (device) map[device] = (map[device] ?? 0) + 1;
  });

  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }));
}

export async function getErrorsOverTime() {
  const { data } = await db()
    .from("error_events")
    .select("created_at")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at");

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const day = r.created_at.slice(0, 10);
    map[day] = (map[day] ?? 0) + 1;
  });
  return Object.entries(map).map(([day, count]) => ({ day, count }));
}

export async function getRecentErrors() {
  const { data } = await db()
    .from("error_events")
    .select("created_at, error_code, error_message, error_source, app_version, device_type, device_make, device_model, file_extension")
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((r) => ({
    date:           r.created_at,
    code:           r.error_code,
    message:        r.error_message ?? "",
    source:         r.error_source ?? "",
    version:        r.app_version ?? "",
    device_type:    (r as any).device_type    ?? null,
    device_make:    (r as any).device_make    ?? null,
    device_model:   (r as any).device_model   ?? null,
    file_extension: (r as any).file_extension ?? null,
  }));
}

export async function getErrorKPIs() {
  const client = db();
  const [total, last7d, last24h, allSessions, successSessions] = await Promise.all([
    client.from("error_events").select("id", { count: "exact", head: true }),
    client.from("error_events").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    client.from("error_events").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    client.from("processing_sessions").select("id", { count: "exact", head: true }),
    client.from("processing_sessions").select("id", { count: "exact", head: true }).eq("status", "success"),
  ]);

  const totalErrors      = total.count ?? 0;
  const errorsLast7d     = last7d.count ?? 0;
  const errorsLast24h    = last24h.count ?? 0;
  const totalSessions    = allSessions.count ?? 0;
  const successCount     = successSessions.count ?? 0;
  const errorCount       = totalSessions - successCount;
  const successRate      = totalSessions > 0 ? Math.round((successCount / totalSessions) * 100) : 0;
  const errorSessionRate = totalSessions > 0 ? Math.round((errorCount / totalSessions) * 100) : 0;
  const errorRate        = totalSessions > 0 ? Math.round((totalErrors / Math.max(1, totalSessions)) * 100) : 0;

  return {
    totalErrors, errorsLast7d, errorsLast24h, errorRate,
    totalSessions, successCount, errorCount,
    successRate, errorSessionRate,
  };
}

// ── Mobile download action: Save vs Share to Instagram ───────────────────────
// Requires column: ALTER TABLE video_exports ADD COLUMN download_action text;

export async function getMobileDownloadActions() {
  const { data } = await db()
    .from("video_exports")
    .select("download_action")
    .eq("completed_download", true)
    .not("download_action", "is", null);

  const map: Record<string, number> = { save: 0, share: 0 };
  (data ?? []).forEach(r => {
    const k = r.download_action as string;
    if (k === "save" || k === "share") map[k]++;
  });

  return [
    { name: "Save to Photos / Gallery", value: map.save },
    { name: "Share to Instagram",       value: map.share },
  ].filter(d => d.value > 0);
}

// ── Mobile OS breakdown (iOS vs Android) ─────────────────────────────────────

export async function getMobileOsBreakdown() {
  const { data } = await db()
    .from("processing_sessions")
    .select("device_os")
    .not("device_os", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { if (r.device_os) map[r.device_os] = (map[r.device_os] ?? 0) + 1; });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
}

// ── Device type breakdown (gopro / iphone / android / unknown) ───────────────

export async function getVideoDeviceTypes() {
  const { data } = await db()
    .from("processing_sessions")
    .select("device_type")
    .not("device_type", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => {
    const k = r.device_type ?? "unknown";
    map[k] = (map[k] ?? 0) + 1;
  });
  return Object.entries(map)
    .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
    .sort((a, b) => b.value - a.value);
}

// ── Device makes (Apple, Samsung, GoPro…) ────────────────────────────────────

export async function getVideoDeviceMakes() {
  const { data } = await db()
    .from("processing_sessions")
    .select("device_make")
    .not("device_make", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { if (r.device_make) map[r.device_make] = (map[r.device_make] ?? 0) + 1; });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }));
}

// ── Browser OS breakdown ──────────────────────────────────────────────────────

export async function getBrowserOsBreakdown() {
  const { data } = await db()
    .from("processing_sessions")
    .select("browser_os, browser_is_mobile")
    .not("browser_os", "is", null);

  const osMap: Record<string, number> = {};
  let mobile = 0, desktop = 0;
  (data ?? []).forEach((r) => {
    if (r.browser_os) osMap[r.browser_os] = (osMap[r.browser_os] ?? 0) + 1;
    if (r.browser_is_mobile) mobile++; else desktop++;
  });
  return {
    byOs: Object.entries(osMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
    mobileDesktop: [
      { name: "Mobile",  value: mobile },
      { name: "Desktop", value: desktop },
    ].filter(d => d.value > 0),
  };
}

// ── Processing time distribution ──────────────────────────────────────────────

export async function getProcessingTimeBuckets() {
  const { data } = await db()
    .from("processing_sessions")
    .select("processing_time_ms")
    .eq("status", "success")
    .not("processing_time_ms", "is", null);

  const buckets: Record<string, number> = { "< 5s": 0, "5–15s": 0, "15–30s": 0, "30–60s": 0, "> 60s": 0 };
  (data ?? []).forEach((r) => {
    const ms = r.processing_time_ms ?? 0;
    if (ms < 5_000)        buckets["< 5s"]++;
    else if (ms < 15_000)  buckets["5–15s"]++;
    else if (ms < 30_000)  buckets["15–30s"]++;
    else if (ms < 60_000)  buckets["30–60s"]++;
    else                   buckets["> 60s"]++;
  });
  return Object.entries(buckets).map(([name, value]) => ({ name, value }));
}

// ── Content volume stats (for investor KPIs) ──────────────────────────────────

export async function getContentStats() {
  const [gpxRes, sessionRes, exportRes] = await Promise.all([
    db().from("gpx_sessions").select("distance_m, elevation_gain_m, duration_s"),
    db().from("processing_sessions").select("video_duration_s, scenes_count").eq("status", "success"),
    db().from("video_exports").select("output_duration_s, output_size_bytes").eq("completed_download", true),
  ]);

  const gpxRows     = gpxRes.data    ?? [];
  const sessionRows = sessionRes.data ?? [];
  const exportRows  = exportRes.data  ?? [];

  const totalKm        = Math.round(gpxRows.reduce((s, r) => s + (r.distance_m ?? 0), 0) / 1000);
  const totalElevM     = Math.round(gpxRows.reduce((s, r) => s + (r.elevation_gain_m ?? 0), 0));
  const totalActivityH = Math.round(gpxRows.reduce((s, r) => s + (r.duration_s ?? 0), 0) / 3600 * 10) / 10;
  // Cap at 12h (43200s) to filter historical rows that were stored with an
  // absolute Unix timestamp instead of duration (bug fixed 2026-05-21).
  const MAX_VIDEO_S    = 43_200;
  const totalVideoH    = Math.round(
    sessionRows
      .filter(r => (r.video_duration_s ?? 0) > 0 && (r.video_duration_s ?? 0) <= MAX_VIDEO_S)
      .reduce((s, r) => s + (r.video_duration_s ?? 0), 0) / 3600 * 10
  ) / 10;

  const sceneValues    = sessionRows.map(r => r.scenes_count).filter((v): v is number => v !== null);
  const avgScenes      = sceneValues.length ? Math.round(sceneValues.reduce((s, v) => s + v, 0) / sceneValues.length * 10) / 10 : 0;

  const outDurValues   = exportRows.map(r => r.output_duration_s).filter((v): v is number => v !== null && v > 0);
  const avgOutputSec   = outDurValues.length ? Math.round(outDurValues.reduce((s, v) => s + v, 0) / outDurValues.length) : 0;

  return { totalKm, totalElevM, totalActivityH, totalVideoH, avgScenes, avgOutputSec };
}

// ── Render time percentiles (P50 / P90 / P99) ─────────────────────────────────

export async function getRenderTimePercentiles() {
  const { data } = await db()
    .from("video_exports")
    .select("render_duration_ms")
    .eq("render_status", "success")
    .not("render_duration_ms", "is", null);

  const times = (data ?? []).map(r => r.render_duration_ms ?? 0).sort((a, b) => a - b);
  if (times.length === 0) return { p50: 0, p90: 0, p99: 0, count: 0 };

  const p = (pct: number) => times[Math.min(Math.floor(times.length * pct), times.length - 1)];
  return {
    p50:   Math.round(p(0.50) / 1000),
    p90:   Math.round(p(0.90) / 1000),
    p99:   Math.round(p(0.99) / 1000),
    count: times.length,
  };
}

// ── Render success rate by device type ────────────────────────────────────────
// Uses video_exports.render_status joined via processing_sessions.
// This reflects actual video render outcomes, not just upload processing.

export async function getSuccessRateByDevice() {
  // Fetch exports with render_status, joined via processing_session_id
  const { data: exports_ } = await db()
    .from("video_exports")
    .select("render_status, processing_session_id")
    .not("render_status", "is", null);

  if (!exports_ || exports_.length === 0) return [];

  // Fetch session device types for the session IDs we have
  const sessionIds = [...new Set(exports_.map(e => e.processing_session_id).filter(Boolean))];
  const { data: sessions } = await db()
    .from("processing_sessions")
    .select("id, device_type")
    .in("id", sessionIds.slice(0, 500)); // cap to avoid oversized IN clause

  const sessionMap = new Map((sessions ?? []).map(s => [s.id, s.device_type]));

  const map: Record<string, { success: number; total: number }> = {};
  exports_.forEach(e => {
    const raw = sessionMap.get(e.processing_session_id ?? "") ?? "unknown";
    const k = raw === "gopro"   ? "GoPro"
            : raw === "iphone"  ? "iPhone"
            : raw === "android" ? "Android"
            : "Unknown";
    if (!map[k]) map[k] = { success: 0, total: 0 };
    map[k].total++;
    if (e.render_status === "success") map[k].success++;
  });

  return Object.entries(map)
    .filter(([, v]) => v.total >= 2)
    .map(([device, v]) => ({
      name:        device,
      successRate: Math.round(v.success / v.total * 100),
      total:       v.total,
    }))
    .sort((a, b) => b.total - a.total);
}

// ── Video input duration distribution ─────────────────────────────────────────

export async function getVideoDurationDistribution() {
  const { data } = await db()
    .from("processing_sessions")
    .select("video_duration_s")
    .not("video_duration_s", "is", null)
    .gt("video_duration_s", 0);

  const buckets: Record<string, number> = {
    "< 1 min": 0, "1–5 min": 0, "5–15 min": 0,
    "15–30 min": 0, "30–60 min": 0, "> 1 hour": 0,
  };
  (data ?? []).forEach(r => {
    const s = r.video_duration_s ?? 0;
    if      (s < 60)   buckets["< 1 min"]++;
    else if (s < 300)  buckets["1–5 min"]++;
    else if (s < 900)  buckets["5–15 min"]++;
    else if (s < 1800) buckets["15–30 min"]++;
    else if (s < 3600) buckets["30–60 min"]++;
    else               buckets["> 1 hour"]++;
  });
  return Object.entries(buckets).map(([name, value]) => ({ name, value }));
}

export type DashboardData = Awaited<ReturnType<typeof getAllDashboardData>>;

export async function getAllDashboardData() {
  const [
    kpis, sessionsOverTime, sessionSuccessOverTime, funnel, renderStatus,
    renderDuration, cameraModels, gpsDevices, gpsLock,
    syncStrategies, gpxFields, activityTypes, unitSystem,
    topLocations, timeOnReady, processingTime,
    errorsByCode, errorsBySource, errorsByDevice, errorsOverTime, recentErrors, errorKPIs,
    videoDeviceTypes, videoDeviceMakes, browserOs,
    gpsDeviceModels, gpsDeviceBrands, mobileOsBreakdown, mobileDownloadActions,
    contentStats, renderPercentiles, successByDevice, videoDuration,
  ] = await Promise.all([
    getKPIs(), getSessionsOverTime(), getSessionSuccessOverTime(), getFunnel(), getRenderStatus(),
    getRenderDurationBuckets(), getCameraModels(), getGpsDevices(), getGpsLockStats(),
    getSyncStrategies(), getGpxFieldsPresence(), getActivityTypes(), getUnitSystem(),
    getTopLocations(), getTimeOnReady(), getProcessingTimeBuckets(),
    getErrorsByCode(), getErrorsBySource(), getErrorsByDevice(), getErrorsOverTime(), getRecentErrors(), getErrorKPIs(),
    getVideoDeviceTypes(), getVideoDeviceMakes(), getBrowserOsBreakdown(),
    getGpsDeviceModels(), getGpsDeviceBrands(), getMobileOsBreakdown(), getMobileDownloadActions(),
    getContentStats(), getRenderTimePercentiles(), getSuccessRateByDevice(), getVideoDurationDistribution(),
  ]);

  return {
    kpis, sessionsOverTime, sessionSuccessOverTime, funnel, renderStatus,
    renderDuration, cameraModels, gpsDevices, gpsLock,
    syncStrategies, gpxFields, activityTypes, unitSystem,
    topLocations, timeOnReady, processingTime,
    errorsByCode, errorsBySource, errorsByDevice, errorsOverTime, recentErrors, errorKPIs,
    videoDeviceTypes, videoDeviceMakes, browserOs, mobileOsBreakdown, mobileDownloadActions,
    gpsDeviceModels, gpsDeviceBrands,
    contentStats, renderPercentiles, successByDevice, videoDuration,
  };
}
