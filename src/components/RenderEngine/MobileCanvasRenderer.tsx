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

    // ── GPS bounds (for map overlays) ────────────────────────────────────────
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
    }
    const latR = maxLat - minLat || 0.001;
    const lonR = maxLon - minLon || 0.001;

    // ── Mini-map (ACTION phase — top-right corner) ───────────────────────────
    const MM_W  = Math.round(W * 0.38);
    const MM_H  = Math.round(MM_W * 0.72);
    const MM_X  = W - MM_W - Math.round(W * 0.04);
    const MM_Y  = Math.round(H * 0.055);
    const toMMX = (lon: number) => 14 + ((lon - minLon) / lonR) * (MM_W - 28);
    const toMMY = (lat: number) => MM_H - 14 - ((lat - minLat) / latR) * (MM_H - 28);

    // Pre-render full route to an offscreen canvas (O(n) once, O(1) per frame)
    const routeCache = document.createElement("canvas");
    routeCache.width = MM_W; routeCache.height = MM_H;
    const rc = routeCache.getContext("2d")!;
    rc.strokeStyle = "rgba(255,255,255,0.65)"; rc.lineWidth = 2.5; rc.lineJoin = "round"; rc.lineCap = "round";
    rc.beginPath();
    pts.forEach((p: any, i: number) =>
      i === 0 ? rc.moveTo(toMMX(p.lon), toMMY(p.lat)) : rc.lineTo(toMMX(p.lon), toMMY(p.lat)),
    );
    rc.stroke();

    // ── Speed gauge (ACTION phase — left side) ───────────────────────────────
    const G_CX      = Math.round(W * 0.255);
    const G_CY      = Math.round(H * 0.215);
    const G_R       = Math.round(W * 0.185);
    const G_START   = Math.PI * 0.75;
    const G_SWEEP   = Math.PI * 1.5;
    const G_LW      = Math.round(W * 0.025);
    const maxGauge  = Math.max(60, Math.ceil(maxSpeedDisp / 10) * 10);

    // Pre-render gauge track (O(1) per frame)
    const gaugeTrackCache = document.createElement("canvas");
    gaugeTrackCache.width  = Math.round(W * 0.60);
    gaugeTrackCache.height = Math.round(H * 0.48);
    const gc = gaugeTrackCache.getContext("2d")!;
    gc.strokeStyle = "rgba(255,255,255,0.10)"; gc.lineWidth = G_LW; gc.lineCap = "round";
    gc.beginPath(); gc.arc(G_CX, G_CY, G_R, G_START, G_START + G_SWEEP); gc.stroke();

    // ── Intro-phase full-route projection (animated GPS route reveal) ─────────
    const IR_PAD  = Math.round(W * 0.11);
    const IR_W    = W - IR_PAD * 2;
    const IR_H    = Math.round(H * 0.48);
    const IR_Y    = Math.round(H * 0.18);
    const toIRX   = (lon: number) => IR_PAD + ((lon - minLon) / lonR) * IR_W;
    const toIRY   = (lat: number) => IR_Y + IR_H - ((lat - minLat) / latR) * IR_H;

    // ── Segment timeline — hard cap at 30s to prevent OOM on iOS ─────────────
    // At 4 Mbps, 30s = ~15 MB encoded data. StorytellingProcessor can generate
    // 60+ second videos which crash the WebKit renderer at this bitrate+resolution.
    const MOBILE_DUR_CAP = 30;
    const segments   = storyPlan.segments;
    const rawDurSec   = segments.reduce((s, seg) => s + seg.durationSec, 0);
    const totalDurSec = Math.min(rawDurSec, MOBILE_DUR_CAP);

    function getSegAt(timeSec: number): {
      seg: typeof segments[0]; segIdx: number; localTime: number;
    } | null {
      let t = 0;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
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

    // ── Drawing: GPS mini-map (ACTION overlay) ────────────────────────────────
    function drawMiniMap(c: CanvasRenderingContext2D, gpsIdx: number, alpha: number) {
      if (alpha <= 0) return;
      c.save(); c.globalAlpha = alpha;

      // Card background
      c.fillStyle = "rgba(8,8,14,0.86)";
      c.beginPath(); c.roundRect(MM_X - 6, MM_Y - 6, MM_W + 12, MM_H + 12, 14); c.fill();
      c.strokeStyle = "rgba(245,158,11,0.22)"; c.lineWidth = 1.5; c.stroke();

      // Full route (O(1) blit)
      c.drawImage(routeCache, MM_X, MM_Y);

      // Amber trail up to current GPS
      const trailEnd = Math.min(gpsIdx + 1, pts.length);
      if (trailEnd > 1) {
        c.strokeStyle = "#f59e0b"; c.lineWidth = 3.2; c.lineJoin = "round"; c.lineCap = "round";
        sh(c, "rgba(245,158,11,0.55)", 8);
        c.beginPath();
        for (let i = 0; i < trailEnd; i++) {
          const p = pts[i] as any;
          i === 0 ? c.moveTo(MM_X + toMMX(p.lon), MM_Y + toMMY(p.lat))
                  : c.lineTo(MM_X + toMMX(p.lon), MM_Y + toMMY(p.lat));
        }
        c.stroke(); nosh(c);
      }

      // Position dot
      const cur = pts[gpsIdx] as any;
      if (cur) {
        sh(c, "rgba(245,158,11,0.85)", 16);
        c.fillStyle = "#f59e0b";
        c.beginPath(); c.arc(MM_X + toMMX(cur.lon), MM_Y + toMMY(cur.lat), 7, 0, Math.PI * 2); c.fill();
        nosh(c);
        c.fillStyle = "#fff";
        c.beginPath(); c.arc(MM_X + toMMX(cur.lon), MM_Y + toMMY(cur.lat), 4, 0, Math.PI * 2); c.fill();
      }

      c.restore();
    }

    // ── Drawing: telemetry HUD (ACTION phase) ─────────────────────────────────
    function drawTelemetryHUD(c: CanvasRenderingContext2D, gpsIdx: number, elapsed: number) {
      const cur      = pts[gpsIdx] as any;
      const speedRaw = Number(cur?.speed) || 0;
      const speedVal = Math.round(speedRaw * SPEED_DIV);
      const distM    = cumDist[Math.min(gpsIdx, cumDist.length - 1)] || 0;
      const distVal  = (distM / DIST_DIV).toFixed(1);

      // Intensity bar (top)
      const iGrad = c.createLinearGradient(0, 0, W, 0);
      iGrad.addColorStop(0, "#f59e0b"); iGrad.addColorStop(0.65, "#f97316"); iGrad.addColorStop(1, "#ef4444");
      c.fillStyle = iGrad;
      const barW = c01(Math.max(0.12, speedVal / maxGauge) * 0.92 + Math.sin(elapsed * 0.9) * 0.03);
      c.fillRect(0, 0, W * barW, 7);

      // Gauge track (O(1) blit)
      c.drawImage(gaugeTrackCache, 0, 0);

      // Gauge fill
      const speedFrac = c01(speedVal / maxGauge);
      if (speedFrac > 0.01) {
        const arcGrad = c.createLinearGradient(G_CX - G_R, G_CY, G_CX + G_R, G_CY);
        arcGrad.addColorStop(0, "#f59e0b"); arcGrad.addColorStop(1, "#f97316");
        c.strokeStyle = arcGrad; c.lineWidth = G_LW; c.lineCap = "round";
        sh(c, "rgba(245,158,11,0.50)", 22);
        c.beginPath(); c.arc(G_CX, G_CY, G_R, G_START, G_START + G_SWEEP * speedFrac); c.stroke();
        nosh(c);
      }

      // Speed number
      sh(c, "rgba(0,0,0,0.95)", 30);
      c.font = `900 ${Math.round(W * 0.155)}px sans-serif`;
      c.fillStyle = "#fff"; c.textAlign = "center";
      c.fillText(String(speedVal), G_CX, G_CY + Math.round(W * 0.030));
      c.font = `700 ${Math.round(W * 0.033)}px sans-serif`;
      c.fillStyle = "#f59e0b";
      c.fillText(SPEED_UNIT, G_CX, G_CY + Math.round(W * 0.082));
      nosh(c);

      // Distance
      const metY = G_CY + G_R + Math.round(H * 0.040);
      sh(c, "rgba(0,0,0,1)", 22);
      c.textAlign = "left";
      c.font = `900 ${Math.round(W * 0.115)}px sans-serif`;
      c.fillStyle = "#fff";
      c.fillText(distVal, W * 0.04, metY);
      const dw = c.measureText(distVal).width;
      c.font = `700 ${Math.round(W * 0.038)}px sans-serif`;
      c.fillStyle = "#f59e0b";
      c.fillText(DIST_UNIT, W * 0.04 + dw + 8, metY - 6);

      // Secondary row: HR + time
      const subY = metY + Math.round(H * 0.038);
      c.font = `900 ${Math.round(W * 0.046)}px sans-serif`;
      let subX = W * 0.04;
      if (hasHR && Number(cur?.hr) > 0) {
        const hr = Math.round(Number(cur.hr) + Math.sin(elapsed * 1.1) * 2);
        c.fillStyle = "#ff4d4d"; sh(c, "rgba(0,0,0,0.8)", 12);
        c.fillText(`♥ ${hr}`, subX, subY);
        subX += c.measureText(`♥ ${hr}`).width + Math.round(W * 0.04);
      }
      const relMs  = Math.max(0, (cur?.time || 0) - (pts[0]?.time || 0));
      const relSec = Math.round(relMs / 1000);
      const rh     = Math.floor(relSec / 3600);
      const rm     = Math.floor((relSec % 3600) / 60).toString().padStart(2, "0");
      const rs     = Math.floor(relSec % 60).toString().padStart(2, "0");
      const curTime = rh > 0 ? `⏱ ${rh}:${rm}:${rs}` : `⏱ ${rm}:${rs}`;
      c.fillStyle = "rgba(255,255,255,0.88)"; sh(c, "rgba(0,0,0,0.8)", 12);
      c.fillText(curTime, subX, subY);
      nosh(c);

      // Mini-map
      drawMiniMap(c, gpsIdx, 1);
    }

    // ── Drawing: INTRO phase ───────────────────────────────────────────────────
    function drawIntroPhase(c: CanvasRenderingContext2D, localTime: number, segDur: number) {
      // Dark background
      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#06060f"); bg.addColorStop(1, "#050505");
      c.fillStyle = bg; c.fillRect(0, 0, W, H);

      // GPS route reveal (progressively draws the route)
      const routeProg = eOut(pp(localTime, 0, segDur * 0.65));
      const drawCount = Math.round(pts.length * routeProg);

      if (drawCount > 1) {
        // Dim full route
        c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = 2.5; c.lineJoin = "round"; c.lineCap = "round";
        c.beginPath();
        pts.forEach((p: any, i: number) => i === 0 ? c.moveTo(toIRX(p.lon), toIRY(p.lat)) : c.lineTo(toIRX(p.lon), toIRY(p.lat)));
        c.stroke();

        // Animated amber trail
        sh(c, "rgba(245,158,11,0.50)", 12);
        c.strokeStyle = "#f59e0b"; c.lineWidth = 4; c.lineJoin = "round"; c.lineCap = "round";
        c.beginPath();
        for (let i = 0; i < drawCount; i++) {
          const p = pts[i] as any;
          i === 0 ? c.moveTo(toIRX(p.lon), toIRY(p.lat)) : c.lineTo(toIRX(p.lon), toIRY(p.lat));
        }
        c.stroke(); nosh(c);

        // Start dot (green)
        const sp = pts[0] as any;
        sh(c, "rgba(34,197,94,0.75)", 14);
        c.fillStyle = "#22c55e";
        c.beginPath(); c.arc(toIRX(sp.lon), toIRY(sp.lat), 9, 0, Math.PI * 2); c.fill(); nosh(c);

        // End dot (amber, appears when route is 95% drawn)
        if (routeProg > 0.95) {
          const ep = pts[pts.length - 1] as any;
          sh(c, "rgba(245,158,11,0.75)", 14);
          c.fillStyle = "#f59e0b";
          c.beginPath(); c.arc(toIRX(ep.lon), toIRY(ep.lat), 9, 0, Math.PI * 2); c.fill(); nosh(c);
        }
      }

      // Title — "YOUR RIDE" + sub-label
      const titleA = eOut(pp(localTime, 0.25, 1.1));
      if (titleA > 0) {
        c.save(); c.globalAlpha = titleA;
        sh(c, "rgba(0,0,0,0.9)", 26);
        c.textAlign = "center";
        c.font = `900 ${Math.round(W * 0.082)}px sans-serif`;
        c.fillStyle = "#fff";
        c.fillText("YOUR RIDE", W / 2, Math.round(H * 0.108));
        c.font = `700 ${Math.round(W * 0.032)}px sans-serif`;
        c.fillStyle = "#f59e0b";
        c.fillText("GPS · TELEMETRY · STORY", W / 2, Math.round(H * 0.148));
        nosh(c); c.restore();
      }

      // Stats (distance / time / max speed) — appear near end of INTRO
      const statsA = eOut(pp(localTime, segDur * 0.55, segDur * 0.85));
      if (statsA > 0) {
        c.save(); c.globalAlpha = statsA;
        const statDefs = [
          { val: totalDist, unit: DIST_UNIT, label: "DISTANCE" },
          { val: timeStr,   unit: "",        label: "TIME" },
          { val: String(maxSpeedDisp), unit: SPEED_UNIT, label: "MAX SPEED" },
          ...(hasHR ? [{ val: String(maxHR), unit: "BPM", label: "MAX HR" }] : [{ val: `+${eleGainDisp}`, unit: ELE_UNIT, label: "ELEVATION" }]),
        ].slice(0, 3);

        const statY = Math.round(H * 0.765);
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
        // Dividers between stats
        c.fillStyle = "rgba(255,255,255,0.10)";
        for (let i = 1; i < statDefs.length; i++)
          c.fillRect(SW * i - 1, statY - Math.round(W * 0.065), 2, Math.round(W * 0.092));
        c.restore();
      }
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
        // Seek video to this highlight's start (once per new ACTION segment)
        if (segIdx !== lastSegIdx && typeof seg.videoStartTime === "number") {
          lastSegIdx = segIdx;
          videoEl.currentTime = seg.videoStartTime;
          videoEl.play().catch(() => {});
        }

        drawVideoFrame(ctx);

        // Soft vignette to make overlay text readable
        const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.72);
        vig.addColorStop(0, "rgba(0,0,0,0.02)"); vig.addColorStop(1, "rgba(0,0,0,0.58)");
        ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

        drawTelemetryHUD(ctx, gpsIdx, elapsed);
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
      mlogClear(); // fresh log for this session
      mlog("INIT", `canvas=${W}×${H} fps=${FPS} dur=${totalDurSec.toFixed(1)}s segments=${segments.length}`);
      mlog("INIT", `pts=${pts.length} videoFile=${videoFile?.name} size=${((videoFile?.size ?? 0)/1_048_576).toFixed(1)}MB`);

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

      // ── 30fps throttle: rAF fires at 60fps on iPhone; only capture at 30fps ──
      let lastCaptureMs = -1;
      let lastLogSec    = -1;

      const loop = (now: number) => {
        if (isStopped) return;

        const elapsed = (now - recStartMs) / 1000;
        setProgress(Math.round(c01(elapsed / totalDurSec) * 90));

        // Log every second for debugging
        const secFloor = Math.floor(elapsed);
        if (secFloor > lastLogSec) {
          lastLogSec = secFloor;
          mlog("REC", `t=${secFloor}s mem=${mlogMemory()}`);
        }

        if (elapsed >= totalDurSec) {
          isStopped = true;
          mlog("REC", "loop ended — calling stop()");
          setStatus("Encoding…");
          const renderStart = Date.now();

          recorder!.stop()
            .then(async (blob) => {
              mlog("DONE", `blob=${(blob.size/1_048_576).toFixed(1)}MB`);
              setProgress(99);
              setStatus("Sharing…");
              const filename = `LENS_${makeTimestamp()}.mp4`;
              await shareOrDownload(blob, filename);
              setProgress(100);
              setStatus("Done!");
              onRenderComplete({
                durationMs:      Date.now() - renderStart,
                outputFormat:    "mp4",
                outputSizeBytes: blob.size,
                status:          "success",
              });
            })
            .catch((err: any) => {
              mlog("ERROR", `stop() failed: ${err.message}`);
              setStatus("Export failed.");
              onRenderComplete({
                durationMs:      0,
                outputFormat:    "mp4",
                outputSizeBytes: 0,
                status:          "error",
                errorMessage:    err.message ?? "unknown",
              });
            });
          return;
        }

        // Draw every rAF for smooth preview
        try {
          drawFrame(elapsed);
        } catch (err: any) {
          mlog("ERROR", `drawFrame crashed: ${err.message}`);
        }

        // ── Capture only at 30fps to avoid VideoFrame memory spike on iOS ────
        if (lastCaptureMs < 0 || now - lastCaptureMs >= CAPTURE_INTERVAL_MS) {
          try {
            recorder!.captureFrame();
          } catch (err: any) {
            mlog("ERROR", `captureFrame crashed: ${err.message}`);
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
      isStopped = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandled);
      URL.revokeObjectURL(videoUrl);
      videoEl.src = "";
    };
  }, [videoFile, activityPoints.length, storyPlan]);

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-4">

      {/* Title */}
      <div className="text-white text-lg font-black uppercase tracking-[0.2em] mb-0.5 text-center">
        Creating Your Video
      </div>
      <div className="text-amber-500 text-[11px] font-black uppercase tracking-widest mb-5 animate-pulse">
        {status}
      </div>

      {/* Progress bar */}
      <div className="w-[240px] h-2 bg-white/10 rounded-full mb-5 overflow-hidden">
        <div
          className="h-full bg-amber-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Phone mockup preview */}
      <div className="relative w-[178px] h-[316px] bg-black border-2 border-zinc-800 rounded-[1.4rem] overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.10)] pointer-events-none">
        <canvas ref={canvasRef} width={W} height={H} className="w-full h-full object-cover" />
        {/* Inner screen shine */}
        <div className="absolute inset-0 rounded-[1.4rem] ring-1 ring-inset ring-white/5 pointer-events-none" />
      </div>

      {/* Hint */}
      <p className="text-zinc-600 text-[11px] mt-5 text-center max-w-[220px] leading-relaxed">
        Keep this screen active while your video is generated.
      </p>
    </div>
  );
}
