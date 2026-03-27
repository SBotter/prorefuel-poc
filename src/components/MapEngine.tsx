"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { GPSPoint } from "@/lib/media/GoProEngine";
import { HighlightSegment } from "@/lib/engine/VideoAnalyzer";

interface MapEngineProps {
  activityPoints: GPSPoint[];
  highlight: HighlightSegment;
  videoFile: File | null;
  onComplete?: () => void;
}

const MapEngine = forwardRef((props: MapEngineProps, ref) => {
  const { activityPoints, highlight, videoFile, onComplete } = props;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const requestRef = useRef<number>(0);

  const [viewMode, setViewMode] = useState<"INTRO" | "MAP" | "ACTION" | "BRAND">("MAP");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const state = useRef({
    virtualIndex: 0,
    lastTick: 0,
    isStarted: false,
    currentBearing: 0,
    viewMode: "MAP" as "INTRO" | "MAP" | "ACTION" | "BRAND",
    pitch: 60,
    zoom: 18,
  });

  // Estatísticas da Rota para a Tela de Intro
  const { totalDistKm, totalTimeMin } = React.useMemo(() => {
    let d = 0;
    if (activityPoints.length > 1) {
      for (let i = 0; i < activityPoints.length - 1; i++) {
        const R = 6371e3;
        const p1 = activityPoints[i];
        const p2 = activityPoints[i + 1];
        const φ1 = (p1.lat * Math.PI) / 180;
        const φ2 = (p2.lat * Math.PI) / 180;
        const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
        const Δλ = ((p2.lon - p1.lon) * Math.PI) / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        d += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    if (!mapContainerRef.current || !activityPoints.length || mapRef.current)
      return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      center: [activityPoints[0].lon, activityPoints[0].lat],
      zoom: 18,
      pitch: 60,
      bearing: 0,
      interactive: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      map.resize();
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: activityPoints.map((p) => [p.lon, p.lat]),
          },
          properties: {},
        },
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 6,
          "line-opacity": 0.8,
        },
      });

      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.backgroundColor = "#fff";
      el.style.borderRadius = "50%";
      el.style.border = "3px solid #f59e0b";
      markerRef.current = new mapboxgl.Marker(el)
        .setLngLat([activityPoints[0].lon, activityPoints[0].lat])
        .addTo(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [activityPoints]);

  const startExperience = () => {
    if (!mapRef.current) return;
    state.current.lastTick = performance.now();
    state.current.isStarted = true;

    // Ativa a INTRO com Fade-In
    setViewMode("INTRO");
    state.current.viewMode = "INTRO";

    // Depois de 6.5s curtindo a intro, o texto esmaece e ficamos com o mapa cru rolando.
    setTimeout(() => {
      if (state.current.viewMode === "INTRO") {
        setViewMode("MAP");
        state.current.viewMode = "MAP";
      }
    }, 6500);

    const animate = (now: number) => {
      if (!state.current.isStarted || !mapRef.current) return;

      const delta = (now - state.current.lastTick) / 1000;
      state.current.lastTick = now;

      // SINCRONIA: 1x se o vídeo estiver rodando, 8x se estiver apenas no mapa
      const speed = state.current.viewMode === "ACTION" ? 1 : 8;

      state.current.virtualIndex += delta * speed;
      const idx = Math.floor(state.current.virtualIndex);

      if (idx >= activityPoints.length - 1) {
        if (state.current.viewMode !== "BRAND") {
          setViewMode("BRAND");
          state.current.viewMode = "BRAND";
        }
        return;
      }

      const fraction = state.current.virtualIndex - idx;
      const p1 = activityPoints[idx];
      const p2 = activityPoints[Math.min(idx + 1, activityPoints.length - 1)];

      const current = {
        lat: p1.lat + (p2.lat - p1.lat) * fraction,
        lon: p1.lon + (p2.lon - p1.lon) * fraction,
        ele: p1.ele,
        time: p1.time,
      };

      const target = activityPoints[Math.min(idx + 15, activityPoints.length - 1)];

      if (current && target) {
        const distToTarget = getDistance(current, target);
        // Só rotaciona se houver movimento real (evita giro 360º quando GPS fica parado numa sinaleira)
        if (distToTarget > 0.00005) {
          const targetBearing = calculateBearing(current, target);
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
          center: [current.lon, current.lat],
          bearing: state.current.currentBearing,
          pitch: state.current.pitch,
          zoom: state.current.zoom,
        });

        markerRef.current?.setLngLat([current.lon, current.lat]);
        setCurrentIndex(idx);

        // TRIGGER DO VÍDEO FULLSCREEN
        const dist = getDistance(current, highlight.startPoint);
        if (dist < 0.0004 && state.current.viewMode === "MAP") {
          setViewMode("ACTION");
          state.current.viewMode = "ACTION";

          // SNAP EXATO: Alinha o mapa perfeitamente com a coordenada de ignição do vídeo
          // para remover a "latência de raio" (o ponto estava entrando no raio e ativando antes da hora)
          let bestIdx = idx;
          let minD = Infinity;
          for (let i = Math.max(0, idx - 10); i < Math.min(activityPoints.length, idx + 30); i++) {
            const d = getDistance(activityPoints[i], highlight.startPoint);
            if (d < minD) { minD = d; bestIdx = i + 0.5; /* +0.5 para fluidez visual na ignição */ }
          }
          state.current.virtualIndex = bestIdx;

          // Desliga terreno 3D pesado para a GPU salvar quadros no PIP Mode.
          mapRef.current?.setTerrain(null);

          if (videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(console.error);

            // Fim Cinemático: 1.5s antes do vídeo acabar, a tela engole tudo
            videoRef.current.ontimeupdate = () => {
              const v = videoRef.current;
              if (v && v.duration > 0 && v.duration - v.currentTime <= 1.5) {
                if (state.current.viewMode !== "BRAND") {
                  setViewMode("BRAND");
                  state.current.viewMode = "BRAND";
                }
              }
            };

            // Fallback caso o evento de tempo falhe
            videoRef.current.onended = () => {
              if (state.current.viewMode !== "BRAND") {
                setViewMode("BRAND");
                state.current.viewMode = "BRAND";
              }
            };
          }
        }
      }
      requestRef.current = requestAnimationFrame(animate);
    };
    requestRef.current = requestAnimationFrame(animate);
  };

  useImperativeHandle(ref, () => ({ start: startExperience }));

  return (
    <div className="relative w-full h-full aspect-[9/16] bg-black rounded-[2rem] overflow-hidden border-[6px] border-zinc-800 shadow-2xl">
      {/* 1. MAPA (Mini-Map Gadget quando entra o vídeo) */}
      <div
        ref={mapContainerRef}
        onTransitionEnd={() => mapRef.current?.resize()}
        className={`absolute z-30 ease-in-out bg-zinc-900 overflow-hidden ${viewMode === "MAP" || viewMode === "INTRO"
            ? "inset-0 w-full h-full border-0 transition-all duration-700 opacity-100"
            : viewMode === "ACTION"
              ? "bottom-6 right-4 w-[110px] h-[180px] rounded-2xl border-2 border-amber-500/80 shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all duration-700 opacity-100"
              : "bottom-6 right-4 w-[110px] h-[180px] rounded-2xl border-2 border-transparent transition-opacity duration-700 opacity-0 pointer-events-none"
          }`}
      />

      {/* 2. VÍDEO FULLSCREEN (Fica como Fundo durante a AÇÃO) */}
      <div
        className={`absolute inset-0 z-20 transition-opacity duration-[1500ms] bg-black ${viewMode === "ACTION" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
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

      {/* 3. HUD DE PROGRESSO */}
      <div className={`absolute top-10 left-6 z-40 pointer-events-none bg-black/50 backdrop-blur-md p-3 rounded-xl border border-white/10 transition-opacity duration-500 ${viewMode === "BRAND" ? "opacity-0" : "opacity-100"}`}>
        <p className="text-white font-mono text-sm font-bold uppercase">
          {Math.floor((currentIndex / activityPoints.length) * 100)}%{" "}
          <span className="text-amber-500">Route</span>
        </p>
      </div>

      {/* 3.1 LOGO PERMANENTE */}
      <div className={`absolute top-10 right-6 z-50 pointer-events-none drop-shadow-xl transition-opacity duration-500 ${viewMode === "BRAND" ? "opacity-0" : "opacity-90"}`}>
        <img src="/prorefuel_logo.png" alt="ProRefuel" className="h-[22px] w-auto object-contain" />
      </div>

      {/* 4. BRANDING FINAL - IRIS CÍRCULO EXPANDINDO */}
      <div className={`absolute inset-0 z-50 flex items-center justify-center overflow-hidden pointer-events-none`}>
        <div className={`bg-[#050505] rounded-full aspect-square transition-all duration-[1200ms] ease-in-out origin-center ${viewMode === "BRAND" ? "w-[300%] opacity-100" : "w-[0%] opacity-0"
          }`} />
      </div>

      {/* 4.1 BRANDING CONTENT (Surge depois do círculo) */}
      <div
        className={`absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-1000 delay-[600ms] ${viewMode === "BRAND" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-[0.4em] mb-4">
          Developed by
        </p>
        <img src="/prorefuel_logo.png" alt="ProRefuel" className="w-1/2 max-w-[200px] drop-shadow-[0_0_30px_rgba(245,158,11,0.2)] animate-pulse" />
      </div>

      {/* 0. INTRO SCREEN (Por cima do mapa rodando) */}
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

function calculateBearing(start: GPSPoint, end: GPSPoint) {
  const y =
    Math.sin(((end.lon - start.lon) * Math.PI) / 180) *
    Math.cos((end.lat * Math.PI) / 180);
  const x =
    Math.cos((start.lat * Math.PI) / 180) *
    Math.sin((end.lat * Math.PI) / 180) -
    Math.sin((start.lat * Math.PI) / 180) *
    Math.cos((end.lat * Math.PI) / 180) *
    Math.cos(((end.lon - start.lon) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function getDistance(p1: GPSPoint, p2: GPSPoint) {
  return Math.sqrt(Math.pow(p1.lat - p2.lat, 2) + Math.pow(p1.lon - p2.lon, 2));
}

MapEngine.displayName = "MapEngine";
export default MapEngine;
