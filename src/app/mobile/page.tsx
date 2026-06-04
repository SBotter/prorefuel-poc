"use client";
/**
 * /mobile — lightweight page served to all mobile devices via middleware redirect.
 *
 * Three states:
 *   1. Capability loading  → skeleton / nothing yet
 *   2. Unsupported device  → marketing page + "Update Required" block (iOS < 16.4)
 *   3. Supported device    → upload form + MobileCanvasRenderer experience
 */

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { mlog, mlogClear } from "@/lib/engine/mobile/mobileDebugLogger";
import {
  trackProcessingSession, trackVideoExport, trackError, trackHevcTranscode,
  trackGpxSession, trackVideoUpload, computeGpxMetrics,
  buildBrowserCtx,
} from "@/lib/supabase/tracking";
import type { ErrorContext } from "@/lib/supabase/tracking";
import type { VideoUploadInsert } from "@/lib/supabase/types";
import type { ActionSegment }  from "@/lib/engine/TelemetryCrossRef";
import type { StoryPlan }      from "@/lib/engine/StorytellingProcessor";
import { RENDER_QUALITY_MESSAGES } from "@/lib/engine/StorytellingProcessor";
import type { UnitSystem }     from "@/lib/utils/units";
import type { MobileCapabilities } from "@/lib/engine/mobile/mobileCapabilities";
import type { RenderResult }   from "@/components/MapEngine";
import { StravaConnect }        from "@/components/StravaConnect";
import { InstallPrompt }       from "@/components/InstallPrompt";

// MobileCanvasRenderer — only loaded when user reaches the EXPERIENCE step
const MobileCanvasRenderer = dynamic(
  () => import("@/components/RenderEngine/MobileCanvasRenderer")
    .then(m => ({ default: m.MobileCanvasRenderer })),
  { ssr: false },
);

// ─── Icons ────────────────────────────────────────────────────────────────────
function IgIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Unsupported device screen ────────────────────────────────────────────────
function UnsupportedScreen({ caps }: { caps: MobileCapabilities }) {
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans overflow-x-hidden">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-4 backdrop-blur-md bg-black/40 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight text-white">LENS</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Beta</span>
        </div>
      </nav>

      <div className="pt-24 px-5 pb-16">

        {/* Unsupported block */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-7 text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2"/>
              <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3"/>
            </svg>
          </div>
          <p className="font-black text-white text-base uppercase tracking-widest mb-2">Update Required</p>
          <p className="text-zinc-400 text-sm leading-relaxed mb-5 max-w-[240px] mx-auto">
            {caps.blockedReason ?? "This device is not supported."}
          </p>
          {caps.isIOS && (
            <div className="flex items-center gap-2 justify-center px-4 py-3 rounded-xl bg-zinc-800/80 border border-zinc-700">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-zinc-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="3"/>
              </svg>
              <span className="text-zinc-400 text-[12px] font-bold">Settings → General → Software Update</span>
            </div>
          )}
          {caps.isAndroid && (
            <div className="flex items-center gap-2 justify-center px-4 py-3 rounded-xl bg-zinc-800/80 border border-zinc-700">
              <span className="text-zinc-400 text-[12px] font-bold">Open this page in Chrome 94+</span>
            </div>
          )}
        </div>

        {/* Marketing content for unsupported users */}
        <h1 className="text-4xl font-black tracking-tight leading-[0.9] mb-4">
          STOP SHARING<br />RAW FOOTAGE.<br />
          <span className="text-amber-500">START SHARING<br />STORIES.</span>
        </h1>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          GPS-synced cinematic edits from your GoPro, iPhone, or Android. In under 60 seconds.
        </p>

        <div className="grid grid-cols-3 gap-2 mb-8">
          {[{ value: "<60s", label: "Render" }, { value: "9:16", label: "Format" }, { value: "0 Upload", label: "Private" }].map(s => (
            <div key={s.label} className="flex flex-col items-center bg-zinc-900/50 rounded-xl py-3 border border-zinc-800/60">
              <span className="text-base font-black text-amber-400 leading-none">{s.value}</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="bg-amber-500/10 border border-amber-500/25 rounded-[2rem] p-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-2">Already updated?</p>
          <p className="text-white text-sm font-bold mb-3">Reload the page to try again.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-amber-500 text-black font-black text-sm uppercase tracking-widest"
          >
            Reload
          </button>
        </div>
      </div>
    </main>
  );
}

// ─── Debug panel (shown when ?debug=1 is in the URL) ─────────────────────────
function DebugPanel() {
  const [logs,    setLogs]    = useState<string[]>([]);
  const [copied,  setCopied]  = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    import("@/lib/engine/mobile/mobileDebugLogger").then(({ mlogGet }) => {
      setLogs(mlogGet());
    });
  }, []);

  const refresh = useCallback(() => {
    import("@/lib/engine/mobile/mobileDebugLogger").then(({ mlogGet }) => {
      setLogs(mlogGet());
    });
  }, []);

  const copy = useCallback(async () => {
    const text = logs.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select textarea
      textRef.current?.select();
    }
  }, [logs]);

  const clear = useCallback(() => {
    import("@/lib/engine/mobile/mobileDebugLogger").then(({ mlogClear }) => {
      mlogClear();
      setLogs([]);
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <a
            href="/mobile"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-[11px] font-black uppercase tracking-widest active:bg-zinc-700"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back
          </a>
          <span className="text-amber-400 font-black text-sm uppercase tracking-widest">
            Debug ({logs.length})
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-[11px] font-black uppercase tracking-widest">
            Refresh
          </button>
          <button onClick={copy} className="px-3 py-1.5 rounded-lg bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest">
            {copied ? "Copied!" : "Copy"}
          </button>
          <button onClick={clear} className="px-3 py-1.5 rounded-lg bg-red-500/30 text-red-400 text-[11px] font-black uppercase tracking-widest">
            Clear
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-zinc-600 text-sm">No logs yet. Run a video export to generate logs.</p>
        </div>
      ) : (
        <textarea
          ref={textRef}
          readOnly
          value={logs.join("\n")}
          className="flex-1 bg-zinc-900 text-green-400 font-mono text-[10px] p-3 rounded-xl border border-zinc-800 resize-none leading-relaxed"
        />
      )}

      <p className="text-zinc-700 text-[10px] mt-2 text-center">
        Logs persist across crashes (localStorage). Share via Copy.
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MobilePage() {
  const [mounted,        setMounted]        = useState(false);
  const [mobileCaps,     setMobileCaps]     = useState<MobileCapabilities | null>(null);
  const [showDebug,      setShowDebug]      = useState(false);
  const [step,           setStep]           = useState<"UPLOAD" | "READY" | "EXPERIENCE">("UPLOAD");
  const [activityPoints, setActivityPoints] = useState<any[]>([]);
  const [highlights,     setHighlights]     = useState<ActionSegment[]>([]);
  const [storyPlan,      setStoryPlan]      = useState<StoryPlan | null>(null);
  const [videoFile,      setVideoFile]      = useState<File | null>(null);
  const [unit,           setUnit]           = useState<UnitSystem>("metric");
  const [loading,        setLoading]        = useState(false);
  const [progress,       setProgress]       = useState(0);
  const [statusMsg,      setStatusMsg]      = useState("");
  const [uploadError,    setUploadError]    = useState<string | null>(null);
  const [gpxError,       setGpxError]       = useState<string | null>(null);
  const [gpxLoaded,      setGpxLoaded]      = useState(false);
  const [videoLoaded,    setVideoLoaded]    = useState(false);
  const [activityName,   setActivityName]   = useState("YOUR RIDE");

  const gpxNameRef             = useRef("");
  const processingSessionIdRef = useRef<string | null>(null);
  const experienceStartRef     = useRef<number | null>(null);
  const storyPlanRef           = useRef<StoryPlan | null>(null);
  const gpxMetricsRef          = useRef<ReturnType<typeof computeGpxMetrics> | null>(null);
  const videoMetricsRef        = useRef<Omit<VideoUploadInsert, "app_version" | "processing_session_id"> | null>(null);
  // true when the video that reached the render pipeline is HEVC (H.265).
  // Used by MobileCanvasRenderer to select VP9 encoding (no Video Toolbox conflict).
  const sourceIsHevcRef        = useRef(false);

  // H.265 pre-transcoding state — only active when an HEVC video is detected
  const [hevcConverting, setHevcConverting] = useState(false);
  const [hevcProgress,   setHevcProgress]   = useState(0);
  const [hevcStatus,     setHevcStatus]     = useState("");
  const [videoSuccess,   setVideoSuccess]   = useState(false);

  // ── Capability detection + debug mode ──────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    import("@/lib/engine/mobile/mobileCapabilities").then(({ getMobileCapabilities }) => {
      setMobileCaps(getMobileCapabilities());
    });
    // ?debug=1 → show debug panel
    if (new URLSearchParams(window.location.search).get("debug") === "1") {
      setShowDebug(true);
    }
  }, []);

  // ── Browser context helper — call once, reuse for all error tracking ────────
  // Returns structured browser/hardware context for error diagnostics.
  const getBrowserCtx = (): Pick<ErrorContext,
    "browser_os" | "browser_os_version" | "browser_name" | "browser_version" |
    "device_memory_gb" | "cpu_cores"
  > => mobileCaps ? buildBrowserCtx(mobileCaps) : {};

  // ── Core GPX processing — called by file upload AND Strava import ──────────
  const processGpxText = async (text: string) => {
    setGpxError(null);
    const xml  = new DOMParser().parseFromString(text, "text/xml");
    const creatorRaw = xml.documentElement.getAttribute("creator") || "";

    const parsePoint = (pt: Element) => {
      const lat  = parseFloat(pt.getAttribute("lat") || "0");
      const lon  = parseFloat(pt.getAttribute("lon") || "0");
      const ele  = parseFloat(pt.querySelector("ele")?.textContent   || "0");
      const time = new Date(pt.querySelector("time")?.textContent    || "").getTime();
      const hr   = pt.querySelector("hr")    ? parseFloat(pt.querySelector("hr")!.textContent!   || "0") || undefined : undefined;
      const cad  = pt.querySelector("cad")   ? parseFloat(pt.querySelector("cad")!.textContent!  || "0") || undefined : undefined;
      const spd  = pt.querySelector("speed") ? parseFloat(pt.querySelector("speed")!.textContent! || "0") * 3.6 || undefined : undefined;
      return { lat, lon, ele, time, ...(hr !== undefined && { hr }), ...(cad !== undefined && { cad }), ...(spd !== undefined && { speed: spd }) };
    };

    // Parse all trkpts (unfiltered) to detect timestamp-less files
    const allTrkpts = Array.from(xml.querySelectorAll("trkpt")).map(parsePoint);
    let pts = allTrkpts.filter(p => isFinite(p.time));
    if (pts.length === 0) {
      const rtepts = Array.from(xml.querySelectorAll("rtept")).map(parsePoint).filter(p => isFinite(p.time));
      pts = rtepts;
    }
    if (pts.length === 0) {
      const isStravaNoTs = creatorRaw.toLowerCase().includes("strava") && allTrkpts.length > 0;
      const msg = isStravaNoTs
        ? "This Strava GPX has no timestamps — exported from a public URL which strips timing data.\n\nUse \"Import from Strava\" button (recommended) or log into Strava → activity → ⋯ → Export GPX."
        : "No GPS track found in this file.";
      void trackError("NO_GPS_TRACK",
        `[${gpxNameRef.current || "gpx"}] ${isStravaNoTs ? `Strava public URL export — ${allTrkpts.length} points but all timestamps stripped.` : "No <trkpt>/<rtept> elements or all timestamps invalid."}`,
        "gpx_upload",
        getBrowserCtx());
      setGpxError(msg); return;
    }

    setActivityPoints(pts);

    const allNameEls   = Array.from(xml.getElementsByTagName("name"));
    const rawTrackName = allNameEls.find(el => el.parentElement?.localName === "trk")?.textContent?.trim()
                      || allNameEls.find(el => el.textContent?.trim())?.textContent?.trim()
                      || "";
    const suuntoMatch  = rawTrackName.match(/^suuntoapp-([A-Za-z]+(?:[A-Z][a-z]+)*)-\d/);
    const parsedName   = suuntoMatch
      ? suuntoMatch[1].replace(/([A-Z])/g, " $1").trim()
      : rawTrackName || "YOUR RIDE";
    setActivityName(parsedName);

    const activityType = xml.querySelector("trk > type")?.textContent?.trim()
      || (suuntoMatch ? suuntoMatch[1].replace(/([A-Z])/g, " $1").trim() : undefined)
      || undefined;

    let resolvedLocation: string | undefined;
    try {
      const { lat, lon } = pts[0];
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const resp = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=place,region&access_token=${token}`);
      if (resp.ok) {
        const geo  = await resp.json();
        const feat = geo.features?.[0];
        if (feat) {
          const city  = feat.text || "";
          const ctx   = (feat.context as any[])?.find((c: any) => c.id?.startsWith("region"));
          const state = (ctx?.short_code ?? ctx?.text ?? "").split("-").pop() ?? "";
          resolvedLocation = state ? `${city}, ${state}` : city;
        }
      }
    } catch { /* geocoding optional */ }

    gpxMetricsRef.current = computeGpxMetrics(pts, {
      creator: creatorRaw || undefined,
      activityType,
      activityName: parsedName,
      activityLocation: resolvedLocation,
    });

    setGpxLoaded(true);
  };

  // ── GPX file upload ──────────────────────────────────────────────────────────
  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      void trackError("WRONG_GPX_FORMAT", `Wrong format: "${file.name}". Only .gpx files are accepted.`, "gpx_upload", {
        ...getBrowserCtx(),
        file_extension: `.${file.name.split(".").pop()?.toLowerCase() ?? "unknown"}`,
        file_size_bytes: file.size,
        file_mime_type:  file.type || null,
      });
      setGpxError("Only .gpx files are accepted."); e.target.value = ""; return;
    }
    gpxNameRef.current = file.name;
    await processGpxText(await file.text());
  };

  // ── Video upload ────────────────────────────────────────────────────────────
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Build error context incrementally as we learn more about the file/device.
    // Step 1: browser + file — always available at this point.
    const errCtxBase: ErrorContext = {
      ...getBrowserCtx(),
      file_extension:  `.${file.name.split(".").pop()?.toLowerCase() ?? "unknown"}`,
      file_size_bytes: file.size,
      file_mime_type:  file.type || null,
    };

    const nameLc = file.name.toLowerCase();
    if (!nameLc.endsWith(".mp4") && !nameLc.endsWith(".mov")) {
      const mobileExt = file.name.split(".").pop()?.toLowerCase() ?? "unknown";
      void trackError("WRONG_VIDEO_FORMAT", `[${file.name}] Unsupported extension ".${mobileExt}" on mobile. LENS mobile accepts .mp4 and .mov only. Size: ${(file.size/1024/1024).toFixed(1)}MB.`, "video_upload", errCtxBase);
      setUploadError("Only .mp4 and .mov files are supported."); e.target.value = ""; return;
    }

    // ── File size guard (device-aware) ──────────────────────────────────────────
    // Desktop: no limit.
    // File size ≠ RAM usage: the browser streams the blob URL on-demand, decoding
    // only 3-5 frames at a time. The real memory cost is fixed (~200MB regardless
    // of file size). Limits here protect against devices with constrained blob URL
    // handling or insufficient RAM for the concurrent encode+decode pipeline.
    //
    // iOS 17+ / iPhone 11+ (A13, 2019):  2 GB
    // iOS 16.4–16.x / older iPhones:     500 MB
    // Android 11+ (most modern phones):  1.5 GB
    // Android 10 (typical 4-6 GB RAM):   1 GB  ← raised from 500 MB (was too conservative)
    // Android 9 and older:               500 MB
    const iosVer      = mobileCaps?.iosVersion     ?? 0;
    const androidVer  = mobileCaps?.androidVersion ?? 0;
    const isAndroid   = mobileCaps?.isAndroid ?? false;

    let MAX_VIDEO_MB: number;
    if (isAndroid) {
      MAX_VIDEO_MB = androidVer >= 11 ? 1536          // 1.5 GB
                   : androidVer >= 10 ? 1024          // 1 GB
                   : 500;                             // 500 MB
    } else {
      MAX_VIDEO_MB = iosVer >= 17 ? 2048 : 500;
    }

    if (file.size > MAX_VIDEO_MB * 1_048_576) {
      const fileMB  = (file.size  / 1_048_576).toFixed(0);
      const limitGB = (MAX_VIDEO_MB / 1024).toFixed(MAX_VIDEO_MB % 1024 === 0 ? 0 : 1);
      const msg = `Video too large (${fileMB} MB). Maximum for this device is ${MAX_VIDEO_MB >= 1024 ? limitGB + " GB" : MAX_VIDEO_MB + " MB"}. Trim the clip or open LENS on desktop Chrome (no size limit).`;
      void trackError("WRONG_VIDEO_FORMAT", `[${file.name}] File too large: ${fileMB}MB > ${MAX_VIDEO_MB}MB limit. Android: ${androidVer}, iOS: ${iosVer}.`, "video_upload", errCtxBase);
      setUploadError(msg);
      e.target.value = "";
      return;
    }

    // Show loading immediately — camera detection + HEVC scan happen before the main
    // engine and take 0.5-2s. Without this the UI looks frozen after file selection.
    setLoading(true);
    setUploadError(null);
    setStatusMsg("Checking video…");
    setProgress(0);

    // ── Camera detection on ORIGINAL file (before any transcoding) ──────────────
    // Must run on the original file so that Android container metadata (com.android.*)
    // is available. After FFmpeg transcoding, these tags may be stripped.
    const { CameraDetector: CD } = await import("@/lib/media/CameraDetector");
    const originalCamDetection   = await CD.detect(file);
    mlog("CAM_EARLY", `type=${originalCamDetection.type} make=${originalCamDetection.make}`);

    // Step 2: enrich context with camera info — available after detection
    const errCtxCam: ErrorContext = {
      ...errCtxBase,
      device_type:  originalCamDetection.type,
      device_make:  originalCamDetection.make  || null,
      device_model: originalCamDetection.model || null,
    };

    // ── Video metadata scan — runs BEFORE the codec check ────────────────────────
    // Reading Phase 1 (first 2 MB) + Phase 2 (last 1.5 MB) gives codec, resolution,
    // fps, creation timestamp and GPS flag. Running it here means vmeta.codec is
    // available as a redundant HEVC signal in the codec check below.
    const { parseVideoMeta: _parseVideoMeta } = await import("@/lib/engine/parseVideoMeta");
    const vmeta = await _parseVideoMeta(file).catch(() => ({
      codec: "unknown" as const, width: null, height: null,
      fps: null, hasEmbeddedGPS: false, recordedAt: null,
    }));
    mlog("VMETA", `codec=${vmeta.codec} ${vmeta.width}×${vmeta.height} fps=${vmeta.fps} gps=${vmeta.hasEmbeddedGPS}`);

    // ── Codec compatibility check ─────────────────────────────────────────────────
    // canBrowserPlay() loads the actual file into a hidden <video> and seeks to
    // trigger real frame decoding. This is more reliable than canPlayType() or UA
    // sniffing — Android Chrome claims HEVC support on devices that silently fail.
    //
    // GoPro always records H.264 — skip the probe entirely (saves ~0.5s).
    let processFile = file;
    let detectedCodec: "h264" | "hevc" | null = null;
    let transcodeStart: number | null = null;

    // Mobile HEVC transcode size limit: beyond this, FFmpeg.wasm will OOM.
    // Empirically safe at ~200 MB on iOS 16.4+ (2 GB virtual budget for WASM).
    const HEVC_TRANSCODE_LIMIT_MB = 200;

    try {
      const isGoPro = originalCamDetection.type === "gopro";
      const { canBrowserPlay, transcodeHevcToH264, isHevcVideo } = await import("@/lib/engine/mobile/hevcTranscoder");
      const probe = isGoPro
        ? { canPlay: true, videoWidth: 0, videoHeight: 0 }
        : await canBrowserPlay(file);
      const canPlay    = probe.canPlay;
      const probeW     = probe.videoWidth;
      const probeH     = probe.videoHeight;
      const maxDim     = Math.max(probeW, probeH);

      mlog("PROBE", `canPlay=${canPlay} resolution=${probeW}x${probeH} maxDim=${maxDim}`);

      // ── HEVC detection — three redundant signals ───────────────────────────────
      //
      // Signal A: resolution from canBrowserPlay (most reliable on iOS).
      //   iPhone records 4K (.mov) EXCLUSIVELY in HEVC — H.264 is capped at 1080p
      //   in "Most Compatible" mode. So .mov + maxDim > 1920 = HEVC with near-certainty.
      //   This signal works even when file.slice() PHAsset reads fail for large files.
      //   NOTE: 4K H.264 on iPhone (rare, "Most Compatible" + 4K mode) would be a
      //   false positive — but 4K H.264 at 30fps is also extremely slow to render on
      //   mobile, so HEVC handling (reject if large, transcode if small) is still correct.
      //
      // Signal B: vmeta.codec from parseVideoMeta (Phase 1+2, reads last 3 MB).
      //   May return 'unknown' if iOS PHAsset tail read is unreliable for large files.
      //
      // Signal C: isHevcVideo() (Phase 1+2, reads last 3 MB).
      //   Same potential PHAsset limitation; different code path.
      //
      // Any signal independently catching HEVC routes through the HEVC path.
      // The HEVC path then decides: transcode (small files) or reject (large files).
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isResolutionHevc = !isGoPro && ext === 'mov' && maxDim > 1920;

      const isHEVC = isGoPro ? false : (
        isResolutionHevc ||                                // Signal A
        vmeta.codec === 'hevc' ||                         // Signal B
        (canPlay ? await isHevcVideo(file) : true)        // Signal C
      );
      detectedCodec = isHEVC ? "hevc" : "h264";
      // Track for MobileCanvasRenderer — HEVC source → VP9 encoder on iOS
      sourceIsHevcRef.current = isHEVC;

      mlog("CODEC", `canPlay=${canPlay} isHEVC=${isHEVC} size=${(file.size/1024/1024).toFixed(0)}MB`);

      if (isHEVC) {
        if (canPlay) {
          // ── HEVC + canPlay=true: render directly with VP9 encoder ────────────
          //
          // iOS can decode HEVC natively. We render directly — no transcoding.
          //
          // Encoder strategy: VP9 (libvpx, pure CPU software). VP9 has zero
          // interaction with iOS Video Toolbox. The HEVC hardware decoder and VP9
          // CPU encoder run on completely independent paths → no conflict.
          //
          // For 4K HEVC: the hardware HEVC decoder occasionally gets suspended by
          // iOS under memory pressure (readyState drops to 0 for ~1s then recovers).
          // This causes brief frozen frames in the output, but the render completes.
          // MobileCanvasRenderer skips frames during the suspension automatically.
          //
          // After VP9 encoding, MobileCanvasRenderer post-transcodes VP9→H264 using
          // FFmpeg.wasm so the output is Photos-compatible on iOS.
          mlog("CODEC", `HEVC canPlay=true — rendering with VP9 encoder. ${(file.size/1024/1024).toFixed(0)}MB ${probeW}×${probeH}`);
        } else {
          // ── HEVC + canPlay=false: device cannot decode → must transcode ─────
          const fileMB = file.size / 1_048_576;
          if (fileMB > HEVC_TRANSCODE_LIMIT_MB) {
            // Too large for FFmpeg.wasm (would OOM)
            mlog("CODEC", `HEVC canPlay=false, too large to transcode: ${fileMB.toFixed(0)}MB > ${HEVC_TRANSCODE_LIMIT_MB}MB`);
            const resInfo = probeW > 0 ? ` (${probeW}×${probeH})` : '';
            void trackError("WRONG_VIDEO_FORMAT",
              `[${file.name}] HEVC${resInfo} canPlay=false, too large for mobile transcode: ${fileMB.toFixed(0)}MB > ${HEVC_TRANSCODE_LIMIT_MB}MB.`,
              "video_upload",
              { ...errCtxCam, video_codec: "hevc", video_width: probeW || null, video_height: probeH || null });
            setLoading(false);
            setUploadError(
              `This video uses H.265 (HEVC) and cannot be played or converted on this device.\n\n` +
              `To fix:\n` +
              `• iPhone: Settings → Camera → Formats → "Most Compatible" — records in H.264\n` +
              `• Open LENS on desktop Chrome — no size limit there`
            );
            e.target.value = "";
            return;
          }

          // Small HEVC that the browser can't decode — transcode via FFmpeg.wasm
          mlog("CODEC", `HEVC canPlay=false (${fileMB.toFixed(0)}MB ≤ ${HEVC_TRANSCODE_LIMIT_MB}MB) — transcoding to H.264`);
          setHevcConverting(true);
          setHevcProgress(0);
          setHevcStatus("Loading converter…");
          transcodeStart = Date.now();
          processFile = await transcodeHevcToH264(file, (pct, status) => {
            setHevcProgress(pct);
            setHevcStatus(status);
          });
          const transcodeMs = Date.now() - transcodeStart;
          mlog("CODEC", `transcoding done in ${(transcodeMs/1000).toFixed(1)}s — ${(processFile.size/1024/1024).toFixed(1)}MB`);
          void trackHevcTranscode(transcodeMs, {
            ...errCtxCam,
            file_size_bytes: file.size,
            file_extension: "." + (file.name.split(".").pop()?.toLowerCase() ?? "unknown"),
          });
          setHevcConverting(false);
          setHevcProgress(0);
          setHevcStatus("");
        }
      } else if (!canPlay) {
        // Non-HEVC file that the browser can't play (unusual codec)
        mlog("CODEC", `browser cannot decode file — transcoding to H.264`);
        setHevcConverting(true);
        setHevcProgress(0);
        setHevcStatus("Loading converter…");
        transcodeStart = Date.now();
        processFile = await transcodeHevcToH264(file, (pct, status) => {
          setHevcProgress(pct);
          setHevcStatus(status);
        });
        const transcodeMs = Date.now() - transcodeStart;
        mlog("CODEC", `transcoding done in ${(transcodeMs/1000).toFixed(1)}s — ${(processFile.size/1024/1024).toFixed(1)}MB`);
        void trackHevcTranscode(transcodeMs, {
          ...errCtxCam,
          file_size_bytes: file.size,
          file_extension: "." + (file.name.split(".").pop()?.toLowerCase() ?? "unknown"),
        });
        setHevcConverting(false);
        setHevcProgress(0);
        setHevcStatus("");
      } else {
        mlog("CODEC", `H.264 natively supported${isGoPro ? " (GoPro)" : ""} — skipping transcode`);
      }
    } catch (err: any) {
      setHevcConverting(false);
      setHevcProgress(0);
      setHevcStatus("");
      setLoading(false);
      mlog("CODEC", `transcoding failed: ${err.message}`);
      void trackError("WRONG_VIDEO_FORMAT",
        `[${file.name}] Video transcoding failed: ${err.message}`,
        "video_upload",
        { ...errCtxCam, video_codec: detectedCodec,
          hevc_transcode_ms: transcodeStart != null ? Date.now() - transcodeStart : null });
      setUploadError(
        "Failed to convert this video for playback. " +
        "Try recording in H.264: Camera app → Settings → Video quality → disable \"Efficient video format\"."
      );
      e.target.value = "";
      return;
    }

    const errCtxFull: ErrorContext = {
      ...errCtxCam,
      video_codec:       detectedCodec,
      video_width:       vmeta.width,
      video_height:      vmeta.height,
      video_fps:         vmeta.fps,
      video_has_gps:     vmeta.hasEmbeddedGPS || null,
      video_recorded_at: vmeta.recordedAt,
      // GPX — if already uploaded before the video
      gpx_start_at:    activityPoints.length > 0 ? new Date(activityPoints[0].time).toISOString() : null,
      gpx_end_at:      activityPoints.length > 0 ? new Date(activityPoints[activityPoints.length - 1].time).toISOString() : null,
      gpx_point_count: activityPoints.length > 0 ? activityPoints.length : null,
      gpx_creator:     gpxMetricsRef.current?.creator ?? null,
    };

    // Pre-checks done — start animated progress for the engine phase
    setProgress(0);
    mlogClear();
    mlog("UPLOAD", `file=${processFile.name} size=${(processFile.size/1_048_576).toFixed(1)}MB`);
    const interval        = setInterval(() => setProgress(p => Math.min(p + 2, 92)), 200);
    const processingStart = Date.now();
    let   errorTracked    = false; // prevents double-tracking in the catch block
    let   camResult: { type: string; make: string; model: string } | null = null;

    try {
      const [
        { iPhoneEngineClient },
        { AndroidEngineClient },
        { GoProEngineClient },
        { iPhoneVideoGPSAnalyzer },
        { VideoGPSAnalyzer },
        { TelemetryCrossRef },
        { StorytellingProcessor },
      ] = await Promise.all([
        import("@/lib/media/iPhoneEngineClient"),
        import("@/lib/media/AndroidEngineClient"),
        import("@/lib/media/GoProEngineClient"),
        import("@/lib/engine/iphone/iPhoneVideoGPSAnalyzer"),
        import("@/lib/engine/VideoGPSAnalyzer"),
        import("@/lib/engine/TelemetryCrossRef"),
        import("@/lib/engine/StorytellingProcessor"),
      ]);

      // Use detection from original file (before transcoding) — preserves Android metadata
      setStatusMsg("Identifying camera…");
      const cam = originalCamDetection;
      camResult = cam; // expose to catch block for richer error messages
      const isIPhone   = cam.type === "iphone";
      const isAndroid  = cam.type === "android";
      const isWhatsApp = cam.type === "whatsapp";
      const isMobile   = isIPhone || isAndroid;

      mlog("CAM", `type=${cam.type} make=${cam.make} model=${cam.model}`);
      mlog("GPX", `activityPoints=${activityPoints.length} t0=${new Date(activityPoints[0]?.time ?? 0).toISOString()}`);

      // ── WhatsApp fast path ────────────────────────────────────────────────────
      // WhatsApp videos (beam box, or mp42+ct=0 fallback) have no telemetry and
      // cannot be synced. Route directly to the portrait template (GPX-only).
      if (isWhatsApp) {
        if (activityPoints.length === 0) {
          errorTracked = true;
          throw new Error("Please upload your GPX activity file first, then add the WhatsApp video.");
        }
        const { WhatsAppEngineClient: _WAC } = await import("@/lib/media/WhatsAppEngineClient");
        const waResult = await _WAC.extractMetadata(file);
        const { ActivityPortraitPlanner: _APl } = await import("@/lib/engine/ActivityPortraitPlanner");
        const sp = _APl.generatePlan(activityPoints as any, waResult.durationMs / 1000);
        storyPlanRef.current = sp;
        clearInterval(interval);
        setProgress(100);
        trackProcessingSession({
          status: "success", video_filename: processFile.name,
          video_duration_s: waResult.durationMs / 1000, camera_model: "WhatsApp",
          device_type: "whatsapp", device_make: "WhatsApp", device_model: "WhatsApp",
          device_os: null, device_os_version: null,
          browser_os: null, browser_is_mobile: true,
          browser_name: null, browser_os_version: null, browser_version: null,
          activity_name: activityName || null,
          gpx_points_count: activityPoints.length || null,
          gps_device: gpxMetricsRef.current?.gps_device_brand ?? null,
          activity_location: gpxMetricsRef.current?.activity_location ?? null,
          sync_strategy: "none", scenes_count: 1, unit_system: unit,
          processing_time_ms: Date.now() - processingStart, error_message: null,
        });
        setHighlights([]);
        setStoryPlan(sp);
        setVideoFile(processFile);
        setVideoLoaded(true);
        setStep("READY");
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────

      let vpts: any[]    = [];
      let gpsVideoOffsetMs = 0;
      let iPhoneVideoStartMs = 0, iPhoneDurationMs = 0, iPhoneHasStartGPS = false;

      if (isMobile) {
        setStatusMsg(isAndroid ? "Reading Android metadata…" : "Reading iPhone metadata…");
        // Always use the ORIGINAL file for metadata/telemetry extraction.
        // FFmpeg transcoding strips QuickTime/EXIF metadata and resets
        // mvhd.creation_time — both iPhone and Android need the original.
        // processFile (H.264) is used only for video rendering.
        const result = isAndroid
          ? await AndroidEngineClient.extractTelemetry(file)
          : await iPhoneEngineClient.extractTelemetry(file);

        // ── Critical: use ALL result fields, same as desktop page ──────────────
        vpts               = result.points as any[];
        gpsVideoOffsetMs   = result.gpsVideoOffsetMs;
        iPhoneVideoStartMs = result.videoStartMs;
        iPhoneDurationMs   = result.durationMs;
        iPhoneHasStartGPS  = result.hasStartGPS;

        mlog("PARSE", `vpts=${vpts.length} offset=${gpsVideoOffsetMs}ms videoStart=${new Date(iPhoneVideoStartMs).toISOString()} dur=${(iPhoneDurationMs/1000).toFixed(1)}s hasGPS=${iPhoneHasStartGPS}`);

        // ── Timezone auto-correction (same as desktop) ──────────────────────────
        // If the video's GPS timestamps don't overlap with the activity, try every
        // 30-min timezone offset to find the best alignment.
        if (activityPoints.length >= 5 && vpts.length >= 2) {
          const actStart = activityPoints[0].time;
          const actEnd   = activityPoints[activityPoints.length - 1].time;
          const vidStart = vpts[0].time;
          const vidEnd   = vpts[vpts.length - 1].time;
          const alreadyOk = vidStart <= actEnd + 60_000 && vidEnd >= actStart - 60_000;

          if (!alreadyOk) {
            mlog("SYNC", `no overlap — trying TZ offsets. vid=[${new Date(vidStart).toISOString()}..${new Date(vidEnd).toISOString()}] act=[${new Date(actStart).toISOString()}..${new Date(actEnd).toISOString()}]`);
            let bestOffset = 0, bestOverlap = 0;
            for (let tzMin = -720; tzMin <= 840; tzMin += 30) {
              const offsetMs   = tzMin * 60_000;
              const adjStart   = vidStart - offsetMs;
              const adjEnd     = vidEnd   - offsetMs;
              const overlap    = Math.max(0, Math.min(adjEnd, actEnd) - Math.max(adjStart, actStart));
              if (overlap > bestOverlap) { bestOverlap = overlap; bestOffset = offsetMs; }
            }
            if (bestOffset !== 0) {
              mlog("SYNC", `applying TZ offset ${bestOffset / 60_000}min (overlap=${(bestOverlap/1000).toFixed(0)}s)`);
              vpts               = vpts.map((p: any) => ({ ...p, time: p.time - bestOffset }));
              iPhoneVideoStartMs = iPhoneVideoStartMs - bestOffset;
            } else {
              mlog("SYNC", "no TZ offset improved overlap — proceeding with original");
            }
          } else {
            mlog("SYNC", `overlap ok — no TZ correction needed`);
          }
        }
      } else {
        setStatusMsg("Extracting GoPro telemetry…");
        // Always use original file for GPMF — transcoding strips the telemetry track.
        const result = await GoProEngineClient.extractTelemetry(file);
        vpts             = result.points as any[];
        gpsVideoOffsetMs = result.gpsVideoOffsetMs;
        mlog("PARSE", `gopro vpts=${vpts.length} offset=${gpsVideoOffsetMs}ms`);
      }

      setStatusMsg("Detecting highlights…");
      const videoProfile = isMobile
        ? iPhoneVideoGPSAnalyzer.analyze(iPhoneVideoStartMs, iPhoneDurationMs, iPhoneHasStartGPS)
        : VideoGPSAnalyzer.analyze(vpts, gpsVideoOffsetMs);

      // ── Temporal overlap guard ────────────────────────────────────────────────
      // If video and GPX are from different days and no timezone correction worked,
      // block here with a clear message instead of producing a broken render.
      {
        const vidT0  = vpts[0]?.time  ?? (isMobile ? iPhoneVideoStartMs : 0);
        const vidT1  = vpts[vpts.length - 1]?.time ?? (isMobile ? iPhoneVideoStartMs + iPhoneDurationMs : 0);
        const actT0  = activityPoints[0]?.time  ?? 0;
        const actT1  = activityPoints[activityPoints.length - 1]?.time ?? 0;
        const DRIFT  = 2 * 60 * 60_000; // 2 hours tolerance for edge TZ cases
        const hasOverlap = vidT0 - DRIFT <= actT1 && vidT1 + DRIFT >= actT0;
        if (!hasOverlap) {
          const vidDate = new Date(vidT0).toLocaleDateString();
          const actDate = new Date(actT0).toLocaleDateString();
          mlog("ERROR", `no temporal overlap: video=${vidDate} gpx=${actDate}`);

          // Mobile video with no embedded GPS + date mismatch → likely a received/social
          // video (WhatsApp .mov saved by iOS, AirDrop, etc.) whose extension or container
          // bypassed beam-box detection. Route to portrait template instead of error.
          if (isMobile && !iPhoneHasStartGPS) {
            mlog("WA_FALLBACK", `no GPS + date mismatch → routing to portrait template`);
            const { ActivityPortraitPlanner: _APl } = await import("@/lib/engine/ActivityPortraitPlanner");
            const sp = _APl.generatePlan(activityPoints as any, iPhoneDurationMs / 1000);
            storyPlanRef.current = sp;
            clearInterval(interval);
            setProgress(100);
            trackProcessingSession({
              status: "success", video_filename: processFile.name,
              video_duration_s: iPhoneDurationMs / 1000, camera_model: "WhatsApp",
              device_type: "whatsapp", device_make: "WhatsApp", device_model: "WhatsApp",
              device_os: null, device_os_version: null,
              browser_os: null, browser_is_mobile: true,
              browser_name: null, browser_os_version: null, browser_version: null,
              activity_name: activityName || null,
              gpx_points_count: activityPoints.length || null,
              gps_device: gpxMetricsRef.current?.gps_device_brand ?? null,
              activity_location: gpxMetricsRef.current?.activity_location ?? null,
              sync_strategy: "none", scenes_count: 1, unit_system: unit,
              processing_time_ms: Date.now() - processingStart, error_message: null,
            });
            setHighlights([]);
            setStoryPlan(sp);
            setVideoFile(processFile);
            setVideoLoaded(true);
            setStep("READY");
            return;
          }

          void trackError(
            "VIDEO_GPX_MISMATCH",
            `[${file.name}] Date mismatch — video: ${vidDate}, GPX: ${actDate}. ` +
            `Camera: ${camResult?.type ?? "unknown"} ${camResult?.make ?? ""} ${camResult?.model ?? ""} | ` +
            `codec: ${vmeta.codec} | res: ${vmeta.width ?? "?"}×${vmeta.height ?? "?"} | fps: ${vmeta.fps ?? "?"} | ` +
            `size: ${(file.size/1024/1024).toFixed(1)}MB | recorded_at: ${vmeta.recordedAt ?? "unknown"} | ` +
            `video GPS pts: ${vpts.length} | vidT0: ${new Date(vidT0).toISOString()} | actT0: ${new Date(actT0).toISOString()} | ` +
            `Activity: "${activityName}" (${activityPoints.length} pts) | GPX creator: ${errCtxFull.gpx_creator ?? "unknown"}.`,
            "video_upload",
            errCtxFull);
          errorTracked = true;
          throw new Error(`This video and GPX are from different days — video: ${vidDate}, GPX: ${actDate}. Please use files from the same ride.`);
        }
      }

      mlog("HIGHLIGHTS", `calling findHighlights vpts=${vpts.length} offset=${gpsVideoOffsetMs}ms`);
      mlog("HIGHLIGHTS", `vpts[0].time=${new Date(vpts[0]?.time ?? 0).toISOString()} vpts[-1].time=${new Date(vpts[vpts.length-1]?.time ?? 0).toISOString()}`);
      mlog("HIGHLIGHTS", `actPts[0].time=${new Date(activityPoints[0]?.time ?? 0).toISOString()}`);
      const segments = TelemetryCrossRef.findHighlights(activityPoints, vpts as any, unit, 0, gpsVideoOffsetMs);
      mlog("HIGHLIGHTS", `found=${segments?.length ?? 0}`);
      // Log first 3 segments to see computed videoStartTime values
      segments?.slice(0, 3).forEach((s, i) => {
        mlog("SEG_CALC", `seg[${i}] videoStart=${s.videoStartTime?.toFixed(2)}s startIdx=${s.startIndex} ptTime=${new Date(activityPoints[s.startIndex]?.time ?? 0).toISOString()}`);
      });

      if (!segments?.length) {
        const vidT0 = vpts[0]?.time ?? iPhoneVideoStartMs;
        const actT0 = activityPoints[0]?.time ?? 0;
        const diffMin = Math.round((vidT0 - actT0) / 60_000);
        mlog("ERROR", `no highlights. vpts[0].time=${new Date(vidT0).toISOString()} actPts[0].time=${new Date(actT0).toISOString()} diff=${diffMin}min`);
        void trackError(
          "NO_SCENES",
          `[${file.name}] No highlight scenes detected — falling back to full video. ` +
          `Camera: ${camResult?.type ?? "unknown"} ${camResult?.make ?? ""} ${camResult?.model ?? ""} | ` +
          `codec: ${vmeta.codec} | res: ${vmeta.width ?? "?"}×${vmeta.height ?? "?"} | fps: ${vmeta.fps ?? "?"} | ` +
          `size: ${(file.size/1024/1024).toFixed(1)}MB | ` +
          `video GPS pts: ${vpts.length} | time diff video-GPX: ${Math.abs(diffMin)} min | ` +
          `Activity: "${activityName}" (${activityPoints.length} pts) | GPX creator: ${errCtxFull.gpx_creator ?? "unknown"}.`,
          "video_upload",
          errCtxFull);
        errorTracked = true;
        // No highlights detected — StorytellingProcessor will apply full-video fallback
      }

      setStatusMsg("Building story…");
      const videoDurationSec = isMobile
        ? iPhoneDurationMs / 1000
        : (vpts.length > 1 ? gpsVideoOffsetMs / 1000 + (vpts[vpts.length - 1].time - vpts[0].time) / 1000 : 0);

      mlog("STORY", `videoDuration=${videoDurationSec.toFixed(1)}s`);
      const sp = StorytellingProcessor.generatePlan(activityPoints, vpts as any, unit, 0, gpsVideoOffsetMs, videoDurationSec);
      mlog("STORY", `segments=${sp.segments.length} totalBudget=${sp.totalBudgetSec?.toFixed(1)}s`);

      // Set render quality level for the user-facing notification
      if (!segments?.length) sp.renderQuality = 'no_scenes';
      else sp.renderQuality = 'perfect';

      clearInterval(interval);
      setProgress(100);
      storyPlanRef.current = sp;

      // Build video upload metrics for trackVideoUpload
      const resolvedCamera = cam.model || cam.make || null;
      const deviceOs       = isAndroid ? "Android" : (isMobile ? "iOS" : null);
      videoMetricsRef.current = {
        filename: processFile.name, file_size_bytes: processFile.size, camera_model: resolvedCamera,
        device_type: cam.type as any, device_make: cam.make || null,
        device_model: cam.model || null, device_os: deviceOs,
        device_os_version: isAndroid
          ? (mobileCaps?.androidVersion?.toString() ?? null)
          : (mobileCaps?.iosVersion?.toString()     ?? null),
        has_gps: isMobile ? iPhoneHasStartGPS : vpts.length > 0, gps_points_count: vpts.length,
        gps_duration_s: videoProfile.durationSec, gps_sampling_interval_ms: videoProfile.samplingIntervalMs,
        gps_start_utc: vpts.length > 0 ? new Date(vpts[0].time).toISOString() : null,
        gps_end_utc:   vpts.length > 0 ? new Date(vpts[vpts.length - 1].time).toISOString() : null,
        gps_video_offset_ms: gpsVideoOffsetMs, has_gps_lock: videoProfile.hasGPSLock,
        gps_lock_latency_s: videoProfile.lockLatencySec, pre_lock_points: videoProfile.preLockPoints,
        post_lock_points: videoProfile.postLockPoints, speed_avg_kmh: null, speed_max_kmh: null,
        distance_m: Math.round(videoProfile.postLockDistanceM),
        fix_pct_no_fix: 0, fix_pct_2d: 0, fix_pct_3d: 100,
      };

      // Track processing session
      trackProcessingSession({
        status:              "success",
        video_filename:      processFile.name,
        video_duration_s:    videoDurationSec || null,
        camera_model:        resolvedCamera,
        device_type:         cam.type as "gopro" | "iphone" | "android" | "unknown",
        device_make:         cam.make || null,
        device_model:        cam.model || null,
        device_os:           deviceOs,
        device_os_version:   isAndroid
          ? (mobileCaps?.androidVersion?.toString() ?? null)
          : (mobileCaps?.iosVersion?.toString()     ?? null),
        browser_os:          deviceOs,
        browser_is_mobile:   true,
        browser_name:        null,
        browser_os_version:  null,
        browser_version:     null,
        activity_name:       activityName || null,
        gpx_points_count:    activityPoints.length || null,
        gps_device:          gpxMetricsRef.current?.gps_device_brand ?? null,
        activity_location:   gpxMetricsRef.current?.activity_location ?? null,
        sync_strategy:       "timestamp-based",
        scenes_count:        sp.segments.filter(s => s.type === 'ACTION').length || null,
        unit_system:         unit,
        processing_time_ms:  Date.now() - processingStart,
        error_message:       null,
      }).then(id => {
        processingSessionIdRef.current = id;
        if (id) {
          if (gpxMetricsRef.current)   trackGpxSession({ ...gpxMetricsRef.current, processing_session_id: id });
          if (videoMetricsRef.current) trackVideoUpload({ ...videoMetricsRef.current, processing_session_id: id });
        }
      });

      setHighlights(segments);
      setStoryPlan(sp);
      setVideoFile(processFile);
      setVideoLoaded(true);
      setStep("READY");
    } catch (err: any) {
      clearInterval(interval);
      mlog("ERROR", `upload failed: ${err.message}`);

      // Translate raw worker/engine errors into clear, actionable user messages.
      const raw: string = err.message ?? "";
      const isGpsError =
        raw.includes("GPMF") ||
        raw.includes("GPS5") ||
        raw.includes("telemetry") ||
        raw.includes("GPS points") ||
        raw.includes("GPS coordinate");
      const userMsg = isGpsError
        ? "No GPS data found in this GoPro file.\n\n" +
          "Most likely cause: the video was re-encoded or trimmed (e.g. exported from CapCut, iMovie, or the GoPro Quik app) — this permanently erases the GPS metadata.\n\n" +
          "Fix: import the original, unedited .mp4 directly from the GoPro SD card. " +
          "Also make sure GPS is enabled on the camera (Settings → Preferences → GPS → On) and the solid lock icon appeared before you started recording."
        : raw || "Processing failed. Please try again.";

      setUploadError(userMsg);
      if (!errorTracked) {
        // Unknown/unexpected error — not already tracked at its source
        void trackError("NO_SCENES",
        `[${file.name}] ${err.message ?? "Processing failed"}. ` +
        `Camera: ${camResult?.type ?? "unknown"} ${camResult?.make ?? ""} ${camResult?.model ?? ""}. ` +
        `GPX points: ${activityPoints.length}. ` +
        `Activity: "${activityName}".`,
        "video_upload",
        errCtxFull);
      }
      trackProcessingSession({
        status: "error", video_filename: file.name, video_duration_s: null,
        camera_model: null, activity_name: activityName || null,
        gpx_points_count: activityPoints.length || null, gps_device: null,
        activity_location: null, sync_strategy: null, scenes_count: null,
        unit_system: unit, processing_time_ms: Date.now() - processingStart,
        error_message: err.message ?? null,
      });
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  // ── After render complete — track export + full form reset ───────────────────
  const handleRenderComplete = (result: RenderResult) => {
    void trackVideoExport({
      processing_session_id: processingSessionIdRef.current,
      reached_experience:    true,
      clicked_record:        true,
      completed_download:    result.status === "success",
      time_on_ready_ms:      null,
      time_to_download_ms:   experienceStartRef.current ? Date.now() - experienceStartRef.current : null,
      render_duration_ms:    result.durationMs,
      render_status:         result.status,
      error_message:         result.errorMessage ?? null,
      output_format:         result.outputFormat,
      output_size_bytes:     result.outputSizeBytes,
      output_duration_s:     storyPlanRef.current
        ? storyPlanRef.current.segments.reduce((s: number, seg: any) => s + (seg.durationSec ?? 0), 0)
        : null,
      download_action:       result.downloadAction ?? null,
    });

    if (result.status === "success") setVideoSuccess(true);

    // Surface render errors to the user — without this the component unmounts
    // silently and the user lands on the upload form with no explanation.
    if (result.status === "error" && result.errorMessage) {
      setUploadError(`Export failed: ${result.errorMessage}. Please try again.`);
    }

    // Reset all state — clean slate for next video.
    // Do NOT clear uploadError here: if an error was just set (lines above), clearing
    // it in the same synchronous pass means the user never sees it. The error is
    // cleared naturally when the user selects a new file (handleVideoUpload → setUploadError(null)).
    setVideoFile(null);    setHighlights([]);      setStoryPlan(null);
    setVideoLoaded(false);
    if (result.status !== "error") setUploadError(null);
    setGpxError(null);
    setGpxLoaded(false);   setActivityPoints([]);  setActivityName("YOUR RIDE");
    setProgress(0);        setStatusMsg("");
    gpxNameRef.current             = "";
    processingSessionIdRef.current = null;
    experienceStartRef.current     = null;
    storyPlanRef.current           = null;
    gpxMetricsRef.current          = null;
    videoMetricsRef.current        = null;
    sourceIsHevcRef.current        = false;
    setStep("UPLOAD");
  };


  // ── Render: debug panel (overlay — shown on top of any state) ─────────────
  if (showDebug) return <DebugPanel />;

  // ── Render: capability still loading ───────────────────────────────────────
  if (!mounted || mobileCaps === null) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Render: unsupported device ──────────────────────────────────────────────
  if (!mobileCaps.isSupported) {
    return <UnsupportedScreen caps={mobileCaps} />;
  }

  // ── Render: EXPERIENCE ──────────────────────────────────────────────────────
  if (step === "EXPERIENCE") {
    return (
      <MobileCanvasRenderer
        activityPoints={activityPoints}
        highlights={highlights}
        storyPlan={storyPlan}
        videoFile={videoFile}
        unit={unit}
        onRenderComplete={handleRenderComplete}
        activityName={activityName}
        sourceIsHEVC={sourceIsHevcRef.current}
      />
    );
  }

  // ── Render: UPLOAD / READY form ─────────────────────────────────────────────
  return (
    <>
    <main className="min-h-screen bg-[#050505] text-white font-sans overflow-x-hidden">

      {/* Ambient glow */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-15%] left-[-5%] w-[70%] h-[50%] bg-amber-500/5 blur-[120px] rounded-full" />
      </div>

      {/* Nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-5 py-4 backdrop-blur-md bg-black/50 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight text-white">LENS</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel</span>
        </div>
        {/* Unit toggle */}
        <div className="flex p-0.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <button onClick={() => setUnit("metric")}
            className={`px-2.5 py-1 rounded-md text-[10px] font-black tracking-widest transition-all ${unit === "metric" ? "bg-amber-500 text-black" : "text-zinc-500"}`}>
            KM
          </button>
          <button onClick={() => setUnit("imperial")}
            className={`px-2.5 py-1 rounded-md text-[10px] font-black tracking-widest transition-all ${unit === "imperial" ? "bg-amber-500 text-black" : "text-zinc-500"}`}>
            MI
          </button>
        </div>
      </nav>

      <div className="relative z-10 px-5 pt-6 pb-24">

        {/* Compact headline */}
        <div className="mb-6">
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-1">GPS · Telemetry · Cinematic</p>
          <h1 className="text-3xl font-black tracking-tight leading-[0.92]">
            Your ride.<br />
            <span className="text-amber-500">Your story.</span>
          </h1>
        </div>

        {/* Upload card */}
        <div className="bg-[#0f0f0f] rounded-3xl border border-zinc-800/80 p-5 shadow-2xl ring-1 ring-white/4 space-y-5">

          {/* ── Step 1: GPS Track (GPX file or Strava) ──────────── */}
          <div>
            {/* Section header */}
            <div className="flex items-center gap-2 mb-2.5">
              <div className={`w-5 h-5 rounded-md flex items-center justify-center font-black text-[10px] shrink-0 transition-colors ${
                gpxLoaded ? "bg-green-500 text-black" : "bg-amber-500 text-black"
              }`}>
                {gpxLoaded ? "✓" : "1"}
              </div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-500">Activity</p>
            </div>

            {/* GPS card — Strava (primary) and GPX file are two routes to the same goal */}
            <div className="rounded-2xl border border-zinc-800/70 overflow-hidden">

              {/* Strava — first (more important / most used) */}
              <StravaConnect
                onGpxLoaded={async (text) => { await processGpxText(text); }}
                origin="mobile"
                embedded
              />

              {/* "or" divider */}
              <div className="flex items-center gap-3 px-4 py-1.5 bg-zinc-900/40">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700 shrink-0">or</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>

              {/* GPX file upload */}
              <label className={`flex items-center gap-4 px-4 py-3.5 w-full cursor-pointer transition-colors ${
                gpxError  ? "bg-red-500/10 border-l-2 border-l-red-500" :
                gpxLoaded ? "bg-green-500/8 border-l-2 border-l-green-500" :
                "hover:bg-white/4 active:bg-white/6 border-l-2 border-l-transparent"
              }`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  gpxLoaded ? "bg-green-500 text-black" : "bg-zinc-800 text-zinc-500"
                }`}>
                  {gpxLoaded ? (
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-white text-sm leading-none mb-0.5">Upload GPX File</p>
                  {gpxError ? (
                    <p className="text-[11px] text-red-400">{gpxError}</p>
                  ) : gpxLoaded ? (
                    <p className="text-[11px] text-green-400 truncate">{gpxNameRef.current}</p>
                  ) : (
                    <p className="text-[11px] text-zinc-600">Garmin · Wahoo · Suunto</p>
                  )}
                </div>
                <input type="file" accept=".gpx" onChange={handleGPXUpload} className="hidden" />
              </label>

            </div>
          </div>

          {/* ── Separator ─────────────────────────────────────────── */}
          <div className="border-t border-zinc-800/50" />

          {/* ── Step 2: Video ─────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-md flex items-center justify-center font-black text-[10px] shrink-0 transition-colors ${
                !gpxLoaded ? "bg-zinc-800 text-zinc-600" :
                videoLoaded ? "bg-green-500 text-black" :
                "bg-amber-500 text-black"
              }`}>
                {videoLoaded ? "✓" : "2"}
              </div>
              <p className={`text-[9px] font-black uppercase tracking-[0.3em] transition-colors ${!gpxLoaded ? "text-zinc-700" : "text-zinc-500"}`}>Video</p>
            </div>

            <label className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
              hevcConverting ? "border-amber-500 bg-amber-500/5 cursor-default pointer-events-none" :
              !gpxLoaded ? "border-zinc-800 opacity-40 cursor-not-allowed" :
              uploadError ? "border-red-500 bg-red-500/8 cursor-pointer" :
              videoLoaded ? "border-green-500 bg-green-500/8 cursor-pointer" :
              loading ? "border-zinc-700 cursor-wait" :
              "border-amber-500 bg-amber-500/5 cursor-pointer active:scale-[0.98]"
            }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                !gpxLoaded ? "bg-zinc-800 text-zinc-600" :
                videoLoaded ? "bg-green-500 text-black" :
                loading || hevcConverting ? "bg-amber-500 text-black" :
                "bg-amber-500 text-black"
              }`}>
                {loading || hevcConverting ? (
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : videoLoaded ? (
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-black text-sm ${!gpxLoaded ? "text-zinc-600" : "text-white"}`}>
                  {hevcConverting ? "Preparing Video" : "Import Video"}
                </p>
                {hevcConverting ? (
                  <>
                    <div className="mt-1.5 w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${hevcProgress}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-black text-amber-500/80 mt-1 animate-pulse">
                      {hevcStatus || "Converting…"} · {hevcProgress}%
                    </p>
                  </>
                ) : uploadError ? (
                  <p className="text-[11px] text-red-400 mt-0.5">{uploadError}</p>
                ) : loading ? (
                  <p className="text-[11px] text-amber-400 mt-0.5 animate-pulse">{statusMsg}</p>
                ) : !gpxLoaded ? (
                  <p className="text-[11px] text-zinc-600 mt-0.5">Load GPS track first</p>
                ) : videoLoaded ? (
                  <p className="text-[11px] text-green-400 mt-0.5 truncate">{videoFile?.name}</p>
                ) : (
                  <p className="text-[11px] text-zinc-600 mt-0.5">GoPro · iPhone · Android</p>
                )}
              </div>
              <input
                type="file" accept=".mp4,.mov,video/mp4,video/quicktime"
                disabled={!gpxLoaded || loading || hevcConverting}
                onChange={handleVideoUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Progress bar (visible during video processing) */}
          {loading && (
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Render quality notification — shown when render is not "perfect" */}
          {storyPlan?.renderQuality && storyPlan.renderQuality !== 'perfect' && (() => {
            const msg = RENDER_QUALITY_MESSAGES[storyPlan.renderQuality!];
            if (!msg?.text) return null;
            return (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/8 border border-amber-500/20">
                <span className="text-base shrink-0 mt-0.5">{msg.icon}</span>
                <div>
                  <p className="text-amber-400 text-[11px] font-black uppercase tracking-widest mb-1">{msg.text}</p>
                  <p className="text-zinc-500 text-[11px] leading-relaxed">{msg.detail}</p>
                </div>
              </div>
            );
          })()}

          {/* Generate button */}
          <button
            disabled={!videoLoaded}
            onClick={() => {
              experienceStartRef.current = Date.now();
              void trackVideoExport({
                processing_session_id: processingSessionIdRef.current,
                reached_experience: true, clicked_record: true, completed_download: false,
                time_on_ready_ms: null, time_to_download_ms: null, render_duration_ms: null,
                render_status: null, error_message: null, output_format: null,
                output_size_bytes: null, output_duration_s: null,
              });
              setStep("EXPERIENCE");
            }}
            className={`w-full py-5 rounded-2xl font-black uppercase tracking-[0.3em] text-sm transition-all flex items-center justify-center gap-3 ${
              videoLoaded
                ? "bg-amber-500 text-black shadow-[0_10px_30px_rgba(245,158,11,0.3)] active:scale-[0.98]"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill={videoLoaded ? "black" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Generate &amp; Save
          </button>

          {/* Trust badges */}
          <div className="flex justify-center gap-5 pt-1">
            {[
              { icon: "🔒", label: "Private" },
              { icon: "📱", label: "On-Device" },
              { icon: "▶️", label: "Insta Ready" },
            ].map(b => (
              <div key={b.label} className="flex items-center gap-1 text-zinc-600">
                <span className="text-[11px]">{b.icon}</span>
                <span className="text-[10px] font-black uppercase tracking-widest">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Compatible devices */}
        <div className="mt-8 mb-6">
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-600 mb-3 text-center">Works with your gear</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[
              { src: "/devices/logos/gopro_logo.svg",   w: 44 },
              { src: "/devices/logos/iphone_logo.svg",  w: 52 },
              { src: "/devices/logos/android_logo.svg", w: 64 },
              { src: "/devices/logos/garmin_logo.svg",  w: 44 },
              { src: "/devices/logos/strava_logo.svg",  w: 40 },
            ].map((d, i) => (
              <div key={i} className="flex items-center justify-center h-7 px-2.5 rounded-lg bg-white/50 border border-white/40">
                <img src={d.src} alt="" style={{ height: 13, width: "auto", maxWidth: d.w }} />
              </div>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-2 mb-8">
          {[{ value: "<60s", label: "Render Time" }, { value: "18Hz", label: "GPS Precision" }, { value: "9:16", label: "Format" }].map(s => (
            <div key={s.label} className="flex flex-col items-center bg-zinc-900/50 rounded-xl py-3 px-1 border border-zinc-800/60">
              <span className="text-sm font-black text-amber-400 leading-none">{s.value}</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Features */}
        <div className="space-y-3 mb-8">
          {[
            { icon: "🛰️", title: "GPS Scene Detection", body: "Finds climbs, sprints and technical sections from your GPS data." },
            { icon: "🎬", title: "Auto-Edit", body: "Selects the best clips and assembles them with cinematic transitions." },
            { icon: "📊", title: "Telemetry Overlay", body: "Speed, heart rate, elevation — rendered on every frame." },
            { icon: "🔒", title: "100% Private", body: "Everything runs in your browser. Your files never leave your device." },
          ].map(f => (
            <div key={f.title} className="flex gap-4 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/60">
              <span className="text-xl shrink-0">{f.icon}</span>
              <div>
                <p className="font-black text-white text-sm mb-0.5">{f.title}</p>
                <p className="text-zinc-500 text-xs leading-relaxed">{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Instagram */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-purple-600/15 border border-purple-500/30">
            <IgIcon size={14} />
            <span className="text-[13px] font-black text-white tracking-wide">@LENS.video</span>
          </div>
        </div>
        <p className="text-zinc-600 text-[11px] text-center mb-8">Tag your LENS edits to get featured.</p>

      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-800/50 bg-black/30 px-5 py-6 text-center">
        <span className="text-base font-black text-white">LENS</span>
        <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest ml-2">by ProRefuel.app</span>
        <div className="flex items-center justify-center gap-4 mt-3">
          <a href="/how-it-works" className="text-[11px] font-black uppercase tracking-widest text-zinc-600">How It Works</a>
          <a href="/privacy"  className="text-[11px] font-black uppercase tracking-widest text-zinc-600">Privacy</a>
        </div>
      </footer>

    </main>

    <InstallPrompt show={videoSuccess} />
    </>
  );
}
