"use client";
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { EnhancedGPSPoint, ActionSegment } from "@/lib/engine/TelemetryCrossRef";
import { FrameCompositor } from "@/lib/engine/FrameCompositor";
import { getToneOutputStream, stopAll, disconnectToneOutputStream } from "@/lib/audio/AudioEngine";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const W = 1080;
const H = 1920;
const FPS = 30;
const DURATION_S = 12;
const TOTAL_FRAMES = FPS * DURATION_S;

export interface CanvasRendererProps {
  activityPoints: EnhancedGPSPoint[];
  highlights: ActionSegment[];
  videoFile: File | null;
  onComplete: (videoBlobUrl: string) => void;
  onCancel: () => void;
  /** When true: renders two synchronized videos — RAW (no overlay) + LENS (with telemetry).
   *  No intro, no branding. Both start at the exact same video timestamp. */
  beforeAfterMode?: boolean;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function timestamp() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, "0")}${String(n.getDate()).padStart(2, "0")}` +
    `${String(n.getHours()).padStart(2, "0")}${String(n.getMinutes()).padStart(2, "0")}${String(n.getSeconds()).padStart(2, "0")}`;
}

function buildRecorder(canvas: HTMLCanvasElement, audioTracks: MediaStreamTrack[]): MediaRecorder {
  const videoStream = canvas.captureStream(FPS);
  const combined = audioTracks.length > 0
    ? new MediaStream([...videoStream.getVideoTracks(), ...audioTracks])
    : videoStream;

  const mimeTypes = ["video/webm;codecs=vp8,opus", "video/webm"];
  for (const mime of mimeTypes) {
    try { return new MediaRecorder(combined, { mimeType: mime }); } catch { /* try next */ }
  }
  return new MediaRecorder(videoStream);
}

export function CanvasRenderer({
  activityPoints, highlights, videoFile,
  onComplete, onCancel,
  beforeAfterMode = false,
}: CanvasRendererProps) {
  const lensCanvasRef = useRef<HTMLCanvasElement>(null);
  const rawCanvasRef  = useRef<HTMLCanvasElement>(null);
  const hiddenMapContainer = useRef<HTMLDivElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string | null>(null);

  const [status, setStatus]   = useState("Initializing…");
  const [progress, setProgress] = useState(0);

  // Create stable video object URL
  useEffect(() => {
    if (videoFile && !videoUrlRef.current) {
      videoUrlRef.current = URL.createObjectURL(videoFile);
    }
    return () => {
      if (videoUrlRef.current) { URL.revokeObjectURL(videoUrlRef.current); videoUrlRef.current = null; }
    };
  }, [videoFile]);

  useEffect(() => {
    if (!hiddenMapContainer.current || !lensCanvasRef.current || !activityPoints.length) return;

    const map = new mapboxgl.Map({
      container: hiddenMapContainer.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      preserveDrawingBuffer: true,
      interactive: false,
      center: [activityPoints[0].lon, activityPoints[0].lat],
      zoom: 15,
      pitch: 60,
      bearing: 0,
      attributionControl: false,
    });

    const rafRef = { current: 0 };
    const lensChunks: Blob[] = [];
    const rawChunks: Blob[]  = [];
    let completedRecorders = 0;
    const ts = timestamp();

    map.on("load", () => {
      setStatus("Rendering route on map…");

      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: activityPoints.map(p => [p.lon, p.lat]) },
          properties: {},
        },
      });
      map.addLayer({
        id: "route-line", type: "line", source: "route",
        paint: { "line-color": "#f59e0b", "line-width": 4, "line-opacity": 0.9 },
      });

      setTimeout(async () => {
        const lensCanvas = lensCanvasRef.current!;
        const rawCanvas  = rawCanvasRef.current;
        const lensCtx = lensCanvas.getContext("2d")!;
        const rawCtx  = beforeAfterMode ? rawCanvas?.getContext("2d") ?? null : null;
        const mapCanvas = hiddenMapContainer.current!.querySelector("canvas") as HTMLCanvasElement;
        const videoEl = hiddenVideoRef.current;

        if (!lensCtx || !mapCanvas) return;

        // Fly along route for visual interest
        map.flyTo({
          center: [activityPoints[Math.floor(activityPoints.length / 2)].lon, activityPoints[Math.floor(activityPoints.length / 2)].lat],
          zoom: 17, pitch: 65, bearing: 140, duration: 8000, essential: true,
        });

        // Seek both recorders to the same start frame
        const videoStart = highlights[0]?.videoStartTime ?? 0;
        if (videoEl) {
          videoEl.currentTime = videoStart;
          await videoEl.play().catch(() => {});
        }

        // Audio: only in standard mode (intro sound). Before/after = silent for clean comparison.
        let audioTracks: MediaStreamTrack[] = [];
        if (!beforeAfterMode) {
          try {
            const audioStream = await getToneOutputStream();
            audioTracks = audioStream.getAudioTracks();
          } catch { /* video-only fallback */ }
        }

        // Build recorders — raw gets no audio tracks (cleaner comparison)
        const lensRecorder = buildRecorder(lensCanvas, audioTracks);
        const rawRecorder  = beforeAfterMode ? buildRecorder(rawCanvas!, []) : null;

        const totalExpected = beforeAfterMode ? 2 : 1;

        const handleStop = (which: "lens" | "raw", chunks: Blob[]) => {
          const blob = new Blob(chunks, { type: "video/webm" });
          const filename = beforeAfterMode
            ? (which === "lens" ? `LENS_edit_${ts}.webm` : `LENS_raw_${ts}.webm`)
            : `LENS_video_${ts}.webm`;

          downloadBlob(blob, filename);

          if (which === "lens") onComplete(URL.createObjectURL(blob));

          completedRecorders++;
          if (completedRecorders === totalExpected) {
            setStatus(beforeAfterMode ? "✅ Both videos downloaded!" : "✅ Download started!");
            stopAll().catch(() => {});
            disconnectToneOutputStream();
            setTimeout(() => onCancel(), 2000);
          }
        };

        lensRecorder.ondataavailable = (e) => { if (e.data.size > 0) lensChunks.push(e.data); };
        lensRecorder.onstop = () => handleStop("lens", lensChunks);

        if (rawRecorder) {
          rawRecorder.ondataavailable = (e) => { if (e.data.size > 0) rawChunks.push(e.data); };
          rawRecorder.onstop = () => handleStop("raw", rawChunks);
        }

        // ── Start both recorders on the same tick for frame-perfect sync ──
        setStatus(beforeAfterMode ? "Recording RAW + LENS in sync…" : "Recording…");
        lensRecorder.start(250);
        rawRecorder?.start(250);

        let frames = 0;

        const drawLoop = () => {
          frames++;
          setProgress(Math.min(99, 10 + (frames / TOTAL_FRAMES) * 89));

          const currentPt = activityPoints[Math.floor((frames / TOTAL_FRAMES) * activityPoints.length)];

          // ── LENS canvas: map + video + telemetry ──────────────────────────
          lensCtx.fillStyle = "#050505";
          lensCtx.fillRect(0, 0, W, H);
          try { lensCtx.drawImage(mapCanvas, 0, 0, W, H); } catch { /* map not ready */ }
          if (videoEl && !videoEl.paused) {
            try { lensCtx.drawImage(videoEl, 0, 0, W, H); } catch {}
          }
          if (currentPt) {
            FrameCompositor.renderTelemetry(lensCtx, currentPt.speed ?? 0, frames / FPS);
          }

          // ── RAW canvas: video only — no map, no overlay ───────────────────
          if (beforeAfterMode && rawCtx) {
            rawCtx.fillStyle = "#050505";
            rawCtx.fillRect(0, 0, W, H);
            if (videoEl && !videoEl.paused) {
              try { rawCtx.drawImage(videoEl, 0, 0, W, H); } catch {}
            }
          }

          if (frames < TOTAL_FRAMES) {
            rafRef.current = requestAnimationFrame(drawLoop);
          } else {
            setStatus("Encoding…");
            setProgress(100);
            lensRecorder.stop();
            rawRecorder?.stop();
          }
        };

        rafRef.current = requestAnimationFrame(drawLoop);

      }, 1500);
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      stopAll().catch(() => {});
      disconnectToneOutputStream();
    };
  }, [activityPoints.length]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-8">

      <div className="text-white text-2xl font-black mb-1 uppercase tracking-[0.2em] text-center">
        {beforeAfterMode ? "Before / After Export" : "Exporting Video"}
      </div>

      {beforeAfterMode && (
        <p className="text-zinc-500 text-[11px] uppercase tracking-widest font-black mb-4">
          RAW + LENS · Frame-perfect sync · No intro · No branding
        </p>
      )}

      <div className="text-amber-500 font-mono text-sm mb-5 animate-pulse flex items-center gap-3 bg-black/40 px-4 py-2 rounded-full border border-white/5">
        <svg className="animate-spin h-4 w-4 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        {status}
      </div>

      <div className="w-[300px] h-2 bg-white/10 rounded-full mb-6 overflow-hidden">
        <div className="h-full bg-amber-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {/* Canvas previews */}
      {beforeAfterMode ? (
        <div className="flex items-end gap-4">
          {/* RAW preview */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Raw</span>
            <div className="relative w-[130px] h-[231px] bg-black border-2 border-zinc-700 rounded-[1.2rem] overflow-hidden shadow-lg pointer-events-none">
              <canvas ref={rawCanvasRef} width={W} height={H} className="w-full h-full object-cover" />
              <div className="absolute top-2 left-0 right-0 flex justify-center">
                <span className="px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 text-[9px] font-black uppercase tracking-widest">No overlay</span>
              </div>
            </div>
          </div>

          <div className="text-zinc-700 font-black text-xl mb-10">↔</div>

          {/* LENS preview */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">LENS Edit</span>
            <div className="relative w-[130px] h-[231px] bg-black border-2 border-amber-500/40 rounded-[1.2rem] overflow-hidden shadow-[0_0_30px_rgba(245,158,11,0.15)] pointer-events-none">
              <canvas ref={lensCanvasRef} width={W} height={H} className="w-full h-full object-cover" />
              <div className="absolute top-2 left-0 right-0 flex justify-center">
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[9px] font-black uppercase tracking-widest">GPS + Telemetry</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative w-[270px] h-[480px] bg-black border-4 border-white/10 rounded-[2rem] overflow-hidden shadow-[0_0_80px_rgba(245,158,11,0.15)] pointer-events-none">
          <canvas ref={lensCanvasRef} width={W} height={H} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="text-white/40 text-[11px] mt-6 text-center max-w-xs">
        {beforeAfterMode
          ? "Two files will download automatically: LENS_raw_… and LENS_edit_…"
          : "Keep this tab active. Hardware WebGL is rendering your video."}
      </div>

      <button onClick={onCancel}
        className="mt-6 px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-rose-500/20 hover:border-rose-500/50 transition-colors text-xs font-bold uppercase tracking-widest">
        Abort
      </button>

      {/* Hidden rendering factory */}
      <div className="fixed top-[-9999px] left-[-9999px] opacity-0 pointer-events-none">
        <div ref={hiddenMapContainer} style={{ width: `${W}px`, height: `${H}px` }} />
        {videoUrlRef.current && (
          <video ref={hiddenVideoRef} src={videoUrlRef.current} muted playsInline crossOrigin="anonymous" />
        )}
      </div>
    </div>
  );
}
