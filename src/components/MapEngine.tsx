"use client";
// @ts-ignore - @ffmpeg/ffmpeg types

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { GPSPoint } from "@/lib/media/GoProEngineClient";
import { ActionSegment } from "@/lib/engine/TelemetryCrossRef";
import { StoryPlan } from "@/lib/engine/StorytellingProcessor";
import { AltimetryGraph } from "./AltimetryGraph";
import { TelemetryHUD } from "./TelemetryHUD";
import { UnitSystem, SPEED_LABEL, DIST_LABEL, DIST_DIVISOR, ELE_LABEL, ELE_FACTOR } from "@/lib/utils/units";
import { playIntroWithDataImpacts, playBrandExit, initTone, getToneOutputStream } from "@/lib/audio/AudioEngine";

interface DeviceInfo {
  label: string;
  logoFile: string;
}

interface ActivityMeta {
  name: string;
  location?: string;
  gpsDevice?: DeviceInfo;
  camera?: DeviceInfo;
}

export interface RenderResult {
  durationMs: number;
  outputFormat: "mp4" | "webm";
  outputSizeBytes: number;
  status: "success" | "error" | "fallback";
  errorMessage?: string;
}

interface MapEngineProps {
  activityPoints: any[];
  highlights: ActionSegment[];
  storyPlan: StoryPlan | null;
  videoFile: File | null;
  activityMeta?: ActivityMeta;
  autoRecord?: boolean;
  unit?: UnitSystem;
  onRenderComplete?: (result: RenderResult) => void;
}

function calculateBearing(start: GPSPoint, end: GPSPoint) {
  const y = Math.sin(((end.lon - start.lon) * Math.PI) / 180) * Math.cos((end.lat * Math.PI) / 180);
  const x = Math.cos((start.lat * Math.PI) / 180) * Math.sin((end.lat * Math.PI) / 180) - Math.sin((start.lat * Math.PI) / 180) * Math.cos((end.lat * Math.PI) / 180) * Math.cos(((end.lon - start.lon) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function getDistance(p1: GPSPoint, p2: GPSPoint) {
  const R = 6371e3;
  const φ1 = (p1.lat * Math.PI) / 180;
  const φ2 = (p2.lat * Math.PI) / 180;
  const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const Δλ = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MapEngine = forwardRef(({ activityPoints, highlights, storyPlan, videoFile, activityMeta, autoRecord = false, unit = 'metric', onRenderComplete }: MapEngineProps, ref) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const requestRef = useRef<number>(0);
  const recordingRef = useRef<{ recorder: MediaRecorder; compositeLoop: number } | null>(null);
  const autoRecordRef = useRef(autoRecord);
  const startRecordingRef = useRef<(() => Promise<void>) | null>(null);

  // Lightweight Canvas 2D mini-map (replaces Mapbox in ACTION mode)
  const miniMapCanvasRef = useRef<HTMLCanvasElement>(null);
  // Engine 1: snapshot of outgoing frame for crossfade transition
  const clipTransCanvasRef = useRef<HTMLCanvasElement>(null);
  // Audio context — created once per video element to avoid duplicate createMediaElementSource calls
  const audioCtxRef = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null);
  const routeCacheRef = useRef<{
    canvas: HTMLCanvasElement;
    proj: { minLon: number; minLat: number; cosLat: number; scale: number; offX: number; offY: number; MH: number };
  } | null>(null);
  // Garante que o áudio da brand só dispara uma vez (pre-trigger 2s antes)
  const brandAudioFiredRef = useRef(false);
  // Pre-brand fade: 0→1 nos 2s antes do BRAND (sincronizado com audio preroll)
  const preBrandFadeRef   = useRef(0);
  // Live ref — always reflects latest activityMeta so closures in the main effect
  // (captured at GPX-upload time) can still read camera/location added later.
  const activityMetaRef   = useRef(activityMeta);

  const [viewMode, setViewMode] = useState<"INTRO" | "MAP" | "ACTION" | "BRAND">("BRAND");
  const [preBrandFade, setPreBrandFade] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [clipIdx, setClipIdx] = useState(0); // increments on each ACTION clip change → triggers cutFlash
   const [isRecording, setIsRecording] = useState(false);
   const [isTranscoding, setIsTranscoding] = useState(false);
   const [renderError, setRenderError] = useState<{ message: string; isOOM: boolean } | null>(null);
   const [isLongActivity, setIsLongActivity] = useState(false);


  const state = useRef({
    virtualIndex: 0,
    startTime: 0,
    lastTick: 0,
    isStarted: false,

    currentBearing: 0,
    viewMode: "BRAND" as "INTRO" | "MAP" | "ACTION" | "BRAND",
    pitch: 60,
    zoom: 18,
    activeHighlightIndex: -1, // Tracks which highlight block is currently playing (if any)
    mapPointsPerSec: 10,
    isLongActivity: false,
    marathonSegments: [] as any[],
    lastHighlightSyncIndex: -1,
    lastPreSeekTarget: -1,   // videoStartTime we last pre-seeked to (avoids repeat seeks)
    lastHudUpdateTime: 0,    // throttle setCurrentIndex React re-renders to ~10fps
    lastMiniMapUpdate: 0,    // throttle Canvas 2D mini-map redraws to ~5fps
    currentSegIdx: -1,       // current segment index — shared with compositeLoop for transitions
  });

  const { totalDistKm, totalTimeStr, avgSpeedKmh } = React.useMemo(() => {
    let d = 0;
    if (activityPoints.length > 1) {
      for (let i = 0; i < activityPoints.length - 1; i++) {
        d += getDistance(activityPoints[i], activityPoints[i + 1]);
      }
    }
    const tMs    = activityPoints.length > 1 ? (activityPoints[activityPoints.length - 1].time - activityPoints[0].time) : 0;
    const tSecs  = tMs / 1000;
    const distUnit = d / DIST_DIVISOR[unit];
    const avg = tSecs > 0 ? (distUnit / (tSecs / 3600)).toFixed(1) : "--";
    const hhN = Math.floor(tSecs / 3600);
    const mmS = Math.floor((tSecs % 3600) / 60).toString().padStart(2, "0");
    const ssS = Math.floor(tSecs % 60).toString().padStart(2, "0");
    const timeStr = (!isNaN(tSecs) && tSecs > 0)
      ? (hhN > 0 ? `${hhN.toString().padStart(2, "0")}:${mmS}:${ssS}` : `${mmS}:${ssS}`)
      : "--";
    return { totalDistKm: distUnit.toFixed(1), totalTimeStr: timeStr, avgSpeedKmh: avg };
  }, [activityPoints, unit]);

  const hrMax = React.useMemo(
    () => Math.max(...activityPoints.map(p => (p as any).hr ?? 0), 1),
    [activityPoints]
  );

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [videoFile]);

  // Keep activityMetaRef current so closures inside the main useEffect
  // (which only re-runs when activityPoints changes) always see the latest metadata.
  useEffect(() => {
    activityMetaRef.current = activityMeta;
  }, [activityMeta]);

  // Pre-compute mini-map route cache once — draws the full polyline to an offscreen canvas
  // so ACTION mode only needs drawImage + a dot each frame (no per-frame GPS iteration)
  useEffect(() => {
    if (!activityPoints.length) return;
    const MW = 360, MH = 290, PAD = 14; // shorter + wider ratio for mini-map widget
    const offscreen = document.createElement("canvas");
    offscreen.width = MW;
    offscreen.height = MH;
    const c = offscreen.getContext("2d")!;

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of activityPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const latRange = (maxLat - minLat) || 0.001;
    const lonRange = (maxLon - minLon) || 0.001;

    // Aspect-ratio-preserving projection — 1° lon ≠ 1° lat, correct via cos(midLat)
    const midLat  = (minLat + maxLat) / 2;
    const cosLat  = Math.cos(midLat * Math.PI / 180);
    const routeW  = lonRange * cosLat;
    const routeH  = latRange;
    const drawW   = MW - PAD * 2;
    const drawH   = MH - PAD * 2;
    const scale   = Math.min(drawW / routeW, drawH / routeH);
    const offX    = PAD + (drawW - routeW * scale) / 2;
    const offY    = PAD + (drawH - routeH * scale) / 2;

    const toX = (lon: number) => offX + (lon - minLon) * cosLat * scale;
    const toY = (lat: number) => MH - offY - (lat - minLat) * scale;

    c.fillStyle = "rgba(8,8,8,0.82)";
    c.fillRect(0, 0, MW, MH);

    // Full route — bright enough to read the complete trail shape
    c.strokeStyle = "rgba(255,255,255,0.38)";
    c.lineWidth = 2;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.beginPath();
    activityPoints.forEach((p, i) => {
      i === 0 ? c.moveTo(toX(p.lon), toY(p.lat)) : c.lineTo(toX(p.lon), toY(p.lat));
    });
    c.stroke();

    routeCacheRef.current = { canvas: offscreen, proj: { minLon, minLat, cosLat, scale, offX, offY, MH } };
  }, [activityPoints]);

  useEffect(() => {
    if (!mapContainerRef.current || !activityPoints.length || mapRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
    mapContainerRef.current.innerHTML = "";

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      center: [activityPoints[0].lon, activityPoints[0].lat],
      zoom: 18,
      pitch: 60,
      bearing: calculateBearing(activityPoints[0], activityPoints[Math.min(10, activityPoints.length - 1)]),
      attributionControl: false,
      logoPosition: "top-left",
    });

    map.on("error", (e) => {
      // Tile load errors and style errors are non-fatal — log and continue
      console.warn("[MapEngine] Mapbox error:", e.error?.message ?? e);
    });

    map.on("load", () => {
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: activityPoints.map((pt: any) => [pt.lon, pt.lat]),
          },
        },
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 8,
          "line-opacity": 0.8,
        },
      });

      const el = document.createElement('div');
      el.className = 'w-6 h-6 rounded-full bg-amber-500 border-4 border-white shadow-[0_0_20px_rgba(245,158,11,1)] transition-all duration-300';
      
      markerRef.current = new mapboxgl.Marker(el)
        .setLngLat([activityPoints[0].lon, activityPoints[0].lat])
        .addTo(map);

      mapRef.current = map;

      if (autoRecordRef.current && startRecordingRef.current) {
        setTimeout(() => startRecordingRef.current!(), 100);
      }
    });

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [activityPoints]);

  const startExperience = () => {
    if (!storyPlan) {
      console.error("[MapEngine] Cannot start without a StoryPlan.");
      return;
    }

    state.current.lastTick = performance.now();
    state.current.startTime = performance.now();
    state.current.isStarted = true;
    state.current.lastHighlightSyncIndex = -1;
    state.current.isLongActivity = storyPlan.isLongActivity;
    setIsLongActivity(storyPlan.isLongActivity);

    // MUDANÇA 1: map flight speed driven by editingRhythm
    const rhythm = storyPlan.narrativePlan?.editingRhythm ?? "MEDIUM";
    state.current.mapPointsPerSec = rhythm === "FAST" ? 14 : rhythm === "SLOW" ? 6 : 10;

    setViewMode("INTRO");
    state.current.viewMode = "INTRO";

    // Resetar flags a cada nova experiência
    brandAudioFiredRef.current = false;
    preBrandFadeRef.current    = 0;
    setPreBrandFade(0);

    // Calcular tempo total dos segmentos (= quando o BRAND começa)
    const brandStartSec = storyPlan.segments.reduce((sum: number, s: any) => sum + s.durationSec, 0);

    // ── Audio: prewarm AudioContext on this user gesture, then play intro ──────
    playIntroWithDataImpacts().catch(() => {}); // prewarm + play; swallow if browser blocks

    let prevActionSegIdx = -1; // closure: tracks last ACTION segIdx for crossfade detection

    const animate = (now: number) => {
      if (!state.current.isStarted || !mapRef.current || !storyPlan) return;
      
      const elapsedTotal = (now - state.current.startTime) / 1000;
      let runningTime = 0;
      let currentSeg = null;
      let segIdx = -1;

      for (let i = 0; i < storyPlan.segments.length; i++) {
        const s = storyPlan.segments[i];
        if (elapsedTotal < runningTime + s.durationSec) {
          currentSeg = s;
          segIdx = i;
          break;
        }
        runningTime += s.durationSec;
      }

      // Pre-trigger: disparar áudio da brand 2s antes para fade-in suave
      if (!brandAudioFiredRef.current && elapsedTotal >= brandStartSec - 2) {
        brandAudioFiredRef.current = true;
        playBrandExit(2).catch(() => {});
      }

      // Pre-brand fade overlay — escurece o vídeo nos 2s antes do BRAND
      // Sincronizado com o preroll de áudio: ambos começam em brandStartSec-2
      if (elapsedTotal >= brandStartSec - 2 && elapsedTotal < brandStartSec) {
        const t = (elapsedTotal - (brandStartSec - 2)) / 2; // 0→1 em 2s
        // easeInCubic: começa lento, acelera — cinematográfico
        const eased = t * t * t;
        const fade  = eased * 0.88; // máximo 88% → logo emerge do escuro
        if (fade !== preBrandFadeRef.current) {
          preBrandFadeRef.current = fade;
          setPreBrandFade(fade);
        }
      }

      if (!currentSeg) {
        if (state.current.viewMode !== "BRAND") {
          state.current.viewMode = "BRAND";
          setViewMode("BRAND");
        }
        return;
      }

      const progressInSeg = (elapsedTotal - runningTime) / currentSeg.durationSec;
      const ptsInSeg = currentSeg.endIndex - currentSeg.startIndex;

      // ── GPS index computation ───────────────────────────────────────────────
      // ACTION: binary-search activityPoints by the GPS timestamp the video is showing.
      //   videoEpoch = GPS timestamp at video.currentTime=0
      //              = activityPoints[startIndex].time - videoStartTime * 1000
      //              = videoPoints[0].time  (GoPro GPS recording epoch)
      //   targetMs   = videoEpoch + video.currentTime * 1000
      //
      // Why binary search instead of ratio interpolation:
      //   • Eliminates the "GPS stuck" bug: previous fix clamped progress to [0,1],
      //     freezing the index at endIndex while the video kept playing past the clip window.
      //   • No dependency on gpsTimeSec/ptsInSeg ratio — works even when durationSec ≠ clipSec.
      //   • Handles non-uniform GPS sample rates from Garmin tracks.
      //
      // MAP / INTRO / BRAND: no video, drive GPS from wall-clock elapsed time (unchanged).
      if (
        currentSeg.type === "ACTION" &&
        videoRef.current &&
        typeof currentSeg.videoStartTime === "number"
      ) {
        const videoEpoch = activityPoints[currentSeg.startIndex].time - currentSeg.videoStartTime * 1000;
        const targetMs   = videoEpoch + videoRef.current.currentTime * 1000;

        // Binary search: first index where activityPoints[i].time >= targetMs
        let lo = 0, hi = activityPoints.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (activityPoints[mid].time < targetMs) lo = mid + 1;
          else hi = mid;
        }

        // Sub-sample interpolation so the map/gauge glide smoothly between 1-Hz GPS points
        let vi = lo;
        if (lo > 0 && lo < activityPoints.length) {
          const t0   = activityPoints[lo - 1].time;
          const t1   = activityPoints[lo].time;
          const span = t1 - t0;
          if (span > 0) vi = lo - 1 + (targetMs - t0) / span;
        }
        state.current.virtualIndex = Math.max(0, Math.min(vi, activityPoints.length - 1));
      } else {
        state.current.virtualIndex = currentSeg.startIndex + (ptsInSeg * progressInSeg);
      }
      const idx = Math.floor(state.current.virtualIndex);
      // Throttle React re-renders to ~10fps — map animation runs from state.current refs, not React state
      if (now - state.current.lastHudUpdateTime > 100) {
        state.current.lastHudUpdateTime = now;
        setCurrentIndex(idx);
      }

      if (currentSeg.type !== state.current.viewMode) {
        const incoming = currentSeg.type as string;
        state.current.viewMode = incoming as any;
        setViewMode(incoming as any);
      }


      // Always expose current segment index so compositeLoop can detect clip changes
      state.current.currentSegIdx = segIdx;

      if (videoRef.current) {
        const vid = videoRef.current;
        if (currentSeg.type === "ACTION" && typeof currentSeg.videoStartTime === 'number') {
          // Enter ACTION: seek only once per segment, only if off by > 0.5s
          if (state.current.lastHighlightSyncIndex !== segIdx) {
            state.current.lastHighlightSyncIndex = segIdx;

            // Capture outgoing frame before seeking (object-cover math)
            const snapCanvas = clipTransCanvasRef.current;
            const isIntraAction = prevActionSegIdx >= 0; // true when switching between ACTION clips
            if (isIntraAction && snapCanvas && vid.readyState >= 2 && vid.videoWidth > 0) {
              const sc = snapCanvas.getContext('2d')!;
              const vW = vid.videoWidth, vH = vid.videoHeight;
              const cW = snapCanvas.clientWidth || 375;
              const cH = snapCanvas.clientHeight || 667;
              snapCanvas.width = cW; snapCanvas.height = cH;
              const scl = Math.max(cW / vW, cH / vH);
              const dW = vW * scl, dH = vH * scl;
              sc.clearRect(0, 0, cW, cH);
              sc.drawImage(vid, (cW - dW) / 2, (cH - dH) / 2, dW, dH);
              // Restart clipTransOut on the snapshot canvas without re-keying (prevents black flash)
              snapCanvas.style.animation = 'none';
              void snapCanvas.offsetWidth;
              snapCanvas.style.animation = 'clipTransOut 900ms cubic-bezier(0.645,0.045,0.355,1) forwards';
              setTimeout(() => { snapCanvas.style.animation = 'none'; sc.clearRect(0, 0, cW, cH); }, 950);
              // Apply incoming animation directly on video element
              vid.style.animation = 'none';
              void vid.offsetWidth; // force reflow to restart animation
              vid.style.animation = 'clipTransIn 900ms 120ms cubic-bezier(0.645,0.045,0.355,1) both';
              setTimeout(() => { vid.style.animation = ''; }, 1100);
            }

            prevActionSegIdx = segIdx; // track for next clip change detection
            setClipIdx(prev => prev + 1);
            if (Math.abs(vid.currentTime - currentSeg.videoStartTime) > 0.5) {
              vid.currentTime = currentSeg.videoStartTime;
            }
            vid.play().catch((err) => { console.warn("[MapEngine] video.play() failed:", err); });
          }
        } else {
          // Non-ACTION (INTRO/MAP/BRAND): pause video and pre-seek to the NEXT action segment
          // so the decoder is ready and playback starts instantly with no freeze
          if (!vid.paused) vid.pause();
          const nextAction = storyPlan.segments
            .slice(segIdx + 1)
            .find(s => s.type === "ACTION" && typeof s.videoStartTime === 'number');
          if (nextAction?.videoStartTime !== undefined &&
              nextAction.videoStartTime !== state.current.lastPreSeekTarget) {
            state.current.lastPreSeekTarget = nextAction.videoStartTime;
            vid.currentTime = nextAction.videoStartTime;
          }
        }
      }

      const pt1 = activityPoints[idx];
      const pt2 = activityPoints[Math.min(idx + 1, activityPoints.length - 1)];
      if (pt1 && pt2) {
        const fraction = state.current.virtualIndex - idx;
        const interpLon = pt1.lon + (pt2.lon - pt1.lon) * fraction;
        const interpLat = pt1.lat + (pt2.lat - pt1.lat) * fraction;
        markerRef.current?.setLngLat([interpLon, interpLat]);

        const target = activityPoints[Math.min(idx + 15, activityPoints.length - 1)];
        if (target) {
            const tBearing = calculateBearing(pt1, target);
            let diff = tBearing - state.current.currentBearing;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            state.current.currentBearing += diff * 0.1;

            // MUDANÇA 2+3: zoom and pitch respond to editingRhythm
            const _rhythm = storyPlan?.narrativePlan?.editingRhythm ?? "MEDIUM";
            const baseMapZoom  = _rhythm === "FAST" ? 17 : _rhythm === "SLOW" ? 19 : 18;
            const basePitch    = _rhythm === "FAST" ? 70 : _rhythm === "SLOW" ? 45 : 60;
            const tZoom  = currentSeg.type === "ACTION" ? 14 : baseMapZoom;
            const tPitch = currentSeg.type === "ACTION"
              ? (currentSeg.title?.includes("DOWNHILL") ? 85 : basePitch - 10)
              : basePitch;
            state.current.pitch += (tPitch - state.current.pitch) * 0.1;
            state.current.zoom += (tZoom - state.current.zoom) * 0.1;

            if (currentSeg.type === "ACTION") {
              // ACTION mode: Mapbox goes completely idle — canvas 2D mini-map handles the widget
              // Redraw mini-map at ~5fps (no need for 60fps on a small position indicator)
              if (now - state.current.lastMiniMapUpdate > 200) {
                state.current.lastMiniMapUpdate = now;
                const miniCanvas = miniMapCanvasRef.current;
                const cache = routeCacheRef.current;
                if (miniCanvas && cache) {
                  const mc = miniCanvas.getContext("2d");
                  if (mc) {
                    const MW = miniCanvas.width, MH = miniCanvas.height;
                    const { minLon, minLat, cosLat, scale, offX, offY } = cache.proj;
                    const toX = (lon: number) => offX + (lon - minLon) * cosLat * scale;
                    const toY = (lat: number) => MH - offY - (lat - minLat) * scale;

                    // Layer 1: cached background (dim full route) — stretched to canvas dimensions
                    mc.drawImage(cache.canvas, 0, 0, MW, MH);

                    // Layer 2: amber progress trail — full route from 0→idx (no window cap)
                    mc.strokeStyle = "rgba(245,158,11,0.85)";
                    mc.lineWidth = 2.5;
                    mc.lineJoin = "round";
                    mc.lineCap = "round";
                    mc.beginPath();
                    for (let i = 0; i <= idx; i++) {
                      const p = activityPoints[i];
                      const x = toX(p.lon), y = toY(p.lat);
                      i === 0 ? mc.moveTo(x, y) : mc.lineTo(x, y);
                    }
                    mc.stroke();

                    // Layer 3: current position dot + glow
                    const cur = activityPoints[idx];
                    const cx = toX(cur.lon), cy = toY(cur.lat);
                    const glow = mc.createRadialGradient(cx, cy, 0, cx, cy, 14);
                    glow.addColorStop(0, "rgba(245,158,11,0.55)");
                    glow.addColorStop(1, "rgba(245,158,11,0)");
                    mc.fillStyle = glow;
                    mc.beginPath();
                    mc.arc(cx, cy, 14, 0, Math.PI * 2);
                    mc.fill();
                    mc.strokeStyle = "#ffffff";
                    mc.lineWidth = 2;
                    mc.beginPath();
                    mc.arc(cx, cy, 6, 0, Math.PI * 2);
                    mc.stroke();
                    mc.fillStyle = "#f59e0b";
                    mc.beginPath();
                    mc.arc(cx, cy, 4, 0, Math.PI * 2);
                    mc.fill();
                  }
                }
              }
            } else {
              // MAP / INTRO / BRAND: Mapbox runs normally
              let shakeX = 0, shakeY = 0;
              if (currentSeg.title?.includes("TECHNICAL")) {
                shakeX = (Math.random() - 0.5) * 0.0005;
                shakeY = (Math.random() - 0.5) * 0.0005;
              }
              mapRef.current!.jumpTo({
                center: [interpLon + shakeX, interpLat + shakeY],
                bearing: state.current.currentBearing,
                pitch: state.current.pitch,
                zoom: state.current.zoom,
              });
            }
        }
      }
      requestRef.current = requestAnimationFrame(animate);
    };
    requestRef.current = requestAnimationFrame(animate);
  };



  const startRecording = async () => {
    const mapCanvas = mapContainerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    const videoEl = videoRef.current;
    if (!mapCanvas) return;

    // FORCE 1080p Portrait (Cinematic High-Res)
    const W = 1080;
    const H = 1920;
    const offscreen = document.createElement("canvas");
    offscreen.width = W;
    offscreen.height = H;

    const ctx = offscreen.getContext("2d")!;

    // Prefer H264-in-webm + opus audio → enables instant remux instead of slow transcode
    const preferredTypes = [
      "video/webm;codecs=avc1,opus",
      "video/webm;codecs=h264,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=avc1",
      "video/webm;codecs=h264",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) || "video/webm";
    console.log("[ProRefuel] MediaRecorder mimeType selected:", mimeType);

    const chunks: Blob[] = [];
    const stream = offscreen.captureStream(30);

    // ── Audio: pre-warm Tone.js so its AudioContext exists before we bridge it ─
    // This must happen before createMediaElementSource (each can only be called once).
    let toneStream: MediaStream | null = null;
    try {
      await initTone();
      toneStream = await getToneOutputStream();
    } catch (e) {
      console.warn("[ProRefuel] Tone.js pre-warm failed — cinematic audio will not be recorded:", e);
    }

    // ── Audio: bridge GoPro audio + Tone.js into the recording stream ──────────
    // createMediaElementSource must only be called once per element — reuse ref.
    if (videoEl && !audioCtxRef.current) {
      try {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaElementSource(videoEl);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination); // GoPro audio → speakers too

        // Bridge Tone.js stream (different AudioContext) into the recording dest
        if (toneStream) {
          const toneSource = audioCtx.createMediaStreamSource(toneStream);
          toneSource.connect(dest);
          console.log("[ProRefuel] Tone.js audio bridged into recording stream ✓");
        }

        audioCtxRef.current = { ctx: audioCtx, dest };
      } catch (e) {
        console.warn("[ProRefuel] AudioContext setup failed — recording video-only:", e);
      }
    } else if (audioCtxRef.current && toneStream) {
      // audioCtx already exists (e.g. second recording) — add Tone bridge if not yet present
      try {
        const toneSource = audioCtxRef.current.ctx.createMediaStreamSource(toneStream);
        toneSource.connect(audioCtxRef.current.dest);
      } catch { /* already bridged */ }
    }

    // Resume context if browser suspended it (happens when created before user gesture)
    audioCtxRef.current?.ctx.resume().catch(() => {});

    // Combine canvas video track + audio track into one stream for MediaRecorder
    let recordStream = stream;
    if (audioCtxRef.current) {
      const audioTrack = audioCtxRef.current.dest.stream.getAudioTracks()[0];
      if (audioTrack) {
        recordStream = new MediaStream([...stream.getVideoTracks(), audioTrack]);
        console.log("[ProRefuel] Audio track added to recording stream ✓");
      }
    }

    let recorder: MediaRecorder;
    try {
      // 15 Mbps for high quality — enough for crystal clear 1080p
      recorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond: 15_000_000 });
    } catch {
      try { recorder = new MediaRecorder(recordStream, { videoBitsPerSecond: 15_000_000 }); }
      catch { recorder = new MediaRecorder(recordStream); }
    }


    const isH264Source = mimeType.includes("avc1") || mimeType.includes("h264");

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      setIsRecording(false);
      setIsTranscoding(true);
      const renderStart = Date.now();
      try {
        const inputBlob = new Blob(chunks, { type: mimeType });
        console.log("[ProRefuel] Recorded blob size:", inputBlob.size, "bytes | codec:", mimeType);

        if (inputBlob.size === 0) throw new Error("Recording is empty — no data was captured.");

        const { FFmpeg } = await import("@ffmpeg/ffmpeg");
        const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
        const ffmpeg = new FFmpeg();
        ffmpeg.on("log", ({ message }) => console.log("[FFmpeg]", message));

        const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
        console.log("[ProRefuel] Loading FFmpeg WASM...");
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        });

        await ffmpeg.writeFile("input.webm", await fetchFile(inputBlob));

        let exitCode: number;
        if (isH264Source) {
          // Fast path: H264 video — copy video stream (no re-encode), transcode audio Opus→AAC.
          // "-c copy" would embed Opus in MP4 which most players reject; audio must be AAC.
          console.log("[ProRefuel] H264 source detected — remuxing video, transcoding audio Opus→AAC...");
          exitCode = await ffmpeg.exec([
            "-i", "input.webm",
            "-c:v", "copy",          // copy H264 video — lossless, instant
            "-c:a", "aac",           // transcode Opus → AAC (MP4-compatible)
            "-b:a", "192k",
            "-ar", "48000",          // 48kHz — standard for video
            "-ac", "2",              // stereo
            "-movflags", "+faststart",
            "output.mp4",
          ]);
        } else {
          // Slow path: VP8/VP9 → must transcode to H264. Use ultrafast for max speed.
          console.log("[ProRefuel] VP8/VP9 source — transcoding with high quality (CRF 20)...");
          exitCode = await ffmpeg.exec([
            "-i", "input.webm",
            "-vf", "scale=1080:1920", // Force final output scale
            "-r", "30",
            "-c:v", "libx264",
            "-preset", "ultrafast",  // fastest possible in WASM
            "-crf", "20",            // lower is better (20 is high quality)
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",           // encode audio track (GoPro original)
            "-b:a", "128k",
            "-movflags", "+faststart",
            "output.mp4",
          ]);

        }

        console.log("[ProRefuel] FFmpeg exit code:", exitCode);
        if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);

        const data = await ffmpeg.readFile("output.mp4") as Uint8Array<ArrayBuffer>;
        console.log("[ProRefuel] MP4 size:", data.byteLength, "bytes");
        if (data.byteLength === 0) throw new Error("FFmpeg produced an empty MP4.");

        const mp4Blob = new Blob([data], { type: "video/mp4" });
        const url = URL.createObjectURL(mp4Blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ProRefuel_Cinematic_${Date.now()}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        onRenderComplete?.({
          durationMs: Date.now() - renderStart,
          outputFormat: "mp4",
          outputSizeBytes: mp4Blob.size,
          status: "success",
        });
      } catch (err: any) {
        console.error("[ProRefuel] FFmpeg error:", err);

        // Detect OOM: WebAssembly memory errors, RangeError, or ENOMEM in message
        const errMsg = (err?.message ?? "") + (err?.stack ?? "");
        const isOOM  = /out of memory|memory access out of bounds|RangeError|WebAssembly\.Memory|Cannot allocate|ENOMEM/i.test(errMsg);

        const fallbackBlob = new Blob(chunks, { type: mimeType });

        setRenderError({
          message: isOOM
            ? "Not enough memory to render. Close other tabs and try again."
            : "Render failed. Please try again.",
          isOOM,
        });
        onRenderComplete?.({
          durationMs:      Date.now() - renderStart,
          outputFormat:    "mp4",
          outputSizeBytes: 0,
          status:          "error",
          errorMessage:    (isOOM ? "OOM: " : "") + (err?.message ?? "unknown"),
        });
      } finally {
        setIsTranscoding(false);
      }
    };


    // ── Pre-load logo image once ──────────────────────────────────────────────
    const logoImg = new Image();
    logoImg.src = "/prorefuel_logo.png";

    // Lazy logo cache — loads an SVG/image the first time it's requested.
    // Using a live cache (not captured at effect startup) ensures logos added
    // after GPX upload (e.g. camera detected from video) are still shown.
    const logoCache = new Map<string, HTMLImageElement>();
    const getLogoImg = (url: string): HTMLImageElement => {
      if (!logoCache.has(url)) {
        const img = new Image();
        img.src = url;
        logoCache.set(url, img);
      }
      return logoCache.get(url)!;
    };

    // ── Pre-compute cumulative distances (meters) per GPS index ───────────────
    const cumDist: number[] = [0];
    for (let i = 1; i < activityPoints.length; i++) {
      cumDist.push(cumDist[i - 1] + getDistance(activityPoints[i - 1], activityPoints[i]));
    }
    const realMaxSpeed = Math.max(...activityPoints.map(p => (p as any).speed || 0));
    const STABLE_GAUGE_MAX = Math.max(50, Math.ceil(realMaxSpeed / 10) * 10);

    // ── Pre-compute elevation bounds ──────────────────────────────────────────
    let minE = Infinity, maxE = -Infinity, peakEleIdx = 0;
    for (let i = 0; i < activityPoints.length; i++) {
      const ele = activityPoints[i].ele;
      if (ele < minE) minE = ele;
      if (ele > maxE) { maxE = ele; peakEleIdx = i; }
    }
    const eRange = maxE - minE || 1;

    // ── Pre-compute GPS bounds for broadmap (used every frame — compute once) ─
    let bmMinLat = Infinity, bmMaxLat = -Infinity, bmMinLon = Infinity, bmMaxLon = -Infinity;
    for (const p of activityPoints) {
      if (p.lat < bmMinLat) bmMinLat = p.lat;
      if (p.lat > bmMaxLat) bmMaxLat = p.lat;
      if (p.lon < bmMinLon) bmMinLon = p.lon;
      if (p.lon > bmMaxLon) bmMaxLon = p.lon;
    }
    const bmLatRange = (bmMaxLat - bmMinLat) || 0.001;
    const bmLonRange = (bmMaxLon - bmMinLon) || 0.001;

    // ── Pre-render static broadmap background to offscreen canvas (done ONCE) ─
    const pipW = Math.round(W * 0.52);   // wider — uses horizontal space better
    const pipH = Math.round(W * 0.34);   // enough height to read the full route shape
    const pipX = W - pipW - Math.round(W * 0.04);
    const pipY = Math.round(H * 0.07);

    // ── Pre-project GPS→pixel for broadmap amber trail (eliminates per-point division every frame) ─
    const bmProjX = new Float32Array(activityPoints.length);
    const bmProjY = new Float32Array(activityPoints.length);
    for (let i = 0; i < activityPoints.length; i++) {
      const p = activityPoints[i];
      bmProjX[i] = 32 + ((p.lon - bmMinLon) / bmLonRange) * (pipW - 64);
      bmProjY[i] = pipH - 32 - ((p.lat - bmMinLat) / bmLatRange) * (pipH - 64);
    }

    const broadmapCache = document.createElement("canvas");
    broadmapCache.width = pipW;
    broadmapCache.height = pipH;
    (() => {
      const bc = broadmapCache.getContext("2d")!;
      bc.fillStyle = "#080808";
      bc.fillRect(0, 0, pipW, pipH);
      bc.strokeStyle = "rgba(255,255,255,0.38)";
      bc.lineWidth = 2;
      bc.lineJoin = "round";
      bc.beginPath();
      activityPoints.forEach((p, i) => {
        const px = 32 + ((p.lon - bmMinLon) / bmLonRange) * (pipW - 64);
        const py = pipH - 32 - ((p.lat - bmMinLat) / bmLatRange) * (pipH - 64);
        i === 0 ? bc.moveTo(px, py) : bc.lineTo(px, py);
      });
      bc.stroke();
    })();

    // ── Incremental trail cache — O(delta) per frame instead of O(idx) ────────
    // Amber progress trail is painted once into this canvas and grows by 1 segment
    // per GPS advance. No full-route redraw every frame.
    const trailCache = document.createElement("canvas");
    trailCache.width = pipW; trailCache.height = pipH;
    const trailCtx = trailCache.getContext("2d")!;
    trailCtx.strokeStyle = "rgba(245,158,11,0.85)";
    trailCtx.lineWidth = 3; trailCtx.lineJoin = "round"; trailCtx.lineCap = "round";
    let lastTrailIdx = -1;

    // ── Pre-render static altimetry background to offscreen canvas (done ONCE) ─
    // X axis = cumulative distance (not index) for accurate altitude×distance profile
    const totalDistM = cumDist[cumDist.length - 1] || 1;
    const ALT_H = Math.round(H * 0.12);
    const ALT_PAD_TOP = 28; // px above curve for max label
    const ALT_Y = H - ALT_H - ALT_PAD_TOP;
    const altimetryCache = document.createElement("canvas");
    altimetryCache.width = W;
    altimetryCache.height = ALT_H + ALT_PAD_TOP;
    (() => {
      const ac = altimetryCache.getContext("2d")!;
      const cH = ALT_H + ALT_PAD_TOP;
      // Dark fade strip
      const bgGrad = ac.createLinearGradient(0, 0, 0, cH);
      bgGrad.addColorStop(0, "rgba(5,5,5,0)");
      bgGrad.addColorStop(0.3, "rgba(5,5,5,0.75)");
      bgGrad.addColorStop(1, "rgba(5,5,5,0.97)");
      ac.fillStyle = bgGrad;
      ac.fillRect(0, 0, W, cH);

      // Area fill — distance-based X
      const altGrad = ac.createLinearGradient(0, ALT_PAD_TOP, 0, ALT_PAD_TOP + ALT_H);
      altGrad.addColorStop(0, "rgba(245,158,11,0.45)");
      altGrad.addColorStop(1, "rgba(245,158,11,0)");
      ac.fillStyle = altGrad;
      ac.beginPath();
      ac.moveTo(0, ALT_PAD_TOP + ALT_H);
      activityPoints.forEach((p, i) => {
        const x = (cumDist[i] / totalDistM) * W;
        const y = ALT_PAD_TOP + ALT_H - ((p.ele - minE) / eRange) * (ALT_H * 0.85);
        ac.lineTo(x, y);
      });
      ac.lineTo(W, ALT_PAD_TOP + ALT_H);
      ac.closePath();
      ac.fill();

      // Curve line with glow
      ac.strokeStyle = "#f59e0b";
      ac.lineWidth = 2.5;
      ac.lineJoin = "round";
      ac.shadowColor = "rgba(245,158,11,0.45)";
      ac.shadowBlur = 8;
      ac.beginPath();
      activityPoints.forEach((p, i) => {
        const x = (cumDist[i] / totalDistM) * W;
        const y = ALT_PAD_TOP + ALT_H - ((p.ele - minE) / eRange) * (ALT_H * 0.85);
        i === 0 ? ac.moveTo(x, y) : ac.lineTo(x, y);
      });
      ac.stroke();
      ac.shadowBlur = 0;

      // ── Max elevation indicator: dotted line + amber dot + pill label ────────
      const peakXc = (cumDist[peakEleIdx] / totalDistM) * W;
      const peakYc = ALT_PAD_TOP + ALT_H - ((maxE - minE) / eRange) * (ALT_H * 0.85);

      // Pill label dimensions
      const labelFontSize = Math.round(W * 0.026);
      ac.font = `800 ${labelFontSize}px sans-serif`;
      const labelText = `▲ ${Math.round(maxE)}m`;
      const textW = ac.measureText(labelText).width;
      const pillW = textW + 20;
      const pillH = labelFontSize + 10;
      const pillGap = 6; // px gap between label bottom and dotted line
      const pillX = Math.min(Math.max(peakXc - pillW / 2, 4), W - pillW - 4);
      const pillY = Math.max(peakYc - pillH - pillGap - 8, 2); // sits above the peak

      // Dotted vertical line: from pill bottom → just above peak dot
      const dotRadius = Math.round(W * 0.008);
      ac.save();
      ac.setLineDash([4, 4]);
      ac.strokeStyle = "rgba(245,158,11,0.55)";
      ac.lineWidth = 1.5;
      ac.beginPath();
      ac.moveTo(peakXc, pillY + pillH + pillGap);
      ac.lineTo(peakXc, peakYc - dotRadius - 1);
      ac.stroke();
      ac.setLineDash([]);
      ac.restore();

      // Peak amber dot
      ac.save();
      ac.beginPath();
      ac.arc(peakXc, peakYc, dotRadius + 2, 0, Math.PI * 2);
      ac.fillStyle = "rgba(0,0,0,0.75)";
      ac.fill();
      ac.beginPath();
      ac.arc(peakXc, peakYc, dotRadius, 0, Math.PI * 2);
      ac.fillStyle = "#f59e0b";
      ac.fill();
      ac.restore();

      // Pill background
      ac.save();
      ac.shadowColor = "rgba(0,0,0,0.9)"; ac.shadowBlur = 8;
      ac.fillStyle = "rgba(0,0,0,0.72)";
      ac.beginPath();
      const r = pillH / 2;
      ac.roundRect(pillX, pillY, pillW, pillH, r);
      ac.fill();
      ac.shadowBlur = 0;
      // Pill border
      ac.strokeStyle = "rgba(245,158,11,0.55)";
      ac.lineWidth = 1.2;
      ac.beginPath();
      ac.roundRect(pillX, pillY, pillW, pillH, r);
      ac.stroke();
      // Pill text
      ac.fillStyle = "#fbbf24";
      ac.textAlign = "center";
      ac.textBaseline = "middle";
      ac.fillText(labelText, pillX + pillW / 2, pillY + pillH / 2);
      ac.restore();
    })();

    // ── Pre-project altimetry X/Y into Float32Arrays (O(1) lookup per frame) ───
    const altProjX = new Float32Array(activityPoints.length);
    const altProjY = new Float32Array(activityPoints.length);
    for (let i = 0; i < activityPoints.length; i++) {
      altProjX[i] = (cumDist[i] / totalDistM) * W;
      altProjY[i] = ALT_Y + ALT_PAD_TOP + ALT_H - ((activityPoints[i].ele - minE) / eRange) * (ALT_H * 0.85);
    }

    // ── Pre-compute gauge geometry constants (used every frame — compute once) ──
    const MAX_SPD = STABLE_GAUGE_MAX;
    const gCX = W * 0.20;
    const gCY = H * 0.15;
    const gR  = W * 0.13;
    const GAUGE_START = 0.75 * Math.PI;
    const GAUGE_SWEEP = 1.5  * Math.PI;
    const GAUGE_END   = GAUGE_START + GAUGE_SWEEP;
    const speedToAngle = (s: number) => GAUGE_START + Math.min(s / MAX_SPD, 1) * GAUGE_SWEEP;
    const arcFillGrad = (() => {
      const g = ctx.createLinearGradient(gCX - gR, gCY, gCX + gR, gCY);
      g.addColorStop(0, "#f59e0b"); g.addColorStop(1, "#fbbf24"); return g;
    })();

    // ── Pre-render gauge static layer (vignette + track arc + ticks + hub) ─────
    // Sized to only the area the gauge occupies (top-left ~52%×44%) — not full 1080×1920
    const gaugeCacheW = Math.round(W * 0.52);
    const gaugeCacheH = Math.round(H * 0.44);
    const gaugeCache = document.createElement("canvas");
    gaugeCache.width = gaugeCacheW; gaugeCache.height = gaugeCacheH;
    (() => {
      const gc = gaugeCache.getContext("2d")!;
      // Soft radial shadow behind gauge — subtle depth, no hard box
      const vg = gc.createRadialGradient(gCX, gCY, 0, gCX, gCY, W * 0.42);
      vg.addColorStop(0, "rgba(0,0,0,0.28)"); vg.addColorStop(1, "rgba(0,0,0,0)");
      gc.fillStyle = vg;
      gc.fillRect(0, 0, gaugeCacheW, gaugeCacheH);
      // Track arc
      gc.lineWidth = Math.round(W * 0.022); gc.lineCap = "round";
      gc.strokeStyle = "rgba(255,255,255,0.12)";
      gc.beginPath(); gc.arc(gCX, gCY, gR, GAUGE_START, GAUGE_END); gc.stroke();
      // Tick marks + labels
      gc.lineCap = "butt";
      for (let spd = 0; spd <= MAX_SPD; spd += 10) {
        const a = speedToAngle(spd), cosA = Math.cos(a), sinA = Math.sin(a);
        const isMajor = spd % 20 === 0;
        const outer = gR - Math.round(W * 0.024);
        const inner = outer - (isMajor ? gR * 0.12 : gR * 0.07);
        gc.strokeStyle = isMajor ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)";
        gc.lineWidth = isMajor ? 2.5 : 1.5;
        gc.beginPath();
        gc.moveTo(gCX + cosA * outer, gCY + sinA * outer);
        gc.lineTo(gCX + cosA * inner, gCY + sinA * inner);
        gc.stroke();
        if (isMajor) {
          const lr = inner - gR * 0.12;
          gc.shadowColor = "rgba(0,0,0,1)"; gc.shadowBlur = 10;
          gc.font = `700 ${Math.round(W * 0.024)}px sans-serif`;
          gc.fillStyle = "rgba(255,255,255,0.6)"; gc.textAlign = "center";
          gc.fillText(String(spd), gCX + cosA * lr, gCY + sinA * lr + 5);
          gc.shadowBlur = 0;
        }
      }
      // Hub dot (static, dark center)
      gc.fillStyle = "#1a1a1a";
      gc.beginPath(); gc.arc(gCX, gCY, W * 0.022, 0, Math.PI * 2); gc.fill();
      gc.strokeStyle = "rgba(255,255,255,0.15)"; gc.lineWidth = 1.5; gc.stroke();
    })();

    // ── Helpers ───────────────────────────────────────────────────────────────
    const shadow = (color: string, blur: number) => { ctx.shadowColor = color; ctx.shadowBlur = blur; };
    const noShadow = () => { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; };

    // ── Draw telemetry HUD — dynamic parts only (cache handles static) ─────────
    const drawTelemetry = (idx: number) => {
      const pt1 = activityPoints[idx];
      const pt2 = activityPoints[Math.min(idx + 1, activityPoints.length - 1)];
      if (!pt1) return;
      ctx.save();

      // Layer 1: static gauge (vignette + track + ticks + hub) — small canvas blit
      ctx.drawImage(gaugeCache, 0, 0, gaugeCacheW, gaugeCacheH);

      const frac = state.current.virtualIndex - idx;
      const s1 = Number((pt1 as any).speed) || 0;
      const s2 = Number((pt2 as any).speed) || 0;
      const speedNow = s1 + (s2 - s1) * frac;
      if (speedNow > maxSpeedSeen) maxSpeedSeen = speedNow;

      const d1 = cumDist[idx];
      const d2 = cumDist[Math.min(idx + 1, cumDist.length - 1)];
      const distKm = ((d1 + (d2 - d1) * frac) / DIST_DIVISOR[unit]).toFixed(2);

      const tNow  = pt1.time + (pt2.time - pt1.time) * frac;
      const secs  = (tNow - activityPoints[0].time) / 1000;
      const hhNum = Math.floor(secs / 3600);
      const mm    = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
      const ss    = Math.floor(secs % 60).toString().padStart(2, "0");
      const timeStr = hhNum > 0
        ? `${hhNum.toString().padStart(2, "0")}:${mm}:${ss}`
        : `${mm}:${ss}`;
      const pt = (frac < 0.5 ? pt1 : pt2) as any;

      // Layer 2: speed fill arc (dynamic)
      if (speedNow > 0.5) {
        ctx.strokeStyle = arcFillGrad;
        ctx.lineWidth = Math.round(W * 0.022); ctx.lineCap = "round";
        ctx.shadowColor = "rgba(245,158,11,0.4)"; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(gCX, gCY, gR, GAUGE_START, speedToAngle(speedNow)); ctx.stroke();
        noShadow();
      }

      // Layer 3: max-speed red needle (only redrawn — rarely changes)
      if (maxSpeedSeen > 0.5) {
        const maxAngle = speedToAngle(maxSpeedSeen);
        ctx.save();
        ctx.translate(gCX, gCY); ctx.rotate(maxAngle);
        ctx.strokeStyle = "#ef4444"; ctx.lineWidth = Math.round(W * 0.006);
        ctx.shadowColor = "rgba(239,68,68,0.7)"; ctx.shadowBlur = 10; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-gR * 0.12, 0); ctx.lineTo(gR * 0.82, 0); ctx.stroke();
        ctx.fillStyle = "#ef4444"; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(gR * 0.82, 0, W * 0.006, 0, Math.PI * 2); ctx.fill();
        ctx.restore(); noShadow();
      }

      // Layer 4: speed number + KM/H
      shadow("rgba(0,0,0,0.9)", 20);
      ctx.font = `900 ${Math.round(W * 0.13)}px sans-serif`;
      ctx.fillStyle = speedNow > maxSpeedSeen * 0.9 ? "#fbbf24" : "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(Math.round(speedNow).toString(), gCX, gCY + Math.round(W * 0.015));
      ctx.font = `700 ${Math.round(W * 0.028)}px sans-serif`;
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(SPEED_LABEL[unit], gCX, gCY + Math.round(W * 0.016) + Math.round(W * 0.04));

      // Layer 5: secondary metrics (distance, HR, power, time)
      const metY = gCY + gR + Math.round(H * 0.04);
      shadow("rgba(0,0,0,1)", 25);
      ctx.font = `900 ${Math.round(W * 0.11)}px sans-serif`;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
      ctx.fillText(distKm, W * 0.04, metY);
      const dW = ctx.measureText(distKm).width;
      ctx.font = `700 ${Math.round(W * 0.035)}px sans-serif`;
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(` ${DIST_LABEL[unit]}`, W * 0.04 + dW, metY - 4);

      const subY = metY + Math.round(H * 0.055);
      let groupX = W * 0.04;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.round(W * 0.54), H);
      ctx.clip();
      ctx.font = `900 ${Math.round(W * 0.044)}px sans-serif`;
      if (pt.hr) {
        shadow("rgba(0,0,0,1)", 20);
        ctx.fillStyle = "#ff4d4d";
        ctx.fillText(`\u2665 ${Math.round(pt.hr)}`, groupX, subY);
        groupX += ctx.measureText(`\u2665 ${Math.round(pt.hr)}`).width + Math.round(W * 0.03);
      }
      if (pt.power) {
        shadow("rgba(0,0,0,1)", 20);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`\u26A1 ${Math.round(pt.power)}W`, groupX, subY);
        groupX += ctx.measureText(`\u26A1 ${Math.round(pt.power)}W`).width + Math.round(W * 0.03);
      }
      shadow("rgba(0,0,0,1)", 20);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(`\u23F1 ${timeStr}`, groupX, subY);
      ctx.restore();

      // Intensity bar — top of canvas, full width
      const iScore = storyPlan?.intensityScores?.[idx] ?? 0;
      const barW = Math.round(W * iScore);
      if (barW > 0) {
        const barGrad = ctx.createLinearGradient(0, 0, W, 0);
        barGrad.addColorStop(0,   "#f59e0b");
        barGrad.addColorStop(0.6, "#f97316");
        barGrad.addColorStop(1,   "#ef4444");
        ctx.fillStyle = barGrad;
        ctx.fillRect(0, 0, barW, 6);
      }

      ctx.restore();
    };


    // ── Draw logo PNG top-right ───────────────────────────────────────────────
    const drawLogo = () => {
      if (!logoImg.complete || logoImg.naturalWidth === 0) return;
      ctx.save();
      shadow("rgba(0,0,0,0.7)", 16);
      const lH = Math.round(H * 0.028);
      const lW = (logoImg.naturalWidth / logoImg.naturalHeight) * lH;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(logoImg, W - lW - Math.round(W * 0.06), Math.round(H * 0.04), lW, lH);
      ctx.globalAlpha = 1;
      noShadow();
      ctx.restore();
    };

    // ── Draw GPS marker dot at current map position ───────────────────────────
    const drawMarker = (idx: number, pip?: { x: number; y: number; w: number; h: number }) => {
      if (!mapRef.current) return;
      const pt1 = activityPoints[idx];
      const pt2 = activityPoints[Math.min(idx + 1, activityPoints.length - 1)];
      const frac = state.current.virtualIndex - idx;
      const lon = pt1.lon + (pt2.lon - pt1.lon) * frac;
      const lat = pt1.lat + (pt2.lat - pt1.lat) * frac;

      // Project GPS → CSS px on Mapbox canvas
      const containerRect = mapContainerRef.current!.getBoundingClientRect();
      const projected = mapRef.current.project([lon, lat]);
      const nx = projected.x / containerRect.width;
      const ny = projected.y / containerRect.height;

      const cx = pip ? pip.x + nx * pip.w : nx * W;
      const cy = pip ? pip.y + ny * pip.h : ny * H;
      const dotR = pip ? pip.w * 0.05 : W * 0.015; 
      const glowR = dotR * 3;

      ctx.save();
      // Glow — two concentric alpha circles (no gradient object allocation per frame)
      const pulse = 1 + Math.sin(performance.now() / 200) * 0.2;
      ctx.fillStyle = `rgba(245,158,11,${(0.28 * pulse).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(245,158,11,0.18)";
      ctx.beginPath(); ctx.arc(cx, cy, glowR * 0.55, 0, Math.PI * 2); ctx.fill();
      // White ring
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, dotR * 1.2, 0, Math.PI * 2); ctx.stroke();
      // Amber fill
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath(); ctx.arc(cx, cy, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };

    const drawBroadMap = (idx: number, x: number, y: number, w: number, h: number) => {
        ctx.save();
        ctx.globalAlpha = 0.78; // semi-transparent so video shows through

        // Clip to rounded rect
        ctx.beginPath();
        (ctx as any).roundRect?.(x, y, w, h, 28);
        ctx.clip();

        // Layer 1: pre-cached background (full route dim line) — single drawImage, O(1)
        ctx.drawImage(broadmapCache, x, y, w, h);

        // Layer 2: amber progress trail — incremental paint (O(delta) not O(idx))
        if (idx > lastTrailIdx) {
          const from = Math.max(lastTrailIdx, 0);
          trailCtx.beginPath();
          trailCtx.moveTo(bmProjX[from], bmProjY[from]);
          for (let i = from + 1; i <= idx; i++) {
            trailCtx.lineTo(bmProjX[i], bmProjY[i]);
          }
          trailCtx.stroke();
          lastTrailIdx = idx;
        }
        ctx.drawImage(trailCache, 0, 0, pipW, pipH, x, y, w, h);

        // Layer 3: current position dot + glow
        const cx = x + bmProjX[idx];
        const cy = y + bmProjY[idx];
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(245,158,11,0.8)";
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();

        // Border on top
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        (ctx as any).roundRect?.(x, y, w, h, 28);
        ctx.stroke();

        ctx.restore();
    };


    // ── Draw altimetry sparkline — full width, bottom of canvas ──────────────
    // All X/Y pre-computed into Float32Arrays — zero arithmetic per frame
    const drawAltimetry = (idx: number) => {
      ctx.save();

      // Layer 1: cached background (gradient + area fill + curve + labels) — single blit
      ctx.drawImage(altimetryCache, 0, ALT_Y);

      // Layer 2: cursor — O(1) array lookups only, NO shadowBlur
      const curX = altProjX[idx];
      const curY = altProjY[idx];

      // Dashed vertical line
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(curX, ALT_Y + ALT_PAD_TOP);
      ctx.lineTo(curX, ALT_Y + ALT_PAD_TOP + ALT_H);
      ctx.stroke();
      ctx.setLineDash([]);

      // Outer ring (static, no pulsing — no Math.sin per frame)
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(curX, curY, 8, 0, Math.PI * 2);
      ctx.stroke();

      // White dot — NO shadowBlur
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(curX, curY, 5, 0, Math.PI * 2);
      ctx.fill();

      // Amber core — NO shadowBlur
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(curX, curY, 3, 0, Math.PI * 2);
      ctx.fill();

      // Elevation label — single text draw, shadow reset after
      shadow("rgba(0,0,0,0.9)", 10);
      ctx.font = `800 ${Math.round(W * 0.03)}px sans-serif`;
      ctx.fillStyle = "#fbbf24";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(activityPoints[idx].ele)}m`,
        Math.min(Math.max(curX, 40), W - 40), curY - 10);
      noShadow();

      ctx.restore();
    };

    // ── Pre-create intro gradients once — reused every frame, no per-frame allocation ──
    const introVignette = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 1.2);
    introVignette.addColorStop(0, "rgba(0,0,0,0.22)");
    introVignette.addColorStop(0.6, "rgba(0,0,0,0.48)");
    introVignette.addColorStop(1, "rgba(0,0,0,0.88)");
    const introSepGrad = ctx.createLinearGradient(W / 2 - W * 0.3, 0, W / 2 + W * 0.3, 0);
    introSepGrad.addColorStop(0, "transparent");
    introSepGrad.addColorStop(0.5, "#f59e0b");
    introSepGrad.addColorStop(1, "transparent");

    // Title layout cache — computes font size (per longest word) and wrapped lines.
    // Recomputed only when title string changes, never per-frame.
    let _cachedTitleText = "";
    let _cachedTitleFontSize = Math.round(W * 0.19);
    let _cachedTitleLines: string[] = ["EPIC RIDE"];
    const getTitleLayout = (title: string): { fontSize: number; lines: string[] } => {
      if (title === _cachedTitleText) return { fontSize: _cachedTitleFontSize, lines: _cachedTitleLines };
      _cachedTitleText = title;

      // 1. Base font on longest single word so each word always fits on its line
      const longestWord = title.split(/[\s\-]+/).reduce((a, b) => a.length > b.length ? a : b, title);
      let sz = Math.round(W * 0.19);
      const minSz = Math.round(W * 0.055);
      ctx.font = `900 italic ${sz}px sans-serif`;
      while (ctx.measureText(longestWord).width > W * 0.88 && sz > minSz) {
        sz -= 1;
        ctx.font = `900 italic ${sz}px sans-serif`;
      }

      // 2. Word-wrap the full title at that font size
      const maxLineW = W * 0.88;
      const words = title.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxLineW && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      _cachedTitleFontSize = sz;
      _cachedTitleLines = lines;
      return { fontSize: sz, lines };
    };

    // ── Intentional empty block — title/location/devices now read live from ref ─
    {
      // (block kept to avoid diff conflicts with downstream code)
    }

    // ── Draw INTRO cinematic screen — animated reveal ─────────────────────────
    const drawIntro = (elapsed: number) => {
      const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

      // Read live metadata (ref is kept in sync by a dedicated useEffect)
      const liveMeta      = activityMetaRef.current;
      const actTitle      = liveMeta?.name     || "EPIC RIDE";
      const actLocation   = liveMeta?.location || "";
      const gpsDeviceInfo = liveMeta?.gpsDevice;
      const cameraInfo    = liveMeta?.camera;
      const { fontSize: titleFontSize, lines: titleLines } = getTitleLayout(actTitle);

      ctx.save();

      // ── 1. Cinematic vignette — reuse pre-created gradient (no allocation per frame) ──
      ctx.fillStyle = introVignette;
      ctx.fillRect(0, 0, W, H);

      // ── 2. Letterbox bars — retract from 30% → 5px over 700ms ─────────────
      const barProg = easeOut(elapsed / 700);
      const barH = Math.round(lerp(H * 0.30, 5, barProg));
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, W, barH);           // top bar
      ctx.fillRect(0, H - barH, W, barH);    // bottom bar
      // Amber accent on bar edge
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(0, barH - 4, W, 4);
      ctx.fillRect(0, H - barH, W, 4);

      // ── 3. Logo — fades in at 500ms ────────────────────────────────────────
      const logoAlpha = easeOut(clamp01((elapsed - 500) / 400));
      if (logoAlpha > 0.01 && logoImg.complete && logoImg.naturalWidth > 0) {
        const lH = Math.round(H * 0.06);
        const lW = (logoImg.naturalWidth / logoImg.naturalHeight) * lH;
        const logoY = H * 0.14 + (1 - logoAlpha) * 20;
        ctx.globalAlpha = logoAlpha * 0.85;
        shadow("rgba(0,0,0,0.8)", 20);
        ctx.drawImage(logoImg, (W - lW) / 2, logoY, lW, lH);
        ctx.globalAlpha = 1;
        noShadow();
      }

      // ── 4. Activity title — multi-line, scales in + fades from 750ms ────────
      const titleAlpha = easeOut(clamp01((elapsed - 750) / 500));
      if (titleAlpha > 0.01) {
        const titleScale = lerp(1.10, 1.0, easeOut(clamp01((elapsed - 750) / 600)));
        const lineH      = titleFontSize * 1.08;
        const blockH     = titleLines.length * lineH;
        // Block center: slightly above midpoint, shifts up a little if location follows
        const blockCenterY = H * (actLocation ? 0.395 : 0.430);
        const blockTopY    = blockCenterY - blockH / 2;

        ctx.save();
        ctx.globalAlpha = titleAlpha;
        shadow("rgba(0,0,0,1)", 60);
        ctx.font = `900 italic ${titleFontSize}px sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        titleLines.forEach((line, i) => {
          const lineBaseY = blockTopY + lineH * (i + 0.82) + (1 - titleAlpha) * 18;
          ctx.save();
          ctx.translate(W / 2, lineBaseY);
          ctx.scale(titleScale, titleScale);
          ctx.fillText(line, 0, 0);
          ctx.restore();
        });
        ctx.restore();
        noShadow();
      }

      // ── 5. Location subtitle — tight below title block ────────────────────
      if (actLocation) {
        const locAlpha = easeOut(clamp01((elapsed - 1100) / 400));
        if (locAlpha > 0.01) {
          // Position below title block: blockCenterY + blockH/2 + small gap
          const { fontSize: tfsz, lines: tlines } = getTitleLayout(actTitle);
          const blockBottom = H * 0.395 + (tlines.length * tfsz * 1.08) / 2;
          const locY = blockBottom + Math.round(W * 0.055) + (1 - locAlpha) * 10;
          ctx.save();
          ctx.globalAlpha = locAlpha * 0.62;
          shadow("rgba(0,0,0,0.9)", 10);
          ctx.font = `400 ${Math.round(W * 0.032)}px sans-serif`;
          ctx.fillStyle = "#d0d0d0";
          ctx.textAlign = "center";
          ctx.letterSpacing = "0.18em";
          ctx.fillText(actLocation.toUpperCase(), W / 2, locY);
          ctx.letterSpacing = "0em";
          ctx.restore();
          noShadow();
        }
      }

      // ── 6. Separator line draws left → right ──────────────────────────────
      const sepProg = easeOut(clamp01((elapsed - 1480) / 350));
      if (sepProg > 0.01) {
        const sepAlpha = Math.min(sepProg * 2, 1);
        const sepY = H * 0.535;
        const sepHalfMax = W * 0.3;
        ctx.globalAlpha = sepAlpha * 0.7;
        // Reuse pre-created intro separator gradient (no allocation per frame)
        ctx.strokeStyle = introSepGrad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 2 - sepHalfMax * sepProg, sepY);
        ctx.lineTo(W / 2 + sepHalfMax * sepProg, sepY);
        ctx.stroke();
        ctx.globalAlpha = 1;
        noShadow();
      }

      // ── 7. Stats — horizontal info rows with count-up ───────────────────────
      const totalSecs  = activityPoints.length > 1
        ? (activityPoints[activityPoints.length - 1].time - activityPoints[0].time) / 1000 : 0;
      const finalDistKm = cumDist[cumDist.length - 1] / DIST_DIVISOR[unit];
      const finalAvgSpd = totalSecs > 0 ? finalDistKm / (totalSecs / 3600) : 0;

      const STAT_START = 1800;
      const COUNT_DUR  = 700;

      const statRows: { label: string; delay: number; countFn: (p: number) => string }[] = [
        {
          label: "DISTANCE",
          delay: STAT_START,
          countFn: (p) => `${(finalDistKm * p).toFixed(1)} ${DIST_LABEL[unit]}`,
        },
        {
          label: "DURATION",
          delay: STAT_START + 140,
          countFn: (p) => {
            const cs  = totalSecs * p;
            const ch  = Math.floor(cs / 3600);
            const cm  = Math.floor((cs % 3600) / 60).toString().padStart(2, "0");
            const cse = Math.floor(cs % 60).toString().padStart(2, "0");
            return totalSecs >= 3600
              ? `${ch.toString().padStart(2, "0")}:${cm}:${cse}`
              : `${cm}:${cse}`;
          },
        },
        {
          label: "AVG SPEED",
          delay: STAT_START + 280,
          countFn: (p) => `${(finalAvgSpd * p).toFixed(1)} ${SPEED_LABEL[unit]}`,
        },
      ];

      const listTop  = H * 0.60;
      const rowH     = Math.round(H * 0.068);
      const padL     = Math.round(W * 0.08);
      const padR     = Math.round(W * 0.08);
      const lblFont  = `500 ${Math.round(W * 0.024)}px sans-serif`;
      const valFont  = `900 ${Math.round(W * 0.068)}px sans-serif`;

      statRows.forEach((s, i) => {
        const alpha     = easeOut(clamp01((elapsed - s.delay) / 400));
        if (alpha < 0.01) return;
        const countProg = easeOut(clamp01((elapsed - s.delay) / COUNT_DUR));
        const rowY      = listTop + i * rowH;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Top separator line
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(padL, rowY);
        ctx.lineTo(W - padR, rowY);
        ctx.stroke();

        // Label — left, dim small caps
        shadow("rgba(0,0,0,0.8)", 6);
        ctx.font      = lblFont;
        ctx.fillStyle = "rgba(255,255,255,0.38)";
        ctx.textAlign = "left";
        ctx.fillText(s.label, padL, rowY + rowH * 0.70);

        // Value + unit — right, bold, count-up
        const displayVal = s.countFn(countProg);
        shadow("rgba(0,0,0,1)", 20);
        ctx.font      = valFont;
        ctx.fillStyle = countProg >= 0.98 ? "#ffffff" : "#fbbf24";
        ctx.textAlign = "right";
        ctx.fillText(displayVal, W - padR, rowY + rowH * 0.74);

        // Bottom separator on last row
        if (i === statRows.length - 1) {
          noShadow();
          ctx.strokeStyle = "rgba(255,255,255,0.10)";
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(padL, rowY + rowH);
          ctx.lineTo(W - padR, rowY + rowH);
          ctx.stroke();
        }

        ctx.restore();
        noShadow();
      });

      // ── 8. Equipment logos footer — logos only, frosted pill background ──────
      // Rule: show logo if available, nothing if not. No text labels.
      const equipAlpha = easeOut(clamp01((elapsed - 2400) / 500));
      const equipDevices = ([
        gpsDeviceInfo?.logoFile ? gpsDeviceInfo : null,
        cameraInfo?.logoFile    ? cameraInfo    : null,
      ] as const).filter(Boolean) as NonNullable<typeof gpsDeviceInfo>[];

      if (equipAlpha > 0.01 && equipDevices.length > 0) {
        ctx.save();

        const iconH  = Math.round(H * 0.030);
        const padH   = Math.round(W * 0.04);  // horizontal padding inside pill
        const padV   = Math.round(H * 0.009); // vertical padding
        const dotGap = Math.round(W * 0.055); // space around separator dot

        // Measure each logo width
        const imgs = equipDevices.map(d => getLogoImg(d.logoFile));
        const widths = imgs.map(img =>
          img.complete && img.naturalWidth > 0
            ? (img.naturalWidth / img.naturalHeight) * iconH
            : iconH // fallback square until loaded
        );
        const totalLogoW = widths.reduce((a, b) => a + b, 0)
          + (equipDevices.length === 2 ? dotGap : 0);
        const pillW = totalLogoW + padH * 2;
        const pillH = iconH + padV * 2;
        const pillX = (W - pillW) / 2;
        const pillY = Math.round(H * 0.862) - pillH;

        // Frosted glass pill
        ctx.globalAlpha = equipAlpha * 0.9;
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        const r = pillH / 2;
        ctx.beginPath();
        if ((ctx as any).roundRect) {
          (ctx as any).roundRect(pillX, pillY, pillW, pillH, r);
        } else {
          ctx.moveTo(pillX + r, pillY);
          ctx.lineTo(pillX + pillW - r, pillY);
          ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + r, r);
          ctx.lineTo(pillX + pillW, pillY + pillH - r);
          ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH, r);
          ctx.lineTo(pillX + r, pillY + pillH);
          ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - r, r);
          ctx.lineTo(pillX, pillY + r);
          ctx.arcTo(pillX, pillY, pillX + r, pillY, r);
          ctx.closePath();
        }
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.30)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw logos
        ctx.globalAlpha = equipAlpha;
        const logoY = pillY + padV;

        if (equipDevices.length === 2) {
          const cx = W / 2;
          // Left logo (right-aligned to center gap)
          if (widths[0] > 0) ctx.drawImage(imgs[0], cx - dotGap / 2 - widths[0], logoY, widths[0], iconH);
          // Amber separator dot
          ctx.globalAlpha = equipAlpha * 0.55;
          ctx.fillStyle = "#f59e0b";
          ctx.beginPath();
          ctx.arc(cx, pillY + pillH / 2, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = equipAlpha;
          // Right logo
          if (widths[1] > 0) ctx.drawImage(imgs[1], cx + dotGap / 2, logoY, widths[1], iconH);
        } else {
          if (widths[0] > 0) ctx.drawImage(imgs[0], (W - widths[0]) / 2, logoY, widths[0], iconH);
        }

        ctx.restore();
      }

      ctx.restore();
    };

    // ── Pre-create brand glow gradient (constant geometry, only opacity varies) ─
    const brandGlowGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
    brandGlowGrad.addColorStop(0, "rgba(245,158,11,0.15)");
    brandGlowGrad.addColorStop(1, "rgba(245,158,11,0)");

    // ── Draw BRAND finale screen (cinematic) ─────────────────────────────────
    const drawBrand = (progress: number) => {
      // progress: 0 → 1 mapped over BRAND_DURATION ms
      ctx.save();

      // Phase 1 (0→0.35): expanding dark circle wipes the screen
      const wipeP = Math.min(progress / 0.35, 1);
      const r = wipeP * W * 1.8;
      ctx.fillStyle = "#060606";
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.fill();

      // Phase 2 (0.3→1): fade in amber radial glow + content
      if (progress > 0.3) {
        const fadeIn = Math.min((progress - 0.3) / 0.3, 1);

        // Amber radial glow — reuse pre-created gradient, scale via globalAlpha
        ctx.globalAlpha = fadeIn;
        ctx.fillStyle = brandGlowGrad;
        ctx.fillRect(0, 0, W, H);

        ctx.globalAlpha = fadeIn;
        shadow("rgba(0,0,0,0.9)", 30);

        // "LENS" — large, bold, matching landing page font-black tracking-tight
        ctx.font = `900 ${Math.round(W * 0.26)}px sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.97)";
        ctx.textAlign = "center";
        ctx.letterSpacing = "-0.02em";
        ctx.fillText("LENS", W / 2, H * 0.35);
        ctx.letterSpacing = "0em";

        // Amber accent line below LENS
        ctx.globalAlpha = fadeIn * 0.7;
        ctx.fillStyle = "#f59e0b";
        const accentW = Math.round(W * 0.18);
        ctx.fillRect((W - accentW) / 2, H * 0.375, accentW, Math.round(H * 0.003));

        ctx.globalAlpha = fadeIn;

        // "DEVELOPED BY"
        ctx.font = `300 ${Math.round(W * 0.038)}px sans-serif`;
        ctx.fillStyle = "rgba(160,160,160,0.7)";
        ctx.letterSpacing = "0.3em";
        ctx.fillText("DEVELOPED BY", W / 2, H * 0.44);
        ctx.letterSpacing = "0em";

        // ProRefuel logo large + glow
        if (logoImg.complete && logoImg.naturalWidth > 0) {
          const lH = Math.round(H * 0.075);
          const lW = (logoImg.naturalWidth / logoImg.naturalHeight) * lH;
          ctx.shadowColor = "rgba(245,158,11,0.6)";
          ctx.shadowBlur = 60;
          ctx.drawImage(logoImg, (W - lW) / 2, H * 0.465, lW, lH);
          noShadow();
        }

        // Tagline
        if (progress > 0.65) {
          const tagAlpha = Math.min((progress - 0.65) / 0.2, 1);
          ctx.globalAlpha = fadeIn * tagAlpha;
          ctx.font = `400 ${Math.round(W * 0.030)}px sans-serif`;
          ctx.fillStyle = "rgba(245,158,11,0.75)";
          ctx.fillText("lens.prorefuel.app", W / 2, H * 0.575);
        }

        // Amber bottom accent line
        ctx.globalAlpha = fadeIn;
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(0, H - 4, W, 4);

        ctx.globalAlpha = 1;
      }
      ctx.restore();
    };
    const BRAND_DURATION = 3500; // ms — recording stays alive 3.5s for full brand reveal

    // ── Brand timing tracker ──────────────────────────────────────────────────
    let brandStartTime = 0;
    let introStartTime = 0;
    let brandStopScheduled = false;
    let maxSpeedSeen = 0; // tracks peak speed for frozen red needle

    // ── Main composite loop — rAF with 30ms guard (exactly 2 rAF ticks at 60Hz) ──
    // rAF fires every 16.67ms. Guard of 30ms ensures we always land on tick #2 (33ms = 30fps).
    // Using 33.3ms was the bug: it sat exactly at the 2-tick boundary so any jitter bumped it
    // to tick #3 (50ms = 20fps). 30ms is safely below 2 ticks → always fires at 33ms.
    // rAF is critical vs setInterval: ctx.drawImage(videoEl) syncs with the video frame update
    // cycle. setInterval fires mid-decode and captures duplicate/stale frames → jerky motion.
    const TARGET_FPS = 30;
    const FRAME_MS = 1000 / TARGET_FPS;
    let lastFrameCount = -1;
    let recordingStartTime = 0;

    // ── Cross-dissolve transition buffer ─────────────────────────────────────
    const transCanvas = document.createElement("canvas");
    transCanvas.width = W; transCanvas.height = H;
    const transCtx = transCanvas.getContext("2d")!;
    let prevVm = "INTRO";
    let transStart = -1;
    const rhythm = storyPlan?.narrativePlan?.editingRhythm ?? "MEDIUM";
    const TRANS_DUR = rhythm === "FAST" ? 280 : rhythm === "SLOW" ? 750 : 480;

    // ── Clip-to-clip cinematic crossfade ─────────────────────────────────────
    let prevCompositeSegIdx = -1;
    let clipTransStart2 = -1;
    const CLIP_TRANS_DUR = 900;
    const CLIP_TRANS_DELAY_B = 120;
    const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const clipSnapCanvas = new OffscreenCanvas(W, H);
    const clipSnapCtx = clipSnapCanvas.getContext('2d')!;

    const compositeLoop = (now: DOMHighResTimeStamp) => {
      if (!recordingRef.current) return;

      if (recordingStartTime === 0) recordingStartTime = now;
      const frameCount = Math.floor((now - recordingStartTime) / FRAME_MS);
      if (frameCount <= lastFrameCount) {
        recordingRef.current.compositeLoop = requestAnimationFrame(compositeLoop as FrameRequestCallback);
        return;
      }
      lastFrameCount = frameCount;

      const vm = state.current.viewMode;
      const idx = Math.floor(state.current.virtualIndex);

      // Detect mode change → snapshot last complete frame of old mode
      if (vm !== prevVm) {
        transCtx.drawImage(offscreen, 0, 0);
        transStart = now;
        prevVm = vm;
      }

      // ── Clip-to-clip cinematic crossfade detection (BEFORE clear) ───────────
      // ctx.canvas still contains the previous frame — snapshot it before clearing
      {
        const csi = (state.current as any).currentSegIdx ?? -1;
        if (vm === "ACTION") {
          if (csi !== prevCompositeSegIdx) {
            if (prevCompositeSegIdx !== -1 && clipTransStart2 < 0) {
              // Snapshot the outgoing frame (previous frame still in canvas)
              clipSnapCtx.drawImage(ctx.canvas, 0, 0);
              clipTransStart2 = now;
            }
            prevCompositeSegIdx = csi;
          }
        } else {
          prevCompositeSegIdx = -1;
          clipTransStart2 = -1;
        }
      }

      // Background
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, W, H);

      if (vm === "BRAND") {
        if (brandStartTime === 0) brandStartTime = performance.now();
        const elapsed = performance.now() - brandStartTime;
        const progress = Math.min(elapsed / BRAND_DURATION, 1);
        // Draw map base then overlay brand wipe
        try { ctx.drawImage(mapCanvas, 0, 0, W, H); } catch {}
        drawBrand(progress);
        
        // Stop recording only after full brand animation completes
        if (progress >= 1 && !brandStopScheduled && recordingRef.current) {
          brandStopScheduled = true;
          const { recorder: rec, compositeLoop: cl } = recordingRef.current;
          cancelAnimationFrame(cl);
          recordingRef.current = null;
          if (rec.state === "recording") rec.stop();
          return;
        }
      } else if (vm === "ACTION") {
        // GO PRO VIDEO CENTRIC (Highlight clips only)
        // compositeLoop NEVER touches play/pause — animate loop is the sole video controller

        // Draw outgoing clip A as BASE LAYER (full opacity → transparent, scale 1→1.03)
        // Must be drawn BEFORE clip B so B appears on top as it fades in
        if (clipTransStart2 > 0) {
          const elapsed = now - clipTransStart2;
          if (elapsed >= CLIP_TRANS_DUR) {
            clipTransStart2 = -1;
          } else {
            const t = easeInOutCubic(Math.min(elapsed / CLIP_TRANS_DUR, 1));
            const alphaA = 1 - t;
            const scaleA = 1.0 + 0.03 * t;
            const sw = W * scaleA, sh = H * scaleA;
            ctx.save();
            ctx.globalAlpha = alphaA;
            ctx.drawImage(clipSnapCanvas, (W - sw) / 2, (H - sh) / 2, sw, sh);
            ctx.restore();
          }
        }

        // Draw incoming clip B (with crossfade-in animation if transition active)
        if (videoEl) {
          try {
            const vW = videoEl.videoWidth || 1920;
            const vH = videoEl.videoHeight || 1080;
            const canvasAR = W / H;
            const vidAR = vW / vH;
            let sx = 0, sy = 0, sw = vW, sh = vH;
            if (vidAR > canvasAR) { sw = Math.round(vH * canvasAR); sx = Math.round((vW - sw) / 2); }
            else { sh = Math.round(vW / canvasAR); sy = Math.round((vH - sh) / 2); }

            if (videoEl.readyState >= 2) {
              // Incoming clip B animation
              let bAlpha = 1, bScl = 1;
              if (clipTransStart2 > 0) {
                const elapsed = now - clipTransStart2;
                const tRaw = Math.max(0, (elapsed - CLIP_TRANS_DELAY_B) / CLIP_TRANS_DUR);
                const t = easeInOutCubic(Math.min(tRaw, 1));
                bAlpha = t;
                bScl = 1.05 - 0.05 * t;
              }
              ctx.save();
              ctx.globalAlpha = bAlpha;
              const dw = W * bScl, dh = H * bScl;
              ctx.drawImage(videoEl, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
              ctx.restore();
            }
          } catch { /* cross-origin or not-ready — skip frame */ }
        }

        // --- NEW PREMIUM HUD LAYOUT for 1080p ---
        // (W=1080, H=1920)
        
        // 1. Map Broad View Widget (Top-Right) — pipX/pipY/pipW/pipH pre-computed above startRecording
        drawBroadMap(idx, pipX, pipY, pipW, pipH);

        // 2. Altimetry (Bottom-Left / Bottom)
        drawAltimetry(idx);

        // 3. Telemetry HUD (Top-Left)
        drawTelemetry(idx);

        // Pre-brand fade overlay — drawn last so it covers everything
        const fade = preBrandFadeRef.current;
        if (fade > 0) {
          ctx.globalAlpha = fade;
          ctx.fillStyle = "#050505";
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
        }

      } else {

        // Scenario A: Short Activity or INTRO — Map layout
        try { ctx.drawImage(mapCanvas, 0, 0, W, H); } catch {}

        if (vm === "INTRO") {
          if (introStartTime === 0) introStartTime = performance.now();
          drawIntro(performance.now() - introStartTime);
        } else if (vm === "MAP") {
          drawTelemetry(idx);
          drawMarker(idx);
          drawAltimetry(idx);
        }
      }

      // Cross-dissolve: overlay the previous-mode snapshot fading out
      if (transStart > 0 && now - transStart < TRANS_DUR) {
        const t = (now - transStart) / TRANS_DUR;
        // easeInQuad fade-out: starts opaque, accelerates to transparent
        ctx.globalAlpha = Math.pow(1 - t, 1.6);
        ctx.drawImage(transCanvas, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }

      recordingRef.current.compositeLoop = requestAnimationFrame(compositeLoop as FrameRequestCallback);
    };

    recorder.start();
    recordingRef.current = { recorder, compositeLoop: requestAnimationFrame(compositeLoop as FrameRequestCallback) };
    setIsRecording(true);
    startExperience();

  };


  // Wire the ref so the map 'load' closure can access startRecording safely
  startRecordingRef.current = startRecording;

  useImperativeHandle(ref, () => ({
    start: startExperience,
    startRecording,
    isRecording,
  }));

  // Recording stop is handled exclusively inside compositeLoop (brandStopScheduled flag)
  // to ensure the full 3.5s brand animation is captured before stopping.

  const isEnding = activityPoints.length > 0 && currentIndex > 0 && currentIndex >= activityPoints.length - 20;

  return (
    <div className="relative w-full h-full bg-[#050505] overflow-hidden mapbox-wrapper-hack">

      {/* TRANSCODING OVERLAY */}
      {isTranscoding && (
        <div className="absolute inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center gap-4">
          <svg className="animate-spin text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="40" height="40">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-white text-xs font-black uppercase tracking-[0.3em]">Generating MP4...</p>
          <p className="text-zinc-500 text-[10px] uppercase tracking-widest">Please wait</p>
        </div>
      )}

      {/* RENDER ERROR OVERLAY */}
      {renderError && (
        <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center gap-5 px-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <p className="text-white font-black text-sm uppercase tracking-wide mb-2">
              {renderError.isOOM ? "Out of Memory" : "Render Failed"}
            </p>
            <p className="text-zinc-400 text-xs leading-relaxed">{renderError.message}</p>
          </div>
          <button
            onClick={() => setRenderError(null)}
            className="px-6 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-[11px] font-black uppercase tracking-widest hover:bg-zinc-700 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: `
        .mapbox-wrapper-hack .mapboxgl-canvas { width: 100% !important; height: 100% !important; }
        .mapbox-wrapper-hack { outline: none; }

        @keyframes introBarTop    { from { height: 30% } to { height: 5px } }
        @keyframes introBarBot    { from { height: 30% } to { height: 5px } }
        @keyframes introFadeSlide { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes introScaleIn   { from { opacity: 0; transform: scale(1.14) } to { opacity: 1; transform: scale(1) } }
        @keyframes introSepDraw   { from { width: 0; opacity: 0 } to { width: 60%; opacity: 1 } }
        @keyframes introStatUp    { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes cutFlash {
          0%   { opacity: 0; animation-timing-function: ease-in; }
          28%  { opacity: 1; animation-timing-function: ease-out; }
          100% { opacity: 0; }
        }
        @keyframes sceneLabelIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes clipTransOut {
          0%   { opacity: 1; transform: scale(1.00); }
          100% { opacity: 0; transform: scale(1.03); }
        }
        @keyframes clipTransIn {
          0%   { opacity: 0; transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1.00); }
        }

        .intro-bar-top  { animation: introBarTop  700ms cubic-bezier(0.16,1,0.3,1) 0ms    both; }
        .intro-bar-bot  { animation: introBarBot  700ms cubic-bezier(0.16,1,0.3,1) 0ms    both; }
        .intro-logo     { animation: introFadeSlide 450ms ease-out              500ms  both; }
        .intro-epic     { animation: introScaleIn   500ms cubic-bezier(0.16,1,0.3,1) 750ms  both; }
        .intro-ride     { animation: introScaleIn   500ms cubic-bezier(0.16,1,0.3,1) 1050ms both; }
        .intro-sep      { animation: introSepDraw   400ms ease-out              1450ms both; }
        .intro-stat-0   { animation: introStatUp    450ms ease-out              1800ms both; }
        .intro-stat-1   { animation: introStatUp    450ms ease-out              1950ms both; }
        .intro-stat-2   { animation: introStatUp    450ms ease-out              2100ms both; }
      `}} />

      {/* 1. MAPA DYNAMIC LAYER — Mapbox fullscreen (MAP/INTRO/BRAND only; idle in ACTION) */}
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", transition: "opacity 800ms ease" }}
        className={`absolute z-30 bg-zinc-900 overflow-hidden
          ${viewMode === "ACTION"
            ? "opacity-0 pointer-events-none"
            : "opacity-100"
          }
        `}
      />

      {/* 1b. MINI-MAP Canvas 2D (ACTION mode only) — polyline + dot, Mapbox-free, low CPU */}
      <canvas
        ref={miniMapCanvasRef}
        width={360}
        height={290}
        className={`absolute z-40 rounded-[1.2rem] shadow-[0_8px_32px_rgba(0,0,0,0.7)]
          transition-opacity duration-700 pointer-events-none
          ${viewMode === "ACTION" ? "opacity-85" : "opacity-0"}
        `}
        style={{ top: "20px", right: "3%", width: "47%", aspectRatio: "360/290" }}
      />

      {/* 2. VÍDEO FULLSCREEN */}
      <div
        className={`absolute inset-0 z-20 bg-black overflow-hidden transition-opacity ease-out pointer-events-none ${viewMode === "ACTION" ? "opacity-100 duration-300" : viewMode === "BRAND" ? "opacity-0 duration-[1800ms]" : "opacity-0 duration-1000"}`}
      >

        {/* Outgoing clip snapshot — z-index 0 (below video) — animates out while new clip fades in */}
        <canvas
          ref={clipTransCanvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{
            width: '100%', height: '100%',
            transformOrigin: 'center center',
            zIndex: 0,
          }}
        />

        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ zIndex: 1 }}
            playsInline
          />
        )}

      </div>

      {/* 2.1 PRE-BRAND FADE — escurece o vídeo nos 2s antes do logo */}
      {/* Synced with audio preroll: starts together, covers everything above the video */}
      <div
        className="absolute inset-0 z-[45] pointer-events-none bg-[#050505]"
        style={{ opacity: preBrandFade }}
      />

      {/* 2.5 GRÁFICO DE ALTIMETRIA — full width, bottom, always */}
      <div
        style={{
           bottom: 0,
           left: 0,
           width: "100%",
           height: "15vh",
           transition: "opacity 800ms ease",
           opacity: (viewMode === "INTRO" || viewMode === "BRAND" || isEnding) ? 0 : 1
        }}
        className="absolute z-40 pointer-events-none"
      >
         <AltimetryGraph points={activityPoints} currentIndex={currentIndex} unit={unit} />
      </div>

      {/* 3. ACTIVITY TELEMETRY (Cinematic entry delay) */}
      <div 
         style={{
            opacity: (viewMode === "INTRO" || viewMode === "BRAND" || isEnding) ? 0 : 1,
            transition: (viewMode === "INTRO" || viewMode === "BRAND" || isEnding) 
               ? "opacity 500ms ease-in" 
               : "opacity 1500ms ease-out 1500ms"
         }}
         className="absolute inset-0 z-50 pointer-events-none"
      >
         <TelemetryHUD points={activityPoints as any} currentIndex={currentIndex} hrMax={hrMax} intensityScores={storyPlan?.intensityScores} unit={unit} />
      </div>


      {/* 4. BRANDING FINAL — fundo preto full-screen */}
      {/* Fade-in rápido (300ms) para cobrir o mapa antes que o vídeo acabe de desaparecer */}
      <div className={`absolute inset-0 z-50 bg-[#050505] pointer-events-none transition-opacity duration-[300ms] ease-in ${
        viewMode === "BRAND" ? "opacity-100" : "opacity-0"
      }`} />
      <div
        className={`absolute inset-0 z-50 flex flex-col items-center justify-center gap-0 transition-opacity duration-1000 delay-[600ms] ${viewMode === "BRAND" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        {/* LENS — font-black tracking-tight matching landing page */}
        <p className="text-white font-black tracking-tight leading-none mb-2"
          style={{ fontSize: "clamp(3.5rem, 22vw, 7rem)", letterSpacing: "-0.02em" }}>
          LENS
        </p>
        {/* Amber accent line */}
        <div className="w-16 h-[2px] bg-amber-500 mb-5 rounded-full opacity-80" />
        <p className="text-zinc-500 text-[9px] uppercase font-bold tracking-[0.4em] mb-3">
          Developed by
        </p>
        <img src="/prorefuel_logo.png" alt="ProRefuel"
          className="w-1/2 max-w-[180px] drop-shadow-[0_0_30px_rgba(245,158,11,0.25)] animate-pulse" />
        <p className="text-amber-500/70 text-[9px] font-bold tracking-widest uppercase mt-4">
          lens.prorefuel.app
        </p>
      </div>

      {/* Cut flash — mode transitions + within-ACTION clip changes (BRAND has its own fade) */}
      {viewMode !== "BRAND" && (
        <div
          key={`flash-${viewMode}`}
          className="absolute inset-0 pointer-events-none bg-[#050505]"
          style={{ zIndex: 9999, animation: 'cutFlash 520ms forwards' }}
        />
      )}

      {/* 0. INTRO SCREEN — cinematic animated */}
      <div
        key={viewMode === "INTRO" ? "intro-on" : "intro-off"}
        className={`absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-700 ${viewMode === "INTRO" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.85) 100%)' }}
      >
        {/* Cinematic letterbox — bars retract from 30% → 5px */}
        <div className="intro-bar-top absolute top-0 left-0 right-0 bg-[#050505] origin-top"
          style={{ boxShadow: '0 4px 0 0 #f59e0b' }} />
        <div className="intro-bar-bot absolute bottom-0 left-0 right-0 bg-[#050505] origin-bottom"
          style={{ boxShadow: '0 -4px 0 0 #f59e0b' }} />

        {/* Logo */}
        <img src="/prorefuel_logo.png" alt="ProRefuel"
          className="intro-logo absolute w-auto opacity-85 drop-shadow-2xl"
          style={{ height: '6vh', top: '15%' }} />

        {/* Activity title + location — single animated block */}
        {(() => {
          const title = activityMeta?.name || 'EPIC RIDE';

          // Container is max-w-[400px]; on any screen wider than 400px it stays 400px.
          // We must NOT use vw (that's viewport width, not container width).
          // Compute font size in px from the actual container width.
          const containerW = Math.min(
            typeof window !== 'undefined' ? window.innerWidth : 400,
            400
          );
          const availW = containerW * 0.86; // 86% usable width

          // Size based on the longest single word so it never overflows a line.
          // Bold italic sans-serif avg char width ≈ 0.62× font-size.
          const longestWord = title.split(/[\s\-]+/).reduce(
            (a: string, b: string) => (a.length > b.length ? a : b), title
          );
          const byWord  = Math.floor(availW / (Math.max(longestWord.length, 3) * 0.62));
          const byWidth = Math.floor(containerW * 0.185); // hard cap ~18.5% of container
          const fontPx  = Math.max(Math.min(byWord, byWidth), 14);

          return (
            <div className="intro-epic flex flex-col items-center"
              style={{ marginTop: '-3vh', width: '86%' }}>
              <span
                className="font-black uppercase italic select-none text-center block w-full"
                style={{
                  fontSize: `${fontPx}px`,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.05,
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  color: '#ffffff',
                  textShadow: '0 4px 40px rgba(0,0,0,1), 0 0 80px rgba(0,0,0,0.9)',
                }}>
                {title}
              </span>
              {activityMeta?.location && (
                <span
                  className="select-none text-center block"
                  style={{
                    marginTop: '0.30em',
                    fontSize: `${Math.round(fontPx * 0.30)}px`,
                    fontWeight: 300,
                    fontStyle: 'normal',
                    letterSpacing: '0.22em',
                    color: 'rgba(210,210,210,0.72)',
                    textShadow: '0 2px 12px rgba(0,0,0,0.95)',
                    textTransform: 'uppercase',
                  }}>
                  {activityMeta.location}
                </span>
              )}
            </div>
          );
        })()}

        {/* Separator — draws left→right */}
        <div className="intro-sep rounded-full mt-4 mb-4"
          style={{ height: '1.5px', background: 'linear-gradient(to right, transparent, rgba(245,158,11,0.8), transparent)' }} />

        {/* Stats — horizontal info rows */}
        <div className="w-[88%] flex flex-col">
          {[
            { label: 'DISTANCE',  val: totalDistKm,  unit: DIST_LABEL[unit],  cls: 'intro-stat-0' },
            { label: 'DURATION',  val: totalTimeStr, unit: '',                cls: 'intro-stat-1' },
            { label: 'AVG SPEED', val: avgSpeedKmh,  unit: SPEED_LABEL[unit], cls: 'intro-stat-2' },
          ].map((s, i) => (
            <div key={i} className={`${s.cls} flex items-center justify-between`}
              style={{ padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.09)' }}>
              <span className="font-medium uppercase"
                style={{ fontSize: '9px', letterSpacing: '0.10em', color: 'rgba(255,255,255,0.38)' }}>
                {s.label}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-black tabular-nums leading-none text-white"
                  style={{ fontSize: '1.35rem', textShadow: '0 2px 20px rgba(0,0,0,1)' }}>
                  {s.val}
                </span>
                {s.unit && (
                  <span className="font-bold uppercase"
                    style={{ fontSize: '9px', color: '#f59e0b', letterSpacing: '0.06em' }}>
                    {s.unit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Equipment logos — frosted glass pill, logos only, no text labels */}
        {(() => {
          const gpsDev = activityMeta?.gpsDevice;
          const cam    = activityMeta?.camera;
          const showGPS = gpsDev?.logoFile;
          const showCam = cam?.logoFile;
          if (!showGPS && !showCam) return null;
          return (
            <div className="absolute flex justify-center"
              style={{ bottom: '11%', left: 0, right: 0, animation: 'introStatUp 450ms ease-out 2400ms both' }}>
              <div className="flex items-center gap-4 px-5 py-[9px] rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.16)',
                  backdropFilter: 'blur(16px) saturate(1.6)',
                  WebkitBackdropFilter: 'blur(16px) saturate(1.6)',
                  border: '1px solid rgba(255,255,255,0.28)',
                  boxShadow: '0 2px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}>
                {showGPS && (
                  <img src={gpsDev!.logoFile} alt="" className="object-contain" style={{ height: '18px', width: 'auto' }} />
                )}
                {showGPS && showCam && (
                  <div className="rounded-full" style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.22)' }} />
                )}
                {showCam && (
                  <img src={cam!.logoFile} alt="" className="object-contain" style={{ height: '18px', width: 'auto' }} />
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
});

export default MapEngine;
