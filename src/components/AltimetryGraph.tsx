"use client";
import React, { useEffect, useRef, useMemo } from 'react';
import { EnhancedGPSPoint, TelemetryCrossRef } from '@/lib/engine/TelemetryCrossRef';

interface Props {
  points: EnhancedGPSPoint[];
  currentIndex: number;
}

export function AltimetryGraph({ points, currentIndex }: Props) {
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const staticCache    = useRef<HTMLCanvasElement | null>(null);
  const dimsRef        = useRef({ W: 0, H: 0 });

  // Pre-compute per-point positions — only rebuilds when points change
  const data = useMemo(() => {
    if (!points || points.length < 2) return null;

    const cumDist: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      cumDist.push(cumDist[i - 1] + TelemetryCrossRef.getDistance(points[i - 1], points[i]));
    }
    const totalDist = cumDist[cumDist.length - 1] || 1;

    let minE = Infinity, maxE = -Infinity, peakIdx = 0;
    for (let i = 0; i < points.length; i++) {
      const ele = points[i].ele;
      if (ele < minE) minE = ele;
      if (ele > maxE) { maxE = ele; peakIdx = i; }
    }
    const eRange = maxE - minE || 1;

    return { cumDist, totalDist, minE, maxE, eRange, peakIdx };
  }, [points]);

  // Watch canvas size via ResizeObserver — invalidates static cache on resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (W > 0 && H > 0 && (W !== dimsRef.current.W || H !== dimsRef.current.H)) {
        canvas.width  = W;
        canvas.height = H;
        dimsRef.current = { W, H };
        staticCache.current = null; // force rebuild
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Invalidate static cache whenever data changes
  useEffect(() => {
    staticCache.current = null;
  }, [data]);

  // Draw: builds static cache if missing, then draws cursor on top
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !points[currentIndex]) return;

    const { cumDist, totalDist, minE, maxE, eRange, peakIdx } = data;
    const { W, H } = dimsRef.current;
    if (W === 0 || H === 0) return;

    const ALT_PAD_TOP = Math.round(H * 0.22);
    const ALT_H       = H - ALT_PAD_TOP;

    const eleToY = (ele: number) =>
      ALT_PAD_TOP + ALT_H - ((ele - minE) / eRange) * (ALT_H * 0.85);
    const distToX = (d: number) => (d / totalDist) * W;

    // ── Build static cache (same logic as MapEngine canvas IIFE) ─────────────
    if (!staticCache.current) {
      const c  = document.createElement('canvas');
      c.width  = W;
      c.height = H;
      const ac = c.getContext('2d')!;

      // Dark fade background
      const bgGrad = ac.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0,   'rgba(5,5,5,0)');
      bgGrad.addColorStop(0.3, 'rgba(5,5,5,0.75)');
      bgGrad.addColorStop(1,   'rgba(5,5,5,0.97)');
      ac.fillStyle = bgGrad;
      ac.fillRect(0, 0, W, H);

      // Area fill
      const altGrad = ac.createLinearGradient(0, ALT_PAD_TOP, 0, H);
      altGrad.addColorStop(0, 'rgba(245,158,11,0.45)');
      altGrad.addColorStop(1, 'rgba(245,158,11,0)');
      ac.fillStyle = altGrad;
      ac.beginPath();
      ac.moveTo(0, H);
      for (let i = 0; i < points.length; i++) {
        ac.lineTo(distToX(cumDist[i]), eleToY(points[i].ele));
      }
      ac.lineTo(W, H);
      ac.closePath();
      ac.fill();

      // Amber curve with glow
      ac.save();
      ac.strokeStyle = '#f59e0b';
      ac.lineWidth   = 2.5;
      ac.lineJoin    = 'round';
      ac.shadowColor = 'rgba(245,158,11,0.45)';
      ac.shadowBlur  = 8;
      ac.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = distToX(cumDist[i]);
        const y = eleToY(points[i].ele);
        i === 0 ? ac.moveTo(x, y) : ac.lineTo(x, y);
      }
      ac.stroke();
      ac.shadowBlur = 0;
      ac.restore();


      // Peak altitude indicator
      const pkX = distToX(cumDist[peakIdx]);
      const pkY = eleToY(points[peakIdx].ele);
      ac.save();
      ac.setLineDash([3, 3]);
      ac.strokeStyle = 'rgba(251,191,36,0.5)';
      ac.lineWidth   = 1;
      ac.beginPath();
      ac.moveTo(pkX, ALT_PAD_TOP);
      ac.lineTo(pkX, pkY);
      ac.stroke();
      ac.setLineDash([]);
      ac.fillStyle = '#fbbf24';
      ac.beginPath();
      ac.arc(pkX, pkY, 4, 0, Math.PI * 2);
      ac.fill();
      ac.shadowColor = 'rgba(0,0,0,0.9)';
      ac.shadowBlur  = 8;
      ac.font        = `700 ${Math.round(W * 0.026)}px sans-serif`;
      ac.fillStyle   = '#fbbf24';
      ac.textAlign   = 'center';
      ac.textBaseline = 'alphabetic';
      ac.fillText(`▲ ${Math.round(points[peakIdx].ele)}m`, Math.min(Math.max(pkX, 40), W - 40), pkY - 10);
      ac.shadowBlur  = 0;
      ac.restore();

      // X axis labels
      ac.font        = `600 ${Math.round(W * 0.022)}px sans-serif`;
      ac.fillStyle   = 'rgba(255,255,255,0.3)';
      ac.shadowColor = 'rgba(0,0,0,1)';
      ac.shadowBlur  = 4;
      ac.textBaseline = 'alphabetic';
      ac.textAlign    = 'left';
      ac.fillText('0', 8, H - 6);
      ac.textAlign = 'right';
      ac.fillText(`${(totalDist / 1000).toFixed(1)}km`, W - 8, H - 6);
      ac.shadowBlur = 0;

      staticCache.current = c;
    }

    // ── Draw frame ────────────────────────────────────────────────────────────
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(staticCache.current, 0, 0);

    const curX = distToX(cumDist[currentIndex]);
    const curY = eleToY(points[currentIndex].ele);

    ctx.save();

    // Dashed vertical line
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(curX, ALT_PAD_TOP);
    ctx.lineTo(curX, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Outer ring
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(curX, curY, 8, 0, Math.PI * 2);
    ctx.stroke();

    // White dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(curX, curY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Amber core
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(curX, curY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Elevation text — matches Engine 2 exactly
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = 10;
    ctx.font        = `800 ${Math.round(W * 0.03)}px sans-serif`;
    ctx.fillStyle   = '#fbbf24';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
      `${Math.round(points[currentIndex].ele)}m`,
      Math.min(Math.max(curX, 40), W - 40),
      curY - 10,
    );
    ctx.shadowBlur = 0;

    ctx.restore();
  }, [data, currentIndex, points]);

  if (!points || points.length < 2) return null;

  return (
    <div className="absolute bottom-0 left-0 w-full h-[15vh] pointer-events-none z-40">
      <canvas
        ref={canvasRef}
        className="absolute bottom-0 w-full h-full"
        style={{ display: 'block' }}
      />
    </div>
  );
}
