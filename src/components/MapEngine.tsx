"use client";

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { GPSPoint } from "@/lib/media/GoProEngineClient";
import { ActionSegment } from "@/lib/engine/TelemetryCrossRef";
import { TelemetryHUD } from "./TelemetryHUD";
import { AltimetryGraph } from "./AltimetryGraph";

interface MapEngineProps {
  activityPoints: GPSPoint[];
  highlights: ActionSegment[];
  videoFile: File | null;
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

const MapEngine = forwardRef(({ activityPoints, highlights, videoFile }: MapEngineProps, ref) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const requestRef = useRef<number>(0);

  const [viewMode, setViewMode] = useState<"INTRO" | "MAP" | "ACTION" | "BRAND">("BRAND");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Custom HUD para Scene (e.g. MAX HR)
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [activeValue, setActiveValue] = useState<string | null>(null);

  const state = useRef({
    virtualIndex: 0,
    lastTick: 0,
    isStarted: false,
    currentBearing: 0,
    viewMode: "BRAND" as "INTRO" | "MAP" | "ACTION" | "BRAND",
    pitch: 60,
    zoom: 18,
    activeHighlightIndex: -1 // Rastreia qual highlight block está tocando (se existir)
  });

  const { totalDistKm, totalTimeMin } = React.useMemo(() => {
    let d = 0;
    if (activityPoints.length > 1) {
      for (let i = 0; i < activityPoints.length - 1; i++) {
        d += getDistance(activityPoints[i], activityPoints[i + 1]);
      }
    }
    const tMs = activityPoints.length > 1 ? (activityPoints[activityPoints.length - 1].time - activityPoints[0].time) : 0;
    const t = tMs / 1000 / 60;
    return { totalDistKm: (d / 1000).toFixed(1), totalTimeMin: (!isNaN(t) && t > 0) ? t.toFixed(0) : "--" };
  }, [activityPoints]);

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [videoFile]);

  useEffect(() => {
    if (!mapContainerRef.current || !activityPoints.length || mapRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

    // Evita o warning "The map container element should be empty" causado pelo StrictMode (HMR do Next.js) que re-injeta a canvas.
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
            coordinates: activityPoints.map((pt) => [pt.lon, pt.lat]),
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
      el.className = 'w-6 h-6 rounded-full bg-amber-500 border-4 border-white shadow-[0_0_20px_rgba(245,158,11,1)]';
      
      markerRef.current = new mapboxgl.Marker(el)
        .setLngLat([activityPoints[0].lon, activityPoints[0].lat])
        .addTo(map);

      mapRef.current = map;
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
    if (!mapRef.current) return;
    state.current.lastTick = performance.now();
    state.current.isStarted = true;

    setViewMode("INTRO");
    state.current.viewMode = "INTRO";

    setTimeout(() => {
      if (state.current.viewMode === "INTRO") {
        setViewMode("MAP");
        state.current.viewMode = "MAP";
      }
    }, 6500);

    const animate = (now: number) => {
      if (!state.current.isStarted || !mapRef.current) return;

      const deltaMs = now - state.current.lastTick;
      state.current.lastTick = now;

      const speed = state.current.viewMode === "ACTION" ? 1 : 8;
      // GPS/GPX roda a 1Hz. (1 ponto = 1 segundo real).  
      // Então N pointsPerSec = N vezes a velocidade nominal.
      const pointsPerSec = speed;
      const deltaFrames = (deltaMs / 1000) * pointsPerSec;
      
      if (isNaN(deltaFrames)) {
          state.current.lastTick = now;
          requestRef.current = requestAnimationFrame(animate);
          return;
      }

      state.current.virtualIndex = Math.min(
        state.current.virtualIndex + deltaFrames,
        activityPoints.length - 1
      );
      const idx = Math.floor(state.current.virtualIndex);

      // Failsafe absoluto
      if (isNaN(idx) || idx < 0) {
          requestRef.current = requestAnimationFrame(animate);
          return;
      }

      // Gatilho do Fim de Rota
      if (idx >= activityPoints.length - 1) {
        if (state.current.viewMode !== "BRAND") {
          setViewMode("BRAND");
          state.current.viewMode = "BRAND";
        }
        return;
      }

      setCurrentIndex(idx);

      // LÓGICA DO MULTI-HIGHLIGHT - Verifica em qual cena de ação nós estamos agora!
      let foundHighlight = -1;
      for (let i = 0; i < highlights.length; i++) {
        if (idx >= highlights[i].startIndex && idx <= highlights[i].endIndex) {
          foundHighlight = i;
          break;
        }
      }

      // Mudança de Estado de Ação
      if (foundHighlight !== state.current.activeHighlightIndex) {
         state.current.activeHighlightIndex = foundHighlight;

         if (foundHighlight >= 0 && videoRef.current) {
             const hl = highlights[foundHighlight];
             const elapsedSecondsInRoute = (activityPoints[idx].time - hl.startPoint.time) / 1000;
             // Sincroniza o relógio do vídeo com o exato instante em que o ponto ocorreu
             videoRef.current.currentTime = hl.videoStartTime + elapsedSecondsInRoute;
             videoRef.current.play().catch(e => console.error(e));
             
             setViewMode("ACTION");
             state.current.viewMode = "ACTION";

             setActiveTitle(hl.title);
             setActiveValue(hl.value);

             // Intercepta OnEnded para precaver
             videoRef.current.onended = () => {
                 if (state.current.viewMode === "ACTION") {
                    setViewMode("MAP");
                    state.current.viewMode = "MAP";
                 }
             };
             
         } else {
             // Terminou a Action (saiu do Highlight Range) -> Corta de volta pro mapa 3D!
             if (videoRef.current && state.current.viewMode !== "BRAND") {
                 videoRef.current.pause();
                 setViewMode("MAP");
                 state.current.viewMode = "MAP";
                 setActiveTitle(null);
             }
         }
      }

      // Smooth GPS Interpolation
      const pt1 = activityPoints[idx];
      const pt2 = activityPoints[Math.min(idx + 1, activityPoints.length - 1)];
      
      // Bloqueio de quebra de renderização
      if (!pt1 || !pt2) {
         requestRef.current = requestAnimationFrame(animate);
         return;
      }

      const fraction = state.current.virtualIndex - idx;
      
      const interpLon = pt1.lon + (pt2.lon - pt1.lon) * fraction;
      const interpLat = pt1.lat + (pt2.lat - pt1.lat) * fraction;
      markerRef.current?.setLngLat([interpLon, interpLat]);

      // Câmera & Bearing tracking
      const target = activityPoints[Math.min(idx + 15, activityPoints.length - 1)];
      if (pt1 && target) {
        const distToTarget = getDistance(pt1, target);
        if (distToTarget > 0.00005) {
          const targetBearing = calculateBearing(pt1, target);
          let diff = targetBearing - state.current.currentBearing;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;
          state.current.currentBearing += diff * 0.05;
        }

        const targetPitch = state.current.viewMode === "ACTION" ? 0 : 60;
        const targetZoom = state.current.viewMode === "ACTION" ? 14 : 18;

        state.current.pitch += (targetPitch - state.current.pitch) * 0.05;
        state.current.zoom += (targetZoom - state.current.zoom) * 0.05;

        mapRef.current.jumpTo({
          center: [interpLon, interpLat],
          bearing: state.current.currentBearing,
          pitch: state.current.pitch,
          zoom: state.current.zoom,
        });
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
  };

  useImperativeHandle(ref, () => ({
    start: startExperience,
  }));

  const isEnding = activityPoints.length > 0 && currentIndex > 0 && currentIndex >= activityPoints.length - 20;

  return (
    <div className="relative w-full h-full bg-[#050505] overflow-hidden mapbox-wrapper-hack">
      <style dangerouslySetInnerHTML={{ __html: `
        .mapbox-wrapper-hack .mapboxgl-canvas {
          width: 100% !important;
          height: 100% !important;
        }
        .mapbox-wrapper-hack {
           /* Tweak global para ocultar outlines feios no PIP */
           outline: none;
        }
      `}} />

      {/* 1. MAPA DYNAMIC LAYER (GPU Accelerated Scale) */}
      <div
        ref={mapContainerRef}
        style={{
           bottom: (viewMode === "MAP" || viewMode === "INTRO" || viewMode === "BRAND") ? "0px" : "24px",
           right: (viewMode === "MAP" || viewMode === "INTRO" || viewMode === "BRAND") ? "0px" : "16px",
           width: "100%",
           height: "100%",
           transform: (viewMode === "MAP" || viewMode === "INTRO" || viewMode === "BRAND") ? "scale(1)" : "scale(0.42)",
           transition: "all 1000ms cubic-bezier(0.25, 1, 0.5, 1)",
        }}
        className={`absolute z-30 bg-zinc-900 overflow-hidden transform-gpu origin-bottom-right
          ${viewMode === "MAP" || viewMode === "INTRO"
            ? "border-0 opacity-100 rounded-none shadow-none"
            : viewMode === "ACTION"
              ? "rounded-[3rem] border-[12px] border-amber-500 shadow-[0_0_100px_rgba(245,158,11,0.5)] opacity-100"
              : "rounded-[3rem] border-0 opacity-0 pointer-events-none"
          }
        `}
      />

      {/* 2. VÍDEO FULLSCREEN */}
      <div
        className={`absolute inset-0 z-20 bg-black overflow-hidden transition-opacity duration-1000 ease-out ${viewMode === "ACTION" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            className="w-full h-full object-cover"
            muted
            playsInline
          />
        )}
      </div>

      {/* 2.5 GRÁFICO DE ALTIMETRIA INDEPENDENTE (GPU Scaled) */}
      <div 
        style={{
           bottom: viewMode === "ACTION" ? "24px" : "0px",
           left: viewMode === "ACTION" ? "24px" : "0px",
           width: "100%",
           height: "15vh",
           transform: viewMode === "ACTION" ? "scale(0.45)" : "scale(1)",
           transition: "all 1000ms cubic-bezier(0.25, 1, 0.5, 1)",
           opacity: (viewMode === "INTRO" || viewMode === "BRAND" || isEnding) ? 0 : 1
        }}
        className={`absolute z-40 transform-gpu origin-bottom-left overflow-hidden ${
           viewMode === "ACTION" 
             ? "bg-[#050505]/80 backdrop-blur-xl rounded-[2rem] border-4 border-white/10 shadow-2xl" 
             : "bg-transparent pointer-events-none"
        }`}
      >
         <AltimetryGraph points={activityPoints} currentIndex={currentIndex} />
      </div>

      {/* 3. TELEMETRIA CONSTANTE DA ATIVIDADE (Atraso Cinemático de Entrada) */}
      <div 
         style={{
            opacity: (viewMode === "INTRO" || viewMode === "BRAND" || isEnding) ? 0 : 1,
            transition: (viewMode === "INTRO" || viewMode === "BRAND" || isEnding) 
               ? "opacity 500ms ease-in" 
               : "opacity 1500ms ease-out 1500ms"
         }}
         className="absolute inset-0 z-50 pointer-events-none"
      >
         <TelemetryHUD points={activityPoints as any} currentIndex={currentIndex} />
      </div>

      {/* 3.1 LOGO PERMANENTE */}
      <div className={`absolute top-10 right-6 z-50 pointer-events-none drop-shadow-xl transition-opacity duration-500 ${viewMode === "BRAND" || viewMode === "INTRO" ? "opacity-0" : "opacity-90"}`}>
        <img src="/prorefuel_logo.png" alt="ProRefuel" className="h-[22px] w-auto object-contain" />
      </div>

      {/* 3.2 ACTION HUD (Picos) */}
      <div className={`absolute inset-0 flex flex-col justify-end pb-[16vh] pl-8 z-50 transition-all duration-1000 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] pointer-events-none ${viewMode === "ACTION" && activeTitle ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-32"}`}>
        <div className="flex flex-col items-start gap-[2px]">
          <div className="bg-amber-500 text-black px-4 py-1 skew-x-[-15deg] shadow-lg border-l-4 border-white">
              <span className="block skew-x-[15deg] text-[10px] font-black uppercase tracking-[0.3em]">{activeTitle}</span>
          </div>
          <div className="bg-black/90 backdrop-blur-md px-6 py-2 skew-x-[-15deg] border-l-4 border-amber-500 shadow-2xl">
              <span className="block skew-x-[15deg] text-white text-4xl font-black italic tracking-tighter">{activeValue}</span>
          </div>
        </div>
      </div>

      {/* 4. BRANDING FINAL */}
      <div className={`absolute inset-0 z-50 flex items-center justify-center overflow-hidden pointer-events-none`}>
         <div className={`bg-[#050505] rounded-full aspect-square transition-all duration-[1200ms] ease-in-out origin-center ${
           viewMode === "BRAND" ? "w-[300%] opacity-100" : "w-[0%] opacity-0"
         }`} />
      </div>
      <div
        className={`absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-1000 delay-[600ms] ${viewMode === "BRAND" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-[0.4em] mb-4">
          Developed by
        </p>
        <img src="/prorefuel_logo.png" alt="ProRefuel" className="w-1/2 max-w-[200px] drop-shadow-[0_0_30px_rgba(245,158,11,0.2)] animate-pulse" />
      </div>

      {/* 0. INTRO SCREEN */}
      <div
        className={`absolute inset-0 z-50 bg-black/40 flex flex-col items-center justify-center transition-opacity duration-1000 backdrop-blur-[2px] ${viewMode === "INTRO" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <img src="/prorefuel_logo.png" alt="ProRefuel" className="h-4 w-auto mb-10 opacity-70" />
        <h2 className="text-white text-4xl font-black italic tracking-tighter mb-8 text-center leading-none drop-shadow-2xl">
          PROREFUEL<br /><span className="text-amber-500">EPIC RIDE</span>
        </h2>
        <div className="flex gap-8 text-center bg-black/50 p-6 rounded-3xl border border-white/10 shadow-2xl backdrop-blur-md">
          <div className="flex flex-col items-center">
            <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest mb-1">Distância</p>
            <p className="text-white text-2xl font-black">{totalDistKm} <span className="text-amber-500 text-sm">km</span></p>
          </div>
          <div className="w-[1px] bg-white/10 h-10 self-center" />
          <div className="flex flex-col items-center">
            <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest mb-1">Tempo</p>
            <p className="text-white text-2xl font-black">{totalTimeMin} <span className="text-amber-500 text-sm">min</span></p>
          </div>
        </div>
      </div>
    </div>
  );
});

export default MapEngine;
