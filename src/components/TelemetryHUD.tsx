"use client";
import React, { useEffect, useRef, useMemo } from 'react';
import { EnhancedGPSPoint, TelemetryCrossRef } from '@/lib/engine/TelemetryCrossRef';
import { UnitSystem, SPEED_LABEL, DIST_LABEL, DIST_DIVISOR } from '@/lib/utils/units';

interface Props {
  points: EnhancedGPSPoint[];
  currentIndex: number;
  hrMax?: number;
  intensityScores?: Float32Array;
  unit?: UnitSystem;
}

// Static gauge cache keyed by (W, H, maxSpd, unit)
interface GaugeCache {
  canvas: HTMLCanvasElement;
  W: number;
  H: number;
  maxSpd: number;
  unit: UnitSystem;
}

export function TelemetryHUD({ points, currentIndex, hrMax, intensityScores, unit = 'metric' }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const gaugeCacheRef = useRef<GaugeCache | null>(null);
  const maxSpdSeenRef = useRef(0);

  // Pre-compute cumulative distance + gauge max — mirrors Engine 2's startRecording pre-pass
  const { cumDist, maxSpd } = useMemo(() => {
    if (!points || points.length < 2) return { cumDist: new Float64Array(0), maxSpd: 50 };
    const cd = new Float64Array(points.length);
    let total = 0, peak = 0;
    for (let i = 1; i < points.length; i++) {
      total += TelemetryCrossRef.getDistance(points[i - 1], points[i]);
      cd[i] = total;
      const s = (points[i] as any).speed || 0;
      if (s > peak) peak = s;
    }
    maxSpdSeenRef.current = 0; // reset on new activity
    return { cumDist: cd, maxSpd: Math.max(50, Math.ceil(peak / 10) * 10) };
  }, [points]);

  // Sync canvas buffer size via ResizeObserver — invalidates gauge cache on resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (W > 0 && H > 0 && (canvas.width !== W || canvas.height !== H)) {
        canvas.width  = W;
        canvas.height = H;
        gaugeCacheRef.current = null;
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Invalidate cache when scale changes
  useEffect(() => { gaugeCacheRef.current = null; }, [maxSpd]);

  // Per-frame draw — identical proportions to Engine 2's drawTelemetry
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points[currentIndex]) return;
    const W = canvas.width;
    const H = canvas.height;
    if (W === 0 || H === 0) return;

    // ── Gauge geometry ─────────────────────────────────────────────────────────
    // gCY derived so arc top (gCY - gR) sits ~20px from container top,
    // aligning the gauge top with the mini-map widget top edge.
    const gCX = W * 0.20;
    const gR  = Math.round(W * 0.13);
    const gCY = gR + Math.round(H * 0.03); // arc top ≈ H*0.03 (≈20px)
    const GAUGE_START = Math.PI * 0.75;
    const GAUGE_SWEEP = Math.PI * 1.5;
    const GAUGE_END   = GAUGE_START + GAUGE_SWEEP;
    const speedToAngle = (s: number) => GAUGE_START + Math.min(s / maxSpd, 1) * GAUGE_SWEEP;

    // ── Build static gauge cache when needed (same as Engine 2's gaugeCache IIFE) ─
    if (!gaugeCacheRef.current ||
        gaugeCacheRef.current.W !== W ||
        gaugeCacheRef.current.H !== H ||
        gaugeCacheRef.current.maxSpd !== maxSpd ||
        gaugeCacheRef.current.unit !== unit) {
      const cW = Math.round(W * 0.52);
      const cH = Math.round(H * 0.44);
      const gc_canvas = document.createElement('canvas');
      gc_canvas.width  = cW;
      gc_canvas.height = cH;
      const gc = gc_canvas.getContext('2d')!;

      // Soft radial shadow behind gauge
      const vg = gc.createRadialGradient(gCX, gCY, 0, gCX, gCY, W * 0.42);
      vg.addColorStop(0, 'rgba(0,0,0,0.28)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      gc.fillStyle = vg;
      gc.fillRect(0, 0, cW, cH);

      // Track arc
      gc.lineWidth    = Math.round(W * 0.022);
      gc.lineCap      = 'round';
      gc.strokeStyle  = 'rgba(255,255,255,0.12)';
      gc.beginPath();
      gc.arc(gCX, gCY, gR, GAUGE_START, GAUGE_END);
      gc.stroke();

      // Tick marks + speed labels at major ticks
      gc.lineCap = 'butt';
      for (let spd = 0; spd <= maxSpd; spd += 10) {
        const a     = speedToAngle(spd);
        const cosA  = Math.cos(a), sinA = Math.sin(a);
        const isMaj = spd % 20 === 0;
        const outer = gR - Math.round(W * 0.024);
        const inner = outer - (isMaj ? gR * 0.12 : gR * 0.07);
        gc.strokeStyle = isMaj ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
        gc.lineWidth   = isMaj ? 2.5 : 1.5;
        gc.beginPath();
        gc.moveTo(gCX + cosA * outer, gCY + sinA * outer);
        gc.lineTo(gCX + cosA * inner, gCY + sinA * inner);
        gc.stroke();
        if (isMaj) {
          const lr = inner - gR * 0.12;
          gc.shadowColor = 'rgba(0,0,0,1)'; gc.shadowBlur = 10;
          gc.font        = `700 ${Math.round(W * 0.024)}px sans-serif`;
          gc.fillStyle   = 'rgba(255,255,255,0.6)';
          gc.textAlign   = 'center';
          gc.fillText(String(spd), gCX + cosA * lr, gCY + sinA * lr + 5);
          gc.shadowBlur  = 0;
        }
      }

      // Hub dot
      gc.fillStyle   = '#1a1a1a';
      gc.beginPath();
      gc.arc(gCX, gCY, W * 0.022, 0, Math.PI * 2);
      gc.fill();
      gc.strokeStyle = 'rgba(255,255,255,0.15)';
      gc.lineWidth   = 1.5;
      gc.stroke();

      gaugeCacheRef.current = { canvas: gc_canvas, W, H, maxSpd, unit };
    }

    // ── Draw frame ─────────────────────────────────────────────────────────────
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    // Blit static gauge cache
    ctx.drawImage(gaugeCacheRef.current.canvas, 0, 0);

    const shadow  = (col: string, blur: number) => { ctx.shadowColor = col; ctx.shadowBlur = blur; };
    const noShad  = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; };

    // Current telemetry values
    const pt       = points[currentIndex] as any;
    const speedNow = pt.speed || 0;
    if (speedNow > maxSpdSeenRef.current) maxSpdSeenRef.current = speedNow;

    const distKm = (cumDist[currentIndex] / DIST_DIVISOR[unit]).toFixed(2);
    const secs    = (pt.time - points[0].time) / 1000;
    const hhNum   = Math.floor(secs / 3600);
    const mm      = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const ss      = Math.floor(secs % 60).toString().padStart(2, '0');
    const timeStr = hhNum > 0
      ? `${hhNum.toString().padStart(2, '0')}:${mm}:${ss}`
      : `${mm}:${ss}`;

    // ── Speed fill arc ─────────────────────────────────────────────────────────
    if (speedNow > 0.5) {
      const grad = ctx.createLinearGradient(gCX - gR, gCY, gCX + gR, gCY);
      grad.addColorStop(0, '#f59e0b');
      grad.addColorStop(1, '#fbbf24');
      ctx.strokeStyle = grad;
      ctx.lineWidth   = Math.round(W * 0.022);
      ctx.lineCap     = 'round';
      shadow('rgba(245,158,11,0.4)', 18);
      ctx.beginPath();
      ctx.arc(gCX, gCY, gR, GAUGE_START, speedToAngle(speedNow));
      ctx.stroke();
      noShad();
    }

    // ── Max-speed red needle ───────────────────────────────────────────────────
    if (maxSpdSeenRef.current > 0.5) {
      const mAngle = speedToAngle(maxSpdSeenRef.current);
      ctx.save();
      ctx.translate(gCX, gCY);
      ctx.rotate(mAngle);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth   = Math.round(W * 0.006);
      ctx.lineCap     = 'round';
      shadow('rgba(239,68,68,0.7)', 10);
      ctx.beginPath();
      ctx.moveTo(-gR * 0.12, 0);
      ctx.lineTo(gR * 0.82, 0);
      ctx.stroke();
      ctx.fillStyle  = '#ef4444';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(gR * 0.82, 0, W * 0.006, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      noShad();
    }

    // ── Speed number + KM/H ────────────────────────────────────────────────────
    shadow('rgba(0,0,0,0.9)', 20);
    ctx.font      = `900 ${Math.round(W * 0.13)}px sans-serif`;
    ctx.fillStyle = speedNow > maxSpdSeenRef.current * 0.9 ? '#fbbf24' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(speedNow).toString(), gCX, gCY + Math.round(W * 0.015));
    ctx.font      = `700 ${Math.round(W * 0.028)}px sans-serif`;
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(SPEED_LABEL[unit], gCX, gCY + Math.round(W * 0.016) + Math.round(W * 0.04));

    // ── Distance ───────────────────────────────────────────────────────────────
    const metY = gCY + gR + Math.round(H * 0.04);
    shadow('rgba(0,0,0,1)', 25);
    ctx.font      = `900 ${Math.round(W * 0.11)}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(distKm, W * 0.04, metY);
    const dW = ctx.measureText(distKm).width;
    ctx.font      = `700 ${Math.round(W * 0.035)}px sans-serif`;
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(` ${DIST_LABEL[unit]}`, W * 0.04 + dW, metY - 4);

    // ── HR / Power / Time ──────────────────────────────────────────────────────
    // Clipped to left 46% of canvas — padding before mini-map right widget
    const subY   = metY + Math.round(H * 0.055);
    let groupX   = W * 0.04;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.round(W * 0.54), H);
    ctx.clip();
    ctx.font = `900 ${Math.round(W * 0.044)}px sans-serif`;

    if (pt.hr) {
      const ratio    = hrMax && hrMax > 1 ? pt.hr / hrMax : 0;
      const hrColor  = ratio > 0.90 ? '#ef4444' : ratio > 0.75 ? '#f97316' : ratio > 0.60 ? '#fbbf24' : '#ff4d4d';
      shadow('rgba(0,0,0,1)', 20);
      ctx.fillStyle = hrColor;
      const hrStr   = `\u2665 ${Math.round(pt.hr)}`;
      ctx.fillText(hrStr, groupX, subY);
      groupX += ctx.measureText(hrStr).width + Math.round(W * 0.022);
    }

    if (pt.power) {
      shadow('rgba(0,0,0,1)', 20);
      ctx.fillStyle  = '#ffffff';
      const pwStr    = `\u26A1 ${Math.round(pt.power)}W`;
      ctx.fillText(pwStr, groupX, subY);
      groupX += ctx.measureText(pwStr).width + Math.round(W * 0.022);
    }

    shadow('rgba(0,0,0,1)', 20);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(`\u23F1 ${timeStr}`, groupX, subY);
    ctx.restore();

    noShad();
  }, [points, currentIndex, cumDist, maxSpd, hrMax, unit]);

  if (!points || points.length < 2) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ display: 'block' }}
    />
  );
}
