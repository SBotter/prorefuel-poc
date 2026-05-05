"use client";

import { useState, useRef, useEffect } from "react";
import {
  Upload,
  CheckCircle2,
  Loader2,
  Gauge,
  Shield,
  Zap,
  Smartphone,
  Lock,
  PlayCircle,
} from "lucide-react";
import MapEngine from "@/components/MapEngine";
import { trackProcessingSession, trackGpxSession, computeGpxMetrics, trackVideoExport, trackVideoUpload } from "@/lib/supabase/tracking";
import type { RenderResult } from "@/components/MapEngine";
import type { VideoUploadInsert } from "@/lib/supabase/types";
import {
  ActionSegment,
  TelemetryCrossRef,
} from "@/lib/engine/TelemetryCrossRef";
import { SyncEngine } from "@/lib/engine/SyncEngine";
import { GoProEngineClient } from "@/lib/media/GoProEngineClient";
import {
  StorytellingProcessor,
  StoryPlan,
} from "@/lib/engine/StorytellingProcessor";
import { UnitSystem } from "@/lib/utils/units";
import { GPXAnalyzer, GPXProfile } from "@/lib/engine/GPXAnalyzer";
import {
  VideoGPSAnalyzer,
  VideoGPSProfile,
} from "@/lib/engine/VideoGPSAnalyzer";
import { SyncStrategySelector } from "@/lib/engine/SyncStrategySelector";
import { CameraDetector } from "@/lib/media/CameraDetector";
import { iPhoneEngineClient } from "@/lib/media/iPhoneEngineClient";
import { iPhoneVideoGPSAnalyzer } from "@/lib/engine/iphone/iPhoneVideoGPSAnalyzer";

// ── Device detection helpers ──────────────────────────────────────────────
const LOGO_BASE = "/devices/logos";

interface DeviceInfo { label: string; logoFile: string; }

function detectGPSDevice(creatorRaw: string): DeviceInfo {
  const c     = creatorRaw.toLowerCase();
  const clean = creatorRaw.replace(/[_\-]/g, " ").trim();
  if (c.includes("garmin"))  return { label: clean || "Garmin",  logoFile: `${LOGO_BASE}/garmin_logo.svg` };
  if (c.includes("suunto"))  return { label: clean || "Suunto",  logoFile: `${LOGO_BASE}/suunto_logo.svg` };
  if (c.includes("strava"))  return { label: "Strava",           logoFile: `${LOGO_BASE}/strava_logo.svg` };
  if (c.includes("wahoo"))   return { label: clean || "Wahoo",   logoFile: "" };
  if (c.includes("polar"))   return { label: clean || "Polar",   logoFile: "" };
  if (c.includes("coros"))   return { label: clean || "Coros",   logoFile: "" };
  if (c.includes("komoot"))  return { label: "Komoot",           logoFile: "" };
  if (c.includes("bryton"))  return { label: clean || "Bryton",  logoFile: "" };
  if (c.includes("lezyne"))  return { label: clean || "Lezyne",  logoFile: "" };
  if (clean) return { label: clean, logoFile: "" };
  return { label: "", logoFile: "" };
}

function detectCamera(cameraModel: string): DeviceInfo {
  const c = cameraModel.toLowerCase();
  if (c.includes("gopro"))    return { label: cameraModel, logoFile: `${LOGO_BASE}/gopro_logo.svg` };
  if (c.includes("dji"))      return { label: cameraModel, logoFile: "" };
  if (c.includes("insta360")) return { label: cameraModel, logoFile: "" };
  if (c.includes("sony"))     return { label: cameraModel, logoFile: "" };
  if (cameraModel)            return { label: cameraModel, logoFile: "" };
  return { label: "", logoFile: "" };
}

export default function ProRefuelPage() {
  const [mounted, setMounted] = useState(false);
  const [activityPoints, setActivityPoints] = useState<any[]>([]);
  const [gpxProfile, setGpxProfile] = useState<GPXProfile | null>(null);
  const [highlights, setHighlights] = useState<ActionSegment[]>([]);
  const [storyPlan, setStoryPlan] = useState<StoryPlan | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<"UPLOAD" | "READY" | "EXPERIENCE">("UPLOAD");
  const [statusMsg, setStatusMsg] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [unit, setUnit] = useState<UnitSystem>("metric");
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [activityMeta, setActivityMeta] = useState<{ name: string; location?: string; gpsDevice?: DeviceInfo; camera?: DeviceInfo }>({ name: "EPIC RIDE" });
  const mapEngineRef = useRef<{
    start: () => void;
    startRecording: () => Promise<void>;
    isRecording: boolean;
  }>(null);
  const gpxMetricsRef = useRef<ReturnType<typeof computeGpxMetrics> | null>(null);
  const videoMetricsRef = useRef<Omit<VideoUploadInsert, "app_version" | "processing_session_id"> | null>(null);
  const processingSessionIdRef = useRef<string | null>(null);
  const readyStepStartRef = useRef<number | null>(null);
  const experienceStartRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    // Detect real mobile OS via User-Agent — screen size is intentionally NOT used,
    // so a small laptop window still gets the full app experience.
    const ua = navigator.userAgent;
    setIsMobileDevice(/iPhone|iPad|iPod|Android/i.test(ua));
  }, []);
  if (!mounted) return <div className="min-h-screen bg-[#050505]" />;
  if (isMobileDevice) return <MobileLanding />;

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // ── File type guard ───────────────────────────────────────────────────────
    const nameLc = file.name.toLowerCase();
    const isMP4  = nameLc.endsWith(".mp4") || file.type === "video/mp4";
    const isMOV  = nameLc.endsWith(".mov") || file.type === "video/quicktime";
    if (!isMP4 && !isMOV) {
      setUploadError("Unsupported format. Use .mp4 (GoPro) or .mov (iPhone).");
      e.target.value = "";
      return;
    }

    setLoading(true);
    setUploadError(null);
    setProgress(0);
    const processingStart = Date.now();
    const interval = setInterval(
      () => setProgress((p) => (p >= 98 ? 98 : p + 1)),
      150,
    );
    try {
      // ── Detect camera type before any heavy work ──────────────────────────
      // Fast path: filename → extension (zero I/O). exifr is only used as
      // last resort for files that are neither .mp4 nor .mov.
      setStatusMsg("Identifying camera...");
      const cameraDetection = await CameraDetector.detect(file);
      const isIPhone = cameraDetection.type === 'iphone';

      // ── GoPro: set video file immediately so it loads in parallel ─────────
      // GoPro MP4 has moov at the START — the browser reads only the header
      // (< 1 MB) and is ready to play within milliseconds. Loading in parallel
      // with the 30-120s GPMF worker means the video is always ready when the
      // READY screen appears.
      // iPhone MOV is intentionally deferred (setVideoFile below, after processing)
      // because MOV has moov at the END — an early preload would scan the entire
      // file causing disk I/O lag. MapEngine uses preload="none" for MOV and lets
      // the pre-seek during INTRO trigger loading naturally.
      if (!isIPhone) {
        setVideoFile(file);
      }

      if (cameraDetection.type === 'unknown') {
        throw new Error(
          `Camera not supported: ${cameraDetection.make || 'unknown'}. Use GoPro (.mp4) or iPhone (.mov).`
        );
      }

      // ── Extract telemetry — branched by camera type ───────────────────────
      let vpts: any[];
      let syncPoints: any[];
      let cameraModel: string;
      let gpsVideoOffsetMs: number;
      let iPhoneVideoStartMs = 0;
      let iPhoneDurationMs   = 0;
      let iPhoneHasStartGPS  = false;

      if (isIPhone) {
        // iPhone MOV pipeline — uses QuickTime metadata (CreateDate + Duration)
        setStatusMsg("Reading iPhone metadata...");
        const result = await iPhoneEngineClient.extractTelemetry(file);
        vpts             = result.points;
        syncPoints       = result.syncPoints;
        cameraModel      = result.cameraModel;
        gpsVideoOffsetMs = result.gpsVideoOffsetMs; // always 0 for iPhone
        iPhoneVideoStartMs = result.videoStartMs;
        iPhoneDurationMs   = result.durationMs;
        iPhoneHasStartGPS  = result.hasStartGPS;

        // ── Align iPhone NTP → GPS UTC ──────────────────────────────────────
        // iPhone CreateDate is often stored in local time (not UTC). This causes
        // all videoStartTime values to be negative → clamped to 0 → every clip
        // starts at t=0 → the video appears to "loop" (same footage plays N times).
        //
        // Strategy A (spatial): if iPhone has a recording-start GPS coordinate,
        // find the matching activity GPS point and compute the exact offset.
        //
        // Strategy B (timezone scan): if no GPS or spatial match fails, scan all
        // common timezone offsets (-12h → +14h in 30-min steps) and pick the one
        // where the video window overlaps with the activity. This catches any
        // timezone mismatch regardless of whether the iPhone had Location Services.
        if (activityPoints.length >= 5) {
          let clockCorrected = false;

          // Strategy A: spatial match using recording-start GPS coordinate
          if (iPhoneHasStartGPS && vpts[0].lat !== 0) {
            const iPhoneClockOffset = estimateIPhoneClockOffsetMs(
              vpts[0].lat, vpts[0].lon, iPhoneVideoStartMs, activityPoints,
            );
            if (iPhoneClockOffset !== 0) {
              vpts               = vpts.map((p: any) => ({ ...p, time: p.time - iPhoneClockOffset }));
              iPhoneVideoStartMs = iPhoneVideoStartMs - iPhoneClockOffset;
              clockCorrected = true;
              console.log(`[iPhone Sync] Strategy A (spatial): offset=${iPhoneClockOffset}ms`);
            }
          }

          // Strategy B: timezone scan — activates when spatial fails or iPhone has no GPS.
          // Checks if the (possibly corrected) video window overlaps with the activity.
          if (!clockCorrected) {
            const actStart   = activityPoints[0].time;
            const actEnd     = activityPoints[activityPoints.length - 1].time;
            const vidStart   = vpts[0].time;
            const vidEnd     = vpts[vpts.length - 1].time;
            const alreadyOk  = vidStart <= actEnd + 60_000 && vidEnd >= actStart - 60_000;

            if (!alreadyOk) {
              // Scan -12h to +14h in 30-min steps (52 iterations)
              let bestOffset  = 0;
              let bestOverlap = 0;
              for (let tzMin = -720; tzMin <= 840; tzMin += 30) {
                const offsetMs  = tzMin * 60_000;
                const adjStart  = vidStart - offsetMs;
                const adjEnd    = vidEnd   - offsetMs;
                const overlap   = Math.max(0, Math.min(adjEnd, actEnd) - Math.max(adjStart, actStart));
                if (overlap > bestOverlap) { bestOverlap = overlap; bestOffset = offsetMs; }
              }
              if (bestOffset !== 0) {
                console.log(`[iPhone Sync] Strategy B (timezone scan): offset=${bestOffset / 3_600_000}h`);
                vpts               = vpts.map((p: any) => ({ ...p, time: p.time - bestOffset }));
                iPhoneVideoStartMs = iPhoneVideoStartMs - bestOffset;
              } else {
                console.warn('[iPhone Sync] Strategy B: no timezone offset gives overlap — timestamps may be wrong');
              }
            }
          }
        }
      } else {
        // GoPro MP4 pipeline — uses GPMF telemetry stream (unchanged)
        setStatusMsg("Analysing GPMF...");
        const result = await GoProEngineClient.extractTelemetry(file);
        vpts             = result.points;
        syncPoints       = result.syncPoints;
        cameraModel      = result.cameraModel;
        gpsVideoOffsetMs = result.gpsVideoOffsetMs;
      }

      // ── Detect camera from model string or filename fallback ─────────────
      let resolvedModel = cameraModel || cameraDetection.model || cameraDetection.make;
      if (!resolvedModel) {
        const fn = file.name.toUpperCase();
        if (/^G[HXL]\d{6}\.MP4$/.test(fn) || fn.startsWith("GOPR") || fn.startsWith("GP"))
          resolvedModel = "GoPro";
        else if (fn.startsWith("DJI_") || fn.includes("DJI"))
          resolvedModel = "DJI";
        else if (fn.includes("INSTA360") || fn.startsWith("_INSP"))
          resolvedModel = "Insta360";
      }
      if (resolvedModel) {
        const camera = detectCamera(resolvedModel);
        if (camera.label) setActivityMeta(prev => ({ ...prev, camera }));
      }

      // ── Validate: video must have GPS data (GoPro only — iPhone uses timestamps) ──
      if (!isIPhone && vpts.length === 0) {
        throw new Error("No GPS in this video. Enable GPS on your GoPro before recording.");
      }

      // ── Analyse video GPS structure ──────────────────────────────────────
      const videoProfile = isIPhone
        ? iPhoneVideoGPSAnalyzer.analyze(iPhoneVideoStartMs, iPhoneDurationMs, iPhoneHasStartGPS)
        : VideoGPSAnalyzer.analyze(vpts, gpsVideoOffsetMs);

      // ── Validate: GPS lock must have been acquired (GoPro only) ──────────
      if (!isIPhone && (!videoProfile.hasGPSLock || videoProfile.postLockPoints === 0)) {
        throw new Error("GPS signal too weak — no valid fix during recording.");
      }

      // ── Store video metrics — persisted after processing_session is created ──
      const totalPts = vpts.length;
      const fixDist  = videoProfile.fixDistribution;
      const fixTotal = (fixDist.fix0 + fixDist.fix2 + fixDist.fix3) || 1;
      // For iPhone: GPS start/end come from CreateDate + Duration (not a GPS track).
      const gpsStartUtc = isIPhone
        ? new Date(iPhoneVideoStartMs).toISOString()
        : (totalPts > 0 ? new Date((vpts[0] as any).time).toISOString() : null);
      const gpsEndUtc = isIPhone
        ? new Date(iPhoneVideoStartMs + iPhoneDurationMs).toISOString()
        : (totalPts > 0 ? new Date((vpts[totalPts - 1] as any).time).toISOString() : null);
      videoMetricsRef.current = {
        filename:                 file.name,
        file_size_bytes:          file.size,
        camera_model:             resolvedModel ?? null,
        has_gps:                  isIPhone ? iPhoneHasStartGPS : totalPts > 0,
        gps_points_count:         totalPts,
        gps_duration_s:           videoProfile.durationSec,
        gps_sampling_interval_ms: videoProfile.samplingIntervalMs,
        gps_start_utc:            gpsStartUtc,
        gps_end_utc:              gpsEndUtc,
        gps_video_offset_ms:      gpsVideoOffsetMs,
        has_gps_lock:             videoProfile.hasGPSLock,
        gps_lock_latency_s:       videoProfile.lockLatencySec,
        pre_lock_points:          videoProfile.preLockPoints,
        post_lock_points:         videoProfile.postLockPoints,
        speed_avg_kmh:            isIPhone ? null : Math.round(videoProfile.postLockSpeedAvgKmh * 10) / 10,
        speed_max_kmh:            isIPhone ? null : Math.round(videoProfile.postLockSpeedMaxKmh * 10) / 10,
        distance_m:               Math.round(videoProfile.postLockDistanceM),
        fix_pct_no_fix:           Math.round((fixDist.fix0 / fixTotal) * 1000) / 10,
        fix_pct_2d:               Math.round((fixDist.fix2 / fixTotal) * 1000) / 10,
        fix_pct_3d:               Math.round((fixDist.fix3 / fixTotal) * 1000) / 10,
      };

      // ── Validate: video GPS must overlap with GPX activity ───────────────
      // Strategy 1 — Temporal: timestamps must overlap within ±5 min of drift tolerance.
      // Strategy 2 — Spatial fallback: if clock is wildly wrong, check geographic proximity.
      // Both failing = different ride → block.
      {
        const DRIFT_MS      = 5 * 60_000;
        const videoGPSStart = (vpts[0] as any).time + gpsVideoOffsetMs;
        const videoGPSEnd   = (vpts[vpts.length - 1] as any).time;
        const actStart      = activityPoints[0]?.time;
        const actEnd        = activityPoints[activityPoints.length - 1]?.time;

        const temporalOverlap =
          actStart !== undefined && actEnd !== undefined &&
          videoGPSStart - DRIFT_MS <= actEnd &&
          videoGPSEnd   + DRIFT_MS >= actStart;

        if (!temporalOverlap) {
          // Spatial fallback — sample post-lock video points vs sampled GPX points
          const postLock  = (vpts as any[]).filter((p: any) => p.time >= videoGPSStart).slice(0, 20);
          const step      = Math.max(1, Math.floor(activityPoints.length / 40));
          const actSample = activityPoints.filter((_, i) => i % step === 0);
          const hav = (a: {lat:number;lon:number}, b: {lat:number;lon:number}) => {
            const R = 6_371_000, r = (d: number) => d * Math.PI / 180;
            const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
            const h = Math.sin(dLat/2)**2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon/2)**2;
            return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
          };
          const spatialOverlap = postLock.some((vp: any) => actSample.some(ap => hav(vp, ap) < 2_000));
          if (!spatialOverlap) {
            throw new Error("Video doesn't match this activity. Check both files are from the same ride.");
          }
        }
      }

      // ── Select sync strategy based on both file analyses ─────────────────
      // iPhone always uses timestamp-based sync: CreateDate (NTP UTC) aligns
      // directly with activity GPS (satellite UTC) — no clock correction needed.
      const syncPlan = isIPhone
        ? {
            method:             "timestamp-based" as const,
            distanceThresholdM: 0,
            timeWindowMs:       0,
            confidence:         "HIGH" as const,
            reason:             "iPhone CreateDate (NTP UTC) = activity GPS UTC — no correction needed",
          }
        : gpxProfile
          ? SyncStrategySelector.select(gpxProfile, videoProfile)
          : {
              method:             "position-match" as const,
              distanceThresholdM: 10,
              timeWindowMs:       30_000,
              confidence:         "LOW" as const,
              reason:             "no GPX profile",
            };
      console.log(
        `[SyncPlan] method=${syncPlan.method} threshold=${syncPlan.distanceThresholdM.toFixed(1)}m window=${syncPlan.timeWindowMs}ms confidence=${syncPlan.confidence} | ${syncPlan.reason}`,
      );

      // ── Clock offset: always 0 ────────────────────────────────────────────
      // gopro-telemetry derives sample.date from GPSU — the GPS UTC string
      // embedded in the GPMF stream by the GPS receiver. This is the same
      // GPS satellite clock used by Garmin/Wahoo activity files.
      // There is no independent camera clock domain to correct for.
      // Any non-zero clockOffsetMs would introduce a spurious seek shift.
      const clockOffsetMs = 0;
      console.log(
        `[Sync] sample.date=GPS UTC → clockOffsetMs=0, gpsVideoOffsetMs=${gpsVideoOffsetMs}ms`,
      );
      const segments = TelemetryCrossRef.findHighlights(
        activityPoints,
        vpts as any,
        unit,
        clockOffsetMs,
        gpsVideoOffsetMs,
      );
      if (!segments || segments.length === 0)
        throw new Error("No scenes detected in this activity.");

      // TODO: workaround — remove after root cause of residual 4s gap is confirmed
      const VIDEO_SEEK_WORKAROUND_SEC = 0;
      segments.forEach((s) => {
        if (s.videoStartTime !== undefined)
          s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC;
      });

      // Actual duration of the video file in seconds.
      // GoPro: pre-lock delay + GPS recording span.
      // iPhone: CreateDate metadata duration.
      const videoDurationSec = isIPhone
        ? iPhoneDurationMs / 1000
        : (vpts.length > 1
            ? gpsVideoOffsetMs / 1000 + (vpts[vpts.length - 1].time - vpts[0].time) / 1000
            : 0);

      const storyPlan = StorytellingProcessor.generatePlan(
        activityPoints,
        vpts as any,
        unit,
        clockOffsetMs,
        gpsVideoOffsetMs,
        videoDurationSec,
      );
      storyPlan.segments.forEach((s) => {
        if (s.videoStartTime !== undefined)
          s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC;
      });
      setStoryPlan(storyPlan);
      clearInterval(interval);
      setProgress(100);

      // ── Track processing session → then attach GPX child record ─────────
      const videoDurationS = isIPhone
        ? iPhoneDurationMs / 1000
        : (vpts.length > 0 ? (vpts[vpts.length - 1] as any).time / 1000 : null);
      trackProcessingSession({
        status:             "success",
        video_filename:     file.name,
        video_duration_s:   videoDurationS,
        camera_model:       resolvedModel ?? null,
        activity_name:      activityMeta.name ?? null,
        gpx_points_count:   activityPoints.length || null,
        gps_device:         activityMeta.gpsDevice?.label ?? null,
        activity_location:  activityMeta.location ?? null,
        sync_strategy:      syncPlan.method ?? null,
        scenes_count:       storyPlan.segments.length ?? null,
        unit_system:        unit,
        processing_time_ms: Date.now() - processingStart,
        error_message:      null,
      }).then((processingSessionId) => {
        processingSessionIdRef.current = processingSessionId;
        if (processingSessionId) {
          if (gpxMetricsRef.current) {
            trackGpxSession({ ...gpxMetricsRef.current, processing_session_id: processingSessionId });
          }
          if (videoMetricsRef.current) {
            trackVideoUpload({ ...videoMetricsRef.current, processing_session_id: processingSessionId });
          }
        }
      });

      setTimeout(() => {
        setHighlights(segments);
        // iPhone MOV: set videoFile here (deferred) to avoid preloading the file
        // during processing. MOV has moov at the end — early preload scans the
        // entire file. MapEngine uses preload="none" for MOV so no I/O fires here.
        // GoPro: already set above (parallel with GPMF worker).
        if (isIPhone) setVideoFile(file);
        setStep("READY");
        readyStepStartRef.current = Date.now();
        setLoading(false);
      }, 500);
    } catch (e: any) {
      clearInterval(interval);
      setUploadError(e.message);
      setLoading(false);

      // ── Track failed processing session → still attach GPX child record ──
      trackProcessingSession({
        status:             "error",
        video_filename:     file.name,
        video_duration_s:   null,
        camera_model:       null,
        activity_name:      activityMeta.name ?? null,
        gpx_points_count:   activityPoints.length || null,
        gps_device:         activityMeta.gpsDevice?.label ?? null,
        activity_location:  activityMeta.location ?? null,
        sync_strategy:      null,
        scenes_count:       null,
        unit_system:        unit,
        processing_time_ms: Date.now() - processingStart,
        error_message:      e.message ?? null,
      }).then((processingSessionId) => {
        if (processingSessionId) {
          if (gpxMetricsRef.current) {
            trackGpxSession({ ...gpxMetricsRef.current, processing_session_id: processingSessionId });
          }
          if (videoMetricsRef.current) {
            trackVideoUpload({ ...videoMetricsRef.current, processing_session_id: processingSessionId });
          }
        }
      });
    }
  };

  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // ── File type guard ───────────────────────────────────────────────────────
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      setGpxError("Only .gpx files are accepted.");
      e.target.value = "";
      return;
    }
    setGpxError(null);

    const text = await file.text();

    // Deep structural analysis — runs before point extraction
    const profile = GPXAnalyzer.analyze(text);
    setGpxProfile(profile);

    const xml = new DOMParser().parseFromString(text, "text/xml");
    const pts = Array.from(xml.querySelectorAll("trkpt")).map(
      (pt: Element) => {
        // Core fields
        const lat  = parseFloat(pt.getAttribute("lat") || "0");
        const lon  = parseFloat(pt.getAttribute("lon") || "0");
        const ele  = parseFloat(pt.querySelector("ele")?.textContent || "0");
        const time = new Date(pt.querySelector("time")?.textContent || "").getTime();

        // Extensions — Garmin/Wahoo/Strava all use <hr>, <cad>, <power>
        // Namespace prefix varies (gpxtpx:, ns3:, etc.) — querySelector ignores prefix
        const hrEl    = pt.querySelector("hr");
        const cadEl   = pt.querySelector("cad");
        const powerEl = pt.querySelector("power") ?? pt.querySelector("watts");
        const speedEl = pt.querySelector("speed");

        const hr    = hrEl    ? parseFloat(hrEl.textContent    || "0") || undefined : undefined;
        const cad   = cadEl   ? parseFloat(cadEl.textContent   || "0") || undefined : undefined;
        const power = powerEl ? parseFloat(powerEl.textContent || "0") || undefined : undefined;
        const speed = speedEl ? parseFloat(speedEl.textContent || "0") * 3.6 || undefined : undefined; // m/s → km/h

        return { lat, lon, ele, time, ...(hr    !== undefined && { hr }),
                                       ...(cad   !== undefined && { cad }),
                                       ...(power !== undefined && { power }),
                                       ...(speed !== undefined && { speed }) };
      },
    );
    // ── Validate: GPX must contain a GPS track ───────────────────────────────
    if (pts.length === 0) {
      setGpxError("No GPS track found in this file.");
      e.target.value = "";
      return;
    }

    setActivityPoints(pts);

    // ── Activity name ─────────────────────────────────────────────────────────
    // getElementsByTagName ignores namespace prefixes (works with Garmin, Strava, Wahoo, etc.)
    const allNameEls = Array.from(xml.getElementsByTagName("name"));
    const trackName  =
      allNameEls.find(el => el.parentElement?.localName === "trk")?.textContent?.trim() ||
      allNameEls.find(el => el.textContent?.trim())?.textContent?.trim() ||
      "EPIC RIDE";

    const creatorRaw = xml.documentElement.getAttribute("creator") || "";
    const activityType = xml.querySelector("trk > type")?.textContent?.trim() ?? undefined;
    const gpsDevice  = creatorRaw ? detectGPSDevice(creatorRaw) : undefined;
    setActivityMeta({ name: trackName, ...(gpsDevice?.label ? { gpsDevice } : {}) });

    // ── Reverse geocode first GPS point → city name (optional, silent on failure) ─
    let resolvedLocation: string | undefined;
    if (pts.length > 0) {
      try {
        const { lat, lon } = pts[0];
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const resp = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=place,region&access_token=${token}`
        );
        if (resp.ok) {
          const geo = await resp.json();
          const feature = geo.features?.[0];
          if (feature) {
            const city = feature.text || "";
            const regionCtx = (feature.context as any[])?.find((c: any) => c.id?.startsWith("region"));
            const stateRaw  = regionCtx?.short_code ?? regionCtx?.text ?? "";
            const state     = stateRaw.includes("-") ? stateRaw.split("-").pop()! : stateRaw;
            resolvedLocation = state ? `${city}, ${state}` : city;
            if (resolvedLocation) setActivityMeta(prev => ({ ...prev, location: resolvedLocation }));
          }
        }
      } catch { /* geocoding is optional */ }
    }

    // ── Store GPX metrics — will be persisted once the processing session ID is known ──
    gpxMetricsRef.current = computeGpxMetrics(pts, {
      creator:          gpsDevice?.label ?? creatorRaw ?? undefined,
      activityType:     activityType,
      activityName:     trackName,
      activityLocation: resolvedLocation,
    });
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans selection:bg-amber-500/40 overflow-x-hidden">
      {/* AMBIENT BACKGROUND */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-15%] left-[-5%] w-[50%] h-[50%] bg-amber-500/8 blur-[140px] rounded-full" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[40%] h-[40%] bg-amber-500/5 blur-[120px] rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[30%] bg-amber-500/3 blur-[180px] rounded-full" />
      </div>

      {/* ── TOP NAVBAR ─────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <a href="/" className="flex items-center gap-3 group">
          <span className="text-xl font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
          <span className="hidden sm:block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
        </a>
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href="/como-funciona"
            className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors"
          >
            How It Works
          </a>
          <a
            href="/privacidade"
            className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors"
          >
            Privacy
          </a>
          <div className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Free Beta</span>
          </div>
        </div>
      </nav>

      {/* ── PAGE BODY ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-screen flex-col lg:flex-row max-w-[1600px] mx-auto relative z-10 pt-16">

        {/* ── LEFT: HERO ─────────────────────────────────────────────────── */}
        <section className="w-full lg:w-[55%] flex flex-col items-center justify-center px-8 py-12 lg:px-16 lg:py-20">
          <div className="max-w-xl w-full text-center lg:text-left flex flex-col items-center lg:items-start">

            {/* VERSION BADGE */}
            <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-zinc-900/80 border border-amber-500/25 mb-8 shadow-xl backdrop-blur">
              <Zap size={14} className="text-amber-500 fill-amber-500 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200">
                Beta v1.0.29 &nbsp;·&nbsp; 100% Free
              </span>
            </div>

            {/* HEADLINE */}
            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-7xl font-black tracking-tight leading-[0.88] mb-6">
              YOUR CINEMATIC<br />
              ADVENTURE VIDEO<br />
              <span className="text-amber-500 drop-shadow-[0_0_40px_rgba(245,158,11,0.35)]">
                IN 3 CLICKS.
              </span>
            </h1>

            {/* SUBHEADLINE */}
            <p className="text-zinc-400 text-lg font-medium max-w-md mb-2 leading-relaxed">
              Turn your{" "}
              <span className="text-white border-b border-amber-500/70">Activity into a story.</span>
            </p>
            <p className="text-zinc-500 text-sm max-w-sm mb-6 leading-relaxed">
              Import your GPX. Add your GoPro video. LENS generates a cinematic edit — synced, scored, ready to post.
            </p>

            {/* PRIVACY PILL */}
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/60 border border-zinc-700/50 mb-10">
              <Shield size={13} className="text-green-400" />
              <span className="text-[11px] font-bold text-zinc-400">
                No data ever leaves your device. Ever.
              </span>
            </div>

            {/* PHONE MOCKUP */}
            <div className="relative group w-full flex justify-center lg:justify-start">
              {/* Glow halo */}
              <div className="absolute top-4 left-1/2 lg:left-[140px] -translate-x-1/2 lg:translate-x-0 w-[200px] h-[400px] bg-amber-500/15 blur-[60px] rounded-full pointer-events-none transition-opacity duration-700 opacity-60 group-hover:opacity-100" />

              {/* Phone frame — aspect ratio matches the 9:16 video exactly, zero crop */}
              <div className="relative w-[240px] sm:w-[270px] md:w-[300px] transition-transform duration-500 group-hover:scale-[1.02]">
                <div className="aspect-[9/16] rounded-[2.4rem] border-[9px] border-zinc-800 shadow-[0_0_80px_rgba(0,0,0,0.95)] overflow-hidden ring-1 ring-white/8 bg-zinc-900 relative">
                  {/* Video — same aspect ratio as frame → perfect fit, no cropping */}
                  <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-fill"
                  >
                    <source src="/videos/hero-preview.mp4" type="video/mp4" />
                  </video>
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10 pointer-events-none" />
                  {/* Decorative notch — overlay only, doesn't affect video area */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-3 bg-zinc-900/80 rounded-full z-30 pointer-events-none" />
                  {/* Home indicator */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-14 h-[3px] bg-zinc-500/60 rounded-full z-30 pointer-events-none" />
                </div>

              </div>
            </div>
          </div>
        </section>

        {/* ── RIGHT: ENGINE CARD ─────────────────────────────────────────── */}
        <section className="flex-1 flex flex-col items-center justify-center px-6 py-10 lg:px-12 lg:py-20">
          <div className="w-full max-w-[460px]">

            {/* Card header */}
            <div className="flex flex-col items-center lg:items-start mb-8">
              <h2 className="text-7xl font-black tracking-tight uppercase text-white mb-3">
                LENS
              </h2>
              <div className="flex items-center gap-2 mb-3">
                <img src="/prorefuel_logo.png" alt="ProRefuel" className="w-36 opacity-70" />
              </div>
              <p className="text-zinc-500 font-bold tracking-widest uppercase text-[10px]">
                Telemetry · Sync · Cinematic Edit
              </p>
            </div>

            {/* THE CARD */}
            <div className="bg-[#0f0f0f] rounded-[2.8rem] border border-zinc-800/80 p-7 md:p-9 shadow-2xl relative ring-1 ring-white/4">
              {step !== "EXPERIENCE" ? (
                <div className="space-y-5 relative z-10">

                  {/* Unit Selector */}
                  <div className="flex p-1.5 bg-black rounded-2xl border border-zinc-800 shadow-inner">
                    <button
                      onClick={() => setUnit("metric")}
                      className={`flex-1 py-2.5 rounded-xl text-[11px] font-black tracking-widest transition-all ${unit === "metric" ? "bg-amber-500 text-black shadow-[0_5px_15px_rgba(245,158,11,0.3)]" : "text-zinc-500 hover:text-white"}`}
                    >
                      METRIC
                    </button>
                    <button
                      onClick={() => setUnit("imperial")}
                      className={`flex-1 py-2.5 rounded-xl text-[11px] font-black tracking-widest transition-all ${unit === "imperial" ? "bg-amber-500 text-black shadow-[0_5px_15px_rgba(245,158,11,0.3)]" : "text-zinc-500 hover:text-white"}`}
                    >
                      IMPERIAL
                    </button>
                  </div>

                  {/* STEP 01: GPX */}
                  <label
                    className={`group flex items-center gap-5 p-6 rounded-2xl border-2 transition-all cursor-pointer ${
                      gpxError
                        ? "border-red-500 bg-red-500/8"
                        : activityPoints.length > 0
                          ? "border-green-500 bg-green-500/8"
                          : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 animate-glow-pulse"
                    }`}
                  >
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all ${gpxError ? "bg-red-500 text-white" : activityPoints.length > 0 ? "bg-green-500 text-black" : "bg-amber-500 text-black shadow-lg"}`}>
                      {activityPoints.length > 0 ? <CheckCircle2 size={28} /> : <Gauge size={28} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`block text-[10px] font-black uppercase tracking-widest mb-0.5 ${gpxError ? "text-red-400" : activityPoints.length > 0 ? "text-green-500" : "text-amber-500"}`}>
                        Step 01
                      </span>
                      <p className="text-base font-black uppercase text-white leading-none">Import GPX</p>
                      {gpxError && (
                        <p className="text-[11px] font-semibold mt-1 text-red-400">{gpxError}</p>
                      )}
                    </div>
                    <input type="file" accept=".gpx" onChange={handleGPXUpload} className="hidden" />
                  </label>

                  {/* STEP 02: VIDEO */}
                  <label
                    className={`group flex items-center gap-5 p-6 rounded-2xl border-2 transition-all cursor-pointer ${
                      uploadError
                        ? "border-red-500 bg-red-500/8"
                        : highlights.length > 0
                          ? "border-green-500 bg-green-500/8"
                          : activityPoints.length === 0
                            ? "border-zinc-800 bg-zinc-900/40 cursor-not-allowed opacity-60"
                            : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10"
                    }`}
                  >
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all ${highlights.length > 0 ? "bg-green-500 text-black" : activityPoints.length === 0 ? "bg-zinc-800 text-zinc-600" : "bg-amber-500 text-black shadow-lg"}`}>
                      {loading ? <Loader2 className="animate-spin" size={28} /> : highlights.length > 0 ? <CheckCircle2 size={28} /> : <Upload size={28} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`block text-[10px] font-black uppercase tracking-widest mb-0.5 ${uploadError ? "text-red-400" : activityPoints.length === 0 ? "text-zinc-600" : "text-amber-500"}`}>
                        Step 02
                      </span>
                      <p className={`text-base font-black uppercase leading-none ${activityPoints.length === 0 ? "text-zinc-600" : "text-white"}`}>
                        Import Video
                      </p>
                      <p className={`text-[11px] font-semibold mt-1 ${uploadError ? "text-red-400" : "text-zinc-500"}`}>
                        {uploadError
                          ? uploadError
                          : loading
                            ? statusMsg
                            : activityPoints.length === 0
                              ? "Load GPX first"
                              : "GoPro .mp4"}
                      </p>
                    </div>
                    <input type="file" accept=".mp4,.mov,video/mp4,video/quicktime" disabled={activityPoints.length === 0} onChange={handleVideoUpload} className="hidden" />
                    {activityPoints.length === 0 && <Lock size={16} className="text-zinc-700 shrink-0" />}
                  </label>

                  {/* CTA */}
                  <button
                    onClick={() => {
                      experienceStartRef.current = Date.now();
                      trackVideoExport({
                        processing_session_id: processingSessionIdRef.current,
                        reached_experience:    true,
                        clicked_record:        true, // autoRecord=true → starts immediately
                        completed_download:    false,
                        time_on_ready_ms:      readyStepStartRef.current ? Date.now() - readyStepStartRef.current : null,
                        time_to_download_ms:   null,
                        render_duration_ms:    null,
                        render_status:         null,
                        error_message:         null,
                        output_format:         null,
                        output_size_bytes:     null,
                        output_duration_s:     null,
                      });
                      setStep("EXPERIENCE");
                    }}
                    disabled={!highlights.length}
                    className={`w-full py-6 mt-2 rounded-2xl font-black uppercase tracking-[0.35em] text-xs transition-all flex items-center justify-center gap-3 ${
                      highlights.length
                        ? "bg-amber-500 text-black shadow-[0_15px_40px_rgba(245,158,11,0.35)] hover:scale-[1.02] active:scale-[0.98]"
                        : "bg-zinc-800/80 text-zinc-600 cursor-not-allowed"
                    }`}
                  >
                    <Zap size={18} fill={highlights.length ? "black" : "none"} />
                    Generate &amp; Download
                  </button>

                  {/* Trust strip */}
                  <div className="flex justify-center gap-6 pt-6 border-t border-zinc-800/60">
                    <div className="flex items-center gap-1.5 text-zinc-600">
                      <Shield size={12} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Private</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-zinc-600">
                      <Smartphone size={12} />
                      <span className="text-[10px] font-black uppercase tracking-widest">On-Device</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-zinc-600">
                      <PlayCircle size={12} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Insta Ready</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Engine Viewport — same framing as EXPERIENCE */
                <div className="aspect-[9/16] w-full rounded-[2.8rem] overflow-hidden bg-black relative shadow-2xl ring-1 ring-amber-500/20">
                  <MapEngine
                    ref={mapEngineRef}
                    activityPoints={activityPoints}
                    highlights={highlights}
                    storyPlan={storyPlan}
                    videoFile={videoFile}
                    activityMeta={activityMeta}
                    autoRecord={true}
                    unit={unit}
                    onRenderComplete={(result: RenderResult) => {
                      trackVideoExport({
                        processing_session_id: processingSessionIdRef.current,
                        reached_experience:    true,
                        clicked_record:        true,
                        completed_download:    true,
                        time_on_ready_ms:      readyStepStartRef.current && experienceStartRef.current
                                                 ? experienceStartRef.current - readyStepStartRef.current
                                                 : null,
                        time_to_download_ms:   experienceStartRef.current ? Date.now() - experienceStartRef.current : null,
                        render_duration_ms:    result.durationMs,
                        render_status:         result.status,
                        error_message:         result.errorMessage ?? null,
                        output_format:         result.outputFormat,
                        output_size_bytes:     result.outputSizeBytes,
                        output_duration_s:     storyPlan
                                                 ? storyPlan.segments.reduce((s, seg) => s + (seg.durationSec ?? 0), 0)
                                                 : null,
                      });
                    }}
                  />
                </div>
              )}
            </div>

          </div>
        </section>
      </div>

      {/* ── FEATURE SECTION ────────────────────────────────────────────────── */}
      <section className="relative z-10 border-t border-zinc-800/40 bg-gradient-to-b from-black/0 to-black/40">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-20">

          {/* Section headline */}
          <div className="text-center mb-14">
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-4">What LENS does</p>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
              Turn your{" "}
              <span className="text-amber-500">activity</span><br className="hidden sm:block" />
              {" "}into a story.
            </h2>
            <p className="text-zinc-400 text-base max-w-lg mx-auto leading-relaxed">
              Every ride, run, or hike has a story. LENS reads your GPS data, finds the best moments, and edits them together automatically — no video editing skills needed.
            </p>
          </div>

          {/* Camera support row */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">

            {/* GoPro card */}
            <div className="flex-1 max-w-sm mx-auto sm:mx-0 p-6 rounded-3xl bg-zinc-900/60 border border-amber-500/25 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 blur-[40px] rounded-full pointer-events-none" />
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-2xl">🎥</div>
                <div>
                  <p className="font-black text-white text-sm uppercase tracking-wide">GoPro</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Maximum quality</p>
                </div>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed mb-4">
                Full GPS telemetry at 18Hz embedded in the .mp4 file. LENS reads speed, acceleration, and gyroscope data to detect every climb, sprint, and technical section.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["GPS 18Hz","Accelerometer","Gyroscope","Barometer","Auto Sync"].map(f => (
                  <span key={f} className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-black text-amber-400 uppercase tracking-wide">{f}</span>
                ))}
              </div>
            </div>


          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <FeatureTile icon="⚡" title="Auto-edited" body="LENS finds your best moments and builds the story automatically." />
            <FeatureTile icon="🛰️" title="GPS-synced" body="Millisecond precision — video and activity matched to the exact second." />
            <FeatureTile icon="🎬" title="9:16 format" body="Instagram Reels, TikTok, YouTube Shorts — ready to post instantly." />
            <FeatureTile icon="🔒" title="100% private" body="Everything runs in your browser. Your files never leave your device." />
          </div>

          {/* Bottom CTA */}
          <div className="mt-14 text-center">
            <p className="text-zinc-500 text-sm mb-1">No account. No subscription. No upload.</p>
            <p className="text-zinc-300 font-black text-base">Just open Chrome on your desktop and go. ↑</p>
          </div>

        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-zinc-800/50 bg-black/30 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-10 flex flex-col md:flex-row items-center justify-between gap-6">

          {/* Brand */}
          <div className="flex flex-col items-center md:items-start gap-1">
            <a href="/" className="flex items-center gap-2 group">
              <span className="text-lg font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
            </a>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Elevate your adventure.</p>
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-6">
            <a href="/como-funciona" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">
              How It Works
            </a>
            <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">
              Privacy
            </a>
          </div>

          {/* Copyright */}
          <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">
            © {new Date().getFullYear()} ProRefuel.app
          </p>
        </div>
      </footer>

      <style jsx global>{`
        @keyframes glow-pulse {
          0%, 100% { border-color: rgba(245,158,11,0.35); box-shadow: 0 0 0 0 rgba(245,158,11,0); }
          50% { border-color: rgba(245,158,11,0.9); box-shadow: 0 0 20px 2px rgba(245,158,11,0.15); }
        }
        .animate-glow-pulse { animation: glow-pulse 2.2s ease-in-out infinite; }

      `}</style>
    </main>
  );
}

// ── iPhone clock correction ───────────────────────────────────────────────────
//
// iPhone stores QuickTime CreateDate (mvhd) in UTC per spec, but some iOS
// versions write local time. A UTC+1 timezone turns every seek into a negative
// number (clamped to 0) → video stuck at frame 0 → "lag fortissimo".
//
// Fix: use the ISO 6709 recording-start GPS coordinate (when available) to
// find the matching moment in the activity GPS track. The difference between
// CreateDate and that GPS UTC time is the clock offset to subtract.
//
// Search is unconstrained in time (handles ±12 h timezone offsets) but
// constrained to 100 m spatially (iPhone GPS ≤ 10 m error) and ±24 h
// (eliminates matches from completely different days / prior sessions).
//
// Returns 0 when no confident match is found — no correction applied.
function estimateIPhoneClockOffsetMs(
  recordingLat: number,
  recordingLon: number,
  createDateMs: number,
  activityPoints: { lat: number; lon: number; time: number }[],
): number {
  if (activityPoints.length < 5) return 0;

  const R = 6_371_000;
  const toRad = (d: number) => d * Math.PI / 180;
  const MAX_DIST_M   = 100;            // iPhone GPS is ±5–10 m; 100 m is generous
  const MAX_DELTA_MS = 24 * 3_600_000; // ignore matches > 24 h away (different day)

  let minDist  = Infinity;
  let bestMatch: { lat: number; lon: number; time: number } | null = null;

  for (const p of activityPoints) {
    // Quick time pre-filter to avoid haversine on thousands of distant points
    if (Math.abs(p.time - createDateMs) > MAX_DELTA_MS) continue;

    const dLat = toRad(p.lat - recordingLat);
    const dLon = toRad(p.lon - recordingLon);
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(toRad(recordingLat)) * Math.cos(toRad(p.lat))
               * Math.sin(dLon / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    if (dist < minDist) { minDist = dist; bestMatch = p; }
  }

  // If no match within ±24 h, widen to full activity (catches timezone offsets
  // where the pre-filter excluded all candidates)
  if (!bestMatch || minDist > MAX_DIST_M) {
    minDist   = Infinity;
    bestMatch = null;
    for (const p of activityPoints) {
      const dLat = toRad(p.lat - recordingLat);
      const dLon = toRad(p.lon - recordingLon);
      const a    = Math.sin(dLat / 2) ** 2
                 + Math.cos(toRad(recordingLat)) * Math.cos(toRad(p.lat))
                 * Math.sin(dLon / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (dist < minDist) { minDist = dist; bestMatch = p; }
    }
  }

  if (!bestMatch || minDist > MAX_DIST_M) {
    console.log(`[iPhone Sync] No match within ${MAX_DIST_M}m (best: ${minDist.toFixed(0)}m) — skipping clock correction`);
    return 0;
  }

  const offset = createDateMs - bestMatch.time;
  console.log(
    `[iPhone Sync] Spatial clock fix: ${minDist.toFixed(0)}m match at ${new Date(bestMatch.time).toISOString()} ` +
    `→ offset=${offset}ms (${(offset / 3_600_000).toFixed(2)}h) applied`,
  );
  return offset;
}

// ── Mobile-only gate — shown when running on iOS / Android ────────────────

/** Helper: read video duration via HTML5 video element metadata (lightweight, no full decode) */
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => { resolve(video.duration); URL.revokeObjectURL(url); };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Cannot read video.")); };
    video.src = url;
  });
}

const MOBILE_MAX_SIZE_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const MOBILE_MAX_DURATION_S = 300;                        // 5 minutes

function MobileLanding() {
  // ── Phase ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<"upload" | "processing" | "experience">("upload");

  // ── Data ───────────────────────────────────────────────────────────────
  const [activityPoints, setActivityPoints] = useState<any[]>([]);
  const [highlights,     setHighlights]     = useState<ActionSegment[]>([]);
  const [storyPlan,      setStoryPlan]       = useState<StoryPlan | null>(null);
  const [videoFile,      setVideoFile]       = useState<File | null>(null);
  const [activityMeta,   setActivityMeta]    = useState<{ name: string; location?: string; gpsDevice?: DeviceInfo; camera?: DeviceInfo }>({ name: "EPIC RIDE" });

  // ── UI ─────────────────────────────────────────────────────────────────
  const [gpxReady,     setGpxReady]     = useState(false);
  const [videoReady,   setVideoReady]   = useState(false);
  const [statusMsg,    setStatusMsg]    = useState("");
  const [progress,     setProgress]     = useState(0);
  const [gpxError,     setGpxError]     = useState<string | null>(null);
  const [videoError,   setVideoError]   = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [renderDone,   setRenderDone]   = useState(false);
  const [renderBlob,   setRenderBlob]   = useState<Blob | null>(null);
  const [renderFilename, setRenderFilename] = useState("");

  const mapEngineRef = useRef<{ start: () => void; startRecording: () => Promise<void>; isRecording: boolean }>(null);

  // ── GPX upload ─────────────────────────────────────────────────────────
  const handleGPX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGpxError(null);
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      setGpxError("Only .gpx files accepted.");
      e.target.value = "";
      return;
    }
    const text = await file.text();
    const xml  = new DOMParser().parseFromString(text, "text/xml");
    const pts  = Array.from(xml.querySelectorAll("trkpt")).map((pt: Element) => {
      const lat   = parseFloat(pt.getAttribute("lat") || "0");
      const lon   = parseFloat(pt.getAttribute("lon") || "0");
      const ele   = parseFloat(pt.querySelector("ele")?.textContent  || "0");
      const time  = new Date(pt.querySelector("time")?.textContent || "").getTime();
      const hrEl  = pt.querySelector("hr");
      const cadEl = pt.querySelector("cad");
      const hr    = hrEl  ? parseFloat(hrEl.textContent  || "0") || undefined : undefined;
      const cad   = cadEl ? parseFloat(cadEl.textContent || "0") || undefined : undefined;
      return { lat, lon, ele, time, ...(hr  !== undefined && { hr }),
                                     ...(cad !== undefined && { cad }) };
    });
    if (pts.length === 0) {
      setGpxError("No GPS track in this file.");
      e.target.value = "";
      return;
    }
    setActivityPoints(pts);
    const trackName =
      Array.from(xml.getElementsByTagName("name"))
        .find(el => el.parentElement?.localName === "trk")?.textContent?.trim() ||
      "EPIC RIDE";
    const creatorRaw = xml.documentElement.getAttribute("creator") || "";
    const gpsDevice  = creatorRaw ? detectGPSDevice(creatorRaw) : undefined;
    setActivityMeta({ name: trackName, ...(gpsDevice?.label ? { gpsDevice } : {}) });
    setGpxReady(true);
  };

  // ── MOV upload with mobile validations ────────────────────────────────
  const handleMOV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoError(null);

    const nameLc = file.name.toLowerCase();
    const isMOV  = nameLc.endsWith(".mov") || file.type === "video/quicktime";
    const isMP4  = nameLc.endsWith(".mp4") || file.type === "video/mp4";

    if (isMP4) {
      setVideoError("GoPro MP4 requires desktop. Use lens.prorefuel.app on your computer.");
      e.target.value = "";
      return;
    }
    if (!isMOV) {
      setVideoError("Only iPhone .mov files supported on mobile.");
      e.target.value = "";
      return;
    }
    if (file.size > MOBILE_MAX_SIZE_BYTES) {
      const gb = (file.size / 1024 / 1024 / 1024).toFixed(1);
      setVideoError(`File is ${gb} GB — max 1.5 GB on mobile. Use lens.prorefuel.app on desktop.`);
      e.target.value = "";
      return;
    }
    // Duration check (best-effort — HTML5 metadata read, lightweight)
    try {
      const dur = await getVideoDuration(file);
      if (dur > MOBILE_MAX_DURATION_S) {
        const m = Math.floor(dur / 60);
        const s = Math.round(dur % 60);
        setVideoError(`Video is ${m}m ${s}s — over 5 minutes. Use lens.prorefuel.app on desktop.`);
        e.target.value = "";
        return;
      }
    } catch { /* allow — duration check is best-effort */ }

    setVideoFile(file);
    setVideoReady(true);
  };

  // ── Generate handler ───────────────────────────────────────────────────
  const handleProcess = async () => {
    if (!videoFile || activityPoints.length === 0) return;
    setPhase("processing");
    setProcessError(null);
    setProgress(0);
    const interval = setInterval(() => setProgress(p => p >= 95 ? 95 : p + 1), 150);

    try {
      setStatusMsg("Identifying camera...");
      const cameraDetection = await CameraDetector.detect(videoFile);
      if (cameraDetection.type !== "iphone") {
        throw new Error("Only iPhone MOV files are supported on mobile. Use lens.prorefuel.app for GoPro.");
      }

      setStatusMsg("Reading iPhone metadata...");
      const result = await iPhoneEngineClient.extractTelemetry(videoFile);
      let vpts = result.points;
      const { gpsVideoOffsetMs } = result;
      let iPhoneVideoStartMs     = result.videoStartMs;
      const iPhoneDurationMs     = result.durationMs;
      const iPhoneHasStartGPS    = result.hasStartGPS;

      // ── Align iPhone NTP → GPS UTC (fixes "lag fortissimo") ────────────
      if (iPhoneHasStartGPS && vpts[0].lat !== 0 && activityPoints.length >= 5) {
        const iPhoneClockOffset = estimateIPhoneClockOffsetMs(
          vpts[0].lat, vpts[0].lon, iPhoneVideoStartMs, activityPoints,
        );
        if (iPhoneClockOffset !== 0) {
          vpts               = vpts.map((p: any) => ({ ...p, time: p.time - iPhoneClockOffset }));
          iPhoneVideoStartMs = iPhoneVideoStartMs - iPhoneClockOffset;
        }
      }

      setStatusMsg("Checking activity overlap...");
      const DRIFT_MS       = 5 * 60_000;
      const videoGPSStart  = (vpts[0] as any).time;
      const videoGPSEnd    = (vpts[vpts.length - 1] as any).time;
      const actStart       = activityPoints[0]?.time;
      const actEnd         = activityPoints[activityPoints.length - 1]?.time;
      const temporalOverlap =
        actStart !== undefined && actEnd !== undefined &&
        videoGPSStart - DRIFT_MS <= actEnd &&
        videoGPSEnd   + DRIFT_MS >= actStart;
      if (!temporalOverlap) {
        throw new Error("Video doesn't match this activity. Check both files are from the same ride.");
      }

      setStatusMsg("Detecting scenes...");
      const segments = TelemetryCrossRef.findHighlights(
        activityPoints, vpts as any, "metric", 0, gpsVideoOffsetMs,
      );
      if (!segments || segments.length === 0) {
        throw new Error("No scenes detected. Try a more dynamic activity or longer video.");
      }

      const sp = StorytellingProcessor.generatePlan(
        activityPoints, vpts as any, "metric", 0, gpsVideoOffsetMs,
      );

      clearInterval(interval);
      setProgress(100);
      setHighlights(segments);
      setStoryPlan(sp);
      setTimeout(() => setPhase("experience"), 400);
    } catch (err: any) {
      clearInterval(interval);
      setProcessError(err.message);
      setPhase("upload");
    }
  };

  // ── Share / download ───────────────────────────────────────────────────
  const triggerShare = async () => {
    if (!renderBlob) return;
    const shareFile = new File([renderBlob], renderFilename, { type: "video/mp4" });
    const canShare  = typeof navigator.canShare === "function" && navigator.canShare({ files: [shareFile] });
    if (canShare) {
      try {
        await navigator.share({ files: [shareFile] });
        return;
      } catch (err: any) {
        if (err.name === "AbortError") return; // user dismissed — no fallback needed
      }
    }
    // Fallback: browser download
    const url = URL.createObjectURL(renderBlob);
    const a   = document.createElement("a");
    a.href = url; a.download = renderFilename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // ── EXPERIENCE PHASE ───────────────────────────────────────────────────
  if (phase === "experience") {
    return (
      <main className="fixed inset-0 bg-black overflow-hidden">
        <div className="absolute inset-0">
          <MapEngine
            ref={mapEngineRef}
            activityPoints={activityPoints}
            highlights={highlights}
            storyPlan={storyPlan}
            videoFile={videoFile}
            activityMeta={activityMeta as any}
            autoRecord={true}
            unit="metric"
            onDownloadReady={(blob, filename) => {
              setRenderBlob(blob);
              setRenderFilename(filename);
              setRenderDone(true);
            }}
            onRenderComplete={() => {}}
          />
        </div>

        {/* Recording badge */}
        {!renderDone && (
          <div className="absolute top-10 left-0 right-0 flex justify-center pointer-events-none">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/70 border border-zinc-700 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-widest text-white">Recording...</span>
            </div>
          </div>
        )}

        {/* Done overlay */}
        {renderDone && (
          <div className="absolute inset-x-0 bottom-0 pb-safe p-6 bg-gradient-to-t from-black via-black/70 to-transparent">
            <p className="text-center text-zinc-400 text-xs mb-4 font-bold uppercase tracking-widest">Your video is ready</p>
            <button
              onClick={triggerShare}
              className="w-full py-4 rounded-2xl bg-amber-500 text-black font-black text-sm uppercase tracking-widest shadow-[0_0_30px_rgba(245,158,11,0.5)] active:scale-95 transition-transform"
            >
              Save & Share
            </button>
            <button
              onClick={() => {
                setPhase("upload");
                setRenderDone(false);
                setRenderBlob(null);
                setHighlights([]);
                setStoryPlan(null);
                setVideoFile(null);
                setVideoReady(false);
                setGpxReady(false);
                setActivityPoints([]);
              }}
              className="w-full mt-3 py-3 text-zinc-500 text-xs font-black uppercase tracking-widest active:opacity-70"
            >
              Create Another
            </button>
          </div>
        )}
      </main>
    );
  }

  // ── PROCESSING PHASE ───────────────────────────────────────────────────
  if (phase === "processing") {
    return (
      <main className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center px-5">
        <div className="w-full max-w-xs text-center">
          <div className="mb-8">
            <div className="w-16 h-16 mx-auto rounded-full border-2 border-zinc-800 border-t-amber-500 animate-spin" />
          </div>
          <p className="font-black text-white text-xl mb-2">Building your edit</p>
          <p className="text-zinc-400 text-sm mb-8 min-h-[20px]">{statusMsg}</p>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-zinc-600 text-xs">{progress}%</p>
        </div>
      </main>
    );
  }

  // ── UPLOAD / LANDING PHASE ─────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans overflow-x-hidden">

      {/* Ambient glows */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[80%] h-[50%] bg-amber-500/8 blur-[130px] rounded-full" />
        <div className="absolute bottom-[10%] right-[-15%] w-[60%] h-[40%] bg-amber-600/6 blur-[110px] rounded-full" />
      </div>

      <div className="relative z-10 flex flex-col items-center px-5 pt-10 pb-16">

        {/* ── NAVBAR ──────────────────────────────────────────────────────── */}
        <nav className="w-full flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tight">LENS</span>
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">Free Beta</span>
          </div>
        </nav>

        {/* ── HEADLINE ────────────────────────────────────────────────────── */}
        <h1 className="text-[2.5rem] font-black tracking-tight leading-[0.88] text-center mb-4">
          YOUR CINEMATIC<br />ADVENTURE VIDEO<br />
          <span className="text-amber-500">IN 3 CLICKS.</span>
        </h1>
        <p className="text-zinc-400 text-[15px] leading-relaxed text-center max-w-xs mb-1">
          Turn your <span className="text-white font-bold">Strava activity into a story.</span>
        </p>
        <p className="text-zinc-500 text-[13px] text-center max-w-[260px] mb-6">
          iPhone .mov + any GPX → cinematic edit, saved to your gallery.
        </p>

        {/* ── DEVICE BADGE ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800/70 border border-zinc-700/50 mb-2">
          <span className="text-xs">📱</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">iPhone MOV · Up to 5 min · 1.5 GB</span>
        </div>
        <div className="flex items-center gap-1.5 mb-8 flex-wrap justify-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Works with</span>
          {["Garmin","Wahoo","Strava","Komoot"].map(d => (
            <span key={d} className="text-[10px] font-bold text-zinc-500 px-2 py-0.5 rounded-md bg-zinc-900/60 border border-zinc-800">{d}</span>
          ))}
        </div>

        {/* ── UPLOAD FORM ─────────────────────────────────────────────────── */}
        <div className="w-full max-w-sm mb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500/70 text-center mb-5">Create your video</p>

          {/* GPX */}
          <div className="mb-3">
            <label className={`flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-colors ${
              gpxReady
                ? "bg-green-500/10 border-green-500/40"
                : "bg-zinc-900/60 border-zinc-700/60 active:border-zinc-500"
            }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${gpxReady ? "bg-green-500/20" : "bg-zinc-800"}`}>
                {gpxReady ? <CheckCircle2 size={20} className="text-green-400" /> : <span className="text-lg">🗺️</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-white text-sm">{gpxReady ? "GPX activity loaded" : "1. Import GPX activity"}</p>
                <p className="text-zinc-500 text-[11px] mt-0.5 truncate">
                  {gpxReady ? activityMeta.name : "Garmin · Wahoo · Strava · Komoot"}
                </p>
              </div>
              <input type="file" accept=".gpx" className="hidden" onChange={handleGPX} />
            </label>
            {gpxError && <p className="text-red-400 text-[11px] mt-1.5 px-1">{gpxError}</p>}
          </div>

          {/* MOV */}
          <div className="mb-5">
            <label className={`flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-colors ${
              videoReady
                ? "bg-green-500/10 border-green-500/40"
                : "bg-zinc-900/60 border-zinc-700/60 active:border-zinc-500"
            }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${videoReady ? "bg-green-500/20" : "bg-zinc-800"}`}>
                {videoReady ? <CheckCircle2 size={20} className="text-green-400" /> : <span className="text-lg">📱</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-white text-sm">{videoReady ? "iPhone video loaded" : "2. Import iPhone video"}</p>
                <p className="text-zinc-500 text-[11px] mt-0.5 truncate">
                  {videoReady
                    ? `${videoFile!.name} · ${(videoFile!.size / 1024 / 1024).toFixed(0)} MB`
                    : ".mov only · max 5 min · 1.5 GB"}
                </p>
              </div>
              <input type="file" accept=".mov,video/quicktime" className="hidden" onChange={handleMOV} />
            </label>
            {videoError && (
              <p className={`text-[11px] mt-1.5 px-1 leading-relaxed ${videoError.includes("lens.prorefuel.app") ? "text-amber-400" : "text-red-400"}`}>
                {videoError}
              </p>
            )}
          </div>

          {/* Process error */}
          {processError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <p className="text-red-400 text-[11px] leading-relaxed">{processError}</p>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleProcess}
            disabled={!gpxReady || !videoReady}
            className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all ${
              gpxReady && videoReady
                ? "bg-amber-500 text-black shadow-[0_10px_30px_rgba(245,158,11,0.3)] active:scale-95"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            }`}
          >
            Generate My Video
          </button>

          {/* GoPro note */}
          <div className="mt-4 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800 flex gap-2.5 items-start">
            <span className="text-sm shrink-0 mt-0.5">🖥️</span>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              <span className="text-white font-bold">GoPro MP4?</span> Requires desktop.{" "}
              <span className="text-amber-400 font-bold">lens.prorefuel.app</span>
            </p>
          </div>
        </div>

        {/* ── PRIVACY ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 mb-10">
          <Lock size={10} className="text-green-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-green-400">100% Local · Files never leave your device</span>
        </div>

        {/* ── HOW IT WORKS ────────────────────────────────────────────────── */}
        <div className="w-full max-w-sm mb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500/70 text-center mb-5">How it works</p>
          <div className="space-y-3">
            <MobileStep number="01" title="Import your GPX activity" body="Garmin, Wahoo, Strava, Komoot — any .gpx file works." />
            <MobileStep number="02" title="Import your iPhone video" body=".mov file, up to 5 minutes. Enable Location Services on Camera before recording." />
            <MobileStep number="03" title="Generate & save to gallery" body="LENS detects your best moments. Tap Save & Share — choose Photos to save to your gallery." />
          </div>
        </div>

        {/* ── REQUIREMENTS ────────────────────────────────────────────────── */}
        <div className="w-full max-w-sm mb-10 p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Device requirements</p>
          <div className="space-y-1.5">
            {[
              "iPhone 13 or newer",
              "iOS 16 or newer",
              "Safari browser (recommended)",
              "Video: .mov format, max 5 min · 1.5 GB",
            ].map(r => (
              <div key={r} className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                <p className="text-zinc-400 text-xs">{r}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── FEATURES ────────────────────────────────────────────────────── */}
        <div className="w-full max-w-sm space-y-2.5 mb-10">
          <MobileFeatureRow icon="⚡" text="Auto-edited — no video editing needed" />
          <MobileFeatureRow icon="🛰️" text="GPS-synced to the millisecond" />
          <MobileFeatureRow icon="🎬" text="9:16 format — Instagram, TikTok, Shorts ready" />
          <MobileFeatureRow icon="🔒" text="100% private — files stay on your device" />
          <MobileFeatureRow icon="🆓" text="Free during beta — no account required" />
        </div>

        {/* ── GPS DEVICES ─────────────────────────────────────────────────── */}
        <div className="w-full max-w-sm mb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 text-center mb-3">GPX compatible devices</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { name: "Garmin",      emoji: "⌚" },
              { name: "Wahoo",       emoji: "🚴" },
              { name: "Strava",      emoji: "🏃" },
              { name: "Komoot",      emoji: "🗺️" },
              { name: "RideWithGPS", emoji: "📍" },
              { name: "Polar",       emoji: "💙" },
            ].map(d => (
              <div key={d.name} className="flex flex-col items-center gap-1 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/60">
                <span className="text-lg">{d.emoji}</span>
                <span className="text-[10px] font-bold text-zinc-400">{d.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── FOOTER ──────────────────────────────────────────────────────── */}
        <div className="w-full max-w-sm border-t border-zinc-800/60 pt-8 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-black tracking-tight">LENS</span>
            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">by ProRefuel.app</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="/como-funciona" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">How It Works</a>
            <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Privacy</a>
          </div>
          <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">
            © {new Date().getFullYear()} ProRefuel.app
          </p>
        </div>

      </div>
    </main>
  );
}

function FeatureTile({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/60 hover:border-zinc-700 transition-colors">
      <div className="text-2xl mb-3">{icon}</div>
      <p className="font-black text-white text-sm uppercase tracking-wide mb-1.5">{title}</p>
      <p className="text-zinc-500 text-xs leading-relaxed">{body}</p>
    </div>
  );
}

function MobileStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="flex gap-4 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/60">
      <div className="shrink-0 w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center">
        <span className="text-xs font-black text-black">{number}</span>
      </div>
      <div>
        <p className="font-black text-white text-sm mb-0.5">{title}</p>
        <p className="text-zinc-400 text-xs leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function MobileFeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800/60">
      <span className="text-lg shrink-0">{icon}</span>
      <span className="text-sm text-zinc-300 font-medium">{text}</span>
    </div>
  );
}
