"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
import dynamic from "next/dynamic";
import { trackProcessingSession, trackGpxSession, computeGpxMetrics, trackVideoExport, trackVideoUpload } from "@/lib/supabase/tracking";
import type { RenderResult } from "@/components/MapEngine";

// Dynamic import — keeps mapbox-gl, Tone.js and ffmpeg out of the initial bundle.
// MapEngine is only needed when the user clicks Generate, never on landing page load.
const MapEngine = dynamic(() => import("@/components/MapEngine"), { ssr: false });
import type { VideoUploadInsert } from "@/lib/supabase/types";
// Type-only imports — zero runtime cost, erased by TypeScript compiler
import type { ActionSegment }   from "@/lib/engine/TelemetryCrossRef";
import type { StoryPlan }       from "@/lib/engine/StorytellingProcessor";
import type { UnitSystem }      from "@/lib/utils/units";
import type { GPXProfile }      from "@/lib/engine/GPXAnalyzer";
import type { VideoGPSProfile } from "@/lib/engine/VideoGPSAnalyzer";
// Engine modules are loaded on-demand inside the upload handlers (never on mobile)

// ── Instagram icon (inline SVG — lucide-react may not export it) ─────────
function IgIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

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
  if (clean) return { label: clean, logoFile: "" };
  return { label: "", logoFile: "" };
}

function detectCamera(cameraModel: string): DeviceInfo {
  const c = cameraModel.toLowerCase();
  if (c.includes("gopro"))    return { label: cameraModel, logoFile: `${LOGO_BASE}/gopro_logo.svg` };
  if (c.includes("dji"))      return { label: cameraModel, logoFile: "" };
  if (c.includes("insta360")) return { label: cameraModel, logoFile: "" };
  if (cameraModel)            return { label: cameraModel, logoFile: "" };
  return { label: "", logoFile: "" };
}

const CLIP_START = 8;   // seconds — skip intro
const CLIP_END   = 40;  // seconds — loop back

// ── Before/After drag comparison component ────────────────────────────────
function BeforeAfterSlider({ isMobile = false }: { isMobile?: boolean }) {
  // hasDragged is the ONLY React state — controls the hint badge visibility
  const [hasDragged, setHasDragged] = useState(false);

  const containerRef    = useRef<HTMLDivElement>(null);
  const rawRef          = useRef<HTMLVideoElement>(null);
  const lensRef         = useRef<HTMLVideoElement>(null);
  const rawWatermarkRef = useRef<HTMLDivElement>(null);
  const lensClipRef     = useRef<HTMLDivElement>(null);
  const dividerRef      = useRef<HTMLDivElement>(null);
  const handleElRef     = useRef<HTMLDivElement>(null);
  const loopGuardRef    = useRef(false);
  const draggingRef     = useRef(false);
  const hasDraggedRef   = useRef(false);

  // Update all slider visuals directly in the DOM — zero React re-renders
  const applySlider = useCallback((pct: number) => {
    const x = Math.min(95, Math.max(5, pct));
    if (rawWatermarkRef.current)
      rawWatermarkRef.current.style.clipPath = `polygon(0 0,${x}% 0,${x}% 100%,0 100%)`;
    if (lensClipRef.current)
      lensClipRef.current.style.clipPath = `polygon(${x}% 0,100% 0,100% 100%,${x}% 100%)`;
    if (dividerRef.current)
      dividerRef.current.style.left = `${x}%`;
    if (handleElRef.current)
      handleElRef.current.style.left = `${x}%`;
  }, []);

  const getXPct = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 50;
    return ((clientX - rect.left) / rect.width) * 100;
  }, []);

  // Mouse drag — window-level so it works outside the element
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      applySlider(getXPct(e.clientX));
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [applySlider, getXPct]);

  // Touch drag — native listener with { passive: false } so preventDefault actually works
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let startX = 0, startY = 0;
    let isHorizontal: boolean | null = null;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isHorizontal = null;
      draggingRef.current = true;
      applySlider(getXPct(e.touches[0].clientX));
      if (!hasDraggedRef.current) { hasDraggedRef.current = true; setHasDragged(true); }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (isHorizontal === null && (dx > 4 || dy > 4)) isHorizontal = dx >= dy;
      if (isHorizontal) {
        e.preventDefault(); // block page scroll only during horizontal drag
        applySlider(getXPct(e.touches[0].clientX));
      } else {
        draggingRef.current = false; // vertical swipe — hand back to scroll
      }
    };

    const onTouchEnd = () => { draggingRef.current = false; isHorizontal = null; };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, [applySlider, getXPct]);

  // seekTo with 2s timeout fallback — desktop only
  const seekTo = useCallback((v: HTMLVideoElement, t: number) =>
    new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2000);
      v.addEventListener("seeked", () => { clearTimeout(timer); resolve(); }, { once: true });
      v.currentTime = t;
    }), []);

  // Video playback
  useEffect(() => {
    const raw  = rawRef.current;
    const lens = lensRef.current;
    if (!raw || !lens) return;

    // iOS fix: React does not correctly set the HTML `muted` attribute.
    // WebKit checks the attribute (not the JS property) to allow muted autoplay.
    raw.muted  = true;
    lens.muted = true;

    if (isMobile) {
      // Mobile: simplest reliable path — play both as soon as any data is ready.
      // The `loop` attribute on the video elements handles looping natively (no JS needed).
      let played = false;
      const attempt = () => {
        if (played) return;
        played = true;
        Promise.all([raw.play(), lens.play()]).catch(() => {
          played = false;
          // Autoplay blocked (Low Power Mode, etc.) — retry on next user touch
          document.addEventListener("touchstart", attempt, { once: true, passive: true });
        });
      };
      // canplay fires when the browser has enough data; loadeddata fires when the first
      // frame is decoded. We listen to both because iOS versions differ on which fires first.
      raw.addEventListener("canplay",    attempt, { once: true });
      raw.addEventListener("loadeddata", attempt, { once: true });
      if (raw.readyState >= 3) attempt(); // already buffered (cached page revisit)
    } else {
      // Desktop: seek both to CLIP_START then play simultaneously
      const start = () => {
        Promise.all([seekTo(raw, CLIP_START), seekTo(lens, CLIP_START)]).then(() => {
          raw.play().catch(() => {});
          lens.play().catch(() => {});
        });
      };
      let rawMeta  = raw.readyState  >= 1;
      let lensMeta = lens.readyState >= 1;
      const tryStart = () => { if (rawMeta && lensMeta) start(); };
      if (!rawMeta)  raw.addEventListener("loadedmetadata", () => { rawMeta  = true; tryStart(); }, { once: true });
      if (!lensMeta) lens.addEventListener("loadedmetadata", () => { lensMeta = true; tryStart(); }, { once: true });
      tryStart();
    }
  }, [isMobile, seekTo]);

  // Desktop-only: custom loop (CLIP_START↔CLIP_END) + drift correction
  useEffect(() => {
    if (isMobile) return; // mobile uses native loop attribute
    const raw  = rawRef.current;
    const lens = lensRef.current;
    if (!raw || !lens) return;

    const onTimeUpdate = () => {
      if (loopGuardRef.current) return;
      const t = raw.currentTime;
      if (t >= CLIP_END) {
        loopGuardRef.current = true;
        Promise.all([seekTo(raw, CLIP_START), seekTo(lens, CLIP_START)]).then(() => {
          raw.play().catch(() => {});
          lens.play().catch(() => {});
          loopGuardRef.current = false;
        });
      } else if (Math.abs(lens.currentTime - t) > 0.12) {
        lens.currentTime = t;
      }
    };

    raw.addEventListener("timeupdate", onTimeUpdate);
    return () => raw.removeEventListener("timeupdate", onTimeUpdate);
  }, [isMobile, seekTo]);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[9/16] rounded-[2rem] overflow-hidden select-none cursor-col-resize shadow-[0_0_100px_rgba(0,0,0,0.9)] ring-1 ring-white/8"
      onMouseDown={e => { draggingRef.current = true; if (!hasDraggedRef.current) { hasDraggedRef.current = true; setHasDragged(true); } applySlider(getXPct(e.clientX)); }}
    >
      {/* RAW video — base layer */}
      <video
        ref={rawRef}
        src={isMobile ? "/videos/hero-preview-raw-mobile.mp4" : "/videos/hero-preview-raw.mp4"}
        muted playsInline preload="auto" loop={isMobile}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* RAW watermark — clipped to LEFT side only (initial inline style, then direct DOM) */}
      <div
        ref={rawWatermarkRef}
        className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
        style={{ clipPath: "polygon(0 0,50% 0,50% 100%,0 100%)" }}
      >
        <span
          className="font-black text-white uppercase tracking-[0.15em] select-none"
          style={{ fontSize: "clamp(4.5rem, 22%, 7.5rem)", opacity: 0.18 }}
        >RAW</span>
      </div>

      {/* LENS video — clipped to right of slider */}
      <div
        ref={lensClipRef}
        className="absolute inset-0"
        style={{ clipPath: "polygon(50% 0,100% 0,100% 100%,50% 100%)", willChange: "clip-path" }}
      >
        <video
          ref={lensRef}
          src={isMobile ? "/videos/hero-preview-mobile.mp4" : "/videos/hero-preview.mp4"}
          muted playsInline preload="auto" loop={isMobile}
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* LENS watermark — orange, visible on right side only */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className="font-black uppercase tracking-[0.15em] select-none"
            style={{ fontSize: "clamp(4.5rem, 22%, 7.5rem)", opacity: 0.22, color: "#f59e0b" }}
          >LENS</span>
        </div>
      </div>

      {/* Divider line */}
      <div
        ref={dividerRef}
        className="absolute top-0 bottom-0 w-[3px] bg-white shadow-[0_0_14px_rgba(255,255,255,0.9)] z-20 pointer-events-none"
        style={{ left: "50%", transform: "translateX(-50%)" }}
      />

      {/* Drag handle */}
      <div
        ref={handleElRef}
        className="absolute top-1/2 z-20 pointer-events-none"
        style={{ left: "50%", transform: "translate(-50%, -50%)" }}
      >
        <div className="w-11 h-11 rounded-full bg-white shadow-[0_0_24px_rgba(0,0,0,0.8)] flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 3 12 9 6" />
            <polyline points="15 6 21 12 15 18" />
          </svg>
        </div>
      </div>

      {/* Drag hint — shown until first drag */}
      {!hasDragged && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 pointer-events-none animate-pulse">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/65 backdrop-blur-sm border border-white/12">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 3 12 9 6"/><polyline points="15 6 21 12 15 18"/></svg>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-200">Drag to compare</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function ProRefuelPage() {
  const [mounted, setMounted] = useState(false);
  const [activityPoints, setActivityPoints] = useState<any[]>([]);
  const [gpxProfile, setGpxProfile]         = useState<GPXProfile | null>(null);
  const [highlights, setHighlights]         = useState<ActionSegment[]>([]);
  const [storyPlan, setStoryPlan]           = useState<StoryPlan | null>(null);
  const [videoFile, setVideoFile]           = useState<File | null>(null);
  const [loading, setLoading]               = useState(false);
  const [progress, setProgress]             = useState(0);
  const [step, setStep]                     = useState<"UPLOAD" | "READY" | "EXPERIENCE">("UPLOAD");
  const [statusMsg, setStatusMsg]           = useState("");
  const [uploadError, setUploadError]       = useState<string | null>(null);
  const [gpxError, setGpxError]             = useState<string | null>(null);
  const [unit, setUnit]                     = useState<UnitSystem>("metric");
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [activityMeta, setActivityMeta]     = useState<{ name: string; location?: string; gpsDevice?: DeviceInfo; camera?: DeviceInfo }>({ name: "EPIC RIDE" });

  const mapEngineRef           = useRef<{ start: () => void; startRecording: () => Promise<void>; isRecording: boolean }>(null);
  const gpxMetricsRef          = useRef<ReturnType<typeof computeGpxMetrics> | null>(null);
  const videoMetricsRef        = useRef<Omit<VideoUploadInsert, "app_version" | "processing_session_id"> | null>(null);
  const processingSessionIdRef = useRef<string | null>(null);
  const readyStepStartRef      = useRef<number | null>(null);
  const experienceStartRef     = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    const ua = navigator.userAgent;
    setIsMobileDevice(/iPhone|iPad|iPod|Android/i.test(ua));
  }, []);

  if (!mounted) return <div className="min-h-screen bg-[#050505]" />;

  // ── Video upload ──────────────────────────────────────────────────────
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const nameLc = file.name.toLowerCase();
    const isMP4  = nameLc.endsWith(".mp4") || file.type === "video/mp4";
    const isMOV  = nameLc.endsWith(".mov") || file.type === "video/quicktime";
    if (!isMP4 && !isMOV) {
      setUploadError("Unsupported format. Use .mp4 (GoPro).");
      e.target.value = "";
      return;
    }

    setLoading(true);
    setUploadError(null);
    setProgress(0);
    const processingStart = Date.now();
    const interval = setInterval(() => setProgress((p) => (p >= 98 ? 98 : p + 1)), 150);

    try {
      // Lazy-load engine modules — never imported on mobile, only when user actually uploads
      const [
        { CameraDetector },
        { GoProEngineClient },
        { iPhoneEngineClient },
        { iPhoneVideoGPSAnalyzer },
        { VideoGPSAnalyzer },
        { SyncStrategySelector },
        { TelemetryCrossRef },
        { StorytellingProcessor },
      ] = await Promise.all([
        import("@/lib/media/CameraDetector"),
        import("@/lib/media/GoProEngineClient"),
        import("@/lib/media/iPhoneEngineClient"),
        import("@/lib/engine/iphone/iPhoneVideoGPSAnalyzer"),
        import("@/lib/engine/VideoGPSAnalyzer"),
        import("@/lib/engine/SyncStrategySelector"),
        import("@/lib/engine/TelemetryCrossRef"),
        import("@/lib/engine/StorytellingProcessor"),
      ]);

      setStatusMsg("Identifying camera...");
      const cameraDetection = await CameraDetector.detect(file);
      const isIPhone = cameraDetection.type === "iphone";

      if (!isIPhone) setVideoFile(file);

      if (cameraDetection.type === "unknown") {
        throw new Error(`Camera not supported: ${cameraDetection.make || "unknown"}. Use GoPro (.mp4).`);
      }

      let vpts: any[], syncPoints: any[], cameraModel: string, gpsVideoOffsetMs: number;
      let iPhoneVideoStartMs = 0, iPhoneDurationMs = 0, iPhoneHasStartGPS = false;

      if (isIPhone) {
        setStatusMsg("Reading iPhone metadata...");
        const result       = await iPhoneEngineClient.extractTelemetry(file);
        vpts               = result.points;
        syncPoints         = result.syncPoints;
        cameraModel        = result.cameraModel;
        gpsVideoOffsetMs   = result.gpsVideoOffsetMs;
        iPhoneVideoStartMs = result.videoStartMs;
        iPhoneDurationMs   = result.durationMs;
        iPhoneHasStartGPS  = result.hasStartGPS;

        if (activityPoints.length >= 5) {
          let clockCorrected = false;
          if (iPhoneHasStartGPS && vpts[0].lat !== 0) {
            const iPhoneClockOffset = estimateIPhoneClockOffsetMs(vpts[0].lat, vpts[0].lon, iPhoneVideoStartMs, activityPoints);
            if (iPhoneClockOffset !== 0) {
              vpts               = vpts.map((p: any) => ({ ...p, time: p.time - iPhoneClockOffset }));
              iPhoneVideoStartMs = iPhoneVideoStartMs - iPhoneClockOffset;
              clockCorrected = true;
            }
          }
          if (!clockCorrected) {
            const actStart = activityPoints[0].time, actEnd = activityPoints[activityPoints.length - 1].time;
            const vidStart = vpts[0].time, vidEnd = vpts[vpts.length - 1].time;
            const alreadyOk = vidStart <= actEnd + 60_000 && vidEnd >= actStart - 60_000;
            if (!alreadyOk) {
              let bestOffset = 0, bestOverlap = 0;
              for (let tzMin = -720; tzMin <= 840; tzMin += 30) {
                const offsetMs = tzMin * 60_000;
                const adjStart = vidStart - offsetMs, adjEnd = vidEnd - offsetMs;
                const overlap  = Math.max(0, Math.min(adjEnd, actEnd) - Math.max(adjStart, actStart));
                if (overlap > bestOverlap) { bestOverlap = overlap; bestOffset = offsetMs; }
              }
              if (bestOffset !== 0) {
                vpts               = vpts.map((p: any) => ({ ...p, time: p.time - bestOffset }));
                iPhoneVideoStartMs = iPhoneVideoStartMs - bestOffset;
              }
            }
          }
        }
      } else {
        setStatusMsg("Analysing GPMF...");
        const result = await GoProEngineClient.extractTelemetry(file);
        vpts             = result.points;
        syncPoints       = result.syncPoints;
        cameraModel      = result.cameraModel;
        gpsVideoOffsetMs = result.gpsVideoOffsetMs;
      }

      let resolvedModel = cameraModel || cameraDetection.model || cameraDetection.make;
      if (!resolvedModel) {
        const fn = file.name.toUpperCase();
        if (/^G[HXL]\d{6}\.MP4$/.test(fn) || fn.startsWith("GOPR") || fn.startsWith("GP")) resolvedModel = "GoPro";
      }
      if (resolvedModel) {
        const camera = detectCamera(resolvedModel);
        if (camera.label) setActivityMeta(prev => ({ ...prev, camera }));
      }

      if (!isIPhone && vpts.length === 0) throw new Error("No GPS in this video. Enable GPS on your GoPro before recording.");

      const videoProfile = isIPhone
        ? iPhoneVideoGPSAnalyzer.analyze(iPhoneVideoStartMs, iPhoneDurationMs, iPhoneHasStartGPS)
        : VideoGPSAnalyzer.analyze(vpts, gpsVideoOffsetMs);

      if (!isIPhone && (!videoProfile.hasGPSLock || videoProfile.postLockPoints === 0))
        throw new Error("GPS signal too weak — no valid fix during recording.");

      const totalPts = vpts.length;
      const fixDist  = videoProfile.fixDistribution;
      const fixTotal = (fixDist.fix0 + fixDist.fix2 + fixDist.fix3) || 1;
      const gpsStartUtc = isIPhone ? new Date(iPhoneVideoStartMs).toISOString() : (totalPts > 0 ? new Date((vpts[0] as any).time).toISOString() : null);
      const gpsEndUtc   = isIPhone ? new Date(iPhoneVideoStartMs + iPhoneDurationMs).toISOString() : (totalPts > 0 ? new Date((vpts[totalPts - 1] as any).time).toISOString() : null);
      videoMetricsRef.current = {
        filename: file.name, file_size_bytes: file.size, camera_model: resolvedModel ?? null,
        has_gps: isIPhone ? iPhoneHasStartGPS : totalPts > 0, gps_points_count: totalPts,
        gps_duration_s: videoProfile.durationSec, gps_sampling_interval_ms: videoProfile.samplingIntervalMs,
        gps_start_utc: gpsStartUtc, gps_end_utc: gpsEndUtc, gps_video_offset_ms: gpsVideoOffsetMs,
        has_gps_lock: videoProfile.hasGPSLock, gps_lock_latency_s: videoProfile.lockLatencySec,
        pre_lock_points: videoProfile.preLockPoints, post_lock_points: videoProfile.postLockPoints,
        speed_avg_kmh: isIPhone ? null : Math.round(videoProfile.postLockSpeedAvgKmh * 10) / 10,
        speed_max_kmh: isIPhone ? null : Math.round(videoProfile.postLockSpeedMaxKmh * 10) / 10,
        distance_m: Math.round(videoProfile.postLockDistanceM),
        fix_pct_no_fix: Math.round((fixDist.fix0 / fixTotal) * 1000) / 10,
        fix_pct_2d: Math.round((fixDist.fix2 / fixTotal) * 1000) / 10,
        fix_pct_3d: Math.round((fixDist.fix3 / fixTotal) * 1000) / 10,
      };

      {
        const DRIFT_MS      = 5 * 60_000;
        const videoGPSStart = (vpts[0] as any).time + gpsVideoOffsetMs;
        const videoGPSEnd   = (vpts[vpts.length - 1] as any).time;
        const actStart      = activityPoints[0]?.time;
        const actEnd        = activityPoints[activityPoints.length - 1]?.time;
        const temporalOverlap =
          actStart !== undefined && actEnd !== undefined &&
          videoGPSStart - DRIFT_MS <= actEnd && videoGPSEnd + DRIFT_MS >= actStart;
        if (!temporalOverlap) {
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
          if (!spatialOverlap) throw new Error("Video doesn't match this activity. Check both files are from the same ride.");
        }
      }

      const syncPlan = isIPhone
        ? { method: "timestamp-based" as const, distanceThresholdM: 0, timeWindowMs: 0, confidence: "HIGH" as const, reason: "iPhone CreateDate = activity GPS UTC" }
        : gpxProfile
          ? SyncStrategySelector.select(gpxProfile, videoProfile)
          : { method: "position-match" as const, distanceThresholdM: 10, timeWindowMs: 30_000, confidence: "LOW" as const, reason: "no GPX profile" };

      const clockOffsetMs = 0;
      const segments = TelemetryCrossRef.findHighlights(activityPoints, vpts as any, unit, clockOffsetMs, gpsVideoOffsetMs);
      if (!segments || segments.length === 0) throw new Error("No scenes detected in this activity.");

      const VIDEO_SEEK_WORKAROUND_SEC = 0;
      segments.forEach((s) => { if (s.videoStartTime !== undefined) s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC; });

      const videoDurationSec = isIPhone
        ? iPhoneDurationMs / 1000
        : (vpts.length > 1 ? gpsVideoOffsetMs / 1000 + (vpts[vpts.length - 1].time - vpts[0].time) / 1000 : 0);

      const sp = StorytellingProcessor.generatePlan(activityPoints, vpts as any, unit, clockOffsetMs, gpsVideoOffsetMs, videoDurationSec);
      sp.segments.forEach((s) => { if (s.videoStartTime !== undefined) s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC; });
      setStoryPlan(sp);
      clearInterval(interval);
      setProgress(100);

      trackProcessingSession({
        status: "success", video_filename: file.name,
        video_duration_s: isIPhone ? iPhoneDurationMs / 1000 : (vpts.length > 0 ? (vpts[vpts.length - 1] as any).time / 1000 : null),
        camera_model: resolvedModel ?? null, activity_name: activityMeta.name ?? null,
        gpx_points_count: activityPoints.length || null, gps_device: activityMeta.gpsDevice?.label ?? null,
        activity_location: activityMeta.location ?? null, sync_strategy: syncPlan.method ?? null,
        scenes_count: sp.segments.length ?? null, unit_system: unit,
        processing_time_ms: Date.now() - processingStart, error_message: null,
      }).then((processingSessionId) => {
        processingSessionIdRef.current = processingSessionId;
        if (processingSessionId) {
          if (gpxMetricsRef.current)   trackGpxSession({ ...gpxMetricsRef.current, processing_session_id: processingSessionId });
          if (videoMetricsRef.current) trackVideoUpload({ ...videoMetricsRef.current, processing_session_id: processingSessionId });
        }
      });

      setTimeout(() => {
        setHighlights(segments);
        if (isIPhone) setVideoFile(file);
        setStep("READY");
        readyStepStartRef.current = Date.now();
        setLoading(false);
      }, 500);
    } catch (e: any) {
      clearInterval(interval);
      setUploadError(e.message);
      setLoading(false);
      trackProcessingSession({
        status: "error", video_filename: file.name, video_duration_s: null, camera_model: null,
        activity_name: activityMeta.name ?? null, gpx_points_count: activityPoints.length || null,
        gps_device: activityMeta.gpsDevice?.label ?? null, activity_location: activityMeta.location ?? null,
        sync_strategy: null, scenes_count: null, unit_system: unit,
        processing_time_ms: Date.now() - processingStart, error_message: e.message ?? null,
      });
    }
  };

  // ── GPX upload ────────────────────────────────────────────────────────
  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".gpx")) { setGpxError("Only .gpx files are accepted."); e.target.value = ""; return; }
    setGpxError(null);
    const text = await file.text();
    const { GPXAnalyzer } = await import("@/lib/engine/GPXAnalyzer");
    const profile = GPXAnalyzer.analyze(text);
    setGpxProfile(profile);
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const pts = Array.from(xml.querySelectorAll("trkpt")).map((pt: Element) => {
      const lat     = parseFloat(pt.getAttribute("lat") || "0");
      const lon     = parseFloat(pt.getAttribute("lon") || "0");
      const ele     = parseFloat(pt.querySelector("ele")?.textContent || "0");
      const time    = new Date(pt.querySelector("time")?.textContent || "").getTime();
      const hrEl    = pt.querySelector("hr");
      const cadEl   = pt.querySelector("cad");
      const powerEl = pt.querySelector("power") ?? pt.querySelector("watts");
      const speedEl = pt.querySelector("speed");
      const hr    = hrEl    ? parseFloat(hrEl.textContent    || "0") || undefined : undefined;
      const cad   = cadEl   ? parseFloat(cadEl.textContent   || "0") || undefined : undefined;
      const power = powerEl ? parseFloat(powerEl.textContent || "0") || undefined : undefined;
      const speed = speedEl ? parseFloat(speedEl.textContent || "0") * 3.6 || undefined : undefined;
      return { lat, lon, ele, time, ...(hr !== undefined && { hr }), ...(cad !== undefined && { cad }), ...(power !== undefined && { power }), ...(speed !== undefined && { speed }) };
    });
    if (pts.length === 0) { setGpxError("No GPS track found in this file."); e.target.value = ""; return; }
    setActivityPoints(pts);
    const allNameEls  = Array.from(xml.getElementsByTagName("name"));
    const trackName   = allNameEls.find(el => el.parentElement?.localName === "trk")?.textContent?.trim() || allNameEls.find(el => el.textContent?.trim())?.textContent?.trim() || "EPIC RIDE";
    const creatorRaw  = xml.documentElement.getAttribute("creator") || "";
    const activityType = xml.querySelector("trk > type")?.textContent?.trim() ?? undefined;
    const gpsDevice   = creatorRaw ? detectGPSDevice(creatorRaw) : undefined;
    setActivityMeta({ name: trackName, ...(gpsDevice?.label ? { gpsDevice } : {}) });
    let resolvedLocation: string | undefined;
    if (pts.length > 0) {
      try {
        const { lat, lon } = pts[0];
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const resp = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=place,region&access_token=${token}`);
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
    gpxMetricsRef.current = computeGpxMetrics(pts, { creator: gpsDevice?.label ?? creatorRaw ?? undefined, activityType, activityName: trackName, activityLocation: resolvedLocation });
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans selection:bg-amber-500/40 overflow-x-hidden">

      {/* AMBIENT BACKGROUND */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[60%] bg-amber-500/6 blur-[160px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-amber-600/4 blur-[140px] rounded-full" />
        <div className="absolute top-[40%] right-[20%] w-[30%] h-[40%] bg-amber-500/3 blur-[100px] rounded-full" />
      </div>

      {/* ── NAVBAR ──────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <a href="/" className="flex items-center gap-3 group">
          <span className="text-xl font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
          <span className="hidden sm:block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
        </a>
        <div className="flex items-center gap-1 sm:gap-2">
          <a href="/como-funciona" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">How It Works</a>
          <a href="/privacidade" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">Privacy</a>
          <div className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Free Beta</span>
          </div>
        </div>
      </nav>

      {/* ── HERO SECTION ────────────────────────────────────────────────── */}
      <section className="relative z-10 pt-20 pb-0 min-h-screen flex flex-col lg:flex-row max-w-[1600px] mx-auto">

        {/* LEFT: Copy + CTA */}
        <div className="w-full lg:w-[52%] flex flex-col justify-center px-8 py-16 lg:px-16 lg:py-24">

          <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-zinc-900/80 border border-amber-500/25 mb-8 w-fit shadow-xl backdrop-blur">
            <Zap size={13} className="text-amber-500 fill-amber-500 animate-pulse" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200">Beta v1.0.30 &nbsp;·&nbsp; 100% Free</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[0.88] mb-6">
            STOP SHARING<br />
            RAW FOOTAGE.<br />
            <span className="text-amber-500 drop-shadow-[0_0_40px_rgba(245,158,11,0.4)]">
              START SHARING<br />STORIES.
            </span>
          </h1>

          <p className="text-zinc-300 text-xl font-semibold max-w-md mb-3 leading-relaxed">
            Your GoPro captures everything. LENS edits what matters.
          </p>
          <p className="text-zinc-500 text-sm max-w-sm mb-8 leading-relaxed">
            Import your GPX activity and GoPro video. LENS reads your GPS data, detects the best moments, and generates a cinematic 9:16 edit — synced, scored, and ready to post. In seconds.
          </p>

          <div className="flex flex-wrap gap-6 mb-10">
            {[
              { value: "18Hz", label: "GPS Precision" },
              { value: "< 60s", label: "Generate Time" },
              { value: "9:16", label: "Insta Ready" },
              { value: "0 Upload", label: "100% Private" },
            ].map(s => (
              <div key={s.label} className="flex flex-col">
                <span className="text-2xl font-black text-amber-400 leading-none">{s.value}</span>
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-1">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30">
              <IgIcon size={16} className="text-pink-400" />
              <span className="text-[13px] font-black text-white tracking-wide">@LENS.video</span>
            </div>
            <span className="text-zinc-600 text-xs">· Share your results · Get feedback</span>
          </div>
        </div>

        {/* RIGHT: Before/After slider */}
        <div className="w-full lg:w-[48%] flex items-center justify-center px-4 py-10 lg:px-8 lg:py-12">
          <div className="w-full max-w-[340px] md:max-w-[400px] lg:max-w-[460px] xl:max-w-[520px]">
            {/* TEST: slider hidden on mobile to isolate performance issue */}
            {!isMobileDevice && <BeforeAfterSlider isMobile={false} />}
          </div>
        </div>
      </section>

      {/* ── ENGINE SECTION ──────────────────────────────────────────────── */}
      <section className="relative z-10 border-t border-zinc-800/40 bg-gradient-to-b from-black/0 to-zinc-950/60">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-20 flex flex-col lg:flex-row gap-16 items-start">

          <div className="w-full lg:w-[45%] lg:sticky lg:top-24">
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-4">Create your video</p>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-6">
              Your ride.<br />
              <span className="text-amber-500">Edited in seconds.</span>
            </h2>
            <p className="text-zinc-400 text-base leading-relaxed mb-8 max-w-md">
              Drop your GPX activity file and your GoPro video. LENS does the rest — scene detection, GPS sync, cinematic cuts, telemetry overlay. No editing skills needed.
            </p>
            <div className="space-y-3">
              {[
                { icon: "🛰️", title: "GPS Scene Detection", body: "Finds climbs, sprints, and technical sections from your GPS data." },
                { icon: "🎬", title: "Cinematic Auto-Edit", body: "Selects the best clips and assembles them with smooth transitions." },
                { icon: "📊", title: "Telemetry Overlay", body: "Speed, heart rate, elevation — rendered in real time on every frame." },
              ].map(f => (
                <div key={f.title} className="flex gap-4 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/60">
                  <span className="text-2xl shrink-0">{f.icon}</span>
                  <div>
                    <p className="font-black text-white text-sm mb-0.5">{f.title}</p>
                    <p className="text-zinc-500 text-xs leading-relaxed">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full lg:w-[55%] flex justify-center">
            <div className="w-full max-w-[460px]">

              <div className="flex flex-col items-center mb-8">
                <h2 className="text-7xl font-black tracking-tight uppercase text-white mb-3">LENS</h2>
                <div className="flex items-center gap-2 mb-3">
                  <img src="/prorefuel_logo.png" alt="ProRefuel" className="w-36 opacity-70" />
                </div>
                <p className="text-zinc-500 font-bold tracking-widest uppercase text-[10px]">
                  Telemetry · Sync · Cinematic Edit
                </p>
              </div>

              <div className="bg-[#0f0f0f] rounded-[2.8rem] border border-zinc-800/80 p-7 md:p-9 shadow-2xl relative ring-1 ring-white/4">
                {isMobileDevice ? (
                  <div className="flex flex-col items-center gap-4 py-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-2xl">🖥️</div>
                    <p className="font-black text-white text-base uppercase tracking-wide">Desktop only</p>
                    <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
                      LENS requires Chrome on a desktop computer to process your GoPro video.
                    </p>
                    <a href="https://lens.prorefuel.app" className="px-5 py-3 rounded-xl bg-amber-500 text-black font-black text-sm uppercase tracking-widest">
                      lens.prorefuel.app
                    </a>
                  </div>
                ) : step !== "EXPERIENCE" ? (
                  <div className="space-y-5 relative z-10">

                    <div className="flex p-1.5 bg-black rounded-2xl border border-zinc-800 shadow-inner">
                      <button onClick={() => setUnit("metric")} className={`flex-1 py-2.5 rounded-xl text-[11px] font-black tracking-widest transition-all ${unit === "metric" ? "bg-amber-500 text-black shadow-[0_5px_15px_rgba(245,158,11,0.3)]" : "text-zinc-500 hover:text-white"}`}>METRIC</button>
                      <button onClick={() => setUnit("imperial")} className={`flex-1 py-2.5 rounded-xl text-[11px] font-black tracking-widest transition-all ${unit === "imperial" ? "bg-amber-500 text-black shadow-[0_5px_15px_rgba(245,158,11,0.3)]" : "text-zinc-500 hover:text-white"}`}>IMPERIAL</button>
                    </div>

                    <label className={`group flex items-center gap-5 p-6 rounded-2xl border-2 transition-all cursor-pointer ${gpxError ? "border-red-500 bg-red-500/8" : activityPoints.length > 0 ? "border-green-500 bg-green-500/8" : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 animate-glow-pulse"}`}>
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all ${gpxError ? "bg-red-500 text-white" : activityPoints.length > 0 ? "bg-green-500 text-black" : "bg-amber-500 text-black shadow-lg"}`}>
                        {activityPoints.length > 0 ? <CheckCircle2 size={28} /> : <Gauge size={28} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`block text-[10px] font-black uppercase tracking-widest mb-0.5 ${gpxError ? "text-red-400" : activityPoints.length > 0 ? "text-green-500" : "text-amber-500"}`}>Step 01</span>
                        <p className="text-base font-black uppercase text-white leading-none">Import GPX</p>
                        {gpxError && <p className="text-[11px] font-semibold mt-1 text-red-400">{gpxError}</p>}
                      </div>
                      <input type="file" accept=".gpx" onChange={handleGPXUpload} className="hidden" />
                    </label>

                    <label className={`group flex items-center gap-5 p-6 rounded-2xl border-2 transition-all cursor-pointer ${uploadError ? "border-red-500 bg-red-500/8" : highlights.length > 0 ? "border-green-500 bg-green-500/8" : activityPoints.length === 0 ? "border-zinc-800 bg-zinc-900/40 cursor-not-allowed opacity-60" : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10"}`}>
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all ${highlights.length > 0 ? "bg-green-500 text-black" : activityPoints.length === 0 ? "bg-zinc-800 text-zinc-600" : "bg-amber-500 text-black shadow-lg"}`}>
                        {loading ? <Loader2 className="animate-spin" size={28} /> : highlights.length > 0 ? <CheckCircle2 size={28} /> : <Upload size={28} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`block text-[10px] font-black uppercase tracking-widest mb-0.5 ${uploadError ? "text-red-400" : activityPoints.length === 0 ? "text-zinc-600" : "text-amber-500"}`}>Step 02</span>
                        <p className={`text-base font-black uppercase leading-none ${activityPoints.length === 0 ? "text-zinc-600" : "text-white"}`}>Import Video</p>
                        <p className={`text-[11px] font-semibold mt-1 ${uploadError ? "text-red-400" : "text-zinc-500"}`}>
                          {uploadError ? uploadError : loading ? statusMsg : activityPoints.length === 0 ? "Load GPX first" : "GoPro .mp4"}
                        </p>
                      </div>
                      <input type="file" accept=".mp4,.mov,video/mp4,video/quicktime" disabled={activityPoints.length === 0} onChange={handleVideoUpload} className="hidden" />
                      {activityPoints.length === 0 && <Lock size={16} className="text-zinc-700 shrink-0" />}
                    </label>

                    <button
                      onClick={() => {
                        experienceStartRef.current = Date.now();
                        trackVideoExport({
                          processing_session_id: processingSessionIdRef.current,
                          reached_experience: true, clicked_record: true, completed_download: false,
                          time_on_ready_ms: readyStepStartRef.current ? Date.now() - readyStepStartRef.current : null,
                          time_to_download_ms: null, render_duration_ms: null, render_status: null,
                          error_message: null, output_format: null, output_size_bytes: null, output_duration_s: null,
                        });
                        setStep("EXPERIENCE");
                      }}
                      disabled={!highlights.length}
                      className={`w-full py-6 mt-2 rounded-2xl font-black uppercase tracking-[0.35em] text-xs transition-all flex items-center justify-center gap-3 ${highlights.length ? "bg-amber-500 text-black shadow-[0_15px_40px_rgba(245,158,11,0.35)] hover:scale-[1.02] active:scale-[0.98]" : "bg-zinc-800/80 text-zinc-600 cursor-not-allowed"}`}
                    >
                      <Zap size={18} fill={highlights.length ? "black" : "none"} />
                      Generate &amp; Download
                    </button>

                    <div className="flex justify-center gap-6 pt-6 border-t border-zinc-800/60">
                      <div className="flex items-center gap-1.5 text-zinc-600"><Shield size={12} /><span className="text-[10px] font-black uppercase tracking-widest">Private</span></div>
                      <div className="flex items-center gap-1.5 text-zinc-600"><Smartphone size={12} /><span className="text-[10px] font-black uppercase tracking-widest">On-Device</span></div>
                      <div className="flex items-center gap-1.5 text-zinc-600"><PlayCircle size={12} /><span className="text-[10px] font-black uppercase tracking-widest">Insta Ready</span></div>
                    </div>
                  </div>
                ) : (
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
                          reached_experience: true, clicked_record: true, completed_download: true,
                          time_on_ready_ms: readyStepStartRef.current && experienceStartRef.current ? experienceStartRef.current - readyStepStartRef.current : null,
                          time_to_download_ms: experienceStartRef.current ? Date.now() - experienceStartRef.current : null,
                          render_duration_ms: result.durationMs, render_status: result.status,
                          error_message: result.errorMessage ?? null, output_format: result.outputFormat,
                          output_size_bytes: result.outputSizeBytes,
                          output_duration_s: storyPlan ? storyPlan.segments.reduce((s, seg) => s + (seg.durationSec ?? 0), 0) : null,
                        });
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── INSTAGRAM CTA SECTION ───────────────────────────────────────── */}
      <section className="relative z-10 border-t border-zinc-800/40">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-20 text-center">
          <div className="max-w-2xl mx-auto">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600/30 to-pink-600/30 border border-purple-500/30 mb-6">
              <IgIcon size={28} className="text-pink-400" />
            </div>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight mb-4">
              Tag us. Get featured.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">@LENS.video</span>
            </h2>
            <p className="text-zinc-400 text-base leading-relaxed mb-8 max-w-lg mx-auto">
              Share your LENS edit on Instagram and tag <strong className="text-white">@LENS.video</strong>. Your video could be featured on our page — and your feedback helps us build the best auto-editor for action sports.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <div className="px-5 py-3 rounded-2xl bg-gradient-to-r from-purple-600/15 to-pink-600/15 border border-purple-500/25 text-[13px] font-black text-white tracking-wide">
                📸 Share your ride
              </div>
              <div className="px-5 py-3 rounded-2xl bg-zinc-900/60 border border-zinc-700/50 text-[13px] font-black text-zinc-300 tracking-wide">
                💬 Drop feedback
              </div>
              <div className="px-5 py-3 rounded-2xl bg-zinc-900/60 border border-zinc-700/50 text-[13px] font-black text-zinc-300 tracking-wide">
                🏆 Get featured
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURE GRID ────────────────────────────────────────────────── */}
      <section className="relative z-10 border-t border-zinc-800/40 bg-gradient-to-b from-black/0 to-black/40">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-20">
          <div className="text-center mb-14">
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-4">Why LENS</p>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
              Built for <span className="text-amber-500">athletes</span>,<br />not editors.
            </h2>
            <p className="text-zinc-400 text-base max-w-lg mx-auto leading-relaxed">
              Every ride, run, or hike has a story. LENS reads your GPS data, finds the best moments, and assembles them automatically.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <FeatureTile icon="⚡" title="Auto-edited" body="Scene detection powered by your GPS intensity data. No manual cuts." />
            <FeatureTile icon="🛰️" title="GPS-synced" body="Millisecond precision — video and GPS track matched exactly." />
            <FeatureTile icon="🎬" title="9:16 format" body="Instagram Reels, TikTok, YouTube Shorts — ready in one click." />
            <FeatureTile icon="🔒" title="100% private" body="Everything runs in your browser. Your files never leave your device." />
          </div>
          <div className="mt-14 text-center">
            <p className="text-zinc-500 text-sm mb-1">No account. No subscription. No upload.</p>
            <p className="text-zinc-300 font-black text-base">Just open Chrome on your desktop and go. ↑</p>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-zinc-800/50 bg-black/30 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <a href="/" className="flex items-center gap-2 group">
              <span className="text-lg font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
            </a>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Elevate your adventure.</p>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://instagram.com/LENS.video" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-zinc-500 hover:text-pink-400 transition-colors">
              <IgIcon size={14} />
              <span className="text-[11px] font-black uppercase tracking-widest">@LENS.video</span>
            </a>
            <a href="/como-funciona" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">How It Works</a>
            <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">Privacy</a>
          </div>
          <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">© {new Date().getFullYear()} ProRefuel.app</p>
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

// ── iPhone clock correction ───────────────────────────────────────────────
function estimateIPhoneClockOffsetMs(
  recordingLat: number, recordingLon: number, createDateMs: number,
  activityPoints: { lat: number; lon: number; time: number }[],
): number {
  if (activityPoints.length < 5) return 0;
  const R = 6_371_000, toRad = (d: number) => d * Math.PI / 180;
  const MAX_DIST_M = 100, MAX_DELTA_MS = 24 * 3_600_000;
  let minDist = Infinity, bestMatch: { lat: number; lon: number; time: number } | null = null;
  for (const p of activityPoints) {
    if (Math.abs(p.time - createDateMs) > MAX_DELTA_MS) continue;
    const dLat = toRad(p.lat - recordingLat), dLon = toRad(p.lon - recordingLon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(recordingLat)) * Math.cos(toRad(p.lat)) * Math.sin(dLon / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (dist < minDist) { minDist = dist; bestMatch = p; }
  }
  if (!bestMatch || minDist > MAX_DIST_M) {
    minDist = Infinity; bestMatch = null;
    for (const p of activityPoints) {
      const dLat = toRad(p.lat - recordingLat), dLon = toRad(p.lon - recordingLon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(recordingLat)) * Math.cos(toRad(p.lat)) * Math.sin(dLon / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (dist < minDist) { minDist = dist; bestMatch = p; }
    }
  }
  if (!bestMatch || minDist > MAX_DIST_M) return 0;
  return createDateMs - bestMatch.time;
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
