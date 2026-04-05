"use client";
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { EnhancedGPSPoint, ActionSegment } from "@/lib/engine/TelemetryCrossRef";
import { FrameCompositor } from "@/lib/engine/FrameCompositor";
import { playIntroWithDataImpacts, getToneOutputStream, stopAll, disconnectToneOutputStream } from "@/lib/audio/AudioEngine";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export interface CanvasRendererProps {
  activityPoints: EnhancedGPSPoint[];
  highlights: ActionSegment[];
  videoFile: File | null;
  onComplete: (videoBlobUrl: string) => void;
  onCancel: () => void;
}

export function CanvasRenderer({ activityPoints, highlights, videoFile, onComplete, onCancel }: CanvasRendererProps) {
  const masterCanvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenMapContainer = useRef<HTMLDivElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string | null>(null);

  const [status, setStatus] = useState("Initializing WebGL Buffers...");
  const [progress, setProgress] = useState(0);

  // Create stable video URL once
  useEffect(() => {
    if (videoFile && !videoUrlRef.current) {
      videoUrlRef.current = URL.createObjectURL(videoFile);
    }
    return () => {
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
    };
  }, [videoFile]);

  useEffect(() => {
    if (!hiddenMapContainer.current || !masterCanvasRef.current || !activityPoints.length) return;

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

    const requestRef = { current: 0 };
    const mediaRecorderRef = { current: null as MediaRecorder | null };
    const chunksRef = { current: [] as Blob[] };

    map.on('load', () => {
      setStatus("Rendering Route on Map...");

      // BUG FIX 1: Desenhar o trajeto GPX no mapa offline
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: activityPoints.map(p => [p.lon, p.lat])
          },
          properties: {}
        }
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#f59e0b',
          'line-width': 4,
          'line-opacity': 0.9
        }
      });

      setTimeout(async () => {
        setStatus("Starting Frame Compositor...");
        setProgress(10);

        const masterCanvas = masterCanvasRef.current;
        const masterCtx = masterCanvas?.getContext("2d");
        const mapCanvas = hiddenMapContainer.current?.querySelector("canvas") as HTMLCanvasElement | null;
        const videoEl = hiddenVideoRef.current;

        if (!masterCtx || !mapCanvas || !masterCanvas) return;

        // Fly along the route
        map.flyTo({
          center: [activityPoints[Math.floor(activityPoints.length / 2)].lon, activityPoints[Math.floor(activityPoints.length / 2)].lat],
          zoom: 17,
          pitch: 65,
          bearing: 140,
          duration: 8000,
          essential: true
        });

        // BUG FIX 2: Iniciar o vídeo GoPro para captura
        if (videoEl) {
          videoEl.currentTime = highlights[0]?.videoStartTime ?? 0;
          videoEl.play().catch(() => {});
        }

        // ── Cinematic audio for Engine 2 ──────────────────────────────────────
        // Play intro audio (wind + heartbeat) and tap Tone.js output into a
        // MediaStream so the MediaRecorder captures it in the exported file.
        let audioTracks: MediaStreamTrack[] = [];
        try {
          await playIntroWithDataImpacts();
          const audioStream = await getToneOutputStream();
          audioTracks = audioStream.getAudioTracks();
        } catch {
          // Audio capture failed — record video-only rather than abort
        }

        // Setup MediaRecorder with video + audio
        let recorder: MediaRecorder;
        const videoStream = masterCanvas.captureStream(30);
        const combinedStream = audioTracks.length > 0
          ? new MediaStream([...videoStream.getVideoTracks(), ...audioTracks])
          : videoStream;
        try {
          recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp8,opus' });
        } catch {
          try {
            recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
          } catch {
            recorder = new MediaRecorder(videoStream); // final fallback: video only
          }
        }
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          stopAll().catch(() => {});
          disconnectToneOutputStream();

          const blob = new Blob(chunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          onComplete(url);

          // BUG FIX 3: Forçar download appendando ao DOM antes de clicar
          const a = document.createElement('a');
          a.href = url;
          a.download = `ProRefuel_Cinematic_${Date.now()}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          setStatus("✅ Download Iniciado!");
          setTimeout(() => onCancel(), 2000);
        };

        recorder.start(250);

        let frames = 0;
        const totalFrames = 30 * 12; // 12 segundos a 30fps

        const drawLoop = () => {
          frames++;
          setProgress(Math.min(99, 10 + (frames / totalFrames) * 89));

          // Base: preto
          masterCtx.fillStyle = "#050505";
          masterCtx.fillRect(0, 0, 1080, 1920);

          // Camada 1: Mapbox WebGL
          try { masterCtx.drawImage(mapCanvas, 0, 0, 1080, 1920); } catch {}

          // Camada 2: Vídeo GoPro (topo, modo PIP ou fullscreen)
          if (videoEl && !videoEl.paused) {
            try { masterCtx.drawImage(videoEl, 0, 0, 1080, 1920); } catch {}
          }

          // Camada 3: Telemetria Canvas
          const currentPt = activityPoints[Math.floor((frames / totalFrames) * activityPoints.length)];
          if (currentPt) {
            FrameCompositor.renderTelemetry(masterCtx, currentPt.speed ?? 0, frames / 30);
          }

          if (frames < totalFrames) {
            requestRef.current = requestAnimationFrame(drawLoop);
          } else {
            setStatus("Encoding...");
            setProgress(100);
            recorder.stop();
          }
        };

        requestRef.current = requestAnimationFrame(drawLoop);

      }, 1500);
    });

    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      cancelAnimationFrame(requestRef.current);
      map.remove();
      stopAll().catch(() => {});
      disconnectToneOutputStream();
    };
  }, [activityPoints.length]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-8">
      <div className="text-white text-3xl font-black mb-2 uppercase tracking-[0.2em] text-center drop-shadow-lg">
        EXPORTING VIDEO
      </div>
      <div className="text-amber-500 font-mono text-sm mb-6 animate-pulse flex items-center gap-3 bg-black/40 px-4 py-2 rounded-full border border-white/5 shadow-xl">
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {status}
      </div>

      <div className="w-[300px] h-2 bg-white/10 rounded-full mb-8 overflow-hidden shadow-inner">
        <div className="h-full bg-amber-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {/* Preview do Canvas sendo gerado */}
      <div className="relative w-[270px] h-[480px] bg-black border-4 border-white/10 rounded-[2rem] overflow-hidden shadow-[0_0_80px_rgba(245,158,11,0.15)] pointer-events-none">
        <canvas
          ref={masterCanvasRef}
          width={1080}
          height={1920}
          className="w-full h-full object-cover"
        />
      </div>

      <div className="text-white/40 text-[11px] font-sans mt-8 text-center max-w-sm px-4">
        Keep this tab active. Hardware WebGL is rendering your video frame-by-frame.
      </div>

      <button onClick={onCancel} className="mt-8 px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-rose-500/20 hover:border-rose-500/50 transition-colors text-xs font-bold uppercase tracking-widest">
        Abort
      </button>

      {/* Fábrica Offline Escondida */}
      <div className="fixed top-[-9999px] left-[-9999px] opacity-0 pointer-events-none">
        <div ref={hiddenMapContainer} style={{ width: "1080px", height: "1920px" }} />
        {videoUrlRef.current && (
          <video
            ref={hiddenVideoRef}
            src={videoUrlRef.current}
            muted
            playsInline
            crossOrigin="anonymous"
          />
        )}
      </div>
    </div>
  );
}
