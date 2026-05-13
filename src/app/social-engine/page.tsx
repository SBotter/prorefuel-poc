"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import type { ActionSegment } from "@/lib/engine/TelemetryCrossRef";
import type { StoryPlan } from "@/lib/engine/StorytellingProcessor";
import type { RenderResult } from "@/components/MapEngine";

const SocialRenderer = dynamic(
  () => import("@/components/RenderEngine/SocialRenderer").then((m) => m.SocialRenderer),
  { ssr: false },
);
const MapEngine = dynamic(
  () => import("@/components/MapEngine").then((m) => m.default ?? m),
  { ssr: false },
);

type Step =
  | "idle" | "gpx_ok" | "processing" | "ready"
  | "capturing_after"   // MapEngine records action clip, blob intercepted (no download)
  | "rendering_social"  // SocialRenderer builds the full 30s social video
  | "done";

export default function SocialEnginePage() {
  const [step, setStep]   = useState<Step>("idle");
  const [status, setStatus] = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [unit, setUnit]     = useState<"metric" | "imperial">("metric");

  const activityPointsRef = useRef<any[]>([]);
  const highlightsRef     = useRef<ActionSegment[]>([]);
  const storyPlanRef      = useRef<StoryPlan | null>(null);
  const videoFileRef      = useRef<File | null>(null);
  const afterBlobRef      = useRef<Blob | null>(null);
  const gpxNameRef        = useRef("");

  // ── GPX ──────────────────────────────────────────────────────────────────────
  const handleGPX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const text = await file.text();
    const xml  = new DOMParser().parseFromString(text, "text/xml");
    const pts  = Array.from(xml.querySelectorAll("trkpt")).map((pt) => {
      const lat  = parseFloat(pt.getAttribute("lat") || "0");
      const lon  = parseFloat(pt.getAttribute("lon") || "0");
      const ele  = parseFloat(pt.querySelector("ele")?.textContent || "0");
      const time = new Date(pt.querySelector("time")?.textContent || "").getTime();
      const hrEl    = pt.querySelector("hr");
      const cadEl   = pt.querySelector("cad");
      const powerEl = pt.querySelector("power") ?? pt.querySelector("watts");
      const speedEl = pt.querySelector("speed");
      const hr    = hrEl    ? parseFloat(hrEl.textContent    || "0") || undefined : undefined;
      const cad   = cadEl   ? parseFloat(cadEl.textContent   || "0") || undefined : undefined;
      const power = powerEl ? parseFloat(powerEl.textContent || "0") || undefined : undefined;
      const speed = speedEl ? parseFloat(speedEl.textContent || "0") * 3.6 || undefined : undefined;
      return { lat, lon, ele, time, ...(hr !== undefined && { hr }), ...(cad !== undefined && { cad }), ...(power !== undefined && { power }), ...(speed !== undefined && { speed }) };
    }).filter((p) => isFinite(p.time));
    if (pts.length === 0) { setError("No GPS track found."); return; }
    activityPointsRef.current = pts;
    gpxNameRef.current = file.name;
    setStep("gpx_ok");
  };

  // ── Video + full pipeline ─────────────────────────────────────────────────────
  const handleVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setStep("processing");
    setStatus("Analysing GPMF telemetry…");
    try {
      const [{ GoProEngineClient }, { TelemetryCrossRef }, { StorytellingProcessor }] = await Promise.all([
        import("@/lib/media/GoProEngineClient"),
        import("@/lib/engine/TelemetryCrossRef"),
        import("@/lib/engine/StorytellingProcessor"),
      ]);
      const result = await GoProEngineClient.extractTelemetry(file);
      if (result.points.length === 0) { setError("No GPS data in this video."); setStep("gpx_ok"); return; }

      setStatus("Detecting highlights…");
      const highlights = TelemetryCrossRef.findHighlights(
        activityPointsRef.current, result.points as any, unit, 0, result.gpsVideoOffsetMs,
      );
      if (!highlights?.length) { setError("No highlights detected."); setStep("gpx_ok"); return; }

      setStatus("Building story plan…");
      const videoDurationSec = result.points.length > 1
        ? result.gpsVideoOffsetMs / 1000 + (result.points[result.points.length - 1].time - result.points[0].time) / 1000
        : 0;
      const sp = StorytellingProcessor.generatePlan(
        activityPointsRef.current, result.points as any, unit, 0, result.gpsVideoOffsetMs, videoDurationSec,
      );

      // Keep original GPX activityPoints — highlights' startIndex/endIndex point into this array.
      // Replacing with video points would cause out-of-bounds access in MapEngine.
      highlightsRef.current = highlights;
      storyPlanRef.current  = sp;
      videoFileRef.current  = file;
      setStep("ready"); setStatus("");
    } catch (err: any) {
      setError(err.message ?? "Processing failed."); setStep("gpx_ok");
    }
  };

  // ── Blob intercepted from MapEngine (no download) ─────────────────────────────
  const handleAfterBlob = (blob: Blob, _filename: string) => {
    afterBlobRef.current = blob;
    setStep("rendering_social");
  };

  // ── Phase: MapEngine captures the action clip ─────────────────────────────────
  if (step === "capturing_after") {
    return (
      <div className="fixed inset-0 bg-[#050505] z-50">
        {/* Status overlay */}
        <div className="absolute top-0 left-0 right-0 z-10 flex flex-col items-center pt-5 gap-2">
          <div className="px-4 py-2 rounded-full bg-black/80 border border-amber-500/40 text-[11px] font-black uppercase tracking-widest text-amber-400">
            Step 1 of 2 — Capturing AFTER Segment
          </div>
          <p className="text-zinc-600 text-[10px] uppercase tracking-widest">
            Recording real telemetry overlay · no download
          </p>
        </div>

        {/* MapEngine in 9:16 container */}
        <div className="w-full h-full flex items-center justify-center">
          <div className="aspect-[9/16] h-full max-h-screen max-w-[calc(100vh*9/16)] relative overflow-hidden">
            <MapEngine
              key="social-after"
              activityPoints={activityPointsRef.current}
              highlights={highlightsRef.current}
              storyPlan={storyPlanRef.current}
              videoFile={videoFileRef.current}
              unit={unit}
              autoRecord={true}
              skipIntroAndBrand={true}
              onDownloadReady={handleAfterBlob}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Phase: SocialRenderer builds the full social video ───────────────────────
  if (step === "rendering_social") {
    return (
      <SocialRenderer
        activityPoints={activityPointsRef.current}
        highlights={highlightsRef.current}
        videoFile={videoFileRef.current}
        unit={unit}
        afterBlob={afterBlobRef.current ?? undefined}
        onComplete={() => setStep("done")}
        onCancel={() => setStep("ready")}
      />
    );
  }

  // ── Main tool UI ──────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans flex flex-col items-center justify-center px-6 py-16">

      <div className="mb-10 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-500/60 mb-2">Internal Tool</p>
        <h1 className="text-4xl font-black tracking-tight mb-2">Social Media Engine</h1>
        <p className="text-zinc-500 text-sm max-w-sm leading-relaxed">
          30-second MP4 with real telemetry overlay — before/after storytelling ready for Reels, TikTok, Shorts.
        </p>
      </div>

      {/* Timeline preview */}
      <div className="mb-8 flex gap-1 items-end max-w-md w-full overflow-x-auto pb-2">
        {[
          { label: "HOOK",   s: 3.5, color: "#ef4444" },
          { label: "BEFORE", s: 8,   color: "#71717a" },
          { label: "SLAM",   s: 1.5, color: "#f59e0b" },
          { label: "AFTER",  s: 9,   color: "#f59e0b", note: "real engine" },
          { label: "SPLIT",  s: 4.5, color: "#8b5cf6" },
          { label: "OUTRO",  s: 3.5, color: "#ffffff" },
        ].map(({ label, s, color, note }) => (
          <div key={label} className="flex flex-col items-center gap-1" style={{ flex: s }}>
            <div className="w-full h-2 rounded-full" style={{ background: color, opacity: 0.7 }} />
            <span className="text-[9px] font-black uppercase tracking-wider whitespace-nowrap" style={{ color }}>{label}</span>
            {note && <span className="text-[8px] text-amber-500/60 whitespace-nowrap">{note}</span>}
          </div>
        ))}
      </div>

      <div className="w-full max-w-md space-y-4">
        {/* Unit */}
        <div className="flex p-1 bg-zinc-900 rounded-xl border border-zinc-800">
          <button onClick={() => setUnit("metric")}
            className={`flex-1 py-2 rounded-lg text-[11px] font-black tracking-widest transition-all ${unit === "metric" ? "bg-amber-500 text-black" : "text-zinc-500"}`}>
            METRIC
          </button>
          <button onClick={() => setUnit("imperial")}
            className={`flex-1 py-2 rounded-lg text-[11px] font-black tracking-widest transition-all ${unit === "imperial" ? "bg-amber-500 text-black" : "text-zinc-500"}`}>
            IMPERIAL
          </button>
        </div>

        {/* GPX */}
        <label className={`flex items-center gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${
          step === "idle" ? "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10" : "border-green-500 bg-green-500/8"
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-lg ${step === "idle" ? "bg-amber-500 text-black" : "bg-green-500 text-black"}`}>
            {step === "idle" ? "1" : "✓"}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">Step 1</p>
            <p className="font-black text-white">Import GPX</p>
            {gpxNameRef.current && <p className="text-[11px] text-green-400 mt-0.5">{gpxNameRef.current}</p>}
          </div>
          <input type="file" accept=".gpx" onChange={handleGPX} className="hidden" />
        </label>

        {/* Video */}
        <label className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all ${
          step === "idle"        ? "border-zinc-800 bg-zinc-900/40 opacity-50 cursor-not-allowed" :
          step === "gpx_ok"     ? "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer" :
          step === "processing"  ? "border-zinc-700 bg-zinc-900/40 cursor-wait" :
          "border-green-500 bg-green-500/8 cursor-pointer"
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-lg ${
            step === "idle"        ? "bg-zinc-800 text-zinc-600"  :
            step === "gpx_ok"     ? "bg-amber-500 text-black"    :
            step === "processing"  ? "bg-zinc-700 text-zinc-400" :
            "bg-green-500 text-black"
          }`}>
            {step === "processing" ? (
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : step === "ready" || step === "done" ? "✓" : "2"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">Step 2</p>
            <p className={`font-black ${step === "idle" ? "text-zinc-600" : "text-white"}`}>Import GoPro Video</p>
            {step === "processing" && <p className="text-[11px] text-amber-400 mt-0.5 animate-pulse">{status}</p>}
            {videoFileRef.current && step !== "processing" && (
              <p className="text-[11px] text-green-400 mt-0.5 truncate">{videoFileRef.current.name}</p>
            )}
          </div>
          <input type="file" accept=".mp4,.mov" disabled={step === "idle" || step === "processing"} onChange={handleVideo} className="hidden" />
        </label>

        {error && <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}

        {step === "done" && (
          <div className="p-5 rounded-2xl bg-green-500/10 border border-green-500/30 text-center">
            <p className="text-green-400 font-black text-lg mb-1">Social video downloaded!</p>
            <p className="text-zinc-500 text-xs">LENS_social_….mp4 · 30s · 9:16 · Real telemetry</p>
            <button onClick={() => { setStep("ready"); setError(null); afterBlobRef.current = null; }}
              className="mt-3 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-black uppercase tracking-widest hover:bg-zinc-700 transition-colors">
              Render Again
            </button>
          </div>
        )}

        {step !== "done" && (
          <button disabled={step !== "ready"}
            onClick={() => setStep("capturing_after")}
            className={`w-full py-5 rounded-2xl font-black uppercase tracking-[0.3em] text-sm transition-all flex flex-col items-center justify-center gap-1 ${
              step === "ready"
                ? "bg-amber-500 text-black shadow-[0_10px_30px_rgba(245,158,11,0.3)] hover:scale-[1.02] active:scale-[0.98]"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            }`}>
            <span>Generate Social Video</span>
            {step === "ready" && <span className="text-[10px] font-bold opacity-70 normal-case tracking-normal">2 passes · real telemetry · ~3 min</span>}
          </button>
        )}

        {step === "ready" && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Pass 1", value: "Capture AFTER clip" },
              { label: "Pass 2", value: "Build social video" },
              { label: "Telemetry", value: "Real engine output" },
              { label: "Output", value: "MP4 · 1080×1920" },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">{label}</p>
                <p className="text-xs font-black text-white">{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-12 flex items-center gap-6 text-[11px] font-black uppercase tracking-widest text-zinc-700">
        <a href="/render-engine" className="hover:text-amber-400 transition-colors">Before/After Tool</a>
        <span>·</span>
        <a href="/" className="hover:text-amber-400 transition-colors">← LENS</a>
      </div>
    </main>
  );
}
