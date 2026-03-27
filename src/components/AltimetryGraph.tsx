"use client";
import React, { useMemo } from 'react';
import { EnhancedGPSPoint } from '@/lib/engine/TelemetryCrossRef';

interface Props {
  points: EnhancedGPSPoint[];
  currentIndex: number;
}

export function AltimetryGraph({ points, currentIndex }: Props) {
  const { minEle, maxEle, pathD, pointsLen } = useMemo(() => {
    if (!points || points.length < 2) return { minEle: 0, maxEle: 1, pathD: "", pointsLen: 0 };
    
    let min = Infinity;
    let max = -Infinity;
    for (const pt of points) {
      if (pt.ele < min) min = pt.ele;
      if (pt.ele > max) max = pt.ele;
    }
    
    // Add a tiny margin to vertical clipping
    const range = (max - min) || 1;
    min -= range * 0.1;
    max += range * 0.1;
    const finalRange = max - min;

    // Draw the entire mountain SVG path
    let d = `M 0,100 `; // Start at bottom-left
    for (let i = 0; i < points.length; i++) {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - ((points[i].ele - min) / finalRange) * 100;
      d += `L ${x.toFixed(2)},${y.toFixed(2)} `;
    };
    d += `L 100,100 Z`; // Close path to bottom-right

    return { minEle: min, maxEle: max, pathD: d, pointsLen: points.length };
  }, [points]);

  if (pointsLen < 2) return null;

  // Dynamic tracker position
  const progressX = (currentIndex / (pointsLen - 1)) * 100;
  const currentPt = points[currentIndex];
  const range = maxEle - minEle;
  const progressY = 100 - ((currentPt.ele - minEle) / range) * 100;

  return (
    <div className="absolute bottom-0 left-0 w-full h-[15vh] pointer-events-none z-40">
      {/* Sombreado de contraste para o gráfico aparecer em mapas claros ou neves */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#050505]/90 via-black/30 to-transparent" />
      
      <svg className="absolute bottom-0 w-full h-full drop-shadow-2xl" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="altGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(245,158,11,0.5)" />
            <stop offset="100%" stopColor="rgba(245,158,11,0.0)" />
          </linearGradient>
        </defs>
        
        {/* Silhueta Base ds Montanhas */}
        <path d={pathD} fill="url(#altGradient)" stroke="rgba(245,158,11,0.8)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        
        {/* Agulha vertical marcando a posição exata */}
        <line x1={progressX} y1={progressY} x2={progressX} y2="100" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
        
        {/* Ponto (Dot) da moto/atleta nascendo luminoso */}
        <circle cx={progressX} cy={progressY} r="1.5" fill="#fff" className="drop-shadow-[0_0_10px_rgba(255,255,255,1)]" />
      </svg>
    </div>
  );
}
