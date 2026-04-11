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

export async function getFunnel() {
  const client = db();
  const [uploads, reached, downloaded] = await Promise.all([
    client.from("processing_sessions").select("id", { count: "exact", head: true }),
    client.from("video_exports").select("id", { count: "exact", head: true }).eq("reached_experience", true),
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
  const { data } = await db()
    .from("gpx_sessions")
    .select("creator")
    .not("creator", "is", null);

  const map: Record<string, number> = {};
  (data ?? []).forEach((r) => { const k = r.creator!; map[k] = (map[k] ?? 0) + 1; });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
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
    { name: "Heart Rate", value: count("has_hr") },
    { name: "Cadence",    value: count("has_cadence") },
    { name: "Power",      value: count("has_power") },
    { name: "Speed",      value: count("has_speed") },
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

export type DashboardData = Awaited<ReturnType<typeof getAllDashboardData>>;

export async function getAllDashboardData() {
  const [
    kpis, sessionsOverTime, funnel, renderStatus,
    renderDuration, cameraModels, gpsDevices, gpsLock,
    syncStrategies, gpxFields, activityTypes, unitSystem,
    topLocations, timeOnReady,
  ] = await Promise.all([
    getKPIs(), getSessionsOverTime(), getFunnel(), getRenderStatus(),
    getRenderDurationBuckets(), getCameraModels(), getGpsDevices(), getGpsLockStats(),
    getSyncStrategies(), getGpxFieldsPresence(), getActivityTypes(), getUnitSystem(),
    getTopLocations(), getTimeOnReady(),
  ]);

  return {
    kpis, sessionsOverTime, funnel, renderStatus,
    renderDuration, cameraModels, gpsDevices, gpsLock,
    syncStrategies, gpxFields, activityTypes, unitSystem,
    topLocations, timeOnReady,
  };
}
