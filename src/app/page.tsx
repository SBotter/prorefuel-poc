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
    const isMP4 = file.name.toLowerCase().endsWith(".mp4") || file.type === "video/mp4";
    if (!isMP4) {
      setUploadError("Only .mp4 files are accepted.");
      e.target.value = "";
      return;
    }

    setLoading(true);
    setUploadError(null);
    setVideoFile(file);
    setProgress(0);
    const processingStart = Date.now();
    const interval = setInterval(
      () => setProgress((p) => (p >= 98 ? 98 : p + 1)),
      150,
    );
    try {
      setStatusMsg("Analysing GPMF...");
      const {
        points: vpts,
        syncPoints,
        cameraModel,
        gpsVideoOffsetMs,
      } = await GoProEngineClient.extractTelemetry(file);

      // ── Detect camera from GPMF model string or filename fallback ────────
      let resolvedModel = cameraModel;
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

      // ── Validate: video must have GPS data ───────────────────────────────
      if (vpts.length === 0) {
        throw new Error("No GPS found in this video. Enable GPS before recording.");
      }

      // ── Analyse video GPS structure ──────────────────────────────────────
      const videoProfile = VideoGPSAnalyzer.analyze(vpts, gpsVideoOffsetMs);

      // ── Validate: GPS lock must have been acquired ────────────────────────
      if (!videoProfile.hasGPSLock || videoProfile.postLockPoints === 0) {
        throw new Error("Video GPS signal too weak — no valid fix acquired during recording.");
      }

      // ── Store video metrics — persisted after processing_session is created ──
      const totalPts = vpts.length;
      const fixDist  = videoProfile.fixDistribution;
      const fixTotal = (fixDist.fix0 + fixDist.fix2 + fixDist.fix3) || 1;
      videoMetricsRef.current = {
        filename:                 file.name,
        file_size_bytes:          file.size,
        camera_model:             resolvedModel ?? null,
        has_gps:                  totalPts > 0,
        gps_points_count:         totalPts,
        gps_duration_s:           videoProfile.durationSec,
        gps_sampling_interval_ms: videoProfile.samplingIntervalMs,
        gps_start_utc:            totalPts > 0 ? new Date((vpts[0] as any).time).toISOString() : null,
        gps_end_utc:              totalPts > 0 ? new Date((vpts[totalPts - 1] as any).time).toISOString() : null,
        gps_video_offset_ms:      gpsVideoOffsetMs,
        has_gps_lock:             videoProfile.hasGPSLock,
        gps_lock_latency_s:       videoProfile.lockLatencySec,
        pre_lock_points:          videoProfile.preLockPoints,
        post_lock_points:         videoProfile.postLockPoints,
        speed_avg_kmh:            Math.round(videoProfile.postLockSpeedAvgKmh * 10) / 10,
        speed_max_kmh:            Math.round(videoProfile.postLockSpeedMaxKmh * 10) / 10,
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
            throw new Error("This video doesn't match the activity. Check both files are from the same ride.");
          }
        }
      }

      // ── Select sync strategy based on both file analyses ─────────────────
      const syncPlan = gpxProfile
        ? SyncStrategySelector.select(gpxProfile, videoProfile)
        : {
            method: "position-match" as const,
            distanceThresholdM: 10,
            timeWindowMs: 30_000,
            confidence: "LOW" as const,
            reason: "no GPX profile",
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
        throw new Error("Scene detection failed — no segments produced.");

      // TODO: workaround — remove after root cause of residual 4s gap is confirmed
      const VIDEO_SEEK_WORKAROUND_SEC = 0;
      segments.forEach((s) => {
        if (s.videoStartTime !== undefined)
          s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC;
      });

      const storyPlan = StorytellingProcessor.generatePlan(
        activityPoints,
        vpts as any,
        unit,
        clockOffsetMs,
        gpsVideoOffsetMs,
      );
      storyPlan.segments.forEach((s) => {
        if (s.videoStartTime !== undefined)
          s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC;
      });
      setStoryPlan(storyPlan);
      clearInterval(interval);
      setProgress(100);

      // ── Track processing session → then attach GPX child record ─────────
      trackProcessingSession({
        status:             "success",
        video_filename:     file.name,
        video_duration_s:   vpts.length > 0 ? (vpts[vpts.length - 1] as any).time / 1000 : null,
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
            <p className="text-zinc-400 text-lg font-medium max-w-md mb-4 leading-relaxed">
              Turn your adventure into a{" "}
              <span className="text-white border-b border-amber-500/70">cinematic GPS telemetry edit</span>
              {" "}— auto-generated, synced, ready to share.
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
              <img src="/prorefuel_logo.png" alt="ProRefuel" className="w-48 mb-5 drop-shadow-2xl" />
              <h2 className="text-3xl font-black italic tracking-tighter uppercase text-white">
                LENS <span className="text-amber-500">ENGINE</span>
              </h2>
              <p className="text-zinc-500 font-bold mt-1.5 tracking-widest uppercase text-[10px]">
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

                  {/* STEP 02: MP4 */}
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
                        Import MP4
                      </p>
                      <p className={`text-[11px] font-semibold mt-1 ${uploadError ? "text-red-400" : "text-zinc-500"}`}>
                        {uploadError
                          ? uploadError
                          : loading
                            ? statusMsg
                            : activityPoints.length === 0
                              ? "Load GPX first"
                              : "GoPro Video with GPS"}
                      </p>
                    </div>
                    <input type="file" accept=".mp4,video/mp4" disabled={activityPoints.length === 0} onChange={handleVideoUpload} className="hidden" />
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

// ── Mobile-only gate — shown when running on iOS / Android ────────────────

function MobileLanding() {
  const [copied, setCopied] = useState(false);
  const url = "https://lens.prorefuel.app";

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans overflow-x-hidden">
      {/* Ambient glows */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[80%] h-[50%] bg-amber-500/8 blur-[130px] rounded-full" />
        <div className="absolute bottom-[10%] right-[-15%] w-[60%] h-[40%] bg-amber-600/6 blur-[110px] rounded-full" />
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 pt-10 pb-16">

        {/* Navbar */}
        <nav className="w-full flex items-center justify-between mb-10">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tight">LENS</span>
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">Beta v1.0.29</span>
          </div>
        </nav>

        {/* Headline */}
        <h1 className="text-[2.6rem] font-black tracking-tight leading-[0.88] text-center mb-5">
          YOUR CINEMATIC<br />ADVENTURE VIDEO<br />
          <span className="text-amber-500">IN 3 CLICKS.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-zinc-400 text-[15px] leading-relaxed text-center max-w-xs mb-10">
          Turn your adventure into a cinematic GPS telemetry edit — auto-generated, synced, ready to share.
        </p>

        {/* Phone mockup with hero video */}
        <div className="relative w-[220px] mb-5">
          {/* Phone frame */}
          <div className="relative w-full aspect-[9/16] rounded-[2.5rem] bg-zinc-900 border-2 border-zinc-700 shadow-[0_30px_80px_rgba(0,0,0,0.8)] overflow-hidden">
            <video
              src="/videos/hero-preview.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-fill"
            />
            {/* Notch overlay */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-b-2xl z-10" />
          </div>
          {/* Decorative glow behind phone */}
          <div className="absolute inset-0 -z-10 blur-[40px] bg-amber-500/20 rounded-[3rem]" />
        </div>

        {/* Privacy pill */}
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 mb-10">
          <Lock size={10} className="text-green-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-green-400">100% Local · No Data Ever Leaves Your Device</span>
        </div>

        {/* Desktop CTA block */}
        <div className="w-full max-w-sm mb-8">
          <div className="p-5 rounded-3xl bg-zinc-900/70 border border-zinc-800 text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              <span className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Open on your Desktop with Chrome</span>
            </div>
            <p className="text-zinc-500 text-[11px] leading-relaxed mb-4">
              LENS uses GPU, WebAssembly, and Web Workers — it requires the full power of a desktop browser.
            </p>
            <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-black/60 border border-zinc-700 mb-3">
              <span className="flex-1 text-sm font-bold text-amber-400 tracking-wide truncate text-left">{url}</span>
              <button
                onClick={handleCopy}
                className="shrink-0 px-4 py-2 rounded-xl bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest transition-all active:scale-95"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest">
              Paste it in Chrome on your laptop or desktop
            </p>
          </div>
        </div>

        {/* Feature rows */}
        <div className="w-full max-w-sm space-y-2.5 mb-10">
          <MobileFeatureRow icon="🎬" text="Auto-generates cinematic adventure edits" />
          <MobileFeatureRow icon="🛰️" text="Syncs GoPro GPS telemetry with your activity" />
          <MobileFeatureRow icon="📱" text="Outputs 9:16 video ready for Instagram & TikTok" />
          <MobileFeatureRow icon="🔒" text="100% local — your files never leave your device" />
        </div>

        {/* Footer */}
        <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">
          © {new Date().getFullYear()} ProRefuel.app
        </p>
      </div>
    </main>
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
