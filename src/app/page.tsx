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
  ChevronRight,
  Lock,
  PlayCircle,
} from "lucide-react";
import MapEngine from "@/components/MapEngine";
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
  const [unit, setUnit] = useState<UnitSystem>("metric");
  const mapEngineRef = useRef<{
    start: () => void;
    startRecording: () => Promise<void>;
    isRecording: boolean;
  }>(null);

  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <div className="min-h-screen bg-[#050505]" />;

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setUploadError(null);
    setVideoFile(file);
    setProgress(0);
    const interval = setInterval(
      () => setProgress((p) => (p >= 98 ? 98 : p + 1)),
      150,
    );
    try {
      setStatusMsg("Analysing GPMF...");
      const {
        points: vpts,
        syncPoints,
        gpsVideoOffsetMs,
      } = await GoProEngineClient.extractTelemetry(file);

      // ── Analyse video GPS structure ──────────────────────────────────────
      const videoProfile = VideoGPSAnalyzer.analyze(vpts, gpsVideoOffsetMs);

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
        throw new Error("No GPS signal found in video.");

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
      setTimeout(() => {
        setHighlights(segments);
        setStep("READY");
        setLoading(false);
      }, 500);
    } catch (e: any) {
      clearInterval(interval);
      setUploadError(e.message);
      setLoading(false);
    }
  };

  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();

    // Deep structural analysis — runs before point extraction
    const profile = GPXAnalyzer.analyze(text);
    setGpxProfile(profile);

    const xml = new DOMParser().parseFromString(text, "text/xml");
    const pts = Array.from(xml.querySelectorAll("trkpt")).map(
      (pt: Element) => ({
        lat: parseFloat(pt.getAttribute("lat") || "0"),
        lon: parseFloat(pt.getAttribute("lon") || "0"),
        ele: parseFloat(pt.querySelector("ele")?.textContent || "0"),
        time: new Date(pt.querySelector("time")?.textContent || "").getTime(),
      }),
    );
    setActivityPoints(pts);
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans selection:bg-amber-500/40 overflow-x-hidden">
      {/* BACKGROUND EFFECTS */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-amber-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="flex min-h-screen flex-col lg:flex-row max-w-[1600px] mx-auto relative z-10">
        {/* LEFT SECTION: THE SHOWCASE */}
        <section className="w-full lg:w-3/5 flex flex-col items-center justify-center p-8 lg:p-16">
          <div className="max-w-2xl w-full text-center lg:text-left flex flex-col items-center lg:items-start">
            <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-zinc-900 border border-amber-500/30 mb-8 shadow-xl">
              <Zap
                size={16}
                className="text-amber-500 fill-amber-500 animate-pulse"
              />
              <span className="text-xs font-black uppercase tracking-[0.2em] text-zinc-100">
                ProRefuel | Lens v1.0
              </span>
            </div>

            <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-[0.9] mb-8">
              CREATE YOUR STORY IN <br />
              <span className="text-amber-500 drop-shadow-[0_0_30px_rgba(245,158,11,0.3)]">
                3 CLICKS.
              </span>
            </h1>

            <p className="text-zinc-400 text-xl font-medium max-w-lg mb-12 leading-relaxed">
              Transform raw GoPro files into{" "}
              <span className="text-white border-b-2 border-amber-500">
                Cinematic 3D Edits
              </span>
              . No cloud. No wait. 100% Local.
            </p>

            {/* THE SIMULATOR (ENHANCED) */}
            <div className="relative group">
              <div className="absolute -inset-4 bg-amber-500/20 rounded-[4rem] blur-3xl opacity-40 group-hover:opacity-100 transition duration-700"></div>

              <div className="relative w-[320px] md:w-[420px] aspect-[9/17] bg-[#0c0c0c] rounded-[3.8rem] border-[12px] border-zinc-800 shadow-[0_0_80px_rgba(0,0,0,0.9)] p-1 overflow-hidden ring-1 ring-white/10 transition-transform duration-500 group-hover:scale-[1.01]">
                {/* iPhone Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-zinc-800 rounded-b-2xl z-30" />

                {/* Video Content */}
                <div className="w-full h-full rounded-[2.8rem] overflow-hidden bg-black relative">
                  <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  >
                    <source src="/videos/hero-preview.mp4" type="video/mp4" />
                  </video>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                </div>
              </div>

              {/* Floating Success Badge */}
              <div className="absolute -right-10 bottom-20 bg-zinc-900 border border-zinc-700 p-4 rounded-2xl shadow-2xl animate-bounce-slow hidden md:block">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.4)]">
                    <CheckCircle2 size={20} className="text-black" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Status
                    </p>
                    <p className="text-sm font-black text-white">
                      READY TO POST
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT SECTION: THE ENGINE CARD */}
        <section className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-[480px]">
            {/* Header */}
            <div className="flex flex-col items-center lg:items-start mb-10">
              <img
                src="/prorefuel_logo.png"
                alt="ProRefuel"
                className="w-56 mb-6 drop-shadow-2xl"
              />
              <h2 className="text-4xl font-black italic tracking-tighter uppercase text-white">
                LENS <span className="text-amber-500">ENGINE</span>
              </h2>
              <p className="text-zinc-500 font-bold mt-2 tracking-widest uppercase text-[10px]">
                Professional Telemetry Visualizer
              </p>
            </div>

            {/* THE UPLOAD CARD (HIGH CONTRAST) */}
            <div className="bg-[#111111] rounded-[3.5rem] border-2 border-zinc-800 p-8 md:p-10 shadow-2xl relative ring-1 ring-white/5">
              {step !== "EXPERIENCE" ? (
                <div className="space-y-6 relative z-10">
                  {/* Unit Selector (High Contrast) */}
                  <div className="flex p-1.5 bg-black rounded-2xl border border-zinc-800 shadow-inner">
                    <button
                      onClick={() => setUnit("metric")}
                      className={`flex-1 py-3 rounded-xl text-[11px] font-black tracking-widest transition-all ${unit === "metric" ? "bg-amber-500 text-black shadow-[0_5px_15px_rgba(245,158,11,0.3)]" : "text-zinc-500 hover:text-white"}`}
                    >
                      METRIC
                    </button>
                    <button
                      onClick={() => setUnit("imperial")}
                      className={`flex-1 py-3 rounded-xl text-[11px] font-black tracking-widest transition-all ${unit === "imperial" ? "bg-amber-500 text-black shadow-[0_5px_15px_rgba(245,158,11,0.3)]" : "text-zinc-500 hover:text-white"}`}
                    >
                      IMPERIAL
                    </button>
                  </div>

                  {/* STEP 01: GPX (The Hook) */}
                  <label
                    className={`group flex items-center gap-6 p-7 rounded-3xl border-2 transition-all cursor-pointer shadow-lg ${
                      activityPoints.length > 0
                        ? "border-green-500 bg-green-500/10"
                        : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 animate-glow-pulse"
                    }`}
                  >
                    <div
                      className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${activityPoints.length > 0 ? "bg-green-500 text-black" : "bg-amber-500 text-black shadow-xl"}`}
                    >
                      {activityPoints.length > 0 ? (
                        <CheckCircle2 size={32} />
                      ) : (
                        <Gauge size={32} />
                      )}
                    </div>
                    <div className="flex-1">
                      <span
                        className={`block text-[11px] font-black uppercase tracking-widest mb-1 ${activityPoints.length > 0 ? "text-green-500" : "text-amber-500"}`}
                      >
                        Step 01
                      </span>
                      <p className="text-lg font-black uppercase text-white leading-none">
                        Import GPX
                      </p>
                      <p className="text-[11px] text-zinc-400 font-bold mt-2">
                        Garmin / Strava / Wahoo
                      </p>
                    </div>
                    <input
                      type="file"
                      accept=".gpx"
                      onChange={handleGPXUpload}
                      className="hidden"
                    />
                  </label>

                  {/* STEP 02: MP4 (The Action) */}
                  <label
                    className={`group flex items-center gap-6 p-7 rounded-3xl border-2 transition-all cursor-pointer shadow-lg ${
                      uploadError
                        ? "border-red-500 bg-red-500/10"
                        : highlights.length > 0
                          ? "border-green-500 bg-green-500/10"
                          : activityPoints.length === 0
                            ? "border-zinc-800 bg-zinc-900/50 cursor-not-allowed"
                            : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10"
                    }`}
                  >
                    <div
                      className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${highlights.length > 0 ? "bg-green-500 text-black" : activityPoints.length === 0 ? "bg-zinc-800 text-zinc-600" : "bg-amber-500 text-black shadow-xl"}`}
                    >
                      {loading ? (
                        <Loader2 className="animate-spin" size={32} />
                      ) : highlights.length > 0 ? (
                        <CheckCircle2 size={32} />
                      ) : (
                        <Upload size={32} />
                      )}
                    </div>
                    <div className="flex-1">
                      <span
                        className={`block text-[11px] font-black uppercase tracking-widest mb-1 ${activityPoints.length === 0 ? "text-zinc-600" : "text-amber-500"}`}
                      >
                        Step 02
                      </span>
                      <p
                        className={`text-lg font-black uppercase leading-none ${activityPoints.length === 0 ? "text-zinc-600" : "text-white"}`}
                      >
                        Import MP4
                      </p>
                      <p className="text-[11px] text-zinc-400 font-bold mt-2">
                        {loading
                          ? statusMsg
                          : activityPoints.length === 0
                            ? "Lock: Load GPX first"
                            : "Raw GoPro Video"}
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="video/mp4"
                      disabled={activityPoints.length === 0}
                      onChange={handleVideoUpload}
                      className="hidden"
                    />
                    {activityPoints.length === 0 && (
                      <Lock size={18} className="text-zinc-800" />
                    )}
                  </label>

                  {/* CTA BUTTON */}
                  <div className="pt-4">
                    <button
                      onClick={() => setStep("EXPERIENCE")}
                      disabled={!highlights.length}
                      className={`w-full py-8 rounded-3xl font-black uppercase tracking-[0.4em] text-xs transition-all flex items-center justify-center gap-4 ${
                        highlights.length
                          ? "bg-amber-500 text-black shadow-[0_20px_50px_rgba(245,158,11,0.4)] hover:scale-[1.02] active:scale-95"
                          : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                      }`}
                    >
                      <Zap
                        size={22}
                        fill={highlights.length ? "black" : "none"}
                      />{" "}
                      Generate & Download
                    </button>
                  </div>

                  {/* Trust Footer */}
                  <div className="flex justify-center gap-8 pt-10 border-t border-zinc-800">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <Shield size={14} />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Private
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-500">
                      <Smartphone size={14} />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        WASM Power
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-500">
                      <PlayCircle size={14} />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Insta Ready
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Engine Viewport */
                <div className="aspect-[9/16] w-full rounded-[3rem] overflow-hidden bg-black relative shadow-2xl ring-2 ring-amber-500/20">
                  <MapEngine
                    ref={mapEngineRef}
                    activityPoints={activityPoints}
                    highlights={highlights}
                    storyPlan={storyPlan}
                    videoFile={videoFile}
                    autoRecord={true}
                    unit={unit}
                  />
                </div>
              )}
            </div>

            {/* The Final Punchline */}
            <p className="mt-12 text-center text-[12px] text-white uppercase font-black tracking-[0.8em] opacity-80">
              PROREFUEL.APP
            </p>
            <p className="text-center text-[9px] text-zinc-600 uppercase font-bold tracking-[0.3em] mt-2">
              Elevate your performance.
            </p>
          </div>
        </section>
      </div>

      <style jsx global>{`
        @keyframes glow-pulse {
          0%,
          100% {
            border-color: rgba(245, 158, 11, 0.4);
          }
          50% {
            border-color: rgba(245, 158, 11, 1);
          }
        }
        .animate-glow-pulse {
          animation: glow-pulse 2s infinite;
        }
        @keyframes bounce-slow {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        .animate-bounce-slow {
          animation: bounce-slow 4s ease-in-out infinite;
        }
      `}</style>
    </main>
  );
}
