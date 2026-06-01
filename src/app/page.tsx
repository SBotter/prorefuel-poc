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
import { trackProcessingSession, trackGpxSession, computeGpxMetrics, trackVideoExport, trackVideoUpload, trackError, trackHevcTranscode } from "@/lib/supabase/tracking";
import { getBrowserInfo } from "@/lib/utils/browserInfo";
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
import { StravaConnect }         from "@/components/StravaConnect";
import { InstallPrompt }        from "@/components/InstallPrompt";
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

// ── Activity type extraction — 4-layer fallback ───────────────────────────
//
// Layer 1: <trk><type>  — standard GPX. Garmin Connect + Strava write this.
//          May be text ("cycling") or numeric code ("1", "17", "28"…).
// Layer 2: <extensions>  — Polar and some Garmin firmware write sport type here.
// Layer 3: Track name patterns  — Suunto encodes type in the machine-generated
//          name ("suuntoapp-TrailRunning-…"). Wahoo/Coros/Komoot use plain names.
// Layer 4: keyword scan on track name  — last resort, conservative matching.

// Garmin/Polar numeric sport codes → normalized label
const SPORT_CODES: Record<string, string> = {
  "1": "Running",      "2": "Cycling",        "5": "Swimming",
  "17": "Hiking",      "28": "Mountain Biking","29": "Cycling",
  "36": "Skiing",      "45": "Trail Running",  "53": "Walking",
};

function normalizeTypeString(raw: string): string | undefined {
  const t = raw.toLowerCase().replace(/_/g, " ").replace(/-/g, " ").trim();
  if (!t) return undefined;

  // Numeric code
  if (/^\d+$/.test(t)) return SPORT_CODES[t];

  // Specific types — order matters (more specific first)
  if (/trail.?run/.test(t))                              return "Trail Running";
  if (/mountain.?bik|mtb\b/.test(t))                    return "Mountain Biking";
  if (/gravel/.test(t))                                  return "Gravel Cycling";
  if (/e.?bik|ebike/.test(t))                           return "E-Bike";
  if (/cycl|bik(?!e\s*path)|riding|velom/.test(t))      return "Cycling";
  if (/running|jogg/.test(t))                            return "Running";
  if (/hiking|trekking/.test(t))                         return "Hiking";
  if (/walking/.test(t))                                 return "Walking";
  if (/swim/.test(t))                                    return "Swimming";
  if (/nordic.?ski|cross.?country.?ski/.test(t))         return "Cross-Country Skiing";
  if (/ski(?!p)/.test(t))                                return "Skiing";
  if (/kayak|canoe/.test(t))                             return "Kayaking";
  if (/climb|alpini/.test(t))                            return "Climbing";
  if (/triathlon/.test(t))                               return "Triathlon";

  // Return as-is if it's a short alphabetic phrase (likely a valid type value)
  if (/^[a-z][a-z\s]{1,28}$/.test(t))
    return t.replace(/\b\w/g, c => c.toUpperCase());

  return undefined;
}

function extractActivityType(xml: Document, suuntoNameMatch: RegExpMatchArray | null, rawTrackName: string): string | undefined {
  // Layer 1 — <trk><type>
  const typeEl = xml.querySelector("trk > type")?.textContent?.trim();
  const fromType = normalizeTypeString(typeEl ?? "");
  if (fromType) return fromType;

  // Layer 2 — <extensions> sport/activity tags (Polar, some Garmin firmware)
  // Try common element names used by different vendors
  const extCandidates = [
    "sport", "Sport", "activity", "Activity", "activity-type", "ActivityType",
    "SportName", "sportName", "TrackActivity",
  ];
  for (const tag of extCandidates) {
    const el = xml.querySelector(`trk > extensions > ${tag}, trk > extensions [localName="${tag}"]`);
    const fromExt = normalizeTypeString(el?.textContent?.trim() ?? "");
    if (fromExt) return fromExt;
  }
  // Also try any extension element whose tag name contains "sport" or "activity"
  const extEls = xml.querySelectorAll("trk > extensions *");
  for (const el of extEls) {
    const name = el.localName?.toLowerCase() ?? "";
    if (name.includes("sport") || name.includes("activit")) {
      const fromExt = normalizeTypeString(el.textContent?.trim() ?? "");
      if (fromExt) return fromExt;
    }
  }

  // Layer 3 — Suunto machine-generated track name
  if (suuntoNameMatch) {
    return suuntoNameMatch[1].replace(/([A-Z])/g, " $1").trim();
  }

  // Layer 4 — keyword scan on track name (Wahoo, Coros, Komoot, generic apps)
  // Conservative: only match clear sport keywords surrounded by word boundaries
  const nameLc = rawTrackName.toLowerCase();
  if (/\btrail\s*run/.test(nameLc))                        return "Trail Running";
  if (/\bmountain\s*bik|\bmtb\b/.test(nameLc))             return "Mountain Biking";
  if (/\bgravel\b/.test(nameLc))                            return "Gravel Cycling";
  if (/\be\s*-?\s*bik/.test(nameLc))                       return "E-Bike";
  if (/\bcycl|\bbiking\b/.test(nameLc))                    return "Cycling";
  if (/\brunning\b|\bjogging\b/.test(nameLc))              return "Running";
  if (/\bhiking\b|\btrekking\b/.test(nameLc))              return "Hiking";
  if (/\bwalking\b/.test(nameLc))                          return "Walking";
  if (/\bswimming\b/.test(nameLc))                         return "Swimming";
  if (/\bnordic\s*ski|\bcross.country\s*ski/.test(nameLc)) return "Cross-Country Skiing";
  if (/\bskiing\b/.test(nameLc))                           return "Skiing";
  if (/\bkayak/.test(nameLc))                              return "Kayaking";
  if (/\bclimbing\b/.test(nameLc))                         return "Climbing";

  return undefined;
}

const ANDROID_BRANDS = ['samsung', 'galaxy', 'huawei', 'xiaomi', 'google', 'pixel',
  'motorola', 'oneplus', 'oppo', 'vivo', 'realme', 'sony xperia', 'android'];

function detectCamera(cameraModel: string): DeviceInfo {
  const c = cameraModel.toLowerCase();
  if (c.includes("gopro"))                           return { label: cameraModel, logoFile: `${LOGO_BASE}/gopro_logo.svg` };
  if (c.includes("apple") || c.includes("iphone"))  return { label: cameraModel, logoFile: `${LOGO_BASE}/iphone_logo.svg` };
  if (ANDROID_BRANDS.some(b => c.includes(b)))       return { label: cameraModel, logoFile: `${LOGO_BASE}/android_logo.svg` };
  if (c.includes("dji"))                             return { label: cameraModel, logoFile: "" };
  if (c.includes("insta360"))                        return { label: cameraModel, logoFile: "" };
  if (cameraModel)                                   return { label: cameraModel, logoFile: "" };
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
  const [isMobileVideo, setIsMobileVideo]   = useState(false); // true for iPhone + Android
  const [hevcConverting, setHevcConverting] = useState(false);
  const [hevcProgress,   setHevcProgress]   = useState(0);
  const [hevcStatus,     setHevcStatus]     = useState("");
  const [videoSuccess,   setVideoSuccess]   = useState(false);

  const mapEngineRef           = useRef<{ start: () => void; startRecording: () => Promise<void>; isRecording: boolean }>(null);
  const gpxMetricsRef          = useRef<ReturnType<typeof computeGpxMetrics> | null>(null);
  const videoMetricsRef        = useRef<Omit<VideoUploadInsert, "app_version" | "processing_session_id"> | null>(null);
  const processingSessionIdRef = useRef<string | null>(null);
  const readyStepStartRef      = useRef<number | null>(null);
  const experienceStartRef     = useRef<number | null>(null);

  // Browser device info — collected once on mount, used in tracking calls
  const browserInfoRef = useRef<import("@/lib/utils/browserInfo").BrowserInfo | null>(null);

  useEffect(() => {
    setMounted(true);
    setIsMobileDevice(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    // Collect browser/OS info asynchronously (may need high-entropy UA hints)
    import("@/lib/utils/browserInfo").then(({ getBrowserInfoEnriched }) => {
      getBrowserInfoEnriched().then(info => { browserInfoRef.current = info; });
    });
  }, []);

  // ── Video upload ──────────────────────────────────────────────────────
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Extension used only as a quick format gate — not for camera identification
    const nameLc = file.name.toLowerCase();
    const isMP4  = nameLc.endsWith(".mp4") || file.type === "video/mp4";
    const isMOV  = nameLc.endsWith(".mov") || file.type === "video/quicktime";

    // Browser/hardware context — synchronous, available from the very first error.
    const bi  = getBrowserInfo();
    const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "unknown");
    const baseFileBrowserCtx = {
      file_extension:    ext,
      file_size_bytes:   file.size,
      file_mime_type:    file.type || null,
      browser_os:        bi.os,
      browser_os_version: bi.os_version,
      browser_name:      bi.browser,
      browser_version:   bi.browser_version,
      device_memory_gb:  typeof navigator !== "undefined" ? (navigator as any).deviceMemory ?? null : null,
      cpu_cores:         typeof navigator !== "undefined" ? (navigator.hardwareConcurrency || null) : null,
    };

    if (!isMP4 && !isMOV) {
      void trackError(
        "WRONG_VIDEO_FORMAT",
        `[${file.name}] Unsupported extension "${ext}" — LENS accepts .mp4 and .mov. Size: ${(file.size/1024/1024).toFixed(1)}MB.`,
        "video_upload",
        { ...baseFileBrowserCtx },
      );
      setUploadError("Unsupported format. Use GoPro .mp4, iPhone .mov, or Android .mp4.");
      e.target.value = "";
      return;
    }

    // Show loading immediately — pre-checks (camera detection, GPS scan, HEVC detection)
    // take 1-5s on large files. Without this the UI looks frozen after file selection.
    setLoading(true);
    setUploadError(null);
    setStatusMsg("Checking video…");
    setProgress(0);

    // ── Camera detection — reads FILE CONTENT, never filename ────────────────
    const { CameraDetector: CD } = await import("@/lib/media/CameraDetector");
    const earlyDetection = await CD.detect(file);

    // ── Video metadata scan — runs once, reused by ALL error paths ────────────
    // Reads the first 2 MB of the file (fast, ~5ms). Provides codec, resolution,
    // fps, embedded GPS flag, and recording timestamp for every error event.
    const { parseVideoMeta: _parseVideoMeta } = await import("@/lib/engine/parseVideoMeta");
    const vmeta = await _parseVideoMeta(file).catch(() => ({
      codec: "unknown" as const, width: null, height: null,
      fps: null, hasEmbeddedGPS: false, recordedAt: null,
    }));

    // ── Comprehensive error context — spread into every trackError call ────────
    // GPX fields are populated if the user already uploaded a GPX before the video.
    const richCtx = {
      ...baseFileBrowserCtx,
      // Video
      video_codec:       vmeta.codec !== "unknown" ? vmeta.codec : null,
      video_width:       vmeta.width,
      video_height:      vmeta.height,
      video_fps:         vmeta.fps,
      video_has_gps:     vmeta.hasEmbeddedGPS || null,
      video_recorded_at: vmeta.recordedAt,
      // Camera (from file content — not filename)
      device_type:  earlyDetection.type !== "unknown" ? (earlyDetection.type as any) : null,
      device_make:  earlyDetection.make  || null,
      device_model: earlyDetection.model || null,
      // GPX — if already uploaded by the user at this point
      gpx_start_at:    activityPoints.length > 0 ? new Date(activityPoints[0].time).toISOString() : null,
      gpx_end_at:      activityPoints.length > 0 ? new Date(activityPoints[activityPoints.length - 1].time).toISOString() : null,
      gpx_point_count: activityPoints.length > 0 ? activityPoints.length : null,
      gpx_creator:     gpxMetricsRef.current?.creator ?? null,
    };

    // processVideoFile = H.264 version used for setVideoFile (playback).
    // GPMF/GPS/EXIF extraction always uses the original `file`.
    let processVideoFile: File = file;

    // Codec compatibility check — covers both .mp4 AND .mov.
    // canBrowserPlay() loads the actual file into a hidden <video> and seeks to
    // trigger real frame decoding. This catches HEVC on Windows Chrome and any
    // other codec the browser claims to support but cannot hardware-decode.
    if (isMP4 || isMOV) {
      const { canBrowserPlay, transcodeHevcToH264 } = await import("@/lib/engine/mobile/hevcTranscoder");
      const canPlay = await canBrowserPlay(file);
      if (!canPlay) {
        if (earlyDetection.type === "gopro") {
          // GoPro files are often 400MB-2GB — WASM transcoding would OOM.
          // Reject with clear instructions to re-record in H.264.
          void trackError(
            "WRONG_VIDEO_FORMAT",
            `[${file.name}] GoPro file not playable in this browser — likely H.265. size: ${(file.size/1024/1024).toFixed(1)}MB.`,
            "video_upload",
            { ...richCtx },
          );
          setLoading(false);
          setUploadError(
            "This GoPro video cannot be played in this browser.\n\n" +
            "Most likely cause: recorded in H.265. Switch to H.264 before recording: " +
            "Preferences → Video → Codec → H.264."
          );
          e.target.value = "";
          return;
        }
        // iPhone / Android: transcode to H.264 at 1080p so the browser can render it.
        setHevcConverting(true);
        setHevcProgress(0);
        setHevcStatus("Loading converter…");
        const transcodeStart = Date.now();
        try {
          processVideoFile = await transcodeHevcToH264(file, (pct, status) => {
            setHevcProgress(pct);
            setHevcStatus(status);
          }, { maxHeight: 1080 });
          const transcodeMs = Date.now() - transcodeStart;
          setHevcConverting(false);
          void trackHevcTranscode(transcodeMs, {
            ...richCtx,
            file_size_bytes: file.size,
            file_extension: "." + (file.name.split(".").pop()?.toLowerCase() ?? "unknown"),
          });
        } catch (err: any) {
          setHevcConverting(false);
          setLoading(false);
          const transcodeMs = Date.now() - transcodeStart;
          void trackError(
            "WRONG_VIDEO_FORMAT",
            `[${file.name}] Video transcoding failed — codec: ${vmeta.codec}, ` +
            `resolution: ${vmeta.width ?? "?"}×${vmeta.height ?? "?"}, fps: ${vmeta.fps ?? "?"}, ` +
            `size: ${(file.size/1024/1024).toFixed(1)}MB, camera: ${earlyDetection.make || "unknown"} ${earlyDetection.model || ""}. ` +
            `FFmpeg error: ${err.message}`,
            "video_upload",
            { ...richCtx, hevc_transcode_ms: transcodeMs },
          );
          setUploadError(
            `⚠ Could not prepare this video for editing.\n\n` +
            `The video format requires conversion which failed (likely file too large for browser memory). ` +
            `Try trimming the clip, or use a different recording format.`
          );
          e.target.value = "";
          return;
        }
      }
    }

    // Pre-checks done — start animated progress for the engine phase
    setProgress(0);
    const processingStart = Date.now();
    const interval = setInterval(() => setProgress((p) => (p >= 98 ? 98 : p + 1)), 150);

    try {
      // Lazy-load engine modules — never imported on mobile, only when user actually uploads
      const [
        { GoProEngineClient },
        { iPhoneEngineClient },
        { AndroidEngineClient },
        { iPhoneVideoGPSAnalyzer },
        { VideoGPSAnalyzer },
        { SyncStrategySelector },
        { TelemetryCrossRef },
        { StorytellingProcessor },
      ] = await Promise.all([
        import("@/lib/media/GoProEngineClient"),
        import("@/lib/media/iPhoneEngineClient"),
        import("@/lib/media/AndroidEngineClient"),
        import("@/lib/engine/iphone/iPhoneVideoGPSAnalyzer"),
        import("@/lib/engine/VideoGPSAnalyzer"),
        import("@/lib/engine/SyncStrategySelector"),
        import("@/lib/engine/TelemetryCrossRef"),
        import("@/lib/engine/StorytellingProcessor"),
      ]);

      // Camera already detected from file content before setLoading — reuse result
      setStatusMsg("Identifying camera...");
      const cameraDetection = earlyDetection;
      const isIPhone    = cameraDetection.type === "iphone";
      const isAndroid   = cameraDetection.type === "android";
      const isWhatsApp  = cameraDetection.type === "whatsapp";
      const isMobile    = isIPhone || isAndroid;
      setIsMobileVideo(isMobile || isWhatsApp);

      if (!isMobile && !isWhatsApp) setVideoFile(processVideoFile);

      // ── WhatsApp fast path — no telemetry, no sync, portrait template ────────
      if (isWhatsApp) {
        setStatusMsg("WhatsApp video detected — loading activity data…");
        if (activityPoints.length === 0) {
          void trackError(
            "NO_GPS_VIDEO",
            `[${file.name}] WhatsApp video uploaded without a GPX file — portrait template requires activity data.`,
            "video_upload",
            { ...richCtx, device_type: "whatsapp" },
          );
          throw new Error("Please upload your GPX activity file first, then add the WhatsApp video.");
        }

        const { WhatsAppEngineClient } = await import("@/lib/media/WhatsAppEngineClient");
        const waResult = await WhatsAppEngineClient.extractMetadata(file);

        const { ActivityPortraitPlanner } = await import("@/lib/engine/ActivityPortraitPlanner");
        const sp = ActivityPortraitPlanner.generatePlan(
          activityPoints as any,
          waResult.durationMs / 1000,
        );

        setStoryPlan(sp);
        setVideoFile(processVideoFile);
        clearInterval(interval);
        setProgress(100);

        const bi2 = browserInfoRef.current;
        trackProcessingSession({
          status:               "success",
          video_filename:       file.name,
          video_duration_s:     waResult.durationMs / 1000,
          camera_model:         "WhatsApp",
          activity_name:        activityMeta.name ?? null,
          device_type:          "whatsapp",
          device_make:          "WhatsApp",
          device_model:         "WhatsApp",
          device_os:            null,
          device_os_version:    null,
          browser_os:           bi2?.os ?? null,
          browser_os_version:   bi2?.os_version ?? null,
          browser_name:         bi2?.browser ?? null,
          browser_version:      bi2?.browser_version ?? null,
          browser_is_mobile:    bi2?.is_mobile ?? null,
          gpx_points_count:     activityPoints.length || null,
          gps_device:           activityMeta.gpsDevice?.label ?? null,
          activity_location:    activityMeta.location ?? null,
          sync_strategy:        "none",
          scenes_count:         1,
          unit_system:          unit,
          processing_time_ms:   Date.now() - processingStart,
          error_message:        null,
        });

        setTimeout(() => {
          setHighlights([]);
          setStep("READY");
          readyStepStartRef.current = Date.now();
          setLoading(false);
        }, 300);
        return;
      }
      // ────────────────────────────────────────────────────────────────────────

      if (cameraDetection.type === "unknown") {
        const detected = [cameraDetection.make, cameraDetection.model].filter(Boolean).join(" ") || "unrecognised";
        void trackError(
          "UNSUPPORTED_CAMERA",
          `[${file.name}] Camera not supported — detected: "${detected}" (${ext}, ${(file.size/1024/1024).toFixed(1)}MB, codec: ${vmeta.codec}). ` +
          `LENS supports: GoPro MP4, iPhone MOV, Android MP4 (Samsung/Pixel/etc). ` +
          `This may be a DJI, Insta360, dashcam, or re-encoded file. Re-encoding removes telemetry — use originals.`,
          "video_upload",
          { ...richCtx, device_type: null },
        );
        throw new Error("Unsupported camera. Supported: GoPro, iPhone, and Android phones.");
      }

      let vpts: any[], syncPoints: any[], cameraModel: string, gpsVideoOffsetMs: number;
      let iPhoneVideoStartMs = 0, iPhoneDurationMs = 0, iPhoneHasStartGPS = false;
      let recordingDeviceOsVersion: string | null = null;

      if (isMobile) {
        setStatusMsg(isAndroid ? "Reading Android metadata..." : "Reading iPhone metadata...");
        const result = isAndroid
          ? await AndroidEngineClient.extractTelemetry(file)
          : await iPhoneEngineClient.extractTelemetry(file);
        vpts               = result.points;
        syncPoints         = result.syncPoints;
        cameraModel        = result.cameraModel;
        gpsVideoOffsetMs   = result.gpsVideoOffsetMs;
        iPhoneVideoStartMs = result.videoStartMs;
        iPhoneDurationMs   = result.durationMs;
        iPhoneHasStartGPS  = result.hasStartGPS;
        if (isAndroid) recordingDeviceOsVersion = (result as any).deviceOsVersion ?? null;

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
        // Reuse GPS data already extracted during pre-validation — avoids reading the file twice.
        const result = await GoProEngineClient.extractTelemetry(file);
        vpts             = result.points;
        syncPoints       = result.syncPoints;
        cameraModel      = result.cameraModel;
        gpsVideoOffsetMs = result.gpsVideoOffsetMs;
      }

      // resolvedModel comes only from file content (GPMF metadata or EXIF/byte scan)
      const resolvedModel = cameraModel || cameraDetection.model || cameraDetection.make;
      if (resolvedModel) {
        const camera = detectCamera(resolvedModel);
        if (camera.label) setActivityMeta(prev => ({ ...prev, camera }));
      }

      // Update richCtx with the more specific camera model resolved from GPMF/EXIF
      const resolvedCtx = { ...richCtx, device_model: resolvedModel || richCtx.device_model };

      if (!isMobile && vpts.length === 0) {
        void trackError(
          "NO_GPS_VIDEO",
          `[${file.name}] No GPS telemetry found. ` +
          `Camera: ${resolvedModel || cameraDetection.make || "unknown"} | ` +
          `codec: ${vmeta.codec} | res: ${vmeta.width ?? "?"}×${vmeta.height ?? "?"} | ` +
          `size: ${(file.size/1024/1024).toFixed(1)}MB | has_embedded_gps_flag: ${vmeta.hasEmbeddedGPS}. ` +
          `Likely causes: GPS not enabled before recording, GPS lock never acquired (started indoors/immediately), ` +
          `or file was re-encoded (re-encoding removes the GPMF track).`,
          "video_upload",
          resolvedCtx,
        );
        throw new Error("No GPS data found in this video. Make sure GPS is enabled on your GoPro and that you waited for GPS lock before starting recording.");
      }

      const videoProfile = isMobile
        ? iPhoneVideoGPSAnalyzer.analyze(iPhoneVideoStartMs, iPhoneDurationMs, iPhoneHasStartGPS)
        : VideoGPSAnalyzer.analyze(vpts, gpsVideoOffsetMs);

      if (!isMobile && (!videoProfile.hasGPSLock || videoProfile.postLockPoints === 0)) {
        void trackError(
          "GPS_WEAK",
          `[${file.name}] GPS lock never acquired. ` +
          `Camera: ${resolvedModel || cameraDetection.make || "unknown"} | ` +
          `codec: ${vmeta.codec} | res: ${vmeta.width ?? "?"}×${vmeta.height ?? "?"} | ` +
          `pre-lock pts: ${videoProfile.preLockPoints} | post-lock pts: ${videoProfile.postLockPoints} | ` +
          `lock latency: ${videoProfile.lockLatencySec?.toFixed(1) ?? "n/a"}s | ` +
          `total GPS pts: ${vpts.length} | GPS sampling: ${videoProfile.samplingIntervalMs}ms.`,
          "video_upload",
          resolvedCtx,
        );
        throw new Error("GPS signal too weak — no valid fix was recorded. Wait for the GPS lock icon on your GoPro before starting your activity.");
      }

      const totalPts = vpts.length;
      const fixDist  = videoProfile.fixDistribution;
      const fixTotal = (fixDist.fix0 + fixDist.fix2 + fixDist.fix3) || 1;
      const gpsStartUtc = isMobile ? new Date(iPhoneVideoStartMs).toISOString() : (totalPts > 0 ? new Date((vpts[0] as any).time).toISOString() : null);
      const gpsEndUtc   = isMobile ? new Date(iPhoneVideoStartMs + iPhoneDurationMs).toISOString() : (totalPts > 0 ? new Date((vpts[totalPts - 1] as any).time).toISOString() : null);
      // Recording device info (from video metadata / EXIF / detection)
      const deviceType  = cameraDetection.type as VideoUploadInsert["device_type"];
      // make: prefer EXIF detection; for Android the worker returns the model (e.g. "Galaxy S24 FE")
      // so we derive the brand from the resolved model string if detection returned empty
      const inferMakeFromModel = (model: string): string | null => {
        const lc = model.toLowerCase();
        if (lc.includes("samsung") || lc.includes("galaxy")) return "Samsung";
        if (lc.includes("pixel") || lc.includes("google"))   return "Google";
        if (lc.includes("huawei"))                           return "Huawei";
        if (lc.includes("xiaomi") || lc.includes("redmi"))   return "Xiaomi";
        if (lc.includes("oneplus"))                          return "OnePlus";
        if (lc.includes("oppo"))                             return "OPPO";
        if (lc.includes("motorola") || lc.includes("moto")) return "Motorola";
        return null;
      };
      const deviceMake  = cameraDetection.make ||
                          (isAndroid ? inferMakeFromModel(resolvedModel ?? "") : null) ||
                          null;
      const deviceModel = resolvedModel || cameraDetection.model || null;
      const deviceOs    = isIPhone ? "iOS" : isAndroid ? "Android" : null;

      videoMetricsRef.current = {
        filename: file.name, file_size_bytes: file.size, camera_model: resolvedModel ?? null,
        device_type: deviceType, device_make: deviceMake, device_model: deviceModel,
        device_os: deviceOs, device_os_version: recordingDeviceOsVersion,
        has_gps: isMobile ? iPhoneHasStartGPS : totalPts > 0, gps_points_count: totalPts,
        gps_duration_s: videoProfile.durationSec, gps_sampling_interval_ms: videoProfile.samplingIntervalMs,
        gps_start_utc: gpsStartUtc, gps_end_utc: gpsEndUtc, gps_video_offset_ms: gpsVideoOffsetMs,
        has_gps_lock: videoProfile.hasGPSLock, gps_lock_latency_s: videoProfile.lockLatencySec,
        pre_lock_points: videoProfile.preLockPoints, post_lock_points: videoProfile.postLockPoints,
        speed_avg_kmh: isMobile ? null : Math.round(videoProfile.postLockSpeedAvgKmh * 10) / 10,
        speed_max_kmh: isMobile ? null : Math.round(videoProfile.postLockSpeedMaxKmh * 10) / 10,
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
          if (!spatialOverlap) {
            const vidT0 = vpts.length > 0 ? new Date((vpts[0] as any).time).toISOString() : "n/a";
            const actT0 = activityPoints.length > 0 ? new Date(activityPoints[0].time).toISOString() : "n/a";
            void trackError(
              "VIDEO_GPX_MISMATCH",
              `[${file.name}] GPS positions don't overlap within 2km. ` +
              `Video GPS start: ${vidT0} | Activity start: ${actT0} | ` +
              `Camera: ${resolvedModel || cameraDetection.make || "unknown"} | ` +
              `codec: ${vmeta.codec} | res: ${vmeta.width ?? "?"}×${vmeta.height ?? "?"} | ` +
              `Activity: "${activityMeta.name}" (${activityPoints.length} pts) | ` +
              `Video GPS pts: ${vpts.length} | GPX creator: ${gpxMetricsRef.current?.creator ?? "unknown"}.`,
              "video_upload",
              resolvedCtx,
            );
            throw new Error("This video and GPX file don't match. Make sure both files are from the same ride.");
          }
        }
      }

      const syncReason = isAndroid ? "Android tkhd CreateDate − duration = activity GPS UTC"
        : "iPhone CreateDate = activity GPS UTC";
      const syncPlan = isMobile
        ? { method: "timestamp-based" as const, distanceThresholdM: 0, timeWindowMs: 0, confidence: "HIGH" as const, reason: syncReason }
        : gpxProfile
          ? SyncStrategySelector.select(gpxProfile, videoProfile)
          : { method: "position-match" as const, distanceThresholdM: 10, timeWindowMs: 30_000, confidence: "LOW" as const, reason: "no GPX profile" };

      const clockOffsetMs = 0;
      const segments = TelemetryCrossRef.findHighlights(activityPoints, vpts as any, unit, clockOffsetMs, gpsVideoOffsetMs);
      if (!segments || segments.length === 0) {
        const actDurMin = activityPoints.length > 1
          ? ((activityPoints[activityPoints.length-1].time - activityPoints[0].time) / 60_000).toFixed(0)
          : "?";
        void trackError(
          "NO_SCENES",
          `[${file.name}] No highlight scenes found — falling back to full video. ` +
          `Camera: ${resolvedModel || cameraDetection.make || "unknown"} | ` +
          `codec: ${vmeta.codec} | res: ${vmeta.width ?? "?"}×${vmeta.height ?? "?"} | ` +
          `Activity: "${activityMeta.name}" (${actDurMin} min, ${activityPoints.length} GPX pts) | ` +
          `Video GPS pts: ${vpts.length} | GPX creator: ${gpxMetricsRef.current?.creator ?? "unknown"} | ` +
          `Speed avg: ${Math.round(videoProfile.postLockSpeedAvgKmh)}km/h | ` +
          `Speed max: ${Math.round(videoProfile.postLockSpeedMaxKmh)}km/h.`,
          "video_upload",
          resolvedCtx,
        );
        // No highlights detected — StorytellingProcessor will apply full-video fallback
      }

      const VIDEO_SEEK_WORKAROUND_SEC = 0;
      segments.forEach((s) => { if (s.videoStartTime !== undefined) s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC; });

      const videoDurationSec = isMobile
        ? iPhoneDurationMs / 1000
        : (vpts.length > 1 ? gpsVideoOffsetMs / 1000 + (vpts[vpts.length - 1].time - vpts[0].time) / 1000 : 0);

      const sp = StorytellingProcessor.generatePlan(activityPoints, vpts as any, unit, clockOffsetMs, gpsVideoOffsetMs, videoDurationSec);
      sp.segments.forEach((s) => { if (s.videoStartTime !== undefined) s.videoStartTime += VIDEO_SEEK_WORKAROUND_SEC; });
      setStoryPlan(sp);
      clearInterval(interval);
      setProgress(100);

      const bi = browserInfoRef.current;
      trackProcessingSession({
        status: "success", video_filename: file.name,
        video_duration_s: videoDurationSec || null,
        camera_model: resolvedModel ?? null, activity_name: activityMeta.name ?? null,
        device_type: deviceType, device_make: deviceMake, device_model: deviceModel,
        device_os: deviceOs, device_os_version: recordingDeviceOsVersion,
        browser_os: bi?.os ?? null, browser_os_version: bi?.os_version ?? null,
        browser_name: bi?.browser ?? null, browser_version: bi?.browser_version ?? null,
        browser_is_mobile: bi?.is_mobile ?? null,
        gpx_points_count: activityPoints.length || null, gps_device: activityMeta.gpsDevice?.label ?? null,
        activity_location: activityMeta.location ?? null, sync_strategy: syncPlan.method ?? null,
        scenes_count: sp.segments.filter(s => s.type === 'ACTION').length || null, unit_system: unit,
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
        if (isMobile) setVideoFile(processVideoFile);
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

  // ── Core GPX text processing — called by file upload AND Strava import ──
  const processGpxText = async (text: string) => {
    setGpxError(null);
    const { GPXAnalyzer } = await import("@/lib/engine/GPXAnalyzer");
    const profile = GPXAnalyzer.analyze(text);
    setGpxProfile(profile);
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const creatorRaw  = xml.documentElement.getAttribute("creator") || "";

    // Parse a single track/route point element into a GPS point object.
    const parsePoint = (pt: Element) => {
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
    };

    // Primary: track points (<trkpt>) — all GPS devices that record an activity.
    // Fallback: route points (<rtept>) — Suunto and some devices export routes.
    //   Route points are useful if they have timestamps (recorded track in route format).
    //   Route points WITHOUT timestamps cannot be used for video sync and are rejected.
    let pts = Array.from(xml.querySelectorAll("trkpt")).map(parsePoint);
    const usedRtept = pts.length === 0;

    if (usedRtept) {
      const rtepts = Array.from(xml.querySelectorAll("rtept"));
      if (rtepts.length > 0) {
        const withTime = rtepts.filter(pt => !!pt.querySelector("time")?.textContent);
        if (withTime.length === 0) {
          // Suunto and some apps export route files without timestamps — these are
          // planned routes, not recorded activities. They cannot be synced with video.
          const isSuunto = creatorRaw.toLowerCase().includes("suunto");
          void trackError("NO_GPS_TRACK", `Route file (rtept, no timestamps). Creator: "${creatorRaw}".`, "gpx_upload", { gpx_creator: creatorRaw || null });
          setGpxError(
            isSuunto
              ? "This is a Suunto route file, not a recording. Please upload the track file (*-track.gpx) instead — it has timestamps and heart rate data."
              : "This file contains route waypoints but no timestamps. Please export your recorded activity (not a planned route)."
          );
          return;
        }
        // rtept with timestamps → parse them the same way as trkpt
        pts = withTime.map(parsePoint);
      }
    }

    if (pts.length === 0) {
      const deviceHint = creatorRaw ? ` Device: "${creatorRaw}".` : "";
      void trackError("NO_GPS_TRACK", `No GPS track found in this file.${deviceHint}`, "gpx_upload", { gpx_creator: creatorRaw || null });
      setGpxError("No GPS track found in this file. Make sure your .gpx file contains valid location data."); return;
    }
    // Filter points with invalid timestamps (NaN) — can corrupt sync
    const validPts = pts.filter(p => isFinite(p.time) && p.time > 0);
    if (validPts.length === 0) {
      // Detect the specific Strava public URL export — strips timestamps
      const isStravaPublicExport = creatorRaw.toLowerCase().includes("strava") && pts.length > 0;
      const msg = isStravaPublicExport
        ? "This Strava GPX has no timestamps — it was exported from a public URL which strips timing data.\n\nHow to fix:\n• Use LENS's \"Import from Strava\" button to connect directly (recommended)\n• Or: log into Strava → open the activity → ⋯ menu → Export GPX"
        : "No GPS track found in this file. Make sure your .gpx file contains valid location data.";
      void trackError("NO_GPS_TRACK",
        `All ${pts.length} points have no timestamps. Creator: "${creatorRaw}". ` +
        `${isStravaPublicExport ? "Strava public URL export strips timestamps — use authenticated export or Strava API integration." : ""}`,
        "gpx_upload", { gpx_creator: creatorRaw || null });
      setGpxError(msg); return;
    }

    setActivityPoints(validPts);

    // Extract activity name — handle Suunto's "suuntoapp-ActivityType-Timestamp" format.
    const allNameEls  = Array.from(xml.getElementsByTagName("name"));
    const rawTrackName = usedRtept
      ? (xml.querySelector("rte > name")?.textContent?.trim() || allNameEls[0]?.textContent?.trim() || "")
      : (allNameEls.find(el => el.parentElement?.localName === "trk")?.textContent?.trim() || allNameEls.find(el => el.textContent?.trim())?.textContent?.trim() || "");
    // Clean Suunto's machine-generated names: "suuntoapp-Cycling-2026-05-10T..." → "Cycling"
    const suuntoNameMatch = rawTrackName.match(/^suuntoapp-([A-Za-z]+(?:[A-Z][a-z]+)*)-\d/);
    const trackName = suuntoNameMatch
      ? suuntoNameMatch[1].replace(/([A-Z])/g, " $1").trim()  // "TrailRunning" → "Trail Running"
      : rawTrackName || "EPIC RIDE";

    const activityType = extractActivityType(xml, suuntoNameMatch, rawTrackName);
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
    gpxMetricsRef.current = computeGpxMetrics(validPts, { creator: gpsDevice?.label ?? creatorRaw ?? undefined, activityType, activityName: trackName, activityLocation: resolvedLocation });
  };

  // ── GPX file upload ───────────────────────────────────────────────────────
  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      const ext = file.name.split(".").pop() ?? file.type;
      void trackError("WRONG_GPX_FORMAT", `Wrong format: "${file.name}" (.${ext}). Only .gpx files are accepted.`, "gpx_upload",
        { file_extension: "." + ext, file_size_bytes: file.size, file_mime_type: file.type || null });
      setGpxError("Only .gpx files are accepted. Export your activity as GPX from Strava, Garmin Connect, Wahoo, or Komoot."); e.target.value = ""; return;
    }
    await processGpxText(await file.text());
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": "https://lens.prorefuel.app/#app",
        "name": "LENS by ProRefuel",
        "url": "https://lens.prorefuel.app",
        "description": "Automatic cinematic video editor for outdoor sports athletes. Sync GoPro and iPhone footage with GPX activity files and add GPS telemetry overlay showing speed, elevation, heart rate, and a live animated map.",
        "applicationCategory": "MultimediaApplication",
        "operatingSystem": "Chrome on Windows, macOS, Linux",
        "browserRequirements": "Chrome 90+",
        "inLanguage": "en",
        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
        "featureList": [
          "Automatic GPS scene detection from GPX files",
          "GoPro GPMF telemetry overlay at 18Hz precision",
          "iPhone MOV video GPS sync via CreateDate",
          "Cinematic 9:16 vertical format for Instagram Reels, TikTok, YouTube Shorts",
          "Real-time speed, elevation, heart rate, cadence, and power overlay",
          "Live animated map with GPS track",
          "Compatible with Garmin, Suunto, Wahoo, Polar, Coros, Strava, Komoot GPX exports",
          "On-device processing — 100% private, no cloud upload required",
          "MP4 export in under 60 seconds"
        ],
        "screenshot": "https://lens.prorefuel.app/og-image.png",
        "author": { "@type": "Organization", "name": "ProRefuel", "url": "https://prorefuel.app" },
        "aggregateRating": { "@type": "AggregateRating", "ratingValue": "5", "ratingCount": "1", "bestRating": "5" },
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How does LENS sync GoPro video with GPS activity data?",
            "acceptedAnswer": { "@type": "Answer", "text": "LENS reads the embedded GPS timestamps in your GoPro video (GPMF telemetry at 18Hz) and matches them with your GPX activity file from Garmin, Suunto, Strava, Wahoo, Polar, Coros or any GPS device. The sync is automatic and accurate to milliseconds — no manual alignment needed." }
          },
          {
            "@type": "Question",
            "name": "What action cameras are supported by LENS?",
            "acceptedAnswer": { "@type": "Answer", "text": "LENS supports all GoPro cameras (Hero 9, 10, 11, 12, 13 and newer) and iPhone (iOS via MOV files). GoPro files use embedded GPMF telemetry for precise GPS sync, while iPhone videos use GPS timestamps. DJI, Insta360 and other cameras are on the roadmap." }
          },
          {
            "@type": "Question",
            "name": "What GPS devices and apps can I export GPX from?",
            "acceptedAnswer": { "@type": "Answer", "text": "LENS works with GPX files from any GPS device or app: Garmin (Connect), Suunto, Wahoo, Polar, Coros, Bryton, Lezyne, and apps like Strava, Komoot, and TrainingPeaks. Simply export your activity as a .gpx file from any of these platforms and import it into LENS." }
          },
          {
            "@type": "Question",
            "name": "What sports does LENS work with?",
            "acceptedAnswer": { "@type": "Answer", "text": "LENS is designed for outdoor sports athletes: mountain biking (MTB), road cycling, trail running, triathlon, gravel riding, hiking, and adventure sports. The GPS scene detection algorithm automatically identifies climbs, sprints, technical descents, and peak moments from your GPS data." }
          },
          {
            "@type": "Question",
            "name": "Is LENS a free GoPro Quik alternative with GPS overlay?",
            "acceptedAnswer": { "@type": "Answer", "text": "Yes. Unlike GoPro Quik, LENS focuses on deep GPS telemetry integration. LENS syncs your full activity GPS data to display live speed, elevation, heart rate, and an animated map — automatically, in cinematic 9:16 format. It is free and requires no account or subscription." }
          },
          {
            "@type": "Question",
            "name": "How long does it take to generate a video in LENS?",
            "acceptedAnswer": { "@type": "Answer", "text": "Most videos are ready in under 60 seconds. LENS processes everything on your device using WebAssembly — no cloud rendering. Render time depends on your GPU and video length, but the full pipeline from import to download typically takes under a minute." }
          },
          {
            "@type": "Question",
            "name": "Does LENS upload my video to the cloud?",
            "acceptedAnswer": { "@type": "Answer", "text": "No. LENS runs entirely in your browser. Your GoPro video, GPX file, and generated output never leave your device. No account is required and no data is uploaded to any server." }
          },
          {
            "@type": "Question",
            "name": "Can I use LENS with Strava GPX exports?",
            "acceptedAnswer": { "@type": "Answer", "text": "Yes. Export your Strava activity as a GPX file (from the activity page, click the three dots menu and select Export GPX), then import it into LENS. LENS will automatically sync it with your GoPro or iPhone video." }
          },
        ],
      },
      {
        "@type": "Organization",
        "@id": "https://prorefuel.app/#org",
        "name": "ProRefuel",
        "url": "https://prorefuel.app",
        "sameAs": ["https://instagram.com/LENS.video"],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />


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
          <a href="/how-it-works" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">How It Works</a>
          <a href="/privacy" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">Privacy</a>
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
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200">Beta v1.0.31 &nbsp;·&nbsp; 100% Free</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[0.88] mb-6">
            STOP SHARING<br />
            RAW FOOTAGE.<br />
            <span className="text-amber-500 drop-shadow-[0_0_40px_rgba(245,158,11,0.4)]">
              START SHARING<br />STORIES.
            </span>
          </h1>

          <p className="text-zinc-300 text-xl font-semibold max-w-md mb-3 leading-relaxed">
            GoPro, iPhone, or Android — LENS edits what matters.
          </p>
          <p className="text-zinc-500 text-sm max-w-sm mb-6 leading-relaxed">
            Import your GPX activity from Garmin, Strava, or Suunto and your action camera or phone video. LENS reads your GPS data, detects the best moments, and generates a cinematic 9:16 edit — synced, scored, ready to post. In seconds.
          </p>

          {/* Compatible devices strip */}
          <div className="flex flex-wrap items-center gap-3 mb-8">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Works with</span>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { src: "/devices/logos/gopro_logo.svg",   alt: "GoPro",   w: 52 },
                { src: "/devices/logos/iphone_logo.svg",  alt: "iPhone",  w: 56 },
                { src: "/devices/logos/android_logo.svg", alt: "Android", w: 72 },
              ].map(d => (
                <div key={d.alt} className="flex items-center justify-center h-7 px-3 rounded-lg bg-white/50 border border-white/40">
                  <img src={d.src} alt={d.alt} style={{ height: 16, width: "auto", maxWidth: d.w, opacity: 1 }} />
                </div>
              ))}
              <span className="text-zinc-700 text-xs">·</span>
              {[
                { src: "/devices/logos/garmin_logo.svg",  alt: "Garmin",  w: 52 },
                { src: "/devices/logos/strava_logo.svg",  alt: "Strava",  w: 44 },
                { src: "/devices/logos/suunto_logo.svg",  alt: "Suunto",  w: 52 },
              ].map(d => (
                <div key={d.alt} className="flex items-center justify-center h-7 px-3 rounded-lg bg-white/50 border border-white/40">
                  <img src={d.src} alt={d.alt} style={{ height: 14, width: "auto", maxWidth: d.w, opacity: 0.92 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Render time hero stat */}
          <div className="relative mb-5 rounded-2xl overflow-hidden border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-amber-600/5 px-6 py-5 flex items-center gap-5 w-fit">
            <div className="absolute inset-0 bg-amber-500/5 blur-xl pointer-events-none" />
            <div className="relative flex flex-col items-center justify-center shrink-0">
              <span className="text-6xl font-black text-amber-400 leading-none drop-shadow-[0_0_24px_rgba(245,158,11,0.7)]">&lt;60s</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/70 mt-1">render time</span>
            </div>
            <div className="relative flex flex-col gap-0.5 max-w-[220px]">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Lightning Fast</span>
              <p className="text-white text-sm font-bold leading-snug">Your cinematic edit,<br />ready in under a minute.</p>
              <p className="text-zinc-500 text-[11px] mt-1">From raw footage to shareable story — no waiting, no cloud.</p>
            </div>
          </div>

          {/* Secondary stats */}
          <div className="flex flex-wrap gap-6 mb-10">
            {[
              { value: "18Hz", label: "GPS Precision" },
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
            <BeforeAfterSlider isMobile={!!(mounted && isMobileDevice)} />
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
              Drop your GPX activity file and your video — GoPro, iPhone, or Android. LENS does the rest — scene detection, GPS sync, cinematic cuts, telemetry overlay. No editing skills needed.
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
                {(mounted && isMobileDevice) ? (
                  <div className="flex flex-col items-center gap-4 py-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-2xl">🖥️</div>
                    <p className="font-black text-white text-base uppercase tracking-wide">Desktop only</p>
                    <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
                      LENS requires Chrome on a desktop computer to process your video.
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

                    {/* ── Step 01: GPS Track ──────────────────────────────── */}
                    <div>
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center font-black text-[10px] shrink-0 transition-colors ${
                          activityPoints.length > 0 ? "bg-green-500 text-black" : "bg-amber-500 text-black"
                        }`}>
                          {activityPoints.length > 0 ? "✓" : "1"}
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-500">Activity</p>
                      </div>

                      {/* GPS card — Strava (primary) and GPX file are two routes to the same goal */}
                      <div className="rounded-2xl border border-zinc-800/70 overflow-hidden">

                        {/* Strava — first (more important / most used) */}
                        <StravaConnect
                          onGpxLoaded={async (text) => { await processGpxText(text); }}
                          origin="desktop"
                          embedded
                        />

                        {/* "or" divider */}
                        <div className="flex items-center gap-3 px-6 py-2 bg-zinc-900/40">
                          <div className="flex-1 h-px bg-zinc-800" />
                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700 shrink-0">or</span>
                          <div className="flex-1 h-px bg-zinc-800" />
                        </div>

                        {/* GPX file row */}
                        <label className={`group flex items-center gap-5 px-6 py-5 w-full cursor-pointer transition-colors ${
                          gpxError              ? "bg-red-500/8  border-l-2 border-l-red-500" :
                          activityPoints.length > 0 ? "bg-green-500/8 border-l-2 border-l-green-500" :
                          "hover:bg-amber-500/5 active:bg-amber-500/8 border-l-2 border-l-transparent animate-glow-pulse"
                        }`}>
                          <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                            gpxError              ? "bg-red-500 text-white" :
                            activityPoints.length > 0 ? "bg-green-500 text-black" :
                            "bg-amber-500 text-black shadow-lg"
                          }`}>
                            {activityPoints.length > 0 ? <CheckCircle2 size={28} /> : <Gauge size={28} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-black uppercase text-white leading-none">Import GPX</p>
                            {gpxError ? (
                              <p className="text-[11px] font-semibold mt-1 text-red-400">{gpxError}{" "}<a href="/how-it-works#help" className="underline text-amber-400 hover:text-amber-300 whitespace-nowrap">Learn more →</a></p>
                            ) : (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                {["/devices/logos/garmin_logo.svg", "/devices/logos/suunto_logo.svg"].map((src, i) => (
                                  <div key={i} className="flex items-center justify-center px-2 py-1 rounded bg-white/50 border border-white/40">
                                    <img src={src} alt="" style={{ height: 11, width: "auto", maxWidth: 38, opacity: activityPoints.length > 0 ? 1 : 0.9 }} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <input type="file" accept=".gpx" onChange={handleGPXUpload} className="hidden" />
                        </label>

                      </div>
                    </div>

                    {/* ── Step 02: Video ──────────────────────────────────── */}
                    <div>
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center font-black text-[10px] shrink-0 transition-colors ${
                          activityPoints.length === 0 ? "bg-zinc-800 text-zinc-600" :
                          storyPlan !== null        ? "bg-green-500 text-black" :
                          "bg-amber-500 text-black"
                        }`}>
                          {storyPlan !== null ? "✓" : "2"}
                        </div>
                        <p className={`text-[9px] font-black uppercase tracking-[0.3em] transition-colors ${activityPoints.length === 0 ? "text-zinc-700" : "text-zinc-500"}`}>Video</p>
                      </div>

                    <label className={`group flex items-center gap-5 p-6 rounded-2xl border-2 transition-all ${hevcConverting ? "cursor-default pointer-events-none border-amber-500 bg-amber-500/5" : uploadError ? "cursor-pointer border-red-500 bg-red-500/8" : storyPlan !== null ? "cursor-pointer border-green-500 bg-green-500/8" : activityPoints.length === 0 ? "cursor-not-allowed border-zinc-800 bg-zinc-900/40 opacity-60" : "cursor-pointer border-amber-500 bg-amber-500/5 hover:bg-amber-500/10"}`}>
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all ${storyPlan !== null ? "bg-green-500 text-black" : activityPoints.length === 0 ? "bg-zinc-800 text-zinc-600" : "bg-amber-500 text-black shadow-lg"}`}>
                        {loading || hevcConverting ? <Loader2 className="animate-spin" size={28} /> : storyPlan !== null ? <CheckCircle2 size={28} /> : <Upload size={28} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-base font-black uppercase leading-none ${activityPoints.length === 0 ? "text-zinc-600" : "text-white"}`}>
                          {hevcConverting ? "Preparing Video" : "Import Video"}
                        </p>
                        {hevcConverting ? (
                          <>
                            <div className="mt-2 w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                                style={{ width: `${hevcProgress}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-black text-amber-500/80 mt-1 animate-pulse">
                              {hevcStatus || 'Converting…'} · {hevcProgress}%
                            </p>
                          </>
                        ) : uploadError ? (
                          <p className="text-[11px] font-semibold mt-1 text-red-400 whitespace-pre-line leading-relaxed">{uploadError}{" "}<a href="/how-it-works#help" className="underline text-amber-400 hover:text-amber-300 whitespace-nowrap">Learn more →</a></p>
                        ) : loading ? (
                          <>
                            <div className="mt-2 w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-black text-zinc-500 mt-1">{statusMsg}</p>
                          </>
                        ) : activityPoints.length === 0 ? (
                          <p className="text-[11px] font-semibold mt-1 text-zinc-600">Load GPX first</p>
                        ) : (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            {["/devices/logos/gopro_logo.svg", "/devices/logos/iphone_logo.svg", "/devices/logos/android_logo.svg"].map((src, i) => (
                              <div key={i} className="flex items-center justify-center px-2 py-1 rounded bg-white/50 border border-white/40">
                                <img src={src} alt="" style={{ height: 11, width: "auto", maxWidth: 42, opacity: 1 }} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <input type="file" accept=".mp4,.mov,video/mp4,video/quicktime" disabled={activityPoints.length === 0 || hevcConverting} onChange={handleVideoUpload} className="hidden" />
                      {activityPoints.length === 0 && <Lock size={16} className="text-zinc-700 shrink-0" />}
                    </label>
                    </div>

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
                      disabled={storyPlan === null}
                      className={`w-full py-6 mt-2 rounded-2xl font-black uppercase tracking-[0.35em] text-xs transition-all flex items-center justify-center gap-3 ${storyPlan !== null ? "bg-amber-500 text-black shadow-[0_15px_40px_rgba(245,158,11,0.35)] hover:scale-[1.02] active:scale-[0.98]" : "bg-zinc-800/80 text-zinc-600 cursor-not-allowed"}`}
                    >
                      <Zap size={18} fill={storyPlan !== null ? "black" : "none"} />
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
                      isIPhone={isMobileVideo}
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
                        if (result.status === "success") setVideoSuccess(true);
                        if (result.status === "error" && result.errorMessage) {
                          setUploadError(`Export failed: ${result.errorMessage}. Please try again.`);
                          setStep("UPLOAD");
                        }
                        // After successful download: full reset to initial state
                        if (result.status === "success") {
                          setTimeout(() => {
                            setVideoFile(null);      setHighlights([]);      setStoryPlan(null);
                            setIsMobileVideo(false); setUploadError(null);   setGpxError(null);
                            setActivityPoints([]);   setGpxProfile(null);    setProgress(0);
                            setStatusMsg("");        setActivityMeta({ name: "EPIC RIDE" });
                            gpxMetricsRef.current          = null;
                            videoMetricsRef.current        = null;
                            processingSessionIdRef.current = null;
                            readyStepStartRef.current      = null;
                            experienceStartRef.current     = null;
                            setStep("UPLOAD");
                          }, 2000);
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── COMPATIBLE DEVICES ──────────────────────────────────────────── */}
      <section className="relative z-10 border-t border-zinc-800/40">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-16">
          <div className="text-center mb-10">
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-3">Compatible Devices</p>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">
              Works with your gear.
            </h2>
            <p className="text-zinc-500 text-sm max-w-md mx-auto">Your camera and GPS tracker — no matter the brand.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Video cameras */}
            <div className="bg-white/15 border border-white/20 rounded-3xl p-7">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-5">Video Camera</p>
              <div className="space-y-4">
                {[
                  { logo: "/devices/logos/gopro_logo.svg", name: "GoPro", detail: "HERO 8–13, Max, all models — GPMF telemetry at 18Hz", lw: 52 },
                  { logo: "/devices/logos/iphone_logo.svg", name: "iPhone", detail: "iPhone 8 and newer — synced via CreateDate timestamp", lw: 60 },
                  { logo: "/devices/logos/android_logo.svg", name: "Android", detail: "Samsung Galaxy, Google Pixel, and any Android phone", lw: 80 },
                ].map(d => (
                  <div key={d.name} className="flex items-center gap-4 p-3 rounded-2xl bg-white/35 border border-white/30">
                    <div className="w-12 h-10 flex items-center justify-center shrink-0">
                      <img src={d.logo} alt={d.name} style={{ height: 18, width: "auto", maxWidth: d.lw, opacity: 1 }} />
                    </div>
                    <div>
                      <p className="text-zinc-900 text-sm font-black">{d.name}</p>
                      <p className="text-zinc-700 text-[11px] leading-snug">{d.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* GPS trackers */}
            <div className="bg-white/15 border border-white/20 rounded-3xl p-7">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-5">GPS Tracker — export as .gpx</p>
              <div className="space-y-4">
                {[
                  { logo: "/devices/logos/garmin_logo.svg", name: "Garmin", detail: "Edge, Fenix, Forerunner — export GPX from Garmin Connect", lw: 52 },
                  { logo: "/devices/logos/strava_logo.svg", name: "Strava", detail: "Export activity GPX from Strava's activity page", lw: 48 },
                  { logo: "/devices/logos/suunto_logo.svg", name: "Suunto", detail: "Export -track.gpx from Suunto app (not the route file)", lw: 52 },
                ].map(d => (
                  <div key={d.name} className="flex items-center gap-4 p-3 rounded-2xl bg-white/35 border border-white/30">
                    <div className="w-12 h-10 flex items-center justify-center shrink-0">
                      <img src={d.logo} alt={d.name} style={{ height: 16, width: "auto", maxWidth: d.lw, opacity: 0.95 }} />
                    </div>
                    <div>
                      <p className="text-zinc-900 text-sm font-black">{d.name}</p>
                      <p className="text-zinc-700 text-[11px] leading-snug">{d.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-zinc-700 text-[11px] mt-4 leading-relaxed">Also works with Wahoo, Polar, Coros, Komoot and any app that exports standard .gpx files.</p>
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

      {/* ── FAQ SECTION ─────────────────────────────────────────────────── */}
      <section className="relative z-10 border-t border-zinc-800/40" aria-label="Frequently Asked Questions">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-20">
          <div className="max-w-3xl mx-auto">
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-3 text-center">FAQ</p>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-center mb-12">
              Everything you need to know
            </h2>
            <div className="space-y-4">
              {[
                {
                  q: "What action cameras are supported?",
                  a: "LENS supports all GoPro cameras (Hero 9, 10, 11, 12, 13+) and iPhone. GoPro files use embedded GPMF telemetry at 18Hz for precise GPS sync. iPhone MOV files use GPS timestamps. DJI, Insta360 and other action cameras are on the roadmap.",
                },
                {
                  q: "Which GPS devices and apps can I export GPX from?",
                  a: "Any GPS device or app that exports .gpx files: Garmin Connect, Suunto, Wahoo, Polar, Coros, Bryton, Lezyne — and platforms like Strava, Komoot, and TrainingPeaks. Just go to your activity, export as GPX, and import into LENS.",
                },
                {
                  q: "What sports does LENS work with?",
                  a: "LENS is built for outdoor athletes: mountain biking (MTB), road cycling, gravel riding, trail running, triathlon, hiking, and adventure sports. The GPS scene detection automatically finds climbs, sprints, descents, and peak intensity moments.",
                },
                {
                  q: "Is LENS a GoPro Quik alternative with GPS overlay?",
                  a: "Yes. Unlike GoPro Quik, LENS does deep GPS telemetry integration — live speed, elevation, heart rate, cadence, power, and an animated map, automatically synced. No manual editing. Cinematic 9:16 format. Free and no account needed.",
                },
                {
                  q: "Does LENS upload my footage to the cloud?",
                  a: "Never. LENS runs entirely inside your browser using WebAssembly. Your GoPro video, GPX file, and the generated output never leave your device. No account is required. No upload. 100% private.",
                },
                {
                  q: "How long does it take to generate a cinematic video?",
                  a: "Under 60 seconds for most rides. LENS processes everything on-device — scene detection, GPS sync, telemetry overlay, and MP4 export — in a single pipeline running locally in Chrome.",
                },
                {
                  q: "How do I sync GoPro video with Strava?",
                  a: "Open your Strava activity, click the three-dot menu and select Export GPX. Then import that .gpx file into LENS alongside your GoPro video. LENS handles the timestamp sync automatically.",
                },
              ].map(({ q, a }) => (
                <details key={q} className="group bg-zinc-900/50 border border-zinc-800/60 rounded-2xl overflow-hidden">
                  <summary className="flex items-center justify-between px-6 py-4 cursor-pointer list-none select-none hover:bg-zinc-800/30 transition-colors">
                    <span className="font-black text-white text-sm pr-4">{q}</span>
                    <span className="text-amber-500 shrink-0 text-lg group-open:rotate-45 transition-transform duration-200">+</span>
                  </summary>
                  <p className="px-6 pb-5 text-zinc-400 text-sm leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
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
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href="https://instagram.com/LENS.video" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-pink-500/30 bg-pink-500/5 text-pink-400 hover:bg-pink-500/15 transition-colors">
              <IgIcon size={13} />
              <span className="text-[11px] font-black uppercase tracking-widest">Contact · @LENS.video</span>
            </a>
            <a href="/how-it-works" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">How It Works</a>
            <a href="/privacy" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">Privacy</a>
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

    <InstallPrompt show={videoSuccess} />
    </>
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
