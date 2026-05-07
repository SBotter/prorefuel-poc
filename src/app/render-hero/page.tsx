"use client";

/**
 * /render-hero — internal tool to generate hero preview videos for the landing page.
 *
 * Renders TWO versions from the same GPX + GoPro video:
 *   1. hero-preview.mp4      — full LENS edit with telemetry overlay
 *   2. hero-preview-raw.mp4  — identical cuts/timing, zero overlay (pure video)
 *
 * Usage:
 *   1. Place your raw GoPro .mp4 anywhere accessible (or upload via the form)
 *   2. Open /render-hero in Chrome on desktop
 *   3. Upload GPX + video → click Render Both
 *   4. Wait for LENS render to download, then clean render downloads automatically
 *   5. Move both files to public/videos/
 */

import { useState, useRef, useEffect } from "react";
import { CheckCircle2, Loader2, Gauge, Upload, Download, Zap } from "lucide-react";
import MapEngine from "@/components/MapEngine";
import type { RenderResult } from "@/components/MapEngine";
import { ActionSegment, TelemetryCrossRef } from "@/lib/engine/TelemetryCrossRef";
import { StorytellingProcessor, StoryPlan } from "@/lib/engine/StorytellingProcessor";
import { GPXAnalyzer } from "@/lib/engine/GPXAnalyzer";
import { VideoGPSAnalyzer } from "@/lib/engine/VideoGPSAnalyzer";
import { SyncStrategySelector } from "@/lib/engine/SyncStrategySelector";
import { GoProEngineClient } from "@/lib/media/GoProEngineClient";
import { CameraDetector } from "@/lib/media/CameraDetector";

type Phase =
  | "idle"        // waiting for uploads
  | "processing"  // extracting GPMF + story plan
  | "lens-render" // rendering LENS version (with overlay)
  | "clean-render"// rendering clean version (no overlay)
  | "done";       // both files downloaded

export default function RenderHeroPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [phase, setPhase]           = useState<Phase>("idle");
  const [statusMsg, setStatusMsg]   = useState("");
  const [progress, setProgress]     = useState(0);
  const [error, setError]           = useState<string | null>(null);
  const [gpxReady, setGpxReady]     = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // Engine data
  const [activityPoints, setActivityPoints] = useState<any[]>([]);
  const [highlights, setHighlights]         = useState<ActionSegment[]>([]);
  const [storyPlan, setStoryPlan]           = useState<StoryPlan | null>(null);
  const [videoFile, setVideoFile]           = useState<File | null>(null);
  const [gpxName, setGpxName]               = useState("");
  const [videoName, setVideoName]           = useState("");

  // Which render is active
  const [renderKey, setRenderKey]       = useState(0);
  const [isCleanRender, setIsCleanRender] = useState(false);

  const lensCompleted  = useRef(false);
  const cleanCompleted = useRef(false);

  if (!mounted) return <div className="min-h-screen bg-[#0a0a0a]" />;

  // ── GPX upload ──────────────────────────────────────────────────────────
  const handleGPX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const text = await file.text();
    const xml  = new DOMParser().parseFromString(text, "text/xml");
    const pts  = Array.from(xml.querySelectorAll("trkpt")).map((pt: Element) => {
      const lat   = parseFloat(pt.getAttribute("lat") || "0");
      const lon   = parseFloat(pt.getAttribute("lon") || "0");
      const ele   = parseFloat(pt.querySelector("ele")?.textContent  || "0");
      const time  = new Date(pt.querySelector("time")?.textContent || "").getTime();
      const hrEl  = pt.querySelector("hr");
      const cadEl = pt.querySelector("cad");
      const powerEl = pt.querySelector("power") ?? pt.querySelector("watts");
      const speedEl = pt.querySelector("speed");
      const hr    = hrEl    ? parseFloat(hrEl.textContent    || "0") || undefined : undefined;
      const cad   = cadEl   ? parseFloat(cadEl.textContent   || "0") || undefined : undefined;
      const power = powerEl ? parseFloat(powerEl.textContent || "0") || undefined : undefined;
      const speed = speedEl ? parseFloat(speedEl.textContent || "0") * 3.6 || undefined : undefined;
      return { lat, lon, ele, time, ...(hr !== undefined && { hr }), ...(cad !== undefined && { cad }), ...(power !== undefined && { power }), ...(speed !== undefined && { speed }) };
    });
    if (pts.length === 0) { setError("No GPS track found."); return; }
    setActivityPoints(pts);
    setGpxName(file.name);
    setGpxReady(true);
  };

  // ── Video upload ────────────────────────────────────────────────────────
  const handleVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setVideoFile(file);
    setVideoName(file.name);
    setVideoReady(true);
  };

  // ── Process + start render ──────────────────────────────────────────────
  const handleRender = async () => {
    if (!videoFile || activityPoints.length === 0) return;
    setPhase("processing");
    setError(null);
    setProgress(0);
    lensCompleted.current  = false;
    cleanCompleted.current = false;

    const interval = setInterval(() => setProgress(p => p >= 95 ? 95 : p + 1), 180);

    try {
      setStatusMsg("Detecting camera...");
      const cam = await CameraDetector.detect(videoFile);
      if (cam.type !== "gopro") throw new Error("Only GoPro MP4 supported in render-hero.");

      setStatusMsg("Extracting GPMF telemetry...");
      const result         = await GoProEngineClient.extractTelemetry(videoFile);
      const { points: vpts, gpsVideoOffsetMs } = result;
      if (vpts.length === 0) throw new Error("No GPS in video. Enable GPS on GoPro before recording.");

      setStatusMsg("Analysing GPS profiles...");
      const gpxProfile   = GPXAnalyzer.analyze(""); // lightweight — we just need videoProfile
      const videoProfile = VideoGPSAnalyzer.analyze(vpts, gpsVideoOffsetMs);
      if (!videoProfile.hasGPSLock) throw new Error("GPS lock not acquired.");

      setStatusMsg("Building story plan...");
      const segments = TelemetryCrossRef.findHighlights(activityPoints, vpts as any, "metric", 0, gpsVideoOffsetMs);
      if (!segments?.length) throw new Error("No scenes detected.");

      const videoDurationSec = vpts.length > 1
        ? gpsVideoOffsetMs / 1000 + (vpts[vpts.length - 1].time - vpts[0].time) / 1000
        : 0;
      const plan = StorytellingProcessor.generatePlan(activityPoints, vpts as any, "metric", 0, gpsVideoOffsetMs, videoDurationSec);

      clearInterval(interval);
      setProgress(100);
      setHighlights(segments);
      setStoryPlan(plan);

      // Start LENS render
      setTimeout(() => {
        setIsCleanRender(false);
        setRenderKey(k => k + 1);
        setPhase("lens-render");
      }, 400);
    } catch (err: any) {
      clearInterval(interval);
      setError(err.message);
      setPhase("idle");
    }
  };

  // ── Called when each render completes ───────────────────────────────────
  const onRenderComplete = (result: RenderResult) => {
    if (!isCleanRender) {
      // LENS render done → start clean render
      lensCompleted.current = true;
      setTimeout(() => {
        setIsCleanRender(true);
        setRenderKey(k => k + 1);
        setPhase("clean-render");
      }, 800);
    } else {
      // Clean render done → all finished
      cleanCompleted.current = true;
      setPhase("done");
    }
  };

  const renderActive = phase === "lens-render" || phase === "clean-render";

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white font-sans p-8 max-w-2xl mx-auto">

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl font-black tracking-tight">LENS</span>
          <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-[10px] font-black uppercase tracking-widest text-amber-400">Internal Tool</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight mb-2">Hero Video Generator</h1>
        <p className="text-zinc-400 text-sm leading-relaxed max-w-lg">
          Renders two hero videos from one GPX + GoPro video: the LENS-edited version (with full telemetry overlay) and the raw version (same exact cuts, zero overlay). Both download automatically.
        </p>
      </div>

      {/* Output filenames */}
      <div className="flex gap-3 mb-8">
        <div className={`flex-1 p-3 rounded-xl border text-center ${lensCompleted.current ? "border-green-500/40 bg-green-500/8" : "border-zinc-700/50 bg-zinc-900/40"}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Output 1</p>
          <p className="text-sm font-black text-white">hero-preview.mp4</p>
          <p className="text-[10px] text-amber-400 mt-0.5">With LENS overlay</p>
          {lensCompleted.current && <p className="text-[10px] text-green-400 mt-1">✓ Downloaded</p>}
        </div>
        <div className={`flex-1 p-3 rounded-xl border text-center ${cleanCompleted.current ? "border-green-500/40 bg-green-500/8" : "border-zinc-700/50 bg-zinc-900/40"}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Output 2</p>
          <p className="text-sm font-black text-white">hero-preview-raw.mp4</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">Raw cuts, no overlay</p>
          {cleanCompleted.current && <p className="text-[10px] text-green-400 mt-1">✓ Downloaded</p>}
        </div>
      </div>

      {/* Upload / process form */}
      {(phase === "idle" || phase === "processing") && (
        <div className="space-y-4">

          {/* GPX */}
          <label className={`flex items-center gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${gpxReady ? "border-green-500 bg-green-500/8" : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10"}`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${gpxReady ? "bg-green-500 text-black" : "bg-amber-500 text-black"}`}>
              {gpxReady ? <CheckCircle2 size={24} /> : <Gauge size={24} />}
            </div>
            <div>
              <p className="font-black text-sm uppercase tracking-wide">{gpxReady ? "GPX loaded" : "Import GPX activity"}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{gpxReady ? gpxName : "Garmin · Wahoo · any .gpx"}</p>
            </div>
            <input type="file" accept=".gpx" onChange={handleGPX} className="hidden" />
          </label>

          {/* Video */}
          <label className={`flex items-center gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${videoReady ? "border-green-500 bg-green-500/8" : gpxReady ? "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10" : "border-zinc-800 bg-zinc-900/40 opacity-50 cursor-not-allowed"}`}>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${videoReady ? "bg-green-500 text-black" : "bg-amber-500 text-black"}`}>
              {videoReady ? <CheckCircle2 size={24} /> : <Upload size={24} />}
            </div>
            <div>
              <p className="font-black text-sm uppercase tracking-wide">{videoReady ? "Video loaded" : "Import GoPro MP4"}</p>
              <p className="text-zinc-500 text-xs mt-0.5">{videoReady ? videoName : "GoPro .mp4 with GPS"}</p>
            </div>
            <input type="file" accept=".mp4,video/mp4" disabled={!gpxReady} onChange={handleVideo} className="hidden" />
          </label>

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {phase === "processing" ? (
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="animate-spin text-amber-500" size={20} />
                <p className="font-black text-sm">{statusMsg}</p>
              </div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <button
              onClick={handleRender}
              disabled={!gpxReady || !videoReady}
              className={`w-full py-5 rounded-2xl font-black uppercase tracking-[0.3em] text-sm flex items-center justify-center gap-3 transition-all ${gpxReady && videoReady ? "bg-amber-500 text-black hover:scale-[1.01] shadow-[0_10px_30px_rgba(245,158,11,0.3)]" : "bg-zinc-800 text-zinc-600 cursor-not-allowed"}`}
            >
              <Zap size={18} fill={gpxReady && videoReady ? "black" : "none"} />
              Render Both Videos
            </button>
          )}
        </div>
      )}

      {/* Render phase status */}
      {renderActive && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <p className="font-black text-sm uppercase tracking-widest">
                {phase === "lens-render" ? "Rendering LENS version..." : "Rendering clean version..."}
              </p>
            </div>
            <p className="text-zinc-500 text-xs ml-5">
              {phase === "lens-render"
                ? "hero-preview.mp4 — with full telemetry overlay"
                : "hero-preview-raw.mp4 — same cuts, zero overlay"}
            </p>
          </div>

          {/* Progress indicator */}
          <div className="flex gap-2">
            <div className={`flex-1 h-1.5 rounded-full ${lensCompleted.current ? "bg-green-500" : phase === "lens-render" ? "bg-amber-500 animate-pulse" : "bg-zinc-800"}`} />
            <div className={`flex-1 h-1.5 rounded-full ${cleanCompleted.current ? "bg-green-500" : phase === "clean-render" ? "bg-amber-500 animate-pulse" : "bg-zinc-800"}`} />
          </div>
          <div className="flex gap-2 text-center">
            <p className="flex-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">LENS</p>
            <p className="flex-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">RAW</p>
          </div>

          {/* Hidden render canvas */}
          <div className="rounded-2xl overflow-hidden border border-zinc-800 opacity-60" style={{ maxHeight: 320 }}>
            <div className="aspect-[9/16] w-full" style={{ maxHeight: 320, overflow: "hidden" }}>
              <MapEngine
                key={renderKey}
                activityPoints={activityPoints}
                highlights={highlights}
                storyPlan={storyPlan}
                videoFile={videoFile}
                activityMeta={{ name: "Hero Preview" }}
                autoRecord={true}
                unit="metric"
                hideOverlay={isCleanRender}
                onRenderComplete={onRenderComplete}
              />
            </div>
          </div>

          <p className="text-zinc-600 text-xs text-center">Do not close this tab while rendering.</p>
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="p-6 rounded-2xl bg-green-500/10 border border-green-500/30 text-center">
            <div className="text-3xl mb-3">✓</div>
            <p className="font-black text-lg text-green-400 mb-2">Both videos ready!</p>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Move the downloaded files to <code className="text-amber-400 bg-zinc-900 px-1.5 py-0.5 rounded">public/videos/</code> and refresh your landing page.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Next steps</p>
            {[
              "hero-preview.mp4 → public/videos/hero-preview.mp4",
              "hero-preview-raw.mp4 → public/videos/hero-preview-raw.mp4",
              "Open /v2 and test the before/after slider",
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-amber-500 font-black text-xs shrink-0">{i + 1}.</span>
                <p className="text-zinc-400 text-xs">{s}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              setPhase("idle");
              setGpxReady(false);
              setVideoReady(false);
              setActivityPoints([]);
              setHighlights([]);
              setStoryPlan(null);
              setVideoFile(null);
              lensCompleted.current  = false;
              cleanCompleted.current = false;
            }}
            className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-400 text-sm font-black uppercase tracking-widest hover:border-zinc-500 transition-colors"
          >
            Render Another
          </button>
        </div>
      )}
    </main>
  );
}
