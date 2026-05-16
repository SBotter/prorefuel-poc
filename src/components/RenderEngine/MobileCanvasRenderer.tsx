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
}: MobileCanvasRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status,   setStatus]   = useState("Preparing…");
  const [progress, setProgress] = useState(0);
  // After encoding: hold the blob so user can save via a fresh gesture
  const [readyBlob, setReadyBlob] = useState<{ blob: Blob; filename: string } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoFile || !activityPoints.length || !storyPlan?.segments.length) return;

    const ctx = canvas.getContext("2d", { alpha: false })!;
    let rafId       = 0;
    let isStopped   = false;
    let recStartMs  = 0;
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

    // grayFrameCache: pre-computed grayscale frozen video frame for INTRO phase
    // Computed in startRecordingLoop() after pre-seek — populated below.
    const grayFrameCache = document.createElement("canvas");
    grayFrameCache.width = W; grayFrameCache.height = H;
    let grayFrameReady = false;

    // ── Segment timeline — cap at 30s and always reserve 3s for BRAND ──────────
    // At 4 Mbps, 30s = ~15 MB. StorytellingProcessor can emit 60+ second plans.
    // We clamp total to 30s BUT guarantee the BRAND screen always renders (3s).
    const MOBILE_DUR_CAP  = 30;
    const BRAND_RESERVE_S = 3;
    const ACTION_CAP_S    = MOBILE_DUR_CAP - BRAND_RESERVE_S; // 27s for non-brand

    const segments = storyPlan.segments;

    // Rebuild a trimmed segment list: keep INTRO/MAP as-is, trim ACTION to fit
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
        trimmedSegments.push(seg); // INTRO / MAP: keep as-is
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

    // ── Drawing: video frame ─────────────────────────────────────────────────
    function drawVideoFrame(c: CanvasRenderingContext2D) {
      if (videoEl.readyState < 2) return;
      const vW = videoEl.videoWidth || W, vH = videoEl.videoHeight || H;
      const ar = W / H, vAr = vW / vH;
      let sx = 0, sy = 0, sw = vW, sh = vH;
      if (vAr > ar) { sw = Math.round(vH * ar); sx = Math.round((vW - sw) / 2); }
      else          { sh = Math.round(vW / ar); sy = Math.round((vH - sh) / 2); }
      try { c.drawImage(videoEl, sx, sy, sw, sh, 0, 0, W, H); } catch { /* video not ready */ }
    }

    // ── Drawing: GPS mini-map — matches desktop drawBroadMap exactly ─────────
    // No background box. Route has drop shadow. Incremental trail cache.
    function drawMiniMap(c: CanvasRenderingContext2D, gpsIdx: number) {
      // Layer 1: pre-cached route (no background box — shadow gives depth)
      c.save();
      c.drawImage(broadmapCache, MM_X, MM_Y, MM_W, MM_H);

      // Layer 2: amber progress trail — incremental (O(delta) not O(idx))
      if (gpsIdx > lastTrailIdx) {
        const from = Math.max(lastTrailIdx, 0);
        trailCtx.beginPath();
        trailCtx.moveTo(toMMX(pts[from].lon), toMMY(pts[from].lat));
        for (let i = from + 1; i <= gpsIdx; i++)
          trailCtx.lineTo(toMMX((pts[i] as any).lon), toMMY((pts[i] as any).lat));
        trailCtx.stroke();
        lastTrailIdx = gpsIdx;
      }
      c.drawImage(trailCache, 0, 0, MM_W, MM_H, MM_X, MM_Y, MM_W, MM_H);

      // Layer 3: current position dot + glow
      const cx = MM_X + toMMX((pts[gpsIdx] as any).lon);
      const cy = MM_Y + toMMY((pts[gpsIdx] as any).lat);
      c.shadowBlur = 18; c.shadowColor = "rgba(245,158,11,0.8)";
      c.fillStyle = "#f59e0b";
      c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
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
      c.font = `900 ${Math.round(W * 0.11)}px sans-serif`;
      c.fillStyle = "#fff"; c.textAlign = "left";
      c.fillText(distVal, W * 0.04, metY);
      const dw = c.measureText(distVal).width;
      c.font = `700 ${Math.round(W * 0.035)}px sans-serif`;
      c.fillStyle = "#f59e0b";
      c.fillText(` ${DIST_UNIT}`, W * 0.04 + dw, metY - 4);

      const subY = metY + Math.round(H * 0.036);
      c.save();
      c.beginPath(); c.rect(0, 0, Math.round(W * 0.54), H); c.clip();
      c.font = `900 ${Math.round(W * 0.044)}px sans-serif`;
      let groupX = W * 0.04;
      if (hasHR && cur?.hr) {
        sh(c, "rgba(0,0,0,1)", 20);
        c.fillStyle = "#ff4d4d";
        c.fillText(`♥ ${Math.round(cur.hr)}`, groupX, subY);
        groupX += c.measureText(`♥ ${Math.round(cur.hr)}`).width + Math.round(W * 0.03);
      }
      const relMs  = Math.max(0, (cur?.time || 0) - (pts[0]?.time || 0));
      const relSec = Math.round(relMs / 1000);
      const rhh = Math.floor(relSec / 3600);
      const rmm = Math.floor((relSec % 3600) / 60).toString().padStart(2, "0");
      const rss = Math.floor(relSec % 60).toString().padStart(2, "0");
      const tstr = rhh > 0 ? `${rhh.toString().padStart(2,"0")}:${rmm}:${rss}` : `${rmm}:${rss}`;
      sh(c, "rgba(0,0,0,1)", 20);
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.fillText(`⏱ ${tstr}`, groupX, subY);
      c.restore();

      // Intensity bar — top of canvas (speed-based, same as desktop concept)
      const barW2 = Math.round(W * c01(speedRaw / (maxGauge / SPEED_DIV)));
      if (barW2 > 0) {
        const barG = c.createLinearGradient(0, 0, W, 0);
        barG.addColorStop(0, "#f59e0b"); barG.addColorStop(0.6, "#f97316"); barG.addColorStop(1, "#ef4444");
        c.fillStyle = barG; c.fillRect(0, 0, barW2, 6);
      }

      // Mini-map — no background box, matches desktop
      drawMiniMap(c, gpsIdx);

      // Altimetry — matches desktop exactly
      const altCursorX = altProjX[gpsIdx];
      const altCursorY = altProjY[gpsIdx];
      c.drawImage(altimetryCache, 0, ALT_Y);

      // Altimetry cursor (current position on the curve)
      c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 1.5; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(altCursorX, ALT_Y); c.lineTo(altCursorX, ALT_Y + ALT_PT + ALT_H); c.stroke();
      c.setLineDash([]);
      c.fillStyle = "#f59e0b"; c.shadowColor = "rgba(245,158,11,0.6)"; c.shadowBlur = 8;
      c.beginPath(); c.arc(altCursorX, altCursorY, 5, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;

      c.restore();
    }

    // ── Drawing: INTRO phase ──────────────────────────────────────────────────
    // Shows the FIRST FRAME of the video (at highlight position), frozen in
    // black & white. Activity stats overlay animates in. Fades to black before
    // ACTION starts, which then plays the same frame in full color.
    function drawIntroPhase(c: CanvasRenderingContext2D, localTime: number, segDur: number) {
      c.fillStyle = "#050505"; c.fillRect(0, 0, W, H);

      // Fade in from black
      const fadeIn  = eOut(pp(localTime, 0, 0.4));
      // Fade out to black at end (so ACTION "color reveal" feels cinematic)
      const fadeOut = eOut(pp(localTime, segDur * 0.80, segDur));

      // Grayscale frozen video frame (pre-computed — O(1) blit every frame)
      if (grayFrameReady && fadeIn > 0) {
        c.save();
        c.globalAlpha = fadeIn * (1 - fadeOut) * 0.82; // slightly darker for cinematic feel
        c.drawImage(grayFrameCache, 0, 0, W, H);
        c.restore();
      }

      // Dark vignette to frame the content
      const vig = c.createRadialGradient(W / 2, H / 2, H * 0.05, W / 2, H / 2, H * 0.70);
      vig.addColorStop(0, "rgba(0,0,0,0.10)"); vig.addColorStop(1, "rgba(0,0,0,0.78)");
      c.fillStyle = vig; c.fillRect(0, 0, W, H);

      // Fade to black overlay
      if (fadeOut > 0) {
        c.fillStyle = `rgba(5,5,5,${fadeOut})`; c.fillRect(0, 0, W, H);
      }

      // ── Text elements fade in together ────────────────────────────────────
      const textA = fadeIn * (1 - fadeOut);
      if (textA < 0.02) return;
      c.save(); c.globalAlpha = textA;

      // "YOUR RIDE" title
      const titleA = eOut(pp(localTime, 0.3, 1.2));
      if (titleA > 0) {
        c.globalAlpha = textA * titleA;
        sh(c, "rgba(0,0,0,0.9)", 28);
        c.textAlign = "center";
        c.font = `700 ${Math.round(W * 0.032)}px sans-serif`;
        c.fillStyle = "#f59e0b";
        c.fillText("GPS · TELEMETRY · STORY", W / 2, Math.round(H * 0.09));
        c.font = `900 ${Math.round(W * 0.086)}px sans-serif`;
        c.fillStyle = "#fff";
        c.fillText("YOUR RIDE", W / 2, Math.round(H * 0.135));
        nosh(c);
      }

      // Stats (distance / time / max speed) — animate in at mid-INTRO
      const statsA = eOut(pp(localTime, segDur * 0.35, segDur * 0.65));
      if (statsA > 0) {
        c.globalAlpha = textA * statsA;
        const statDefs = [
          { val: totalDist, unit: DIST_UNIT,       label: "DISTANCE" },
          { val: timeStr,   unit: "",              label: "TIME" },
          { val: String(maxSpeedDisp), unit: SPEED_UNIT, label: "MAX SPEED" },
          ...(hasHR ? [{ val: String(maxHR), unit: "BPM", label: "MAX HR" }]
                    : [{ val: `+${eleGainDisp}`, unit: ELE_UNIT, label: "ELEVATION" }]),
        ].slice(0, 3);

        const statY = Math.round(H * 0.77);
        const SW    = W / statDefs.length;
        statDefs.forEach((s, i) => {
          const sx = SW * i + SW / 2;
          sh(c, "rgba(0,0,0,0.9)", 18);
          c.textAlign = "center";
          c.font = `900 ${Math.round(W * 0.082)}px sans-serif`;
          c.fillStyle = "#f59e0b";
          c.fillText(`${s.val}${s.unit ? " " + s.unit : ""}`, sx, statY);
          nosh(c);
          c.font = `600 ${Math.round(W * 0.027)}px sans-serif`;
          c.fillStyle = "rgba(180,180,180,0.85)";
          c.fillText(s.label, sx, statY + Math.round(W * 0.044));
        });
        c.fillStyle = "rgba(255,255,255,0.10)";
        for (let i = 1; i < statDefs.length; i++)
          c.fillRect(SW * i - 1, statY - Math.round(W * 0.065), 2, Math.round(W * 0.092));
      }

      c.restore();
    }

    // ── Drawing: BRAND / outro phase ──────────────────────────────────────────
    function drawBrandPhase(c: CanvasRenderingContext2D, localTime: number, segDur: number) {
      const fadeIn = eOut(pp(localTime, 0, 1.2));

      // Fade from black
      c.fillStyle = `rgba(5,5,5,${fadeIn})`; c.fillRect(0, 0, W, H);

      if (fadeIn < 0.05) return;
      c.save(); c.globalAlpha = fadeIn;

      // Radial glow
      const glow = c.createRadialGradient(W / 2, H * 0.40, 0, W / 2, H * 0.40, H * 0.46);
      glow.addColorStop(0, "rgba(245,158,11,0.12)"); glow.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = glow; c.fillRect(0, 0, W, H);

      // LENS wordmark
      sh(c, "rgba(0,0,0,0.95)", 44);
      c.font = `900 ${Math.round(W * 0.20)}px sans-serif`;
      c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("LENS", W / 2, H * 0.295);
      c.textBaseline = "alphabetic"; nosh(c);

      // Amber underline (grows in)
      const lw = W * 0.48 * c01(fadeIn * 2);
      c.strokeStyle = "#f59e0b"; c.lineWidth = 5;
      c.beginPath(); c.moveTo(W / 2 - lw, H * 0.378); c.lineTo(W / 2 + lw, H * 0.378); c.stroke();

      // Tagline
      c.font = `500 ${Math.round(W * 0.034)}px sans-serif`;
      c.fillStyle = "#a1a1aa"; c.textAlign = "center";
      c.fillText("Cinematic GPS Video", W / 2, H * 0.432);

      // URL (amber)
      sh(c, "rgba(0,0,0,0.9)", 18);
      c.font = `700 ${Math.round(W * 0.040)}px sans-serif`;
      c.fillStyle = "#f59e0b";
      c.fillText("lens.prorefuel.app", W / 2, H * 0.520);
      nosh(c);

      c.restore();
    }

    // ── LENS watermark (every frame, subtle) ──────────────────────────────────
    function drawWatermark(c: CanvasRenderingContext2D) {
      c.save(); c.globalAlpha = 0.18;
      c.font = `700 ${Math.round(W * 0.030)}px sans-serif`;
      c.fillStyle = "#f59e0b"; c.textAlign = "right";
      sh(c, "rgba(0,0,0,0.7)", 10);
      c.fillText("LENS", W - Math.round(W * 0.035), H - Math.round(H * 0.025));
      nosh(c); c.restore();
    }

    // ── Master draw function (called each frame) ───────────────────────────────
    function drawFrame(elapsed: number) {
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);

      const hit = getSegAt(elapsed);
      if (!hit) { drawWatermark(ctx); return; }

      const { seg, segIdx, localTime } = hit;
      const gpsIdx = getGPSIdxAt(elapsed);

      if (seg.type === "INTRO" || seg.type === "MAP") {
        drawIntroPhase(ctx, localTime, seg.durationSec);

      } else if (seg.type === "ACTION") {
        if (segIdx !== lastSegIdx && typeof seg.videoStartTime === "number") {
          lastSegIdx = segIdx;
          // ── NO SEEKS during encoding on iOS ────────────────────────────────
          // Any HTMLVideoElement seek while VideoEncoder is active kills the
          // encoder ("Encoding task did not complete") because both pipelines
          // share the same Video Toolbox hardware block on iPhone.
          // The pre-seek before encoder creation already positioned the video
          // at the first ACTION segment. Subsequent segments play forward from
          // wherever the video currently is — telemetry overlay is correct
          // regardless of exact video position.
          mlog("SEG_START", `seg[${segIdx}] ACTION — no seek (encoder running), video at ${videoEl.currentTime.toFixed(2)}s`);
          if (videoEl.paused) videoEl.play().catch(() => {});
        }

        drawVideoFrame(ctx);

        // Soft vignette to make overlay text readable
        const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.72);
        vig.addColorStop(0, "rgba(0,0,0,0.02)"); vig.addColorStop(1, "rgba(0,0,0,0.58)");
        ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

        drawTelemetryHUD(ctx, gpsIdx);
        drawWatermark(ctx);

      } else if (seg.type === "BRAND") {
        // Keep last video frame visible while fading in brand screen
        if (lastSegIdx >= 0) {
          drawVideoFrame(ctx);
          const vig2 = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.72);
          vig2.addColorStop(0, "rgba(0,0,0,0.02)"); vig2.addColorStop(1, "rgba(0,0,0,0.58)");
          ctx.fillStyle = vig2; ctx.fillRect(0, 0, W, H);
        }
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

    // ── Main recording loop ────────────────────────────────────────────────────
    async function startRecordingLoop() {
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
      if (firstActionSeg) {
        const target = firstActionSeg.videoStartTime!;
        mlog("PRESEEK", `seeking to ${target.toFixed(2)}s before encoder starts`);
        setStatus("Preparing video…");
        videoEl.currentTime = target;

        // Wait for seek to complete
        await new Promise<void>(resolve => {
          const onSeeked = () => { videoEl.removeEventListener("seeked", onSeeked); resolve(); };
          videoEl.addEventListener("seeked", onSeeked);
          setTimeout(resolve, 5000); // fallback timeout
        });

        // Wait for readyState >= 2 (HAVE_CURRENT_DATA)
        if (videoEl.readyState < 2) {
          await new Promise<void>(resolve => {
            const check = () => videoEl.readyState >= 2 ? resolve() : setTimeout(check, 80);
            check();
            setTimeout(resolve, 5000);
          });
        }
        mlog("PRESEEK", `done — readyState=${videoEl.readyState} currentTime=${videoEl.currentTime.toFixed(2)}s`);

        // Wait for the video decoder hardware to fully settle before starting
        // the encoder. Both use Video Toolbox on iOS — concurrent init causes
        // the encoder to fail immediately with no error log (muxer-level error).
        mlog("PRESEEK", "waiting 600ms for Video Toolbox to settle…");
        await new Promise<void>(r => setTimeout(r, 600));
        mlog("PRESEEK", "delay done");

        // ── Pre-compute grayscale frozen frame for INTRO ─────────────────────
        // Draw the current video frame (at the highlight position) to an offscreen
        // canvas and convert to grayscale pixel-by-pixel. Done ONCE — O(n) pixels,
        // then O(1) blit every INTRO frame. Cannot use ctx.filter on iOS < 18.
        try {
          const gfCtx = grayFrameCache.getContext("2d")!;
          if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
            const vW = videoEl.videoWidth, vH = videoEl.videoHeight;
            const ar = W / H, vAr = vW / vH;
            let sx = 0, sy = 0, sw = vW, sh2 = vH;
            if (vAr > ar) { sw = Math.round(vH * ar); sx = Math.round((vW - sw) / 2); }
            else { sh2 = Math.round(vW / ar); sy = Math.round((vH - sh2) / 2); }
            gfCtx.drawImage(videoEl, sx, sy, sw, sh2, 0, 0, W, H);
            // Pixel-level grayscale conversion (iOS < 18 has no ctx.filter)
            const imgData = gfCtx.getImageData(0, 0, W, H);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
              const gray = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
              d[i] = d[i + 1] = d[i + 2] = gray;
            }
            gfCtx.putImageData(imgData, 0, 0);
            grayFrameReady = true;
            mlog("GRAY", `grayscale frame ready ${W}×${H}`);
          }
        } catch (e: any) {
          mlog("GRAY", `grayscale pre-compute failed: ${e?.message} — INTRO will show black`);
        }
      }

      setStatus("Initializing encoder…");
      try {
        recorder = await MobileRecorder.create(canvas as HTMLCanvasElement);
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

      let lastCaptureMs  = -1;
      let lastLogSec     = -1;
      let lastSegIdxLog  = -99;
      let skippedFrames  = 0;

      const loop = (now: number) => {
        if (isStopped) return;

        const elapsed = (now - recStartMs) / 1000;
        setProgress(Math.round(c01(elapsed / totalDurSec) * 90));

        // ── Encoder / muxer death check ───────────────────────────────────────
        if (recorder?.error) {
          isStopped = true;
          mlog("ABORT", `t=${elapsed.toFixed(1)}s err=${recorder.error.name}: ${recorder.error.message}`);
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
          const renderStart = Date.now();
          recorder!.stop()
            .then((blob) => {
              mlog("STOP", `done ${Date.now()-renderStart}ms blob=${(blob.size/1_048_576).toFixed(1)}MB`);
              setProgress(100); setStatus("Video ready!");
              setReadyBlob({ blob, filename: `LENS_${makeTimestamp()}.mp4` });
              onRenderComplete({ durationMs: Date.now()-renderStart, outputFormat: "mp4", outputSizeBytes: blob.size, status: "success" });
            })
            .catch((err: any) => {
              mlog("ERROR", `stop() failed: ${err?.message ?? err}`);
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
            const videoReady = videoEl.readyState >= 2;
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
    };
  }, [videoFile, activityPoints.length, storyPlan]);

  // ── UI ─────────────────────────────────────────────────────────────────────

  // ── State: video ready to save (shown after encoding) ──────────────────────
  if (readyBlob) {
    const { blob, filename } = readyBlob;
    const handleSave = async () => {
      const file = new File([blob], filename, { type: "video/mp4" });
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "LENS Video" });
        } catch (e: any) {
          if (e?.name !== "AbortError") {
            // Fallback: direct download
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    };

    return (
      <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-6">
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

        {/* Save to Photos — primary action (fresh user gesture) */}
        <button
          onClick={handleSave}
          className="w-full max-w-[280px] py-5 rounded-2xl bg-amber-500 text-black font-black uppercase tracking-[0.3em] text-sm shadow-[0_10px_30px_rgba(245,158,11,0.35)] active:scale-[0.97] transition-transform flex items-center justify-center gap-3 mb-3"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          Save to Photos
        </button>

        {/* Done — return to form */}
        <button
          onClick={() => onRenderComplete({ durationMs: 0, outputFormat: "mp4", outputSizeBytes: blob.size, status: "success" })}
          className="w-full max-w-[280px] py-3 rounded-2xl bg-zinc-800/80 border border-zinc-700 text-zinc-400 font-black uppercase tracking-[0.2em] text-xs active:bg-zinc-700 transition-colors"
        >
          Done — Back to Form
        </button>

        <p className="text-zinc-700 text-[10px] mt-5 text-center max-w-[220px] leading-relaxed">
          Tap "Save to Photos" to open the iOS share sheet and save to your Camera Roll.
        </p>
      </div>
    );
  }

  // ── State: encoding in progress ─────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-4">

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
