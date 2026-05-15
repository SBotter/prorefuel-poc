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
import type { ActionSegment }  from "@/lib/engine/TelemetryCrossRef";
import type { StoryPlan }      from "@/lib/engine/StorytellingProcessor";
import type { UnitSystem }     from "@/lib/utils/units";
import type { MobileCapabilities } from "@/lib/engine/mobile/mobileCapabilities";
import type { RenderResult }   from "@/components/MapEngine";

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

  const gpxNameRef = useRef("");

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

  // ── GPX upload ──────────────────────────────────────────────────────────────
  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      setGpxError("Only .gpx files are accepted."); e.target.value = ""; return;
    }
    setGpxError(null);

    const text = await file.text();
    const xml  = new DOMParser().parseFromString(text, "text/xml");

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

    let pts = Array.from(xml.querySelectorAll("trkpt")).map(parsePoint).filter(p => isFinite(p.time));
    if (pts.length === 0) {
      const rtepts = Array.from(xml.querySelectorAll("rtept")).map(parsePoint).filter(p => isFinite(p.time));
      pts = rtepts;
    }
    if (pts.length === 0) { setGpxError("No GPS track found in this file."); return; }

    setActivityPoints(pts);
    gpxNameRef.current = file.name;
    setGpxLoaded(true);
  };

  // ── Video upload ────────────────────────────────────────────────────────────
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const nameLc = file.name.toLowerCase();
    if (!nameLc.endsWith(".mp4") && !nameLc.endsWith(".mov")) {
      setUploadError("Only .mp4 and .mov files are supported."); e.target.value = ""; return;
    }

    // ── File size guard: > 300 MB causes iOS to evict the video buffer ─────────
    const MAX_VIDEO_MB = 300;
    if (file.size > MAX_VIDEO_MB * 1_048_576) {
      setUploadError(`Video too large (${(file.size/1_048_576/1_024).toFixed(1)} GB). Maximum is ${MAX_VIDEO_MB} MB on mobile. Trim the video before uploading.`);
      e.target.value = "";
      return;
    }

    setLoading(true); setUploadError(null); setProgress(0);
    mlogClear();
    mlog("UPLOAD", `file=${file.name} size=${(file.size/1_048_576).toFixed(1)}MB`);
    const interval = setInterval(() => setProgress(p => Math.min(p + 2, 92)), 200);

    try {
      const [
        { CameraDetector },
        { iPhoneEngineClient },
        { AndroidEngineClient },
        { GoProEngineClient },
        { iPhoneVideoGPSAnalyzer },
        { VideoGPSAnalyzer },
        { TelemetryCrossRef },
        { StorytellingProcessor },
      ] = await Promise.all([
        import("@/lib/media/CameraDetector"),
        import("@/lib/media/iPhoneEngineClient"),
        import("@/lib/media/AndroidEngineClient"),
        import("@/lib/media/GoProEngineClient"),
        import("@/lib/engine/iphone/iPhoneVideoGPSAnalyzer"),
        import("@/lib/engine/VideoGPSAnalyzer"),
        import("@/lib/engine/TelemetryCrossRef"),
        import("@/lib/engine/StorytellingProcessor"),
      ]);

      setStatusMsg("Identifying camera…");
      const cam = await CameraDetector.detect(file);
      const isIPhone  = cam.type === "iphone";
      const isAndroid = cam.type === "android";
      const isMobile  = isIPhone || isAndroid;

      mlog("CAM", `type=${cam.type} make=${cam.make} model=${cam.model}`);
      mlog("GPX", `activityPoints=${activityPoints.length} t0=${new Date(activityPoints[0]?.time ?? 0).toISOString()}`);

      let vpts: any[]    = [];
      let gpsVideoOffsetMs = 0;
      let iPhoneVideoStartMs = 0, iPhoneDurationMs = 0, iPhoneHasStartGPS = false;

      if (isMobile) {
        setStatusMsg(isAndroid ? "Reading Android metadata…" : "Reading iPhone metadata…");
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
          throw new Error(`Video (${vidDate}) and GPX (${actDate}) appear to be from different days. Please use files from the same ride.`);
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
        // Provide diagnostic info in the error
        const vidT0 = vpts[0]?.time ?? iPhoneVideoStartMs;
        const actT0 = activityPoints[0]?.time ?? 0;
        const diffMin = Math.round((vidT0 - actT0) / 60_000);
        mlog("ERROR", `no highlights. vpts[0].time=${new Date(vidT0).toISOString()} actPts[0].time=${new Date(actT0).toISOString()} diff=${diffMin}min`);
        throw new Error(`No highlight scenes detected. Video and GPX may not overlap in time (diff: ${Math.abs(diffMin)} min). Make sure both files are from the same ride.`);
      }

      setStatusMsg("Building story…");
      const videoDurationSec = isMobile
        ? iPhoneDurationMs / 1000
        : (vpts.length > 1 ? gpsVideoOffsetMs / 1000 + (vpts[vpts.length - 1].time - vpts[0].time) / 1000 : 0);

      mlog("STORY", `videoDuration=${videoDurationSec.toFixed(1)}s`);
      const sp = StorytellingProcessor.generatePlan(activityPoints, vpts as any, unit, 0, gpsVideoOffsetMs, videoDurationSec);
      mlog("STORY", `segments=${sp.segments.length} totalBudget=${sp.totalBudgetSec?.toFixed(1)}s`);

      clearInterval(interval);
      setProgress(100);
      setHighlights(segments);
      setStoryPlan(sp);
      setVideoFile(file);
      setVideoLoaded(true);
      setStep("READY");
    } catch (err: any) {
      clearInterval(interval);
      mlog("ERROR", `upload failed: ${err.message}`);
      setUploadError(err.message ?? "Processing failed.");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  };

  // ── After render complete ───────────────────────────────────────────────────
  const handleRenderComplete = (result: RenderResult) => {
    if (result.status === "success") {
      setTimeout(() => {
        setVideoFile(null); setHighlights([]); setStoryPlan(null);
        setVideoLoaded(false); setUploadError(null);
        setProgress(0); setStep("READY");
      }, 3000);
    }
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
      />
    );
  }

  // ── Render: UPLOAD / READY form ─────────────────────────────────────────────
  return (
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
        <div className="bg-[#0f0f0f] rounded-3xl border border-zinc-800/80 p-5 shadow-2xl ring-1 ring-white/4 space-y-4">

          {/* Step 1 — GPX */}
          <label className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer active:scale-[0.98] ${
            gpxError  ? "border-red-500 bg-red-500/8" :
            gpxLoaded ? "border-green-500 bg-green-500/8" :
            "border-amber-500 bg-amber-500/5"
          }`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-black text-lg ${
              gpxLoaded ? "bg-green-500 text-black" : "bg-amber-500 text-black"
            }`}>
              {gpxLoaded ? "✓" : "1"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">Step 01</p>
              <p className="font-black text-white text-sm">Import GPX</p>
              {gpxError ? (
                <p className="text-[11px] text-red-400 mt-0.5">{gpxError}</p>
              ) : gpxLoaded ? (
                <p className="text-[11px] text-green-400 mt-0.5 truncate">{gpxNameRef.current}</p>
              ) : (
                <p className="text-[11px] text-zinc-600 mt-0.5">Garmin · Strava · Wahoo · Suunto</p>
              )}
            </div>
            <input type="file" accept=".gpx" onChange={handleGPXUpload} className="hidden" />
          </label>

          {/* Step 2 — Video */}
          <label className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
            !gpxLoaded ? "border-zinc-800 opacity-50 cursor-not-allowed" :
            uploadError ? "border-red-500 bg-red-500/8 cursor-pointer" :
            videoLoaded ? "border-green-500 bg-green-500/8 cursor-pointer" :
            loading ? "border-zinc-700 cursor-wait" :
            "border-amber-500 bg-amber-500/5 cursor-pointer active:scale-[0.98]"
          }`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-black text-lg ${
              !gpxLoaded ? "bg-zinc-800 text-zinc-600" :
              videoLoaded ? "bg-green-500 text-black" :
              loading ? "bg-zinc-700 text-zinc-400" :
              "bg-amber-500 text-black"
            }`}>
              {loading ? (
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : videoLoaded ? "✓" : "2"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">Step 02</p>
              <p className={`font-black text-sm ${!gpxLoaded ? "text-zinc-600" : "text-white"}`}>Import Video</p>
              {uploadError ? (
                <p className="text-[11px] text-red-400 mt-0.5">{uploadError}</p>
              ) : loading ? (
                <p className="text-[11px] text-amber-400 mt-0.5 animate-pulse">{statusMsg}</p>
              ) : !gpxLoaded ? (
                <p className="text-[11px] text-zinc-600 mt-0.5">Load GPX first</p>
              ) : videoLoaded ? (
                <p className="text-[11px] text-green-400 mt-0.5 truncate">{videoFile?.name}</p>
              ) : (
                <p className="text-[11px] text-zinc-600 mt-0.5">GoPro · iPhone · Android</p>
              )}
            </div>
            <input
              type="file" accept=".mp4,.mov,video/mp4,video/quicktime"
              disabled={!gpxLoaded || loading}
              onChange={handleVideoUpload}
              className="hidden"
            />
          </label>

          {/* Progress bar (visible during video processing) */}
          {loading && (
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Generate button */}
          <button
            disabled={!videoLoaded}
            onClick={() => setStep("EXPERIENCE")}
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
          <a href="/privacidade"  className="text-[11px] font-black uppercase tracking-widest text-zinc-600">Privacy</a>
        </div>
      </footer>

    </main>
  );
}
