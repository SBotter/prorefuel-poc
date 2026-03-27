"use client";
import React, { useMemo } from 'react';
import { EnhancedGPSPoint, TelemetryCrossRef } from '@/lib/engine/TelemetryCrossRef';

interface Props {
  points: EnhancedGPSPoint[];
  currentIndex: number;
}

export function TelemetryHUD({ points, currentIndex }: Props) {
  // Pre-calculates an ArrayBuffer Matrix tracking physical traversed distances.
  // Using Float32Array eliminates garbage collection frame drops over long arrays.
  const distanceMatrix = useMemo(() => {
    if (!points || points.length === 0) return new Float32Array(0);
    const mat = new Float32Array(points.length);
    let totalDist = 0;
    for (let i = 1; i < points.length; i++) {
        totalDist += TelemetryCrossRef.getDistance(points[i-1], points[i]);
        mat[i] = totalDist;
    }
    return mat;
  }, [points]);

  if (!points || !points[currentIndex]) return null;

  const current = points[currentIndex];
  const totalDistKm = distanceMatrix[currentIndex] / 1000;
  const elapsedSecs = (current.time - points[0].time) / 1000;

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute top-12 left-10 z-50 pointer-events-none flex flex-col items-start select-none">
      {/* 1. DISTANCE PRINCIPAL (HERO) */}
      <div className="flex items-baseline gap-2 drop-shadow-[0_4px_12px_rgba(0,0,0,1)]">
        <span className="text-white text-[5.5rem] font-bold tracking-tighter leading-none font-sans drop-shadow-[0_0_20px_rgba(0,0,0,0.6)]">
          {totalDistKm.toFixed(2)}
        </span>
        <span className="text-amber-500 font-bold text-xl uppercase tracking-widest">
          KM
        </span>
      </div>

      {/* 2. SUB-METRICS EM COLUNA INVISÍVEL */}
      <div className="flex flex-col gap-[6px] mt-4 ml-1">
        {/* TEMPO */}
        <div className="flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
           <span className="text-white/70 text-[10px] font-black uppercase tracking-[0.25em] w-16">Time</span>
           <span className="text-white font-mono text-2xl font-light tracking-tight">{formatTime(elapsedSecs)}</span>
        </div>

        {/* VELOCIDADE */}
        <div className="flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
           <span className="text-white/70 text-[10px] font-black uppercase tracking-[0.25em] w-16">Speed</span>
           <span className="text-white font-mono text-2xl font-light tracking-tight">
             {current.speed ? current.speed.toFixed(1) : "0.0"} <span className="text-white/40 text-sm font-sans tracking-widest pl-1">km/h</span>
           </span>
        </div>

        {/* HEART RATE */}
        {current.hr !== undefined && (
          <div className="flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
             <span className="text-rose-500/90 text-[10px] font-black uppercase tracking-[0.25em] w-16 animate-pulse">Heart</span>
             <span className="text-white font-mono text-2xl font-light tracking-tight">
               {current.hr} <span className="text-white/40 text-sm font-sans tracking-widest pl-1">bpm</span>
             </span>
          </div>
        )}

        {/* POWER */}
        {current.power !== undefined && (
          <div className="flex items-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
             <span className="text-amber-500/90 text-[10px] font-black uppercase tracking-[0.25em] w-16">Power</span>
             <span className="text-white font-mono text-2xl font-light tracking-tight">
               {current.power} <span className="text-white/40 text-sm font-sans tracking-widest pl-1">w</span>
             </span>
          </div>
        )}
      </div>
    </div>
  );
}
