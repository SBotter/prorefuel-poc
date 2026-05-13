"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import type { ActionSegment } from "@/lib/engine/TelemetryCrossRef";
import type { StoryPlan } from "@/lib/engine/StorytellingProcessor";
import type { RenderResult } from "@/components/MapEngine";

// MapEngine uses Mapbox + browser APIs — must be client-only
const MapEngine = dynamic(
  () => import("@/components/MapEngine").then((m) => m.default ?? m),
  { ssr: false },
);

type Pass = "lens" | "raw";
type Step =
  | "idle"
  | "gpx_ok"
  | "processing"
  | "ready"
  | "recording_lens"
  | "transcoding_lens"
  | "recording_raw"
  | "transcoding_raw"
  | "done";

export default function RenderEnginePage() {
  const [step, setStep]         = useState<Step>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [unit, setUnit]         = useState<"metric" | "imperial">("metric");
  const [pass, setPass]         = useState<Pass>("lens");

  const activityPointsRef = useRef<any[]>([]);
  const highlightsRef     = useRef<ActionSegment[]>([]);
  const storyPlanRef      = useRef<StoryPlan | null>(null);
  const videoFileRef      = useRef<File | null>(null);
  const gpxNameRef        = useRef("");

  // ── Step 1: GPX ──────────────────────────────────────────────────────────────
  const handleGPX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const text = await file.text();
    const xml  = new DOMParser().parseFromString(text, "text/xml");
    const pts = Array.from(xml.querySelectorAll("trkpt")).map((pt) => {
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

      return {
        lat, lon, ele, time,
        ...(hr    !== undefined && { hr }),
        ...(cad   !== undefined && { cad }),
        ...(power !== undefined && { power }),
        ...(speed !== undefined && { speed }),
      };
    }).filter((p) => isFinite(p.time));

    if (pts.length === 0) { setError("No GPS track found in this GPX file."); return; }

    activityPointsRef.current = pts;
    gpxNameRef.current = file.name;
    setStep("gpx_ok");
  };

  // ── Step 2: Video + full engine pipeline ─────────────────────────────────────
  const handleVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setStep("processing");
    setStatusMsg("Analysing GPMF telemetry…");

    try {
      const [
        { GoProEngineClient },
        { TelemetryCrossRef },
        { StorytellingProcessor },
      ] = await Promise.all([
        import("@/lib/media/GoProEngineClient"),
        import("@/lib/engine/TelemetryCrossRef"),
        import("@/lib/engine/StorytellingProcessor"),
      ]);

      const result = await GoProEngineClient.extractTelemetry(file);
      if (result.points.length === 0) {
        setError("No GPS data found in this video."); setStep("gpx_ok"); return;
      }

      setStatusMsg("Detecting highlights…");
      const highlights = TelemetryCrossRef.findHighlights(
        activityPointsRef.current,
        result.points as any,
        unit, 0, result.gpsVideoOffsetMs,
      );
      if (!highlights?.length) {
        setError("No highlight scenes detected. Try a more varied activity."); setStep("gpx_ok"); return;
      }

      setStatusMsg("Building story plan…");
      const videoDurationSec = result.points.length > 1
        ? result.gpsVideoOffsetMs / 1000 + (result.points[result.points.length - 1].time - result.points[0].time) / 1000
        : 0;

      const sp = StorytellingProcessor.generatePlan(
        activityPointsRef.current, result.points as any,
        unit, 0, result.gpsVideoOffsetMs, videoDurationSec,
      );

      highlightsRef.current = highlights;
      storyPlanRef.current  = sp;
      videoFileRef.current  = file;

      setStep("ready");
      setStatusMsg("");
    } catch (err: any) {
      setError(err.message ?? "Processing failed."); setStep("gpx_ok");
    }
  };

  // ── Render complete handlers ──────────────────────────────────────────────────
  const handleLensComplete = (result: RenderResult) => {
    if (result.status === "error") {
      setError(`LENS render failed: ${result.errorMessage ?? "unknown"}`);
      setStep("ready");
      return;
    }
    // LENS MP4 downloaded by MapEngine — now start RAW pass
    setPass("raw");
    setStep("recording_raw");
  };

  const handleRawComplete = (result: RenderResult) => {
    if (result.status === "error") {
      setError(`RAW render failed: ${result.errorMessage ?? "unknown"}`);
    }
    setStep("done");
  };

  // ── UI helpers ────────────────────────────────────────────────────────────────
  const isRendering = step === "recording_lens" || step === "transcoding_lens"
                   || step === "recording_raw"  || step === "transcoding_raw";

  const passLabel: Record<Pass, string> = {
    lens: "Pass 1 of 2 — LENS Edit (with telemetry)",
    raw:  "Pass 2 of 2 — RAW Cut (no overlay)",
  };

  // ── MapEngine rendering passes (shown full-screen) ────────────────────────────
  if (step === "recording_lens" || step === "recording_raw") {
    const isRaw = step === "recording_raw";
    return (
      <div className="fixed inset-0 bg-[#050505] z-50">
        {/* Pass label */}
        <div className="absolute top-4 left-0 right-0 z-10 flex justify-center">
          <div className="px-4 py-2 rounded-full bg-black/70 border border-zinc-700 text-[11px] font-black uppercase tracking-widest text-zinc-300">
            {passLabel[isRaw ? "raw" : "lens"]}
          </div>
        </div>

        {/* 9:16 container centered */}
        <div className="w-full h-full flex items-center justify-center">
          <div className="aspect-[9/16] h-full max-h-screen max-w-[calc(100vh*9/16)] relative overflow-hidden">
            <MapEngine
              key={step}
              activityPoints={activityPointsRef.current}
              highlights={highlightsRef.current}
              storyPlan={storyPlanRef.current}
              videoFile={videoFileRef.current}
              unit={unit}
              autoRecord={true}
              skipIntroAndBrand={true}
              hideOverlay={isRaw}
              onRenderComplete={isRaw ? handleRawComplete : handleLensComplete}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Main tool UI ──────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans flex flex-col items-center justify-center px-6 py-16">

      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-500/60 mb-2">Internal Tool</p>
        <h1 className="text-4xl font-black tracking-tight mb-2">Before / After Engine</h1>
        <p className="text-zinc-500 text-sm max-w-sm leading-relaxed">
          Generates two MP4 files using the full LENS engine — one with telemetry overlay, one raw.
          No intro. No branding. Both start at the same highlight.
        </p>
      </div>

      <div className="w-full max-w-md space-y-4">

        {/* Unit toggle */}
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

        {/* Step 1 — GPX */}
        <label className={`flex items-center gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${
          step === "idle" ? "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10" : "border-green-500 bg-green-500/8"
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-lg ${
            step === "idle" ? "bg-amber-500 text-black" : "bg-green-500 text-black"
          }`}>{step === "idle" ? "1" : "✓"}</div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">Step 1</p>
            <p className="font-black text-white">Import GPX</p>
            {gpxNameRef.current && <p className="text-[11px] text-green-400 mt-0.5">{gpxNameRef.current}</p>}
          </div>
          <input type="file" accept=".gpx" onChange={handleGPX} className="hidden" />
        </label>

        {/* Step 2 — Video */}
        <label className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all ${
          step === "idle"
            ? "border-zinc-800 bg-zinc-900/40 opacity-50 cursor-not-allowed"
            : step === "gpx_ok"
            ? "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer"
            : step === "processing"
            ? "border-zinc-700 bg-zinc-900/40 cursor-wait"
            : "border-green-500 bg-green-500/8 cursor-pointer"
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-lg ${
            step === "idle"       ? "bg-zinc-800 text-zinc-600"  :
            step === "gpx_ok"    ? "bg-amber-500 text-black"    :
            step === "processing" ? "bg-zinc-700 text-zinc-400" :
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
            {step === "processing" && <p className="text-[11px] text-amber-400 mt-0.5 animate-pulse">{statusMsg}</p>}
            {videoFileRef.current && step !== "processing" && (
              <p className="text-[11px] text-green-400 mt-0.5 truncate">{videoFileRef.current.name}</p>
            )}
          </div>
          <input type="file" accept=".mp4,.mov" disabled={step === "idle" || step === "processing"} onChange={handleVideo} className="hidden" />
        </label>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Done state */}
        {step === "done" && (
          <div className="p-5 rounded-2xl bg-green-500/10 border border-green-500/30 text-center">
            <p className="text-green-400 font-black text-lg mb-1">Both videos downloaded!</p>
            <p className="text-zinc-500 text-xs">LENS_edit_….mp4 + LENS_video_….mp4</p>
            <button
              onClick={() => { setStep("ready"); setError(null); setPass("lens"); }}
              className="mt-3 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-black uppercase tracking-widest hover:bg-zinc-700 transition-colors"
            >
              Render Again
            </button>
          </div>
        )}

        {/* Generate button */}
        {step !== "done" && (
          <button
            disabled={step !== "ready"}
            onClick={() => { setPass("lens"); setStep("recording_lens"); }}
            className={`w-full py-5 rounded-2xl font-black uppercase tracking-[0.3em] text-sm transition-all flex items-center justify-center gap-3 ${
              step === "ready"
                ? "bg-amber-500 text-black shadow-[0_10px_30px_rgba(245,158,11,0.3)] hover:scale-[1.02] active:scale-[0.98]"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            }`}
          >
            Generate Before / After
          </button>
        )}

        {/* Info grid */}
        {step === "ready" && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Pass 1",   value: "LENS Edit (telemetry)" },
              { label: "Pass 2",   value: "RAW Cut (no overlay)" },
              { label: "Format",   value: "MP4 · H264" },
              { label: "Intro / Brand", value: "Skipped" },
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
        <a href="/" className="hover:text-amber-400 transition-colors">← Back to LENS</a>
        <span>·</span>
        <span>Internal Tool · Not Public</span>
      </div>
    </main>
  );
}
