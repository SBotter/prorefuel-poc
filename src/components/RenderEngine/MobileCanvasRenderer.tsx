"use client";
/**
 * MobileCanvasRenderer — iOS / Android video export pipeline.
 *
 * Uses WebCodecs VideoEncoder (no captureStream / MediaRecorder / FFmpeg).
 * Produces a silent H264 MP4 and delivers it via the native share sheet
 * (Web Share API) so the user can Save to Photos / Camera Roll.
 *
 * Minimum requirements:
 *   iOS 16.4+  (Safari or any browser — all use WebKit on iOS)
 *   Android Chrome 94+
 *
 * This file is intentionally isolated from the desktop pipeline.
 * DO NOT import from MapEngine or CanvasRenderer.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  MobileRecorder,
  MOBILE_W as W,
  MOBILE_H as H,
  MOBILE_FPS as FPS,
} from "@/lib/engine/mobile/MobileRecorder";
import { mlog, mlogClear, mlogMemory } from "@/lib/engine/mobile/mobileDebugLogger";
import type { ActionSegment }  from "@/lib/engine/TelemetryCrossRef";
import type { StoryPlan }      from "@/lib/engine/StorytellingProcessor";
import type { UnitSystem }     from "@/lib/utils/units";
import type { RenderResult }   from "@/components/MapEngine";
import { computePortraitData } from "@/lib/engine/ActivityPortraitPlanner";

// rAF runs at 60fps on iPhone; we only want 30fps captures.
const CAPTURE_INTERVAL_MS = 1000 / FPS; // ~33.33ms

// ─── Easing / math helpers ────────────────────────────────────────────────────
const c01  = (v: number) => Math.max(0, Math.min(1, v));
const eOut = (t: number) => 1 - (1 - c01(t)) ** 3;
const pp   = (e: number, s: number, en: number) => c01((e - s) / (en - s));

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6_371_000, r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  return (
    R * 2 * Math.atan2(
      Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2),
      Math.sqrt(1 - Math.sin(dLat / 2) ** 2 - Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2),
    )
  );
}

function makeTimestamp(): string {
  const n = new Date();
  return (
    `${n.getFullYear()}` +
    `${String(n.getMonth() + 1).padStart(2, "0")}` +
    `${String(n.getDate()).padStart(2, "0")}` +
    `${String(n.getHours()).padStart(2, "0")}` +
    `${String(n.getMinutes()).padStart(2, "0")}` +
    `${String(n.getSeconds()).padStart(2, "0")}`
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface MobileCanvasRendererProps {
  activityPoints: any[];
  highlights: ActionSegment[];
  storyPlan: StoryPlan | null;
  videoFile: File | null;
  unit: UnitSystem;
  onRenderComplete: (result: RenderResult) => void;
  /** Activity title shown in the INTRO screen. Defaults to "YOUR RIDE". */
  activityName?: string;
  /**
   * true when the source video uses HEVC (H.265).
   * Forces VP9 output on iOS to avoid Video Toolbox hardware conflict between
   * the HEVC hardware decoder and the H264 VTCompressionSession encoder.
   */
  sourceIsHEVC?: boolean;
}

// ─── Shadow helpers ───────────────────────────────────────────────────────────
function sh(c: CanvasRenderingContext2D, color: string, blur: number) {
  c.shadowColor = color; c.shadowBlur = blur;
}
function nosh(c: CanvasRenderingContext2D) {
  c.shadowColor = "transparent"; c.shadowBlur = 0;
}

// ─── Web Share / fallback download ───────────────────────────────────────────
async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: "video/mp4" });
  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "LENS Video" });
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") return; // user dismissed — not an error
    }
  }
  // Fallback: direct <a download>
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Main component ───────────────────────────────────────────────────────────
export function MobileCanvasRenderer({
  activityPoints, highlights, storyPlan, videoFile, unit, onRenderComplete,
  activityName = "YOUR RIDE",
  sourceIsHEVC = false,
}: MobileCanvasRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status,   setStatus]   = useState("Preparing…");
  const [progress, setProgress] = useState(0);
  // After encoding: hold the blob so user can save via a fresh gesture
  const [readyBlob, setReadyBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  // Total render duration (recording start → blob ready) stored via ref so it
  // is accessible both inside the useEffect closure and in the Save/Share handlers.
  const renderDurationMsRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoFile || !activityPoints.length || !storyPlan?.segments.length) return;

    const ctx = canvas.getContext("2d", { alpha: false })!;
    let rafId       = 0;
    let isStopped   = false;
    let recStartMs  = 0;

    // Pre-load images (same as desktop MapEngine)
    const logoImg = new Image();
    logoImg.src = "/prorefuel_logo.png";
    let recorder: MobileRecorder | null = null;

    // ── Unit config ─────────────────────────────────────────────────────────
    const DIST_DIV   = unit === "metric" ? 1000      : 1609.34;
    const SPEED_DIV  = unit === "metric" ? 1          : 0.621371;
    const SPEED_UNIT = unit === "metric" ? "KM/H"    : "MPH";
    const DIST_UNIT  = unit === "metric" ? "KM"      : "MI";
    const ELE_UNIT   = unit === "metric" ? "m"       : "ft";
    const ELE_FACTOR = unit === "metric" ? 1         : 3.28084;

    // ── Pre-compute activity stats ───────────────────────────────────────────
    const pts = activityPoints as any[];

    const cumDist: number[] = [0];
    for (let i = 1; i < pts.length; i++)
      cumDist.push(cumDist[i - 1] + haversineM(pts[i - 1], pts[i]));
    const totalDistM = cumDist[cumDist.length - 1];
    const totalDist  = (totalDistM / DIST_DIV).toFixed(1);

    const totalMs  = pts.length > 1 ? pts[pts.length - 1].time - pts[0].time : 0;
    const totalSec = Math.max(0, Math.round(totalMs / 1000));
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
    const ss = Math.floor(totalSec % 60).toString().padStart(2, "0");
    const timeStr = hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;

    const maxSpeedRaw = Math.max(0, ...pts.map((p: any) => Number(p.speed) || 0));
    const maxSpeedDisp = Math.round(maxSpeedRaw * SPEED_DIV);

    const hasHR = pts.some((p: any) => Number(p.hr) > 0);
    const maxHR = hasHR ? Math.max(0, ...pts.map((p: any) => Number(p.hr) || 0)) : 0;

    const totalEleGain = pts.reduce((sum: number, p: any, i: number) => {
      if (i === 0) return sum;
      const g = (Number(p.ele) || 0) - (Number(pts[i - 1].ele) || 0);
      return sum + (g > 0 ? g : 0);
    }, 0);
    const eleGainDisp = Math.round(totalEleGain * ELE_FACTOR);

    // ── GPS bounds ────────────────────────────────────────────────────────────
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
    }
    const latR = maxLat - minLat || 0.001;
    const lonR = maxLon - minLon || 0.001;

    // ── Mini-map — matches desktop MapEngine broadmap exactly ────────────────
    // Desktop: pipW=W*0.52, pipH=W*0.34, at pipX=W-pipW-W*0.04, pipY=H*0.07
    // No background box — route uses drop shadow for 3D depth, same as desktop.
    const MM_W  = Math.round(W * 0.52);
    const MM_H  = Math.round(W * 0.34);
    const MM_X  = W - MM_W - Math.round(W * 0.04);
    const MM_Y  = Math.round(H * 0.07);
    const MM_PAD = 32;
    const toMMX = (lon: number) => MM_PAD + ((lon - minLon) / lonR) * (MM_W - MM_PAD * 2);
    const toMMY = (lat: number) => MM_H - MM_PAD - ((lat - minLat) / latR) * (MM_H - MM_PAD * 2);

    // broadmapCache: full route with drop shadow — no background box
    const broadmapCache = document.createElement("canvas");
    broadmapCache.width = MM_W; broadmapCache.height = MM_H;
    (() => {
      const bc = broadmapCache.getContext("2d")!;
      bc.shadowColor = "rgba(0,0,0,0.90)"; bc.shadowBlur = 10;
      bc.shadowOffsetX = 3; bc.shadowOffsetY = 4;
      bc.strokeStyle = "rgba(255,255,255,0.85)"; bc.lineWidth = 2.5;
      bc.lineJoin = "round"; bc.lineCap = "round";
      bc.beginPath();
      pts.forEach((p: any, i: number) =>
        i === 0 ? bc.moveTo(toMMX(p.lon), toMMY(p.lat)) : bc.lineTo(toMMX(p.lon), toMMY(p.lat)));
      bc.stroke();
    })();

    // trailCache: incremental amber trail (O(delta) per frame, same as desktop)
    const trailCache = document.createElement("canvas");
    trailCache.width = MM_W; trailCache.height = MM_H;
    const trailCtx = trailCache.getContext("2d")!;
    trailCtx.strokeStyle = "rgba(245,158,11,0.95)"; trailCtx.lineWidth = 3;
    trailCtx.lineJoin = "round"; trailCtx.lineCap = "round";
    trailCtx.shadowColor = "rgba(0,0,0,0.85)"; trailCtx.shadowBlur = 8;
    trailCtx.shadowOffsetX = 2; trailCtx.shadowOffsetY = 3;
    let lastTrailIdx = -1;

    // ── Speed gauge — matches desktop MapEngine ────────────────────────────────
    // Desktop: gCX=W*0.2, gCY=H*0.15, gR=W*0.13, gaugeCache W*0.52×H*0.44
    const G_CX    = W * 0.2;
    const G_CY    = H * 0.15;
    const G_R     = W * 0.13;
    const G_LW    = Math.round(W * 0.022);
    const G_START = Math.PI * 0.75;
    const G_SWEEP = Math.PI * 1.5;
    const G_END   = G_START + G_SWEEP;
    const maxGauge = Math.max(50, Math.ceil(maxSpeedDisp / 10) * 10);
    const speedToAngle = (s: number) => G_START + Math.min(s / maxGauge, 1) * G_SWEEP;

    // gaugeCache: static layer — vignette + track arc + tick marks + hub (O(1) blit per frame)
    const gaugeCacheW = Math.round(W * 0.52);
    const gaugeCacheH = Math.round(H * 0.44);
    const gaugeCache  = document.createElement("canvas");
    gaugeCache.width  = gaugeCacheW; gaugeCache.height = gaugeCacheH;
    (() => {
      const gc = gaugeCache.getContext("2d")!;
      // Soft radial vignette
      const vg = gc.createRadialGradient(G_CX, G_CY, 0, G_CX, G_CY, W * 0.42);
      vg.addColorStop(0, "rgba(0,0,0,0.28)"); vg.addColorStop(1, "rgba(0,0,0,0)");
      gc.fillStyle = vg; gc.fillRect(0, 0, gaugeCacheW, gaugeCacheH);
      // Track arc
      gc.lineWidth = G_LW; gc.lineCap = "round";
      gc.strokeStyle = "rgba(255,255,255,0.12)";
      gc.beginPath(); gc.arc(G_CX, G_CY, G_R, G_START, G_END); gc.stroke();
      // Tick marks + speed labels
      gc.lineCap = "butt";
      for (let spd = 0; spd <= maxGauge; spd += 10) {
        const a = speedToAngle(spd), cosA = Math.cos(a), sinA = Math.sin(a);
        const isMajor = spd % 20 === 0;
        const outer = G_R - Math.round(W * 0.024);
        const inner = outer - (isMajor ? G_R * 0.12 : G_R * 0.07);
        gc.strokeStyle = isMajor ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)";
        gc.lineWidth = isMajor ? 2.5 : 1.5;
        gc.beginPath();
        gc.moveTo(G_CX + cosA * outer, G_CY + sinA * outer);
        gc.lineTo(G_CX + cosA * inner, G_CY + sinA * inner);
        gc.stroke();
        if (isMajor && spd > 0) {
          const lr = inner - G_R * 0.12;
          gc.shadowColor = "rgba(0,0,0,1)"; gc.shadowBlur = 10;
          gc.font = `700 ${Math.round(W * 0.024)}px sans-serif`;
          gc.fillStyle = "rgba(255,255,255,0.6)"; gc.textAlign = "center";
          gc.fillText(String(spd), G_CX + cosA * lr, G_CY + sinA * lr + 5);
          gc.shadowBlur = 0;
        }
      }
      // Hub dot
      gc.fillStyle = "#1a1a1a";
      gc.beginPath(); gc.arc(G_CX, G_CY, W * 0.022, 0, Math.PI * 2); gc.fill();
      gc.strokeStyle = "rgba(255,255,255,0.15)"; gc.lineWidth = 1.5;
      gc.beginPath(); gc.arc(G_CX, G_CY, W * 0.022, 0, Math.PI * 2); gc.stroke();
    })();

    // Max speed tracker for red needle (same as desktop)
    let maxSpeedSeen = 0;

    // ── Cache rebuild — called when iOS HEVC decoder resets ───────────────────
    // broadmapCache, trailCache and altimetryCache are no longer used for drawing:
    //   • drawMiniMap     → routePath2D + trailPath2D (Path2D, CPU-resident)
    //   • drawAltimetryBase → direct draw from altProjX/altProjY (Float32Array, CPU)
    //   • drawPortraitHUD map → routePath2D (Path2D, CPU-resident)
    //
    // Only gaugeCache remains as a GPU-backed offscreen canvas (speed dial static
    // layer drawn once, blitted each frame). Rebuild only this one on reset.
    function rebuildCaches() {
      mlog("CACHE", "rebuilding gaugeCache after decoder reset");

      // Re-draw gaugeCache (speed dial static layer — only remaining GPU cache)
      const gc = gaugeCache.getContext("2d");
      if (gc) {
        gc.clearRect(0, 0, gaugeCacheW, gaugeCacheH);
        const vg = gc.createRadialGradient(G_CX, G_CY, 0, G_CX, G_CY, W * 0.42);
        vg.addColorStop(0, "rgba(0,0,0,0.28)"); vg.addColorStop(1, "rgba(0,0,0,0)");
        gc.fillStyle = vg; gc.fillRect(0, 0, gaugeCacheW, gaugeCacheH);
        gc.lineWidth = G_LW; gc.lineCap = "round";
        gc.strokeStyle = "rgba(255,255,255,0.12)";
        gc.beginPath(); gc.arc(G_CX, G_CY, G_R, G_START, G_END); gc.stroke();
        gc.lineCap = "butt";
        for (let spd = 0; spd <= maxGauge; spd += 10) {
          const a = speedToAngle(spd), cosA = Math.cos(a), sinA = Math.sin(a);
          const isMajor = spd % 20 === 0;
          const outer = G_R - Math.round(W * 0.024);
          const inner = outer - (isMajor ? G_R * 0.12 : G_R * 0.07);
          gc.strokeStyle = isMajor ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)";
          gc.lineWidth = isMajor ? 2.5 : 1.5;
          gc.beginPath();
          gc.moveTo(G_CX + cosA * outer, G_CY + sinA * outer);
          gc.lineTo(G_CX + cosA * inner, G_CY + sinA * inner);
          gc.stroke();
          if (isMajor && spd > 0) {
            const lr = inner - G_R * 0.12;
            gc.shadowColor = "rgba(0,0,0,1)"; gc.shadowBlur = 10;
            gc.font = `700 ${Math.round(W * 0.024)}px sans-serif`;
            gc.fillStyle = "rgba(255,255,255,0.6)"; gc.textAlign = "center";
            gc.fillText(String(spd), G_CX + cosA * lr, G_CY + sinA * lr + 5);
            gc.shadowBlur = 0;
          }
        }
        gc.fillStyle = "#1a1a1a";
        gc.beginPath(); gc.arc(G_CX, G_CY, W * 0.022, 0, Math.PI * 2); gc.fill();
        gc.strokeStyle = "rgba(255,255,255,0.15)"; gc.lineWidth = 1.5;
        gc.beginPath(); gc.arc(G_CX, G_CY, W * 0.022, 0, Math.PI * 2); gc.stroke();
      }

      mlog("CACHE", "gaugeCache rebuild complete");
    }

    // ── Altimetry — matches desktop MapEngine ─────────────────────────────────
    // Desktop: ALT_H=H*0.12, ALT_PAD_TOP=28, ALT_Y=H-ALT_H-28, full width
    const ALT_H     = Math.round(H * 0.12);
    const ALT_PT    = 28; // padding top (above curve for peak label)
    const ALT_Y     = H - ALT_H - ALT_PT;
    const ALT_PAD_X = Math.round(W * 0.02);
    const totalDistMalt = cumDist[cumDist.length - 1] || 1;

    // Find peak elevation index
    let minE = Infinity, maxE = -Infinity, peakEleIdx = 0;
    for (let i = 0; i < pts.length; i++) {
      const e = Number((pts[i] as any).ele) || 0;
      if (e < minE) minE = e;
      if (e > maxE) { maxE = e; peakEleIdx = i; }
    }
    const eRange = maxE - minE || 1;

    // Pre-project altimetry X/Y (O(1) lookup per frame)
    const altProjX = new Float32Array(pts.length);
    const altProjY = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      altProjX[i] = ALT_PAD_X + (cumDist[i] / totalDistMalt) * (W - 2 * ALT_PAD_X);
      altProjY[i] = ALT_Y + ALT_PT + ALT_H - ((Number((pts[i] as any).ele) || 0) - minE) / eRange * (ALT_H * 0.85);
    }

    // altimetryCache: static background (dark fade + amber fill + curve + peak indicator + markers)
    const altimetryCache = document.createElement("canvas");
    altimetryCache.width = W; altimetryCache.height = ALT_H + ALT_PT;
    (() => {
      const ac = altimetryCache.getContext("2d")!;
      // Dark fade strip
      const bgG = ac.createLinearGradient(0, 0, 0, ALT_H + ALT_PT);
      bgG.addColorStop(0, "rgba(5,5,5,0)"); bgG.addColorStop(0.3, "rgba(5,5,5,0.75)"); bgG.addColorStop(1, "rgba(5,5,5,0.97)");
      ac.fillStyle = bgG; ac.fillRect(0, 0, W, ALT_H + ALT_PT);
      // Amber area fill
      const altG = ac.createLinearGradient(0, ALT_PT, 0, ALT_PT + ALT_H);
      altG.addColorStop(0, "rgba(245,158,11,0.45)"); altG.addColorStop(1, "rgba(245,158,11,0)");
      ac.fillStyle = altG;
      ac.beginPath(); ac.moveTo(ALT_PAD_X, ALT_PT + ALT_H);
      pts.forEach((_: any, i: number) => ac.lineTo(altProjX[i], altProjY[i] - ALT_Y));
      ac.lineTo(W - ALT_PAD_X, ALT_PT + ALT_H); ac.closePath(); ac.fill();
      // Curve glow
      ac.strokeStyle = "#f59e0b"; ac.lineWidth = 2.5; ac.lineJoin = "round";
      ac.shadowColor = "rgba(245,158,11,0.45)"; ac.shadowBlur = 8;
      ac.beginPath();
      pts.forEach((_: any, i: number) =>
        i === 0 ? ac.moveTo(altProjX[i], altProjY[i] - ALT_Y) : ac.lineTo(altProjX[i], altProjY[i] - ALT_Y));
      ac.stroke(); ac.shadowBlur = 0;
      // Peak elevation indicator
      const peakXc = altProjX[peakEleIdx];
      const peakYc = altProjY[peakEleIdx] - ALT_Y;
      const labelFontSize = Math.round(W * 0.026);
      ac.font = `800 ${labelFontSize}px sans-serif`;
      const labelText = `▲ ${Math.round(maxE)}m`;
      const textW = ac.measureText(labelText).width;
      const pillW = textW + 20; const pillH = labelFontSize + 10;
      const pillGap = 6;
      const pillX = Math.min(Math.max(peakXc - pillW / 2, 4), W - pillW - 4);
      const pillY = Math.max(peakYc - pillH - pillGap - 8, 2);
      // Dotted vertical line
      ac.save(); ac.setLineDash([4, 4]); ac.strokeStyle = "rgba(245,158,11,0.55)"; ac.lineWidth = 1.5;
      ac.beginPath(); ac.moveTo(peakXc, pillY + pillH + pillGap); ac.lineTo(peakXc, peakYc - 6); ac.stroke();
      ac.setLineDash([]); ac.restore();
      // Peak dot
      ac.beginPath(); ac.arc(peakXc, peakYc, 6, 0, Math.PI * 2); ac.fillStyle = "rgba(0,0,0,0.75)"; ac.fill();
      ac.beginPath(); ac.arc(peakXc, peakYc, 5, 0, Math.PI * 2); ac.fillStyle = "#f59e0b"; ac.fill();
      // Pill
      ac.shadowColor = "rgba(0,0,0,0.9)"; ac.shadowBlur = 8;
      ac.fillStyle = "rgba(0,0,0,0.72)";
      ac.beginPath(); (ac as any).roundRect?.(pillX, pillY, pillW, pillH, pillH / 2); ac.fill();
      ac.shadowBlur = 0;
      ac.strokeStyle = "rgba(245,158,11,0.55)"; ac.lineWidth = 1.2;
      ac.beginPath(); (ac as any).roundRect?.(pillX, pillY, pillW, pillH, pillH / 2); ac.stroke();
      ac.fillStyle = "#fbbf24"; ac.textAlign = "center"; ac.textBaseline = "middle";
      ac.fillText(labelText, pillX + pillW / 2, pillY + pillH / 2);
      // Start (green) / End (red) markers
      const drawAltDot = (x: number, y: number, color: string) => {
        ac.beginPath(); ac.arc(x, y, 6, 0, Math.PI * 2); ac.fillStyle = "rgba(0,0,0,0.75)"; ac.fill();
        ac.beginPath(); ac.arc(x, y, 5, 0, Math.PI * 2); ac.fillStyle = color; ac.fill();
      };
      drawAltDot(altProjX[0], altProjY[0] - ALT_Y, "#22c55e");
      drawAltDot(altProjX[pts.length - 1], altProjY[pts.length - 1] - ALT_Y, "#ef4444");
    })();

    // grayFrameReady: set once video element has a valid frame at the seek position
    let grayFrameReady = false;

    // ── Avg speed (for INTRO stats — matches desktop) ────────────────────────
    const avgSpeedKmh = totalMs > 0
      ? (totalDistM / 1000) / (totalMs / 1000 / 3600)
      : 0;
    const avgSpeedDisp = unit === "metric"
      ? avgSpeedKmh.toFixed(1)
      : (avgSpeedKmh * 0.621371).toFixed(1);

    // ── Pre-create intro gradients (desktop pattern: no per-frame allocation) ─
    const introVignette = ctx.createRadialGradient(W/2, H*0.45, 0, W/2, H*0.45, W*1.2);
    introVignette.addColorStop(0,   "rgba(0,0,0,0.22)");
    introVignette.addColorStop(0.6, "rgba(0,0,0,0.48)");
    introVignette.addColorStop(1,   "rgba(0,0,0,0.88)");
    const introSepGrad = ctx.createLinearGradient(W/2 - W*0.3, 0, W/2 + W*0.3, 0);
    introSepGrad.addColorStop(0,   "transparent");
    introSepGrad.addColorStop(0.5, "#f59e0b");
    introSepGrad.addColorStop(1,   "transparent");

    // ── Segment timeline — cap at 30s and always reserve 3s for BRAND ──────────
    // At 4 Mbps, 30s = ~15 MB. StorytellingProcessor can emit 60+ second plans.
    // We clamp total to 30s BUT guarantee the BRAND screen always renders (3s).
    const MOBILE_DUR_CAP  = 30;
    const BRAND_RESERVE_S = 3;
    const ACTION_CAP_S    = MOBILE_DUR_CAP - BRAND_RESERVE_S; // 27s for non-brand

    const segments = storyPlan.segments;

    // Rebuild a trimmed segment list: keep INTRO as-is, trim ACTION to fit
    // within ACTION_CAP_S, then ensure BRAND is appended.
    const trimmedSegments: typeof segments = [];
    let actionBudget = ACTION_CAP_S;
    let hasBrand = false;

    for (const seg of segments) {
      if (seg.type === "BRAND") {
        hasBrand = true;
        continue; // added at end
      }
      if (seg.type === "ACTION") {
        if (actionBudget <= 0) continue;
        const dur = Math.min(seg.durationSec, actionBudget);
        trimmedSegments.push({ ...seg, durationSec: dur });
        actionBudget -= dur;
      } else {
        trimmedSegments.push(seg); // INTRO: keep as-is
      }
    }

    // Append BRAND (original or synthesised)
    const brandSeg = hasBrand
      ? { ...segments.find(s => s.type === "BRAND")!, durationSec: BRAND_RESERVE_S }
      : { type: "BRAND" as const, durationSec: BRAND_RESERVE_S,
          startIndex: segments[segments.length - 1]?.endIndex ?? 0,
          endIndex:   segments[segments.length - 1]?.endIndex ?? 0,
          videoStartTime: undefined as any,
          title: "BRAND", value: "" } as any;
    trimmedSegments.push(brandSeg);

    const totalDurSec = trimmedSegments.reduce((s, seg) => s + seg.durationSec, 0);

    function getSegAt(timeSec: number): {
      seg: typeof trimmedSegments[0]; segIdx: number; localTime: number;
    } | null {
      let t = 0;
      for (let i = 0; i < trimmedSegments.length; i++) {
        const seg = trimmedSegments[i];
        if (timeSec < t + seg.durationSec) return { seg, segIdx: i, localTime: timeSec - t };
        t += seg.durationSec;
      }
      return null;
    }

    function getGPSIdxAt(timeSec: number): number {
      const hit = getSegAt(timeSec);
      if (!hit) return pts.length - 1;
      const { seg, localTime } = hit;
      const frac = c01(localTime / seg.durationSec);
      const idx  = seg.startIndex + Math.round((seg.endIndex - seg.startIndex) * frac);
      return Math.max(0, Math.min(idx, pts.length - 1));
    }

    // ── Hidden video element ─────────────────────────────────────────────────
    const videoEl = document.createElement("video");
    videoEl.muted = true; videoEl.playsInline = true; videoEl.crossOrigin = "anonymous";
    const videoUrl = URL.createObjectURL(videoFile);
    videoEl.src = videoUrl;
    videoEl.load();

    let lastSegIdx = -1;

    // ── Frozen frame cache — survives iOS HEVC decoder resets ────────────────
    // When the iOS hardware HEVC decoder gets suspended under memory pressure,
    // videoEl.readyState drops to 0 for 1–2 seconds. Without this cache, the
    // canvas goes black and the HUD elements (mini-map, elevation) become invisible
    // because they are drawn semi-transparent over a black background.
    //
    // Fix: every time we successfully draw a video frame, copy it to frozenCanvas.
    // During readyState < 2, we draw the frozen frame instead of nothing. The video
    // appears "paused at the last frame" rather than blacking out.
    // The encoder also uses the frozen frame (captureFrame runs normally), so the
    // output video shows a brief freeze rather than a jump cut.
    const frozenCanvas = new OffscreenCanvas(W, H);
    const frozenCtx    = frozenCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    let   hasFrozenFrame = false;

    // ── Drawing: video frame ─────────────────────────────────────────────────
    function drawVideoFrame(c: CanvasRenderingContext2D): boolean {
      const vW = videoEl.videoWidth || W, vH = videoEl.videoHeight || H;
      const ar = W / H, vAr = vW / vH;
      let sx = 0, sy = 0, sw = vW, sh = vH;
      if (vAr > ar) { sw = Math.round(vH * ar); sx = Math.round((vW - sw) / 2); }
      else          { sh = Math.round(vW / ar); sy = Math.round((vH - sh) / 2); }

      if (videoEl.readyState >= 2) {
        try {
          c.drawImage(videoEl, sx, sy, sw, sh, 0, 0, W, H);
          // Cache this frame for use during decoder resets
          frozenCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, W, H);
          hasFrozenFrame = true;
          return true; // live frame drawn
        } catch { /* video temporarily not ready */ }
      }

      // Decoder suspended — use the frozen frame to keep video + HUD visible
      if (hasFrozenFrame) {
        try { c.drawImage(frozenCanvas, 0, 0, W, H); } catch { /* unlikely */ }
      }
      return hasFrozenFrame; // true = something was drawn, false = truly nothing
    }

    // ── GPS route as Path2D — CPU-resident, never GPU-evicted ────────────────
    // On iOS, canvas offscreen GPU textures get evicted when the HEVC hardware
    // decoder resets under memory pressure. Path2D lives in JS heap (CPU) and is
    // immune to GPU eviction. Drawing via ctx.stroke(path) re-rasterises from
    // CPU data each frame — trivial cost on A15 Bionic (~2ms for 6287 points).
    const routePath2D = (() => {
      const p = new Path2D();
      pts.forEach((pt: any, i: number) =>
        i === 0 ? p.moveTo(toMMX(pt.lon), toMMY(pt.lat)) : p.lineTo(toMMX(pt.lon), toMMY(pt.lat)));
      return p;
    })();

    // Trail grows incrementally as Path2D (also CPU-resident)
    const trailPath2D  = new Path2D();
    let   trailPath2DIdx = -1;

    // ── Drawing: GPS mini-map ─────────────────────────────────────────────────
    // Draws directly from Path2D / data arrays — no GPU-backed canvas textures,
    // so map stays visible even during iOS HEVC decoder resets (GPU eviction).
    function drawMiniMap(c: CanvasRenderingContext2D, gpsIdx: number) {
      c.save();

      // Layer 1: full GPS route (Path2D, CPU-resident)
      c.save();
      c.translate(MM_X, MM_Y);
      c.shadowColor = "rgba(0,0,0,0.90)"; c.shadowBlur = 10;
      c.shadowOffsetX = 3; c.shadowOffsetY = 4;
      c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 2.5;
      c.lineJoin = "round"; c.lineCap = "round";
      c.stroke(routePath2D);
      c.restore();

      // Layer 2: amber progress trail (Path2D, grows incrementally)
      if (gpsIdx > trailPath2DIdx) {
        if (trailPath2DIdx < 0) {
          trailPath2D.moveTo(MM_X + toMMX((pts[0] as any).lon), MM_Y + toMMY((pts[0] as any).lat));
        }
        for (let i = Math.max(trailPath2DIdx + 1, 1); i <= gpsIdx; i++) {
          trailPath2D.lineTo(MM_X + toMMX((pts[i] as any).lon), MM_Y + toMMY((pts[i] as any).lat));
        }
        trailPath2DIdx = gpsIdx;
      }
      c.strokeStyle = "rgba(245,158,11,0.95)"; c.lineWidth = 3;
      c.lineJoin = "round"; c.lineCap = "round";
      c.shadowColor = "rgba(0,0,0,0.85)"; c.shadowBlur = 8;
      c.shadowOffsetX = 2; c.shadowOffsetY = 3;
      c.stroke(trailPath2D);
      c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;

      // Layer 3: current position dot + glow
      const cx = MM_X + toMMX((pts[gpsIdx] as any).lon);
      const cy = MM_Y + toMMY((pts[gpsIdx] as any).lat);
      c.shadowBlur = 18; c.shadowColor = "rgba(245,158,11,0.8)";
      c.fillStyle = "#f59e0b";
      c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0; c.shadowColor = "transparent";
      c.fillStyle = "#fff";
      c.beginPath(); c.arc(cx, cy, 4, 0, Math.PI * 2); c.fill();

      c.restore();
    }

    // ── Drawing: telemetry HUD — matches desktop MapEngine drawTelemetry ────────
    function drawTelemetryHUD(c: CanvasRenderingContext2D, gpsIdx: number) {
      const cur      = pts[gpsIdx] as any;
      const cur2     = pts[Math.min(gpsIdx + 1, pts.length - 1)] as any;
      const speedRaw = Number(cur?.speed) || 0;
      if (speedRaw > maxSpeedSeen) maxSpeedSeen = speedRaw;
      const speedVal = Math.round(speedRaw * SPEED_DIV);
      const distM    = cumDist[Math.min(gpsIdx, cumDist.length - 1)] || 0;
      const distVal  = (distM / DIST_DIV).toFixed(2);

      // Layer 1: static gauge cache (vignette + track + ticks + hub)
      c.save();
      c.drawImage(gaugeCache, 0, 0, gaugeCacheW, gaugeCacheH);

      // Layer 2: speed fill arc
      const arcGrad = c.createLinearGradient(G_CX - G_R, G_CY, G_CX + G_R, G_CY);
      arcGrad.addColorStop(0, "#f59e0b"); arcGrad.addColorStop(1, "#fbbf24");
      if (speedRaw > 0.5) {
        c.strokeStyle = arcGrad; c.lineWidth = G_LW; c.lineCap = "round";
        c.shadowColor = "rgba(245,158,11,0.4)"; c.shadowBlur = 18;
        c.beginPath(); c.arc(G_CX, G_CY, G_R, G_START, speedToAngle(speedRaw * SPEED_DIV)); c.stroke();
        nosh(c);
      }

      // Layer 3: max-speed red needle (same as desktop)
      if (maxSpeedSeen > 0.5) {
        const maxAngle = speedToAngle(maxSpeedSeen * SPEED_DIV);
        c.save(); c.translate(G_CX, G_CY); c.rotate(maxAngle);
        c.strokeStyle = "#ef4444"; c.lineWidth = Math.round(W * 0.006);
        c.shadowColor = "rgba(239,68,68,0.7)"; c.shadowBlur = 10; c.lineCap = "round";
        c.beginPath(); c.moveTo(-G_R * 0.12, 0); c.lineTo(G_R * 0.82, 0); c.stroke();
        c.fillStyle = "#ef4444"; c.shadowBlur = 14;
        c.beginPath(); c.arc(G_R * 0.82, 0, W * 0.006, 0, Math.PI * 2); c.fill();
        c.restore(); nosh(c);
      }

      // Layer 4: speed number + unit
      sh(c, "rgba(0,0,0,0.9)", 20);
      c.font = `900 ${Math.round(W * 0.13)}px sans-serif`;
      c.fillStyle = speedRaw > maxSpeedSeen * 0.9 ? "#fbbf24" : "#fff";
      c.textAlign = "center";
      c.fillText(String(speedVal), G_CX, G_CY + Math.round(W * 0.015));
      c.font = `700 ${Math.round(W * 0.028)}px sans-serif`;
      c.fillStyle = "#f59e0b";
      c.fillText(SPEED_UNIT, G_CX, G_CY + Math.round(W * 0.016) + Math.round(W * 0.04));

      // "GPS Activity" label for iPhone source (same as desktop)
      nosh(c);
      c.font = `500 ${Math.round(W * 0.022)}px sans-serif`;
      c.fillStyle = "rgba(161,161,170,0.65)";
      c.fillText("GPS Activity", G_CX, G_CY - G_R * 0.58);

      // Layer 5: secondary metrics — distance, HR, time
      const metY = G_CY + G_R + Math.round(H * 0.04);
      sh(c, "rgba(0,0,0,1)", 25);
      c.font = `900 ${Math.round(W * 0.075)}px sans-serif`;
      c.fillStyle = "#fff"; c.textAlign = "left";
      c.fillText(distVal, W * 0.04, metY);
      const dw = c.measureText(distVal).width;
      c.font = `700 ${Math.round(W * 0.026)}px sans-serif`;
      c.fillStyle = "#f59e0b";
      c.fillText(` ${DIST_UNIT}`, W * 0.04 + dw, metY - 4);

      const subY = metY + Math.round(H * 0.036);
      c.save();
      c.beginPath(); c.rect(0, 0, Math.round(W * 0.54), H); c.clip();
      c.font = `900 ${Math.round(W * 0.044)}px sans-serif`;
      // Two-row layout when power is present:
      //   Row 1: ♥ HR   ⚡ Power    Row 2: ⏱ Time
      const hasPow2 = hasPowerData; // stable: keep visible at 0W when coasting
      const lineH2  = Math.round(W * 0.054);
      const timeY2  = hasPow2 ? subY + lineH2 : subY;
      let groupX    = W * 0.04;
      if (hasHR && cur?.hr) {
        sh(c, "rgba(0,0,0,1)", 20);
        c.fillStyle = "#ff4d4d";
        c.fillText(`\u2665 ${Math.round(cur.hr)}`, groupX, subY);
        groupX += c.measureText(`\u2665 ${Math.round(cur.hr)}`).width + Math.round(W * 0.03);
      }
      if (hasPow2) {
        sh(c, "rgba(0,0,0,1)", 20);
        c.fillStyle = "#ffffff";
        c.fillText(`\u26A1 ${Math.round((cur as any)?.power ?? 0)}W`, groupX, subY);
        groupX = W * 0.04; // time on row 2
      }
      const relMs  = Math.max(0, (cur?.time || 0) - (pts[0]?.time || 0));
      const relSec = Math.round(relMs / 1000);
      const rhh = Math.floor(relSec / 3600);
      const rmm = Math.floor((relSec % 3600) / 60).toString().padStart(2, "0");
      const rss = Math.floor(relSec % 60).toString().padStart(2, "0");
      const tstr = rhh > 0 ? `${rhh.toString().padStart(2,"0")}:${rmm}:${rss}` : `${rmm}:${rss}`;
      sh(c, "rgba(0,0,0,1)", 20);
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.fillText(`\u23F1 ${tstr}`, groupX, timeY2);
      c.restore();      c.restore();

      // Intensity bar — top of canvas (speed-based, same as desktop concept)
      const barW2 = Math.round(W * c01(speedRaw / (maxGauge / SPEED_DIV)));
      if (barW2 > 0) {
        const barG = c.createLinearGradient(0, 0, W, 0);
        barG.addColorStop(0, "#f59e0b"); barG.addColorStop(0.6, "#f97316"); barG.addColorStop(1, "#ef4444");
        c.fillStyle = barG; c.fillRect(0, 0, barW2, 6);
      }

      // Mini-map — no background box, matches desktop
      drawMiniMap(c, gpsIdx);

      // Altimetry — extracted to helper so portrait template can reuse it
      drawAltimetryBase(c, gpsIdx);

      c.restore();
    }

    // ── Drawing: INTRO phase ─────────────────────────────────────────────────────
    // Background: solid dark fill (no video).
    //
    // WHY no video background on mobile:
    //   On iOS, the hardware video decoder and the hardware VideoEncoder share the
    //   same Video Toolbox pool (VTCompressionSession). Activating the decoder during
    //   the INTRO (via drawVideoFrame or early videoEl.play()) while the encoder is
    //   initialising causes "Encoding task did not complete" in 1–2 seconds.
    //   Even when prefer-software encoding is requested, WebKit may fall back to
    //   hardware, reintroducing the conflict.
    //
    //   Solution: keep the hardware decoder completely idle during INTRO.
    //   videoEl.play() is only called at ACTION start (main render loop), by which
    //   time the encoder is fully warm and the decoder/encoder interleave is safe.
    //   The INTRO is primarily a text+animation screen; the dark background is fine.
    let introLoggedOnce = false;
    function drawIntroPhase(c: CanvasRenderingContext2D, localTime: number, _segDur: number) {
      const elapsed = localTime * 1000; // ms from intro start (matches desktop timing)
      const eo = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
      const cl = (x: number) => Math.min(Math.max(x, 0), 1);
      const lp = (a: number, b: number, t: number) => a + (b - a) * t;

      if (!introLoggedOnce) {
        introLoggedOnce = true;
        mlog("INTRO", `drawIntroPhase called — elapsed=${elapsed.toFixed(0)}ms`);
      }

      // textAlpha fades out in the last 25% of INTRO so elements exit smoothly.
      const transOutProg = eo(cl((elapsed - (_segDur * 1000 * 0.75)) / (_segDur * 1000 * 0.25)));
      const textAlpha    = 1 - transOutProg;

      c.save();

      // ── 0. Solid dark background — no video, no decoder activation ────────────
      c.fillStyle = "#050505"; c.fillRect(0, 0, W, H);

      // ── All overlay elements — wrapped in textAlpha so they fade out together ─
      if (textAlpha < 0.01) { c.restore(); return; }
      c.save();
      c.globalAlpha = textAlpha;

      // ── 1. Cinematic vignette + bottom contrast overlay ───────────────────────
      c.fillStyle = introVignette; c.fillRect(0, 0, W, H);
      const contrastGrad = c.createLinearGradient(0, H*0.30, 0, H);
      contrastGrad.addColorStop(0,    "rgba(0,0,0,0)");
      contrastGrad.addColorStop(0.25, "rgba(0,0,0,0.55)");
      contrastGrad.addColorStop(1,    "rgba(0,0,0,0.82)");
      c.fillStyle = contrastGrad; c.fillRect(0, H*0.30, W, H*0.70);

      // ── 2. Letterbox bars — retract from 30% → 5px over 700ms ───────────────
      const barProg = eo(elapsed / 700);
      const barH    = Math.round(lp(H * 0.3, 5, barProg));
      c.fillStyle = "#050505";
      c.fillRect(0, 0, W, barH);           // top bar
      c.fillRect(0, H - barH, W, barH);    // bottom bar
      c.fillStyle = "#f59e0b";
      c.fillRect(0, barH - 4, W, 4);       // amber accent top edge
      c.fillRect(0, H - barH, W, 4);       // amber accent bottom edge

      // ── 3. LENS wordmark + "DEVELOPED BY" + ProRefuel logo ────────────────
      const logoAlpha = eo(cl((elapsed - 500) / 400));
      if (logoAlpha > 0.01) {
        const slideUp = (1 - logoAlpha) * 14;

        c.globalAlpha = logoAlpha;
        sh(c, "rgba(0,0,0,0.9)", 25);
        c.font = `900 ${Math.round(W * 0.18)}px sans-serif`;
        c.fillStyle = "rgba(255,255,255,0.97)";
        c.textAlign = "center";
        c.fillText("LENS", W / 2, H * 0.16 + slideUp);

        // Amber accent line below LENS
        c.globalAlpha = logoAlpha * 0.6;
        c.fillStyle = "#f59e0b";
        const accentW = Math.round(W * 0.12);
        c.fillRect((W - accentW) / 2, H * 0.185, accentW, Math.round(H * 0.0025));

        // "DEVELOPED BY"
        nosh(c);
        c.globalAlpha = logoAlpha * 0.6;
        c.font = `300 ${Math.round(W * 0.028)}px sans-serif`;
        c.fillStyle = "rgba(160,160,160,0.9)";
        c.fillText("DEVELOPED BY", W / 2, H * 0.228 + slideUp);

        // ProRefuel logo
        if (logoImg.complete && logoImg.naturalWidth > 0) {
          const lH = Math.round(H * 0.042);
          const lW = (logoImg.naturalWidth / logoImg.naturalHeight) * lH;
          c.globalAlpha = logoAlpha * 0.65;
          c.drawImage(logoImg, (W - lW) / 2, H * 0.248 + slideUp, lW, lH);
        }
        c.globalAlpha = 1; nosh(c);
      }

      // ── 4. Activity title — dynamic font + word-wrap (identical to desktop getTitleLayout) ──
      const titleAlpha = eo(cl((elapsed - 750) / 500));
      if (titleAlpha > 0.01) {
        const titleScale = lp(1.1, 1.0, eo(cl((elapsed - 750) / 600)));

        // Dynamic font sizing — shrinks until the longest word fits in W*0.88
        const maxLineW = W * 0.88;
        let titleFontSize = Math.round(W * 0.19);
        const minFontSize  = Math.round(W * 0.055);
        const longestWord  = activityName.split(/[\s\-]+/).reduce((a, b) => a.length > b.length ? a : b, activityName);
        c.font = `900 italic ${titleFontSize}px sans-serif`;
        while (c.measureText(longestWord).width > maxLineW && titleFontSize > minFontSize) {
          titleFontSize--;
          c.font = `900 italic ${titleFontSize}px sans-serif`;
        }

        // Word-wrap at final font size
        const words = activityName.split(" ");
        const titleLines: string[] = [];
        let currentLine = "";
        for (const word of words) {
          const test = currentLine ? `${currentLine} ${word}` : word;
          if (c.measureText(test).width > maxLineW && currentLine) {
            titleLines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = test;
          }
        }
        if (currentLine) titleLines.push(currentLine);

        const lineH = titleFontSize * 1.08;
        const blockH = titleLines.length * lineH;
        const blockCenterY = H * 0.43;
        const blockTopY = blockCenterY - blockH / 2;

        c.save();
        c.globalAlpha = titleAlpha;
        sh(c, "rgba(0,0,0,1)", 60);
        c.font = `900 italic ${titleFontSize}px sans-serif`;
        c.fillStyle = "#ffffff"; c.textAlign = "center";
        titleLines.forEach((line, i) => {
          const lineBaseY = blockTopY + lineH * (i + 0.82) + (1 - titleAlpha) * 18;
          c.save();
          c.translate(W / 2, lineBaseY); c.scale(titleScale, titleScale);
          c.fillText(line, 0, 0);
          c.restore();
        });
        c.restore(); nosh(c);
      }

      // ── 6. Separator line — amber, draws left→right at 1480ms ───────────────
      const sepProg = eo(cl((elapsed - 1480) / 350));
      if (sepProg > 0.01) {
        const sepAlpha = Math.min(sepProg * 2, 1);
        const sepY = H * 0.535;
        c.globalAlpha = sepAlpha * 0.7;
        c.strokeStyle = introSepGrad; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(W/2 - W*0.3*sepProg, sepY);
        c.lineTo(W/2 + W*0.3*sepProg, sepY);
        c.stroke();
        c.globalAlpha = 1;
      }

      // ── 7. Stats rows with count-up — identical to desktop ───────────────────
      const STAT_START = 1800;
      const COUNT_DUR  = 700;
      const finalDistVal = totalDistM / DIST_DIV;
      const totalSecStat = totalMs / 1000;

      const statRows = [
        {
          label: "DISTANCE",
          delay: STAT_START,
          countFn: (p: number) => `${(finalDistVal * p).toFixed(1)} ${DIST_UNIT}`,
        },
        {
          label: "DURATION",
          delay: STAT_START + 140,
          countFn: (p: number) => {
            const cs = totalSecStat * p;
            const ch = Math.floor(cs / 3600);
            const cm = Math.floor((cs % 3600) / 60).toString().padStart(2, "0");
            const cse = Math.floor(cs % 60).toString().padStart(2, "0");
            return totalSecStat >= 3600 ? `${ch.toString().padStart(2,"0")}:${cm}:${cse}` : `${cm}:${cse}`;
          },
        },
        {
          label: "AVG SPEED",
          delay: STAT_START + 280,
          countFn: (p: number) => `${(parseFloat(avgSpeedDisp) * p).toFixed(1)} ${SPEED_UNIT}`,
        },
      ];

      const listTop = H * 0.6;
      const rowH    = Math.round(H * 0.068);
      const padL    = Math.round(W * 0.15);
      const padR    = Math.round(W * 0.15);
      const lblFont = `700 ${Math.round(W * 0.026)}px sans-serif`;
      const valFont = `900 ${Math.round(W * 0.068)}px sans-serif`;

      statRows.forEach((s, i) => {
        const alpha = eo(cl((elapsed - s.delay) / 400));
        if (alpha < 0.01) return;
        const countProg = eo(cl((elapsed - s.delay) / COUNT_DUR));
        const rowY = listTop + i * rowH;
        c.save(); c.globalAlpha = alpha;
        // Top separator line
        c.strokeStyle = "rgba(255,255,255,0.10)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(padL, rowY); c.lineTo(W - padR, rowY); c.stroke();
        // Label — left, amber
        sh(c, "rgba(0,0,0,0.9)", 8);
        c.font = lblFont; c.fillStyle = "#f59e0b"; c.textAlign = "left";
        c.fillText(s.label, padL, rowY + rowH * 0.7);
        // Value — right, large, count-up
        sh(c, "rgba(0,0,0,1)", 20);
        c.font = valFont;
        c.fillStyle = countProg >= 0.98 ? "#ffffff" : "#fbbf24";
        c.textAlign = "right";
        c.fillText(s.countFn(countProg), W - padR, rowY + rowH * 0.74);
        // Bottom separator on last row
        if (i === statRows.length - 1) {
          nosh(c); c.strokeStyle = "rgba(255,255,255,0.10)"; c.lineWidth = 1;
          c.beginPath(); c.moveTo(padL, rowY + rowH); c.lineTo(W - padR, rowY + rowH); c.stroke();
        }
        c.restore(); nosh(c);
      });

      // ── 8. @LENS.video ──────────────────────────────────────────────────────
      const igAlpha = eo(cl((elapsed - 2200) / 450));
      if (igAlpha > 0.01) {
        c.save(); c.globalAlpha = igAlpha * 0.82;
        sh(c, "rgba(0,0,0,0.9)", 14);
        c.font = `900 italic ${Math.round(W * 0.040)}px sans-serif`;
        c.fillStyle = "#f59e0b"; c.textAlign = "center";
        c.fillText("@LENS.video", W / 2, H * 0.832);
        c.restore(); nosh(c);
      }

      c.restore(); // end of textAlpha wrapper
      c.restore(); // end of outer save
    }

    // ── Drawing: BRAND finale — identical to desktop MapEngine drawBrand() ───────
    // The desktop always calls drawBrand(progress=1) because pre-brand reveals
    // elements before the BRAND phase. Mobile has no pre-brand, so we animate
    // elements in using progress = localTime/segDur (0→1 over 3s).
    // Element timings match desktop exactly (0.22→0.55, 0.33→0.60, 0.42→0.70, 0.60→0.85).
    function drawBrandPhase(c: CanvasRenderingContext2D, localTime: number, segDur: number) {
      const progress = Math.min(localTime / segDur, 1);
      const eo = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
      const cl = (x: number) => Math.min(Math.max(x, 0), 1);

      // ── Background — same as desktop: solid black ──────────────────────────
      c.fillStyle = "#050505"; c.fillRect(0, 0, W, H);

      c.save();

      // ── LENS wordmark: scales 0.55→1.0, fades in at progress 0.22→0.55 ───────
      const lensProg = eo(cl((progress - 0.22) / 0.33));
      if (lensProg > 0.01) {
        const scale = 0.55 + 0.45 * lensProg;
        c.save();
        c.globalAlpha = lensProg;
        sh(c, "rgba(0,0,0,0.9)", 22);
        c.font = `900 ${Math.round(W * 0.26)}px sans-serif`;
        c.fillStyle = "rgba(255,255,255,0.97)";
        c.textAlign = "center";
        c.translate(W / 2, H * 0.38);
        c.scale(scale, scale);
        c.fillText("LENS", 0, 0);
        c.restore();
        nosh(c);
      }

      // ── Amber line: draws left→right, progress 0.33→0.60 ──────────────────
      const lineProg = eo(cl((progress - 0.33) / 0.27));
      if (lineProg > 0.01) {
        const maxW = Math.round(W * 0.18);
        c.globalAlpha = eo(cl(progress / 0.40));
        c.fillStyle = "#f59e0b";
        const lw = maxW * lineProg;
        c.fillRect((W - lw) / 2, H * 0.425, lw, Math.round(H * 0.003));
        c.globalAlpha = 1;
      }

      // ── "DEVELOPED BY" + ProRefuel logo: progress 0.42→0.70 ───────────────
      const logoProg = eo(cl((progress - 0.42) / 0.28));
      if (logoProg > 0.01) {
        const slideY = (1 - logoProg) * 14;
        c.globalAlpha = logoProg;
        sh(c, "rgba(0,0,0,0.8)", 12);
        c.font = `300 ${Math.round(W * 0.032)}px sans-serif`;
        c.fillStyle = "rgba(170,170,170,0.80)";
        c.textAlign = "center";
        c.fillText("DEVELOPED BY", W / 2, H * 0.462 + slideY);
        nosh(c);
        if (logoImg.complete && logoImg.naturalWidth > 0) {
          const lH = Math.round(H * 0.065);
          const lW = (logoImg.naturalWidth / logoImg.naturalHeight) * lH;
          c.shadowColor = "rgba(245,158,11,0.35)"; c.shadowBlur = 30;
          c.drawImage(logoImg, (W - lW) / 2, H * 0.484 + slideY, lW, lH);
          nosh(c);
        }
      }

      // ── @LENS.video: progress 0.60→0.85 ──────────────────────────────────
      const igProg = eo(cl((progress - 0.60) / 0.25));
      if (igProg > 0.01) {
        const slideY = (1 - igProg) * 10;
        c.globalAlpha = igProg * 0.90;
        sh(c, "rgba(0,0,0,0.95)", 16);
        c.font = `900 italic ${Math.round(W * 0.048)}px sans-serif`;
        c.fillStyle = "#f59e0b";
        c.textAlign = "center";
        c.fillText("@LENS.video", W / 2, H * 0.590 + slideY);
        nosh(c);
      }

      c.globalAlpha = 1;
      c.restore();
    }

    // ── Drawing: altimetry — drawn directly from data arrays (no GPU cache) ───
    // altimetryCache (canvas offscreen) gets GPU-evicted during iOS HEVC decoder
    // resets, making the elevation chart invisible permanently. Drawing directly
    // from altProjX/altProjY (CPU Float32Arrays) eliminates this dependency.
    function drawAltimetryBase(c: CanvasRenderingContext2D, gpsIdx: number) {
      const altCursorX = altProjX[gpsIdx];
      const altCursorY = altProjY[gpsIdx];

      c.save();
      c.globalAlpha = 0.45;

      // Background dark fade strip
      const bgG = c.createLinearGradient(0, ALT_Y, 0, ALT_Y + ALT_PT + ALT_H);
      bgG.addColorStop(0, "rgba(5,5,5,0)"); bgG.addColorStop(0.3, "rgba(5,5,5,0.75)"); bgG.addColorStop(1, "rgba(5,5,5,0.97)");
      c.fillStyle = bgG; c.fillRect(0, ALT_Y, W, ALT_PT + ALT_H);

      // Amber area fill
      const altG = c.createLinearGradient(0, ALT_Y + ALT_PT, 0, ALT_Y + ALT_PT + ALT_H);
      altG.addColorStop(0, "rgba(245,158,11,0.45)"); altG.addColorStop(1, "rgba(245,158,11,0)");
      c.fillStyle = altG;
      c.beginPath(); c.moveTo(ALT_PAD_X, ALT_Y + ALT_PT + ALT_H);
      pts.forEach((_: any, i: number) => c.lineTo(altProjX[i], altProjY[i]));
      c.lineTo(W - ALT_PAD_X, ALT_Y + ALT_PT + ALT_H); c.closePath(); c.fill();

      // Elevation curve with amber glow
      c.strokeStyle = "#f59e0b"; c.lineWidth = 2.5; c.lineJoin = "round";
      c.shadowColor = "rgba(245,158,11,0.45)"; c.shadowBlur = 8;
      c.beginPath();
      pts.forEach((_: any, i: number) =>
        i === 0 ? c.moveTo(altProjX[i], altProjY[i]) : c.lineTo(altProjX[i], altProjY[i]));
      c.stroke(); c.shadowBlur = 0;

      c.restore();

      // Dashed cursor line
      c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 1.5; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(altCursorX, ALT_Y); c.lineTo(altCursorX, ALT_Y + ALT_PT + ALT_H); c.stroke();
      c.setLineDash([]);
      // Amber cursor dot
      c.fillStyle = "#f59e0b"; c.shadowColor = "rgba(245,158,11,0.6)"; c.shadowBlur = 8;
      c.beginPath(); c.arc(altCursorX, altCursorY, 5, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
    }

    // ── Drawing: Activity Portrait HUD (template 2) ────────────────────────────
    // Mirrors desktop MapEngine drawPortraitHUD exactly:
    //   • Map centered at top, full static route, no amber trail, no cursor dot
    //   • Single-column stats with progressive reveals (revealFrac 0→1)
    //   • Elevation graph at bottom (same as template 1)
    function drawPortraitHUD(c: CanvasRenderingContext2D, gpsIdx: number, revealFrac: number) {
      const pd = storyPlan?.portraitData;
      if (!pd) return;

      // ── Map: centered, no trail, no cursor ─────────────────────────────────
      // Uses routePath2D (CPU Path2D) — same GPU-eviction immunity as drawMiniMap.
      const mapX = Math.round((W - MM_W) / 2);
      c.save();
      c.globalAlpha = Math.min(revealFrac / 0.08, 1) * 0.88;
      c.translate(mapX, MM_Y);
      c.shadowColor = "rgba(0,0,0,0.90)"; c.shadowBlur = 10;
      c.shadowOffsetX = 3; c.shadowOffsetY = 4;
      c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 2.5;
      c.lineJoin = "round"; c.lineCap = "round";
      c.stroke(routePath2D);
      c.globalAlpha = 1;
      c.restore();

      // ── Format helpers ──────────────────────────────────────────────────────
      const fmtDist  = (m: number) => `${(m / DIST_DIV).toFixed(1)} ${DIST_UNIT}`;
      const fmtTime  = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const mn = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
        const s  = Math.floor(sec % 60).toString().padStart(2, "0");
        return h > 0 ? `${h}h ${mn}min` : `${mn}:${s}`;
      };
      const fmtSpeed = (kmh: number) => `${(kmh * SPEED_DIV).toFixed(1)} ${SPEED_UNIT}`;

      // ── Build stat list (skip null/0 entries) ───────────────────────────────
      type SI = { value: string; label: string; color: string };
      const stats: SI[] = [];
      stats.push({ value: fmtDist(pd.totalDistanceM), label: "Total Distance", color: "#ffffff" });
      stats.push({ value: fmtTime(pd.durationSec),    label: "Total Time",     color: "#ffffff" });
      stats.push({ value: fmtSpeed(pd.avgSpeedKmh),   label: "Avg Speed",      color: "#f59e0b" });
      if (pd.maxSpeedKmh !== null && pd.maxSpeedKmh > 0)
        stats.push({ value: fmtSpeed(pd.maxSpeedKmh), label: "Max Speed",      color: "#fbbf24" });
      stats.push({ value: `▲ ${pd.elevationGainM} m`, label: "Elevation Gain", color: "#ffffff" });
      if (pd.hasHeartRate && pd.hrAvg !== null && pd.hrMax !== null)
        stats.push({ value: `♥ ${pd.hrAvg} / ${pd.hrMax}`, label: "HR avg / max", color: "#f87171" });

      // ── Geometry: fit stats evenly between map bottom and graph top ─────────
      const STATS_TOP = MM_Y + MM_H + Math.round(H * 0.04);
      const STATS_BTM = ALT_Y - Math.round(H * 0.02);
      const ROW_H     = Math.round((STATS_BTM - STATS_TOP) / stats.length);
      const PAD_X     = Math.round(W * 0.06);
      const VAL_SIZE  = Math.round(W * 0.062);
      const LBL_SIZE  = Math.round(W * 0.020);
      const LBL_GAP   = Math.round(W * 0.026);

      const revealStart = 0.10;
      const revealEnd   = 0.75;
      const revealStep  = stats.length > 1 ? (revealEnd - revealStart) / (stats.length - 1) : 0;

      stats.forEach(({ value, label, color }, i) => {
        const threshold = revealStart + i * revealStep;
        const alpha = Math.min(Math.max(revealFrac - threshold, 0) / 0.05, 1);
        if (alpha <= 0) return;
        const y = STATS_TOP + Math.round(ROW_H * (i + 0.72));
        c.save();
        c.globalAlpha  = alpha;
        c.shadowColor  = "rgba(0,0,0,0.95)";
        c.shadowBlur   = 18;
        c.font         = `900 ${VAL_SIZE}px sans-serif`;
        c.fillStyle    = color;
        c.textAlign    = "left";
        c.textBaseline = "alphabetic";
        c.fillText(value, PAD_X, y);
        c.shadowBlur   = 7;
        c.font         = `700 ${LBL_SIZE}px sans-serif`;
        c.fillStyle    = "rgba(161,161,170,0.85)";
        c.fillText(label.toUpperCase(), PAD_X, y + LBL_GAP);
        c.restore();
      });

      // ── Elevation graph (identical to template 1) ───────────────────────────
      drawAltimetryBase(c, gpsIdx);
    }

    // ── LENS watermark — black circle with LENS text, top-right corner ───────────
    function drawWatermark(c: CanvasRenderingContext2D) {
      const wmSize = Math.round(W * 0.079);
      const wmR    = wmSize / 2;
      const wmCX   = W - wmSize - 5 + wmR;
      const wmCY   = 5 + wmR;
      c.save();
      c.globalAlpha = 0.30;
      c.beginPath();
      c.arc(wmCX, wmCY, wmR, 0, Math.PI * 2);
      c.fillStyle = "#000000";
      c.fill();
      c.fillStyle = "#ffffff";
      c.font = `900 ${Math.round(wmSize * 0.30)}px sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("LENS", wmCX, wmCY);
      c.restore();
    }

    // Pre-compute: does ANY point in this activity have power data?
    const hasPowerData = pts.some((p: any) => p.power > 0);

    // ── Master draw function (called each frame) ───────────────────────────────
    function drawFrame(elapsed: number) {
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);

      const hit = getSegAt(elapsed);
      if (!hit) { drawWatermark(ctx); return; }

      const { seg, segIdx, localTime } = hit;
      const gpsIdx = getGPSIdxAt(elapsed);

      if (seg.type === "INTRO") {
        drawIntroPhase(ctx, localTime, seg.durationSec);

      } else if (seg.type === "ACTION") {
        if (segIdx !== lastSegIdx && typeof seg.videoStartTime === "number") {
          lastSegIdx = segIdx;
          mlog("SEG_START", `seg[${segIdx}] ACTION — no seek (encoder running), video at ${videoEl.currentTime.toFixed(2)}s`);
          if (videoEl.paused) videoEl.play().catch(() => {});
        }

        // drawVideoFrame returns true when something was drawn (live or frozen).
        // During iOS HEVC decoder resets (readyState=0), hasFrozenFrame=true means
        // we draw the last cached frame, keeping video + HUD visible.
        const frameDrawn = drawVideoFrame(ctx);

        // Soft vignette
        const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.72);
        vig.addColorStop(0, "rgba(0,0,0,0.02)"); vig.addColorStop(1, "rgba(0,0,0,0.58)");
        ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

        if (storyPlan?.templateId === 'activity_portrait') {
          // Portrait template: map (centered, no cursor) + progressive stats + elevation
          const revealFrac = Math.min(localTime / seg.durationSec, 1);
          drawPortraitHUD(ctx, gpsIdx, revealFrac);
        } else {
          drawTelemetryHUD(ctx, gpsIdx);
        }
        drawWatermark(ctx);

        // No black overlay needed — intro ends with color video visible, ACTION
        // continues from the same frame. Zero black flash between intro and video.

      } else if (seg.type === "BRAND") {
        // Desktop fills with solid black then draws brand elements.
        // No video frame underneath — drawBrandPhase handles the background.
        drawBrandPhase(ctx, localTime, seg.durationSec);
      }
    }

    // ── Global error catchers — write to localStorage before crash ───────────
    const onWindowError = (e: ErrorEvent) => {
      mlog("CRASH", `${e.message} @ ${e.filename}:${e.lineno}`);
    };
    const onUnhandled = (e: PromiseRejectionEvent) => {
      mlog("REJECT", String(e.reason));
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandled);

    // ── Screen Wake Lock ──────────────────────────────────────────────────────
    // Prevents the device screen from dimming or locking during encoding.
    // On iOS, screen lock revokes the VTCompressionSession (hardware encoder) and
    // causes VideoEncoder.flush() to throw "Encoding task did not complete".
    // The Wake Lock ensures the hardware encoder session stays alive for the full
    // duration of the render (30–36s).
    //
    // Available: iOS 16.4+ (Safari), Android Chrome 84+.
    // Automatically released by the browser if the tab is hidden or backgrounded.
    let wakeLock: { release: () => Promise<void> } | null = null;

    // ── Main recording loop ────────────────────────────────────────────────────
    async function startRecordingLoop() {
      // Acquire Screen Wake Lock before encoding starts.
      // Must be called inside an async function (browser requirement).
      if ('wakeLock' in navigator) {
        try {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          mlog("WAKELOCK", "acquired — screen will stay on during encoding");
        } catch (e: any) {
          mlog("WAKELOCK", `could not acquire: ${e?.message ?? e} — encoding may fail if screen dims`);
        }
      } else {
        mlog("WAKELOCK", "not supported on this browser");
      }

      // Do NOT mlogClear() here — upload logs (SEG_CALC, HIGHLIGHTS, etc.) are valuable
      // for diagnosing sync issues. Just append a separator.
      mlog("---", "=== RENDER START ===");
      mlog("INIT", `canvas=${W}×${H} fps=${FPS} dur=${totalDurSec.toFixed(1)}s segments=${segments.length}`);
      mlog("INIT", `pts=${pts.length} videoFile=${videoFile?.name} size=${((videoFile?.size ?? 0)/1_048_576).toFixed(1)}MB`);

      // ── Pre-seek video BEFORE creating the encoder ───────────────────────────
      // On iOS, seeking while VideoEncoder is running kills the encoder because
      // the video decoder and encoder share the same Video Toolbox hardware block.
      // Solution: seek to the first ACTION segment's position NOW, wait for it
      // to complete, then create the encoder. No seeks happen during encoding.
      const firstActionSeg = trimmedSegments.find(
        (s: any) => s.type === "ACTION" && typeof s.videoStartTime === "number" && s.videoStartTime > 0.5,
      );

      // ── iOS HEVC: always start from position 0 ────────────────────────────────
      // ROOT CAUSE of crashes: pre-seeking to a later position (e.g. 23s) forces the
      // iOS hardware HEVC decoder to build up a large reference frame context in GPU
      // memory before the encoder even starts. When the encoder then runs and the
      // decoder's look-ahead hits dense frames further into the video, there's no
      // GPU memory left → OOM → decoder reset.
      //
      // PROOF: IMG_9582.MOV (same 4K HEVC, same device) renders successfully from
      // position 0 with frames up to 1811KB. IMG_9576.MOV crashes from position 23s
      // with frames up to 628KB. Both would work fine from position 0 because the
      // decoder starts with zero accumulated GPU state.
      //
      // Fix: for iOS HEVC, always render from video position 0. The GPS overlay data
      // is still correct (it progresses based on elapsed render time from the video's
      // creation timestamp). The user gets a full quality video with Template A HUD.
      if (firstActionSeg && sourceIsHEVC && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const orig = (firstActionSeg as any).videoStartTime;
        if (orig > 0.5) {
          mlog("HEVC_FIX", `iOS HEVC: overriding videoStartTime ${orig.toFixed(1)}s → 0 (clean decoder state, avoids GPU OOM)`);
          (firstActionSeg as any).videoStartTime = 0;
          if (storyPlan) (storyPlan as any).renderQuality = 'alternative_segment';
        }
      }

      if (firstActionSeg) {
        const target = firstActionSeg.videoStartTime!;
        mlog("PRESEEK", `seeking to ${target.toFixed(2)}s before encoder starts`);
        setStatus("Preparing video…");
        videoEl.currentTime = target;

        // Wait for seek to complete — 15s for slow Android devices (was 5s, too short)
        await new Promise<void>(resolve => {
          const onSeeked = () => { videoEl.removeEventListener("seeked", onSeeked); resolve(); };
          videoEl.addEventListener("seeked", onSeeked);
          setTimeout(resolve, 15_000);
        });

        // Wait for readyState >= 2 (HAVE_CURRENT_DATA)
        if (videoEl.readyState < 2) {
          await new Promise<void>(resolve => {
            const check = () => videoEl.readyState >= 2 ? resolve() : setTimeout(check, 80);
            check();
            setTimeout(resolve, 10_000);
          });
        }
        mlog("PRESEEK", `done — readyState=${videoEl.readyState} currentTime=${videoEl.currentTime.toFixed(2)}s`);

        // ── Post-seek cool-down on iOS ────────────────────────────────────────
        // Seeking to a keyframe in a high-resolution video (especially HEVC 4K)
        // causes iOS Video Toolbox to allocate hardware decoder resources that
        // persist briefly even after the seek completes and the video is paused.
        //
        // Creating the VideoEncoder immediately after (even in prefer-software mode)
        // risks conflicting with these residual decoder hardware resources. A brief
        // pause lets the VTCompressionSession infrastructure settle before encoder init.
        //
        // The pre-warm (play → pause) was REMOVED — it was far more aggressive than a
        // static delay and caused consistent 1-second crashes.
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          await new Promise<void>(r => setTimeout(r, 600));
          mlog("PRESEEK", "post-seek cool-down done — creating encoder");
        }
      } else {
        // No pre-seek, no probe.
        // The decoder will initialise when ACTION starts via videoEl.play() in the loop.
        mlog("PRESEEK", "no seek needed — skipping warm-up to avoid Video Toolbox conflict");
      }

      // Always mark gray frame as ready once the video element has content.
      // Previously this was inside the if(firstActionSeg) block — videos with
      // videoStartTime=0 never entered that block and grayFrameReady stayed false,
      // making the intro background black instead of the frozen grayscale frame.
      grayFrameReady = videoEl.readyState >= 2 && videoEl.videoWidth > 0;
      mlog("GRAY", `grayFrameReady=${grayFrameReady} readyState=${videoEl.readyState} videoWidth=${videoEl.videoWidth}`);

      setStatus("Initializing encoder…");
      // Codec selection — see MobileRecorder.ts for full rationale:
      //   iOS + HEVC source → VP9/libvpx (zero Video Toolbox → no conflict with HEVC decoder)
      //   iOS + H264 source → H264 prefer-software (VT software path, lighter hardware use)
      //   Android           → H264 no-preference   (MediaCodec: decoder/encoder are separate)
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      mlog("ENCODER", `isIOS=${isIOS} sourceIsHEVC=${sourceIsHEVC}`);
      try {
        recorder = await MobileRecorder.create(canvas as HTMLCanvasElement, { isIOS, sourceIsHEVC });
        mlog("INIT", "MobileRecorder created ok");
      } catch (err: any) {
        mlog("ERROR", `MobileRecorder.create failed: ${err.message}`);
        setStatus("Video encoding is not supported on this device.");
        onRenderComplete({ durationMs: 0, outputFormat: "mp4", outputSizeBytes: 0, status: "error", errorMessage: err.message });
        return;
      }

      setStatus("Recording…");
      recStartMs = performance.now();
      mlog("REC", "loop started");

      let lastCaptureMs    = -1;
      let lastLogSec       = -1;
      let lastSegIdxLog    = -99;
      let skippedFrames    = 0;
      let prevVideoReady      = 4;   // track readyState to detect decoder resets
      let decoderResetCount   = 0;   // total reset count
      let lastResetMs         = 0;   // wall-clock ms of the most recent reset
      // Rapid-reset threshold: if 2 resets occur within this window,
      // GPU memory is fragmenting fast enough to crash the browser tab.
      // Videos with a single reset (or resets > 5s apart) are fine.
      const RAPID_RESET_WINDOW_MS = 5_000;

      const loop = (now: number) => {
        if (isStopped) return;

        const elapsed = (now - recStartMs) / 1000;
        setProgress(Math.round(c01(elapsed / totalDurSec) * 90));

        // ── iOS HEVC decoder reset detection & cache rebuild ─────────────────
        // When readyState drops from ≥2 to <2, the iOS GPU has evicted the
        // backing textures of broadmapCache, gaugeCache, altimetryCache and
        // trailCache. Rebuild them immediately using CPU-resident data arrays.
        const curReady = videoEl.readyState;
        if (curReady < 2 && prevVideoReady >= 2) {
          const nowMs = performance.now();
          const msSinceLast = decoderResetCount > 0 ? nowMs - lastResetMs : Infinity;
          decoderResetCount++;
          lastResetMs = nowMs;
          mlog("DECODER_RESET", `t=${elapsed.toFixed(1)}s reset #${decoderResetCount} gap=${msSinceLast < 9999 ? msSinceLast.toFixed(0)+'ms' : 'first'} readyState ${prevVideoReady}→${curReady}`);
          rebuildCaches();

          // Rapid resets (2nd reset within RAPID_RESET_WINDOW_MS of the 1st) signal
          // that the iOS GPU memory is fragmenting fast enough to crash the browser tab
          // ("repeated errors on lens.prorefuel.app" Safari message).
          // Single resets, or resets > 5s apart, are fine — video recovers normally.
          // Only abort when two resets are rapidly consecutive.
          if (decoderResetCount >= 2 && msSinceLast < RAPID_RESET_WINDOW_MS) {
            mlog("ABORT_REASON", `rapid resets: gap=${msSinceLast.toFixed(0)}ms < ${RAPID_RESET_WINDOW_MS}ms threshold`);
            isStopped = true;
            mlog("EARLY_STOP", `2 decoder resets — stopping early to prevent browser OOM crash. frames=${recorder?.framesCaptured}`);
            wakeLock?.release().catch(() => {}); wakeLock = null;
            setStatus("Finalizing…");
            const earlyStartMs = recStartMs;
            recorder!.stop()
              .then(async (vp9Blob) => {
                const totalMs = Math.round(performance.now() - earlyStartMs);
                renderDurationMsRef.current = totalMs;
                mlog("EARLY_STOP", `partial blob=${( vp9Blob.size/1_048_576).toFixed(1)}MB wasVP9=${recorder?.wasVP9}`);
                let finalBlob = vp9Blob;
                if (recorder?.wasVP9 && vp9Blob.size > 5_000) {
                  setStatus("Optimizing for Photos…");
                  try {
                    const { FFmpeg }    = await import("@ffmpeg/ffmpeg");
                    const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
                    const ff = new FFmpeg();
                    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
                    await ff.load({
                      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`,   "text/javascript"),
                      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
                    });
                    await ff.writeFile("in.mp4", await fetchFile(vp9Blob));
                    const exit = await ff.exec(["-i","in.mp4","-c:v","libx264","-preset","ultrafast","-crf","23","-pix_fmt","yuv420p","-movflags","+faststart","out.mp4"]);
                    if (exit === 0) {
                      const raw = await ff.readFile("out.mp4") as Uint8Array<ArrayBuffer>;
                      finalBlob = new Blob([raw], { type: "video/mp4" });
                      mlog("EARLY_STOP", `H264 output: ${(finalBlob.size/1_048_576).toFixed(1)}MB`);
                    }
                  } catch (te: any) { mlog("EARLY_STOP", `transcode failed: ${te?.message} — using VP9`); }
                }
                setProgress(100); setStatus("Video ready!");
                setReadyBlob({ blob: finalBlob, filename: `LENS_${makeTimestamp()}.mp4` });
              })
              .catch((err: any) => {
                mlog("EARLY_STOP", `stop failed: ${err?.message}`);
                setStatus("Export failed. Please try again.");
                onRenderComplete({ durationMs: 0, outputFormat: "mp4", outputSizeBytes: 0, status: "error",
                  errorMessage: "4K video exceeded device memory limits. Record in 1080p: Settings → Camera → Record Video → 1080p HD." });
              });
            return;
          }
        }
        prevVideoReady = curReady;

        // ── Encoder / muxer death check ───────────────────────────────────────
        if (recorder?.error) {
          isStopped = true;
          mlog("ABORT", `t=${elapsed.toFixed(1)}s err=${recorder.error.name}: ${recorder.error.message}`);
          // Release Wake Lock on encoder abort
          wakeLock?.release().catch(() => {});
          wakeLock = null;
          setStatus("Encoding failed. Please try again.");
          onRenderComplete({ durationMs: 0, outputFormat: "mp4", outputSizeBytes: 0, status: "error", errorMessage: recorder.error.message ?? "Encoder died" });
          return;
        }

        // ── Log every second ──────────────────────────────────────────────────
        const secFloor = Math.floor(elapsed);
        if (secFloor > lastLogSec) {
          lastLogSec = secFloor;
          const encMB = ((recorder?.estimatedEncodedBytes ?? 0) / 1_048_576).toFixed(1);
          const queue  = recorder?.encoderQueueSize ?? "?";
          const frames = recorder?.framesCaptured ?? "?";
          const vState = videoEl.readyState;
          const vTime  = videoEl.currentTime.toFixed(2);
          const vState2 = videoEl.paused ? "PAUSED" : "playing";
          mlog("REC", `t=${secFloor}s enc=${encMB}MB q=${queue} frames=${frames} skip=${skippedFrames} vid=${vState}/${vState2}@${vTime}s`);
          skippedFrames = 0;
        }

        // ── Stop when timeline is done ────────────────────────────────────────
        if (elapsed >= totalDurSec) {
          isStopped = true;
          mlog("STOP", `encEst=${((recorder?.estimatedEncodedBytes ?? 0) / 1_048_576).toFixed(1)}MB — flushing`);
          setStatus("Encoding…");
          const flushStart = Date.now();
          // Total duration = recording loop + flush (recStartMs is performance.now())
          const totalStartMs = recStartMs;
          recorder!.stop()
            .then(async (vp9OrH264Blob) => {
              const totalMs = Math.round(performance.now() - totalStartMs);
              renderDurationMsRef.current = totalMs;
              mlog("STOP", `done flush=${Date.now()-flushStart}ms total=${totalMs}ms blob=${(vp9OrH264Blob.size/1_048_576).toFixed(1)}MB wasVP9=${recorder?.wasVP9}`);

              // ── VP9 → H264 post-transcode (iOS Photos compatibility) ──────────
              // VP9/libvpx encoding avoids the Video Toolbox conflict with HEVC
              // hardware decode. But iOS Photos only accepts H264/HEVC in MP4.
              // Re-encode the small VP9 output (~9 MB) to H264 via FFmpeg.wasm.
              // This is fast (9 MB input, no HEVC decode, ultrafast preset) ≈ 10–15s.
              let finalBlob = vp9OrH264Blob;
              if (recorder?.wasVP9) {
                setStatus("Optimizing for Photos…");
                mlog("TRANSCODE", `VP9→H264: ${(vp9OrH264Blob.size/1_048_576).toFixed(1)}MB input`);
                try {
                  const { FFmpeg }    = await import("@ffmpeg/ffmpeg");
                  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
                  const ff = new FFmpeg();
                  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
                  await ff.load({
                    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`,   "text/javascript"),
                    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
                  });
                  await ff.writeFile("in.mp4", await fetchFile(vp9OrH264Blob));
                  const exitCode = await ff.exec([
                    "-i", "in.mp4",
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    "out.mp4",
                  ]);
                  if (exitCode === 0) {
                    const raw = await ff.readFile("out.mp4") as Uint8Array<ArrayBuffer>;
                    finalBlob = new Blob([raw], { type: "video/mp4" });
                    mlog("TRANSCODE", `done: ${(finalBlob.size/1_048_576).toFixed(1)}MB H264`);
                  } else {
                    mlog("TRANSCODE", `FFmpeg exit=${exitCode} — using VP9 blob as fallback`);
                  }
                } catch (transErr: any) {
                  mlog("TRANSCODE", `failed: ${transErr?.message} — using VP9 blob as fallback`);
                }
              }

              // Release Wake Lock now that all encoding/transcoding is complete
              wakeLock?.release().catch(() => {});
              wakeLock = null;
              setProgress(100); setStatus("Video ready!");
              setReadyBlob({ blob: finalBlob, filename: `LENS_${makeTimestamp()}.mp4` });
            })
            .catch((err: any) => {
              mlog("ERROR", `stop() failed: ${err?.message ?? err}`);
              // Release Wake Lock on encode failure
              wakeLock?.release().catch(() => {});
              wakeLock = null;
              setStatus("Export failed. Please try again.");
              onRenderComplete({ durationMs: 0, outputFormat: "mp4", outputSizeBytes: 0, status: "error", errorMessage: err?.message ?? "unknown" });
            });
          return;
        }

        // ── Segment transition log ────────────────────────────────────────────
        const hit = getSegAt(elapsed);
        if (hit && hit.segIdx !== lastSegIdxLog) {
          lastSegIdxLog = hit.segIdx;
          mlog("SEG", `→ seg[${hit.segIdx}] type=${hit.seg.type} dur=${hit.seg.durationSec.toFixed(1)}s videoStart=${hit.seg.videoStartTime?.toFixed(2) ?? "n/a"}s`);
          // Start ACTION video (no seek — pre-seek already positioned the video)
          if (hit.seg.type === "ACTION" && videoEl.paused) videoEl.play().catch(() => {});
        }

        // ── Draw (every rAF for smooth preview) ───────────────────────────────
        try { drawFrame(elapsed); } catch (err: any) { mlog("ERROR", `drawFrame: ${err?.message}`); }

        // ── Capture at 30fps ─────────────────────────────────────────────────
        if (lastCaptureMs < 0 || now - lastCaptureMs >= CAPTURE_INTERVAL_MS) {
          if ((recorder?.encoderQueueSize ?? 0) > 10) {
            skippedFrames++;
          } else {
            // During iOS HEVC decoder reset: drawFrame drew the frozen frame.
            // We can still encode it (frozen = visible frame, not blank).
            // videoEl.readyState < 2 but hasFrozenFrame=true → capture as normal.
            // This avoids jump cuts in the output — shows a brief freeze instead.
            const videoReady = videoEl.readyState >= 2 || hasFrozenFrame;
            if (!videoReady) skippedFrames++;
            const tsUs = Math.round((now - recStartMs) * 1000);
            try { recorder?.captureFrame(videoReady, tsUs); } catch (err: any) { mlog("ERROR", `captureFrame: ${err?.message}`); }
          }
          lastCaptureMs = now;
        }

        rafId = requestAnimationFrame(loop);
      };

      rafId = requestAnimationFrame(loop);
    }

    // Start when video is ready to avoid black frames
    if (videoEl.readyState >= 2) {
      mlog("VIDEO", `readyState=${videoEl.readyState} — starting immediately`);
      startRecordingLoop();
    } else {
      mlog("VIDEO", "waiting for loadeddata…");
      videoEl.addEventListener("loadeddata", () => {
        mlog("VIDEO", `loadeddata fired readyState=${videoEl.readyState}`);
        startRecordingLoop();
      }, { once: true });
      // Fallback timeout — some files take longer to probe
      setTimeout(() => {
        if (!recStartMs && !isStopped) {
          mlog("VIDEO", "fallback timeout fired");
          startRecordingLoop();
        }
      }, 4000);
    }

    return () => {
      // This cleanup fires when the component unmounts (page reload, step change, etc.)
      mlog("CLEANUP", `isStopped=${isStopped} rafId=${rafId} t=${((performance.now()-recStartMs)/1000).toFixed(1)}s`);
      isStopped = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandled);
      URL.revokeObjectURL(videoUrl);
      videoEl.src = "";
      // Release Wake Lock on unmount (success path releases it via recorder.stop() handler)
      wakeLock?.release().catch(() => {});
      wakeLock = null;
    };
  }, [videoFile, activityPoints.length, storyPlan]);

  // ── UI ─────────────────────────────────────────────────────────────────────

  // ── State: video ready to save (shown after encoding) ──────────────────────
  if (readyBlob) {
    const { blob, filename } = readyBlob;
    const isAndroid = /Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

    const handleSave = async () => {
      const file = new File([blob], filename, { type: "video/mp4" });

      // ── Web Share API — iOS and Android Chrome 75+ ─────────────────────────────
      // On Android 10+ (scoped storage), <a download> saves to Downloads but NOT
      // to the Gallery app. Web Share API lets the user choose Google Photos / Gallery
      // directly from the native share sheet, which is the expected "Save" behavior.
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "LENS Video" });
          onRenderComplete({ durationMs: renderDurationMsRef.current, outputFormat: "mp4", outputSizeBytes: blob.size, status: "success", downloadAction: "save" });
          return;
        } catch (e: any) {
          if (e?.name === "AbortError") return; // user dismissed — stay on screen
          // Share API failed — fall through to direct download
        }
      }

      // ── Fallback: direct download (Android without Web Share API support) ──────
      // File goes to /sdcard/Downloads. On Android 9 and older, the Media Scanner
      // picks it up and adds it to the Gallery. On Android 10+, user must open
      // the Files app and move it manually.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onRenderComplete({ durationMs: renderDurationMsRef.current, outputFormat: "mp4", outputSizeBytes: blob.size, status: "success", downloadAction: "save" });
    };

    return (
      <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-6">

        {/* Brand header */}
        <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-10 pb-3 pointer-events-none">
          <span className="text-4xl font-black tracking-tight text-white leading-none">LENS</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Developed by</span>
            <img src="/prorefuel_logo.png" alt="ProRefuel" className="h-[14px] opacity-55" />
          </div>
        </div>

        {/* Success icon */}
        <div className="w-16 h-16 rounded-2xl bg-green-500/15 border border-green-500/40 flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>

        <p className="text-white font-black text-xl uppercase tracking-[0.15em] mb-1">Video Ready!</p>
        <p className="text-zinc-500 text-[11px] font-black uppercase tracking-widest mb-7">
          {(blob.size / 1_048_576).toFixed(1)} MB · MP4 · {W}×{H}
        </p>

        {/* Buttons */}
        <div className="w-full max-w-[280px] flex flex-col gap-3">

          {/* Primary: Save to device */}
          <button
            onClick={handleSave}
            className="w-full py-5 rounded-2xl bg-amber-500 text-black font-black uppercase tracking-[0.3em] text-sm shadow-[0_10px_30px_rgba(245,158,11,0.35)] active:scale-[0.97] transition-transform flex items-center justify-center gap-3"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/>
            </svg>
            {isAndroid ? "Save to Gallery" : "Save to Photos"}
          </button>

          {/* Secondary: Share (Instagram Stories via native share sheet) */}
          {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
            <button
              onClick={async () => {
                const file = new File([blob], filename, { type: "video/mp4" });
                if (navigator.canShare?.({ files: [file] })) {
                  try {
                    await navigator.share({ files: [file], title: "LENS Video" });
                    // Track share action — triggers state reset same as save
                    onRenderComplete({ durationMs: renderDurationMsRef.current, outputFormat: "mp4", outputSizeBytes: blob.size, status: "success", downloadAction: "share" });
                  } catch (e: any) {
                    if (e?.name !== "AbortError") console.warn("Share failed:", e);
                  }
                }
              }}
              className="w-full py-4 rounded-2xl border border-zinc-700 bg-zinc-900 text-white font-black uppercase tracking-[0.25em] text-sm active:scale-[0.97] transition-transform flex items-center justify-center gap-3"
            >
              {/* Instagram gradient icon */}
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="url(#ig-grad)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <defs>
                  <linearGradient id="ig-grad" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#f9ce34"/>
                    <stop offset="0.35" stopColor="#ee2a7b"/>
                    <stop offset="1" stopColor="#6228d7"/>
                  </linearGradient>
                </defs>
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.5" cy="6.5" r="1" fill="#ee2a7b" stroke="none"/>
              </svg>
              Share to Instagram
            </button>
          )}
        </div>

        <p className="text-zinc-600 text-[10px] mt-4 text-center max-w-[220px] leading-relaxed">
          {isAndroid
            ? "Save to gallery, or share directly via your apps."
            : "Save to Camera Roll, or share via the sheet — select Instagram to post as a Story."}
        </p>
      </div>
    );
  }

  // ── State: encoding in progress ─────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-4">

      {/* Brand header */}
      <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-10 pb-3 pointer-events-none">
        <span className="text-4xl font-black tracking-tight text-white leading-none">LENS</span>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Developed by</span>
          <img src="/prorefuel_logo.png" alt="ProRefuel" className="h-[14px] opacity-55" />
        </div>
      </div>

      <div className="text-white text-lg font-black uppercase tracking-[0.2em] mb-0.5 text-center">
        Creating Your Video
      </div>
      <div className={`text-[11px] font-black uppercase tracking-widest mb-5 ${status.includes("failed") ? "text-red-400" : "text-amber-500 animate-pulse"}`}>
        {status}
      </div>

      <div className="w-[240px] h-2 bg-white/10 rounded-full mb-5 overflow-hidden">
        <div className="h-full bg-amber-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {/* Phone mockup preview */}
      <div className="relative w-[178px] h-[316px] bg-black border-2 border-zinc-800 rounded-[1.4rem] overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.10)] pointer-events-none">
        <canvas ref={canvasRef} width={W} height={H} className="w-full h-full object-cover" />
        <div className="absolute inset-0 rounded-[1.4rem] ring-1 ring-inset ring-white/5 pointer-events-none" />
      </div>

      {status.includes("failed") ? (
        <button
          onClick={() => onRenderComplete({ durationMs: 0, outputFormat: "mp4", outputSizeBytes: 0, status: "error", errorMessage: status })}
          className="mt-5 px-6 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-zinc-300 font-black uppercase tracking-widest text-xs active:bg-zinc-700"
        >
          ← Try Again
        </button>
      ) : (
        <p className="text-zinc-600 text-[11px] mt-5 text-center max-w-[220px] leading-relaxed">
          Keep this screen active while your video is generated.
        </p>
      )}
    </div>
  );
}
