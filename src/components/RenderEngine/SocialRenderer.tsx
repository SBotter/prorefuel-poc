"use client";
import React, { useEffect, useRef, useState } from "react";
import type { ActionSegment } from "@/lib/engine/TelemetryCrossRef";

// ─────────────────────────────────────────────────────────────────────────────
// Canvas + timing constants
// ─────────────────────────────────────────────────────────────────────────────
const W   = 1080;
const H   = 1920;
const FPS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────────
const c01  = (v: number) => Math.max(0, Math.min(1, v));
const eOut = (t: number) => 1 - (1 - t) ** 3;
const eIn  = (t: number) => t * t;
const eIO  = (t: number) => t < 0.5 ? 2*t*t : 1-(-2*t+2)**2/2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function pp(e: number, s: number, en: number) { return c01((e - s) / (en - s)); }

// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing helpers
// ─────────────────────────────────────────────────────────────────────────────
function shadow(ctx: CanvasRenderingContext2D, color: string, blur: number) {
  ctx.shadowColor = color; ctx.shadowBlur = blur;
}
function noShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
}
function drawVideo(ctx: CanvasRenderingContext2D, v: HTMLVideoElement | null,
  dx = 0, dy = 0, dw = W, dh = H) {
  if (!v || v.readyState < 2) return;
  const vW = v.videoWidth || 1920, vH = v.videoHeight || 1080;
  const ar = W / H, vAr = vW / vH;
  let sx = 0, sy = 0, sw = vW, sh = vH;
  if (vAr > ar) { sw = Math.round(vH * ar); sx = Math.round((vW - sw) / 2); }
  else          { sh = Math.round(vW / ar); sy = Math.round((vH - sh) / 2); }
  try { ctx.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh); } catch {}
}

// Haversine
function hav(a: {lat:number;lon:number}, b: {lat:number;lon:number}) {
  const R = 6_371_000, r = (d: number) => d * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  return R * 2 * Math.atan2(
    Math.sqrt(Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2),
    Math.sqrt(1 - Math.sin(dLat/2)**2 - Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
export interface SocialRendererProps {
  activityPoints: any[];
  highlights: ActionSegment[];
  videoFile: File | null;
  unit: "metric" | "imperial";
  afterBlob?: Blob;
  onComplete: () => void;
  onCancel: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature card definitions
// ─────────────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: "gps",
    title: "GPS-SYNCED",
    sub: "18Hz telemetry precision",
    detail: "Millisecond sync between video and GPS track",
    color: "#f59e0b",
  },
  {
    icon: "auto",
    title: "AUTO-EDITED",
    sub: "Zero editing skills required",
    detail: "Engine detects climbs, sprints & peak moments",
    color: "#f59e0b",
  },
  {
    icon: "phone",
    title: "INSTA READY",
    sub: "9:16 vertical format",
    detail: "Instagram Reels · TikTok · YouTube Shorts",
    color: "#f59e0b",
  },
  {
    icon: "timer",
    title: "UNDER 60s",
    sub: "From raw footage to story",
    detail: "Full pipeline runs locally in your browser",
    color: "#f59e0b",
  },
  {
    icon: "lock",
    title: "100% PRIVATE",
    sub: "No upload · No cloud",
    detail: "Your files never leave your device",
    color: "#f59e0b",
  },
];

const FEAT_DUR    = 4.8;  // seconds per feature card (same for ALL cards)
const FEAT_IN     = 0.55; // slide-in duration
const FEAT_OUT    = 0.45; // slide-out duration
const FEAT_OFFSET = 1.0;  // breathing room after slam before card 1 starts

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function SocialRenderer({
  activityPoints, highlights, videoFile, unit,
  afterBlob, onComplete, onCancel
}: SocialRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus]     = useState("Preparing…");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoFile || !activityPoints.length || !highlights.length) return;

    const ctx   = canvas.getContext("2d")!;
    let rafId   = 0;
    let recStart = 0;
    let splitVideoSetup = false;
    let splitSyncFrame  = 0; // throttle sync checks to every N frames

    // ── Video elements ──────────────────────────────────────────────────────
    const videoEl = document.createElement("video");
    videoEl.muted = true; videoEl.playsInline = true; videoEl.loop = true;
    videoEl.crossOrigin = "anonymous";
    const videoUrl = URL.createObjectURL(videoFile);
    videoEl.src = videoUrl;

    let afterVideoEl: HTMLVideoElement | null = null;
    let afterUrl = "";
    if (afterBlob) {
      afterVideoEl = document.createElement("video");
      afterVideoEl.muted = true; afterVideoEl.playsInline = true; afterVideoEl.loop = true;
      afterVideoEl.crossOrigin = "anonymous";
      afterUrl = URL.createObjectURL(afterBlob);
      afterVideoEl.src = afterUrl;
      afterVideoEl.load();
    }

    // ── Pre-compute data ────────────────────────────────────────────────────
    const seg  = highlights[0];
    const pts  = activityPoints;
    const DIST_DIV    = unit === "metric" ? 1000 : 1609.34;
    const SPEED_LABEL = unit === "metric" ? "KM/H" : "MPH";
    const DIST_LABEL  = unit === "metric" ? "KM" : "MI";

    const cumDist: number[] = [0];
    for (let i = 1; i < pts.length; i++) cumDist.push(cumDist[i-1] + hav(pts[i-1], pts[i]));
    const totalDist  = (cumDist[cumDist.length-1] / DIST_DIV).toFixed(1);
    const maxSpeedRaw = Math.max(...pts.map((p:any) => Number(p.speed) || 0));
    const maxSpeed   = unit === "metric" ? Math.round(maxSpeedRaw) : Math.round(maxSpeedRaw * 0.621371);
    const midPt      = pts[Math.floor(pts.length * 0.55)] as any;
    const peakSpeed  = unit === "metric" ? Math.round(Number(midPt?.speed) || maxSpeed * 0.82) : Math.round((Number(midPt?.speed) || maxSpeed * 0.82) * 0.621371);
    const hasHR      = pts.some((p:any) => p.hr && p.hr > 0);
    const midHR      = hasHR ? (Math.round((pts[Math.floor(pts.length*0.55)] as any)?.hr) || 148) : 0;

    // Elapsed time at mid-ride — real if timestamps exist, fallback otherwise
    const midIdx     = Math.floor(pts.length * 0.55);
    const elapsedMs  = (pts[midIdx] as any)?.time && (pts[0] as any)?.time
      ? (pts[midIdx] as any).time - (pts[0] as any).time : 0;
    const totalSec   = Math.round(Math.max(0, elapsedMs) / 1000) || 2730; // fallback 45:30
    const hhNum      = Math.floor(totalSec / 3600);
    const mmStr      = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
    const ssStr      = Math.floor(totalSec % 60).toString().padStart(2, "0");
    const timeStr    = hhNum > 0 ? `${hhNum}:${mmStr}:${ssStr}` : `${mmStr}:${ssStr}`;

    // GPS route for mini-map
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
    }
    const latR = maxLat - minLat || 0.001, lonR = maxLon - minLon || 0.001;

    // Elevation bounds (for altimetry)
    const minE = Math.min(...pts.map((p:any) => p.ele));
    const maxE = Math.max(...pts.map((p:any) => p.ele));
    const eRange = maxE - minE || 1;

    // ── Pre-render static telemetry caches (done ONCE — O(n) cost) ───────────
    // These are blitted each frame instead of re-drawing O(n) paths every frame.
    const MW = Math.round(W * 0.52), MH = Math.round(W * 0.34);
    const MX = W - MW - Math.round(W * 0.04), MY = Math.round(H * 0.07);
    const toMX = (lon: number) => 24 + ((lon - minLon) / lonR) * (MW - 48);
    const toMY = (lat: number) => MH - 24 - ((lat - minLat) / latR) * (MH - 48);
    const trailEnd = Math.floor(pts.length * 0.55); // amber trail up to mid-ride

    const routeCache = document.createElement("canvas");
    routeCache.width = MW; routeCache.height = MH;
    (() => {
      const rc = routeCache.getContext("2d")!;
      rc.shadowColor = "rgba(0,0,0,0.9)"; rc.shadowBlur = 10;
      // White full route
      rc.strokeStyle = "rgba(255,255,255,0.85)"; rc.lineWidth = 2.5;
      rc.lineJoin = "round"; rc.lineCap = "round";
      rc.beginPath();
      pts.forEach((p:any, i:number) => { i===0 ? rc.moveTo(toMX(p.lon), toMY(p.lat)) : rc.lineTo(toMX(p.lon), toMY(p.lat)); });
      rc.stroke();
      // Amber trail
      rc.strokeStyle = "#f59e0b"; rc.lineWidth = 3.5;
      rc.shadowColor = "rgba(245,158,11,0.6)"; rc.shadowBlur = 8;
      rc.beginPath();
      pts.slice(0, trailEnd).forEach((p:any, i:number) => { i===0 ? rc.moveTo(toMX(p.lon), toMY(p.lat)) : rc.lineTo(toMX(p.lon), toMY(p.lat)); });
      rc.stroke();
    })();

    // Trail-end dot position (current GPS position indicator)
    const dotPt = pts[trailEnd] as any;
    const dotMapX = MX + toMX(dotPt.lon);
    const dotMapY = MY + toMY(dotPt.lat);

    // Altimetry cache
    const AH = Math.round(H * 0.10), AY = H - AH - 20, AX0 = Math.round(W * 0.02);
    const totalDistM2 = cumDist[cumDist.length - 1] || 1;
    const altCache = document.createElement("canvas");
    altCache.width = W; altCache.height = AH + 30;
    (() => {
      const ac = altCache.getContext("2d")!;
      const altGrad = ac.createLinearGradient(0, 0, 0, AH);
      altGrad.addColorStop(0, "rgba(245,158,11,0.40)"); altGrad.addColorStop(1, "rgba(245,158,11,0)");
      ac.fillStyle = altGrad;
      ac.beginPath(); ac.moveTo(AX0, AH);
      cumDist.forEach((d, i) => {
        const x = AX0 + (d / totalDistM2) * (W - AX0*2);
        const y = AH - ((pts[i] as any).ele - minE) / eRange * AH * 0.85;
        ac.lineTo(x, y);
      });
      ac.lineTo(W - AX0, AH); ac.closePath(); ac.fill();
      ac.strokeStyle = "#f59e0b"; ac.lineWidth = 2.5;
      ac.shadowColor = "rgba(245,158,11,0.4)"; ac.shadowBlur = 8;
      ac.beginPath();
      cumDist.forEach((d, i) => {
        const x = AX0 + (d / totalDistM2) * (W - AX0*2);
        const y = AH - ((pts[i] as any).ele - minE) / eRange * AH * 0.85;
        i===0 ? ac.moveTo(x, y) : ac.lineTo(x, y);
      });
      ac.stroke();
    })();
    // Cursor X position at mid-ride
    const cursorX = AX0 + (cumDist[trailEnd] / totalDistM2) * (W - AX0*2);
    const cursorY = AY + AH - ((dotPt.ele - minE) / eRange * AH * 0.85);

    // ── Dynamic phase timeline ──────────────────────────────────────────────
    const FEAT_TOTAL = FEAT_OFFSET + FEATURES.length * FEAT_DUR; // includes breathing room
    const P = {
      hook:     { s: 0,    e: 10.0 },
      before:   { s: 10.0, e: 16.0 },
      slam:     { s: 10.0, e: 11.8 },
      features: { s: 11.8, e: 11.8 + FEAT_TOTAL },
      split:    { s: 11.8 + FEAT_TOTAL,        e: 11.8 + FEAT_TOTAL + 15.0 }, // +3s
      outro:    { s: 11.8 + FEAT_TOTAL + 15.0, e: 11.8 + FEAT_TOTAL + 20.5 },
    };
    const TOTAL_S = P.outro.e;

    // ── MediaRecorder ───────────────────────────────────────────────────────
    const mimes  = ["video/webm;codecs=avc1,opus","video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
    const mime   = mimes.find(t => MediaRecorder.isTypeSupported(t)) || "video/webm";
    const chunks: Blob[] = [];
    const stream = canvas.captureStream(FPS);
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 15_000_000 }); }
    catch { rec = new MediaRecorder(stream); }

    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = async () => {
      setStatus("Encoding MP4…"); setProgress(98);
      try {
        const { FFmpeg }         = await import("@ffmpeg/ffmpeg");
        const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
        const ff = new FFmpeg();
        const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
        await ff.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
        });
        await ff.writeFile("in.webm", await fetchFile(new Blob(chunks, { type: mime })));
        await ff.exec(["-i","in.webm","-vf","scale=1080:1920","-r","30","-c:v","libx264","-preset","ultrafast","-crf","18","-pix_fmt","yuv420p","-an","-movflags","+faststart","out.mp4"]);
        const data = await ff.readFile("out.mp4") as Uint8Array;
        const blob = new Blob([data], { type: "video/mp4" });
        const n = new Date();
        const ts = `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,"0")}${String(n.getDate()).padStart(2,"0")}${String(n.getHours()).padStart(2,"0")}${String(n.getMinutes()).padStart(2,"0")}${String(n.getSeconds()).padStart(2,"0")}`;
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `LENS_social_${ts}.mp4`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setStatus("✅ Downloaded!"); setProgress(100);
        setTimeout(onComplete, 1800);
      } catch (err) { console.error(err); setStatus("Export failed."); onComplete(); }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // ICON DRAWERS (pure canvas paths — no images required)
    // ═══════════════════════════════════════════════════════════════════════
    function drawIcon(ctx: CanvasRenderingContext2D, type: string, cx: number, cy: number, size: number, color: string) {
      ctx.save();
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = size * 0.08; ctx.lineCap = "round"; ctx.lineJoin = "round";
      shadow(ctx, color, size * 0.5);

      if (type === "gps") {
        // Satellite signal rings
        for (let i = 1; i <= 3; i++) {
          ctx.globalAlpha = 0.3 + i * 0.23;
          ctx.beginPath(); ctx.arc(cx, cy, size * 0.28 * i, -Math.PI*0.75, -Math.PI*0.05); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(cx, cy + size*0.04, size*0.13, 0, Math.PI*2); ctx.fill();
      } else if (type === "auto") {
        // Sparkle / magic star
        const pts8 = 8, r1 = size*0.42, r2 = size*0.18;
        ctx.beginPath();
        for (let i = 0; i < pts8*2; i++) {
          const angle = (i * Math.PI) / pts8 - Math.PI/2;
          const r = i % 2 === 0 ? r1 : r2;
          i === 0 ? ctx.moveTo(cx + Math.cos(angle)*r, cy + Math.sin(angle)*r)
                  : ctx.lineTo(cx + Math.cos(angle)*r, cy + Math.sin(angle)*r);
        }
        ctx.closePath(); ctx.fill();
        // Small star top-right
        ctx.globalAlpha = 0.7;
        const sx2 = cx + size*0.35, sy2 = cy - size*0.38, r3 = size*0.12;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 - Math.PI/2;
          const rr = i%2===0 ? r3 : r3*0.4;
          i===0 ? ctx.moveTo(sx2+Math.cos(a)*rr, sy2+Math.sin(a)*rr)
                : ctx.lineTo(sx2+Math.cos(a)*rr, sy2+Math.sin(a)*rr);
        }
        ctx.closePath(); ctx.fill();
      } else if (type === "phone") {
        // Phone outline
        const pw = size*0.55, ph = size*0.88, px = cx - pw/2, py = cy - ph/2, pr = size*0.10;
        ctx.strokeStyle = color; ctx.lineWidth = size*0.07;
        ctx.beginPath();
        ctx.moveTo(px+pr, py); ctx.lineTo(px+pw-pr, py);
        ctx.quadraticCurveTo(px+pw, py, px+pw, py+pr);
        ctx.lineTo(px+pw, py+ph-pr); ctx.quadraticCurveTo(px+pw, py+ph, px+pw-pr, py+ph);
        ctx.lineTo(px+pr, py+ph); ctx.quadraticCurveTo(px, py+ph, px, py+ph-pr);
        ctx.lineTo(px, py+pr); ctx.quadraticCurveTo(px, py, px+pr, py);
        ctx.closePath(); ctx.stroke();
        // Screen
        ctx.fillStyle = color; ctx.globalAlpha = 0.3;
        ctx.fillRect(px+pw*0.1, py+ph*0.12, pw*0.8, ph*0.68);
        // Home button
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(cx, py+ph*0.88, size*0.06, 0, Math.PI*2); ctx.stroke();
        // Play triangle on screen
        ctx.globalAlpha = 0.9; ctx.fillStyle = color;
        const tx = cx - size*0.06, ty = cy - size*0.04;
        ctx.beginPath(); ctx.moveTo(tx, ty-size*0.1); ctx.lineTo(tx+size*0.16, ty); ctx.lineTo(tx, ty+size*0.1); ctx.closePath(); ctx.fill();
      } else if (type === "timer") {
        // Clock face
        ctx.lineWidth = size*0.07;
        ctx.beginPath(); ctx.arc(cx, cy, size*0.44, 0, Math.PI*2); ctx.stroke();
        // Clock hands
        ctx.lineWidth = size*0.09; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - size*0.28); ctx.stroke(); // 12
        ctx.lineWidth = size*0.07;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + size*0.22, cy + size*0.10); ctx.stroke(); // 3
        // Tick marks
        ctx.lineWidth = size*0.04;
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI * 2) / 12 - Math.PI/2;
          const r0 = i%3===0 ? 0.36 : 0.40;
          ctx.beginPath();
          ctx.moveTo(cx+Math.cos(a)*size*r0, cy+Math.sin(a)*size*r0);
          ctx.lineTo(cx+Math.cos(a)*size*0.44, cy+Math.sin(a)*size*0.44);
          ctx.stroke();
        }
      } else if (type === "lock") {
        // Padlock body
        const bw = size*0.60, bh = size*0.50, bx = cx-bw/2, by = cy-bh*0.1, br = size*0.08;
        ctx.lineWidth = size*0.07;
        ctx.strokeRect(bx, by, bw, bh);
        // Shackle
        ctx.beginPath();
        ctx.arc(cx, by, size*0.22, Math.PI, 0); ctx.stroke();
        // Keyhole
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(cx, by+bh*0.42, size*0.08, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx-size*0.06, by+bh*0.42); ctx.lineTo(cx-size*0.04, by+bh*0.82); ctx.lineTo(cx+size*0.04, by+bh*0.82); ctx.lineTo(cx+size*0.06, by+bh*0.42); ctx.closePath(); ctx.fill();
      }
      noShadow(ctx);
      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TELEMETRY OVERLAY (drawn in canvas — used on right side of split)
    // ═══════════════════════════════════════════════════════════════════════
    // Pre-computed gauge track arc path (drawn to a small cache canvas once)
    const gCX = Math.round(W * 0.21), gCY = Math.round(H * 0.195), gR = Math.round(W * 0.168);
    const GAUGE_START = Math.PI * 0.75, GAUGE_END = Math.PI * 2.25;
    const maxGauge = Math.max(60, Math.ceil(maxSpeed / 10) * 10);
    const gaugeCacheW = Math.round(W * 0.52), gaugeCacheH = Math.round(H * 0.44);
    const gaugeTrackCache = document.createElement("canvas");
    gaugeTrackCache.width = gaugeCacheW; gaugeTrackCache.height = gaugeCacheH;
    (() => {
      const gc = gaugeTrackCache.getContext("2d")!;
      // Radial vignette behind gauge
      const vg = gc.createRadialGradient(gCX, gCY, 0, gCX, gCY, W * 0.42);
      vg.addColorStop(0, "rgba(0,0,0,0.25)"); vg.addColorStop(1, "rgba(0,0,0,0)");
      gc.fillStyle = vg; gc.fillRect(0, 0, gaugeCacheW, gaugeCacheH);
      // Track arc
      gc.strokeStyle = "rgba(255,255,255,0.12)"; gc.lineWidth = Math.round(W * 0.022); gc.lineCap = "round";
      gc.beginPath(); gc.arc(gCX, gCY, gR, GAUGE_START, GAUGE_END); gc.stroke();
    })();

    // drawTelemetryOverlay — uses pre-rendered caches, O(1) per frame
    function drawTelemetryOverlay(ctx: CanvasRenderingContext2D, alpha: number, speedVal: number, distVal: string, elapsed: number) {
      if (alpha <= 0) return;
      ctx.save(); ctx.globalAlpha = alpha;

      // Intensity bar
      const iGrad = ctx.createLinearGradient(0, 0, W, 0);
      iGrad.addColorStop(0, "#f59e0b"); iGrad.addColorStop(0.6, "#f97316"); iGrad.addColorStop(1, "#ef4444");
      ctx.fillStyle = iGrad;
      ctx.fillRect(0, 0, W * Math.min(0.55 + Math.sin(elapsed*0.8)*0.15, 0.98), 6);

      // ── Gauge: blit static track, then draw dynamic fill arc ──────────────
      ctx.drawImage(gaugeTrackCache, 0, 0, gaugeCacheW, gaugeCacheH);
      const speedFrac = c01(speedVal / maxGauge);
      if (speedFrac > 0.01) {
        const arcGrad = ctx.createLinearGradient(gCX - gR, gCY, gCX + gR, gCY);
        arcGrad.addColorStop(0, "#f59e0b"); arcGrad.addColorStop(1, "#f97316");
        ctx.strokeStyle = arcGrad;
        ctx.lineWidth = Math.round(W * 0.022); ctx.lineCap = "round";
        ctx.shadowColor = "rgba(245,158,11,0.5)"; ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(gCX, gCY, gR, GAUGE_START, GAUGE_START + (GAUGE_END - GAUGE_START) * speedFrac);
        ctx.stroke(); ctx.shadowBlur = 0;
      }

      // Speed number + label
      shadow(ctx, "rgba(0,0,0,0.9)", 20);
      ctx.font = `900 ${Math.round(W * 0.13)}px sans-serif`;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
      ctx.fillText(String(speedVal), gCX, gCY + Math.round(W * 0.02));
      ctx.font = `700 ${Math.round(W * 0.028)}px sans-serif`;
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(SPEED_LABEL, gCX, gCY + Math.round(W * 0.062));
      noShadow(ctx);

      // Distance — large number, then KM label (measure width with same font first)
      shadow(ctx, "rgba(0,0,0,1)", 20);
      const metY   = gCY + gR + Math.round(H * 0.04);
      const distFs = Math.round(W * 0.11);
      ctx.font = `900 ${distFs}px sans-serif`;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
      ctx.fillText(distVal, W * 0.04, metY);
      const distW = ctx.measureText(distVal).width; // measured with correct font
      ctx.font = `700 ${Math.round(W * 0.035)}px sans-serif`;
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(DIST_LABEL, W * 0.04 + distW + 8, metY - 6);

      // Secondary metrics row: ♥ HR  ⏱ TIME — same line, left-aligned
      const subY   = metY + Math.round(H * 0.036);
      const subFs  = Math.round(W * 0.044);
      ctx.font = `900 ${subFs}px sans-serif`;
      let subX = W * 0.04;

      if (hasHR && midHR > 0) {
        const hr = Math.round(midHR + Math.sin(elapsed * 1.2) * 3);
        ctx.fillStyle = "#ff4d4d";
        ctx.fillText(`♥ ${hr}`, subX, subY);
        subX += ctx.measureText(`♥ ${hr}`).width + Math.round(W * 0.04);
      }

      // Time — always shown
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(`⏱ ${timeStr}`, subX, subY);

      noShadow(ctx);

      // ── Mini-map: blit pre-rendered route cache + position dot ─────────────
      ctx.drawImage(routeCache, MX, MY); // O(1) blit
      // Position dot only (dynamic)
      ctx.shadowColor = "rgba(245,158,11,0.8)"; ctx.shadowBlur = 18;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath(); ctx.arc(dotMapX, dotMapY, 8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(dotMapX, dotMapY, 4, 0, Math.PI * 2); ctx.fill();

      // ── Altimetry: blit pre-rendered cache + cursor dot ────────────────────
      ctx.save(); ctx.globalAlpha = 0.45;
      ctx.drawImage(altCache, 0, AY); // O(1) blit
      ctx.restore();
      // Cursor dot
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cursorX, AY); ctx.lineTo(cursorX, AY + AH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath(); ctx.arc(cursorX, cursorY, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(cursorX, cursorY, 3, 0, Math.PI * 2); ctx.fill();

      // Watermark
      ctx.save(); ctx.globalAlpha = 0.55;
      ctx.font = `600 ${Math.round(W * 0.033)}px sans-serif`;
      ctx.fillStyle = "#fff"; ctx.textAlign = "right";
      ctx.fillText("LENS.prorefuel.app", W - Math.round(W*0.05), Math.round(H*0.05));
      ctx.restore();

      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1 — HOOK  (0 → 4s)
    // ═══════════════════════════════════════════════════════════════════════
    function drawHook(e: number) {
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);
      drawVideo(ctx, videoEl);

      // Dark vignette
      const vig = ctx.createRadialGradient(W/2, H/2, H*0.08, W/2, H/2, H*0.82);
      vig.addColorStop(0, "rgba(0,0,0,0.05)"); vig.addColorStop(1, "rgba(0,0,0,0.80)");
      ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

      // ─────────────────────────────────────────────────────────────────────
      // HOOK — 10s  |  Viral stop-the-scroll structure
      //
      //  0.5–2.0s  "WAIT."          — pattern interrupt, stops scroll
      //  2.0–2.6s  fade out "WAIT."
      //  2.6–3.2s  beat pause
      //  3.2–5.8s  "Are your best rides / still on your camera?"  — pain question
      //  5.8–6.6s  dark flash / breath
      //  6.6–9.0s  "You film everything." / "And post nothing."  — guilty truth
      //  9.0–10s   fade to BEFORE
      // ─────────────────────────────────────────────────────────────────────

      // ── "WAIT." — single word, enormous, centres the eye ─────────────────
      const waitIn  = eOut(pp(e, 0.45, 0.85));
      const waitOut = eIn( pp(e, 1.90, 2.55));
      const waitA   = waitIn * (1 - waitOut);
      if (waitA > 0.01) {
        ctx.save(); ctx.globalAlpha = waitA;
        shadow(ctx, "rgba(0,0,0,1)", 40);
        ctx.font = `900 ${Math.round(W * 0.28)}px sans-serif`;
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("WAIT.", W / 2, H * 0.5);
        noShadow(ctx); ctx.textBaseline = "alphabetic"; ctx.restore();
      }

      // ── Beat between phrases — subtle dark flash ──────────────────────────
      const beat1 = eIn(pp(e, 2.50, 2.75)) * (1 - eOut(pp(e, 2.75, 3.10)));
      if (beat1 > 0) {
        ctx.fillStyle = `rgba(5,5,5,${beat1 * 0.62})`;
        ctx.fillRect(0, 0, W, H);
      }

      // ── PHRASE 1: Pain question — "Are your best rides / still on your camera?"
      // Each line fits safely at W*0.075 (81px) within 1080px canvas
      const q1In  = eOut(pp(e, 3.10, 3.65));
      const q1Out = eIn( pp(e, 5.60, 6.40));
      const q1    = q1In * (1 - q1Out);
      if (q1 > 0.01) {
        const qY = lerp(H * 0.54, H * 0.44, eOut(Math.min(q1In * 1.6, 1)));
        ctx.save(); ctx.globalAlpha = q1;
        shadow(ctx, "rgba(0,0,0,1)", 32);
        ctx.textAlign = "center";
        // Line 1 — white
        ctx.font = `700 ${Math.round(W * 0.075)}px sans-serif`;
        ctx.fillStyle = "rgba(220,220,220,0.96)";
        ctx.fillText("Are your best rides", W / 2, qY);
        // Line 2 — amber, slightly delayed
        const q1b = eOut(pp(e, 3.40, 3.90)) * (1 - q1Out);
        ctx.globalAlpha = q1b;
        ctx.font = `900 ${Math.round(W * 0.082)}px sans-serif`;
        ctx.fillStyle = "#f59e0b";
        ctx.fillText("still on your camera?", W / 2, qY + Math.round(W * 0.105));
        noShadow(ctx); ctx.restore();
      }

      // ── Dark flash between phrases ────────────────────────────────────────
      const beat2 = eIn(pp(e, 6.00, 6.30)) * (1 - eOut(pp(e, 6.30, 6.70)));
      if (beat2 > 0) {
        ctx.fillStyle = `rgba(5,5,5,${beat2 * 0.68})`;
        ctx.fillRect(0, 0, W, H);
      }

      // ── PHRASE 2: "You film everything." / "And post nothing." — guilty truth
      const p2In  = eOut(pp(e, 6.60, 7.10));
      const p2Out = eIn( pp(e, 8.85, 9.55));
      const p2    = p2In * (1 - p2Out);
      if (p2 > 0.01) {
        const pY = lerp(H * 0.56, H * 0.44, eOut(Math.min(p2In * 1.8, 1)));
        ctx.save(); ctx.globalAlpha = p2;
        shadow(ctx, "rgba(0,0,0,1)", 30);
        ctx.textAlign = "center";
        // "You film everything." — white, normal weight
        ctx.font = `700 ${Math.round(W * 0.075)}px sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.fillText("You film everything.", W / 2, pY);
        // "And post nothing." — punchline: red, bigger, more weight
        const p2b = eOut(pp(e, 6.90, 7.45)) * (1 - p2Out);
        ctx.globalAlpha = p2b;
        ctx.font = `900 ${Math.round(W * 0.096)}px sans-serif`;
        ctx.fillStyle = "#ef4444";
        ctx.fillText("And post nothing.", W / 2, pY + Math.round(W * 0.122));
        noShadow(ctx); ctx.restore();

        // Underline under punchline — draws left to right
        const ulP = eOut(pp(e, 7.10, 7.80)) * (1 - p2Out);
        if (ulP > 0.01) {
          ctx.save(); ctx.globalAlpha = ulP * 0.55;
          ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 4;
          const ulW = W * 0.38 * eOut(pp(e, 7.10, 7.80));
          ctx.beginPath();
          ctx.moveTo(W/2 - ulW, pY + Math.round(W * 0.138));
          ctx.lineTo(W/2 + ulW, pY + Math.round(W * 0.138));
          ctx.stroke(); ctx.restore();
        }
      }

      // Fade to BEFORE
      const fo = eIn(pp(e, P.hook.e - 0.8, P.hook.e));
      if (fo > 0) { ctx.fillStyle = `rgba(5,5,5,${fo})`; ctx.fillRect(0, 0, W, H); }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2 — BEFORE  (4 → 10s)
    // ═══════════════════════════════════════════════════════════════════════
    function drawBefore(e: number) {
      const rel = e - P.before.s;
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);

      // Grayscale video
      const gray = eOut(pp(e, P.before.s, P.before.s + 0.7));
      ctx.filter = `grayscale(${Math.round(gray*100)}%) contrast(0.82) brightness(0.88)`;
      drawVideo(ctx, videoEl);
      ctx.filter = "none";

      // Vignette
      const vig = ctx.createRadialGradient(W/2, H*0.42, H*0.04, W/2, H*0.42, H*0.80);
      vig.addColorStop(0, "rgba(0,0,0,0.08)"); vig.addColorStop(1, "rgba(0,0,0,0.88)");
      ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

      const bg = ctx.createLinearGradient(0, H*0.62, 0, H);
      bg.addColorStop(0, "rgba(0,0,0,0)"); bg.addColorStop(1, "rgba(5,5,5,1)");
      ctx.fillStyle = bg; ctx.fillRect(0, H*0.62, W, H*0.38);

      // "BEFORE" — large, no frame
      const lp = eOut(pp(e, P.before.s + 0.2, P.before.s + 0.7));
      const lx = lerp(-W*0.25, W*0.06, lp);
      ctx.save(); ctx.globalAlpha = lp;
      shadow(ctx, "rgba(0,0,0,0.95)", 18);
      ctx.font = `900 ${Math.round(W * 0.09)}px sans-serif`;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "left";
      ctx.fillText("BEFORE", lx, H * 0.10);
      noShadow(ctx); ctx.restore();

      // "RAW. UNEDITED. FORGOTTEN."
      const tp = eOut(pp(e, P.before.s + 0.5, P.before.s + 1.3));
      const ty = lerp(H*0.87, H*0.73, tp);
      ctx.save(); ctx.globalAlpha = tp;
      shadow(ctx, "rgba(0,0,0,1)", 30);
      ctx.font = `900 italic ${Math.round(W * 0.088)}px sans-serif`;
      ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      ctx.fillText("RAW. UNEDITED.", W/2, ty);
      ctx.font = `900 italic ${Math.round(W * 0.088)}px sans-serif`;
      ctx.fillStyle = "#ef4444";
      ctx.fillText("FORGOTTEN.", W/2, ty + Math.round(W * 0.1));
      noShadow(ctx); ctx.restore();

      // Floating "missing" phrases — appear one at a time and drift up
      const floats: [number, number, string, number, number][] = [
        [1.4, 3.0,  "NO SPEED DATA",    0.22, 0.50],
        [2.3, 3.9,  "NO GPS MAP",       0.70, 0.44],
        [3.2, 4.8,  "NO HEART RATE",    0.28, 0.57],
        [4.0, 5.6,  "NO STORY",         0.65, 0.51],
      ];
      floats.forEach(([ts, te, txt, xF, yB]) => {
        if (rel < ts || rel > te) return;
        const dur = te - ts, loc = (rel - ts) / dur;
        let a = loc < 0.28 ? eOut(loc/0.28) : loc > 0.72 ? eOut(1-(loc-0.72)/0.28) : 1.0;
        const drift = loc * H * 0.055;
        ctx.save(); ctx.globalAlpha = a * 0.78;
        shadow(ctx, "rgba(0,0,0,1)", 18);
        ctx.font = `700 ${Math.round(W * 0.042)}px sans-serif`;
        ctx.fillStyle = "#9ca3af"; ctx.textAlign = "center";
        ctx.fillText(txt, W * xF, H * yB - drift);
        const tw = ctx.measureText(txt).width;
        noShadow(ctx);
        ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 3;
        ctx.globalAlpha = a * 0.55;
        ctx.beginPath();
        ctx.moveTo(W*xF - tw/2, H*yB - drift - Math.round(W*0.032));
        ctx.lineTo(W*xF + tw/2, H*yB - drift - Math.round(W*0.032));
        ctx.stroke();
        ctx.restore();
      });

      const fo = eIn(pp(e, P.before.e - 0.55, P.before.e));
      if (fo > 0) { ctx.fillStyle = `rgba(5,5,5,${fo})`; ctx.fillRect(0, 0, W, H); }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3 — SLAM  (10 → 11.8s)
    // ═══════════════════════════════════════════════════════════════════════
    function drawSlam(e: number) {
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);

      const ph = pp(e, P.slam.s, P.slam.e);
      if (ph < 0.14) {
        ctx.fillStyle = `rgba(245,158,11,${eOut(c01(1 - ph/0.14))})`;
        ctx.fillRect(0, 0, W, H);
      }

      const sp = eOut(pp(e, P.slam.s + 0.05, P.slam.s + 0.55));
      const sc = lerp(2.1, 1.0, sp);
      ctx.save(); ctx.globalAlpha = sp;
      shadow(ctx, "rgba(255,255,255,0.15)", 65);
      ctx.font = `900 ${Math.round(W * 0.25 * sc)}px sans-serif`;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("LENS", W/2, H/2);
      noShadow(ctx); ctx.textBaseline = "alphabetic"; ctx.restore();

      const lp = eOut(pp(e, P.slam.s + 0.4, P.slam.s + 0.9));
      const lw = W * 0.52 * lp;
      ctx.save(); ctx.globalAlpha = lp;
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(W/2 - lw, H/2 + W*0.19); ctx.lineTo(W/2 + lw, H/2 + W*0.19); ctx.stroke();
      ctx.restore();

      const sp2 = eOut(pp(e, P.slam.s + 0.75, P.slam.e - 0.1));
      ctx.save(); ctx.globalAlpha = sp2 * 0.7;
      ctx.font = `500 ${Math.round(W * 0.036)}px sans-serif`;
      ctx.fillStyle = "#a1a1aa"; ctx.textAlign = "center";
      ctx.fillText("by ProRefuel.app", W/2, H/2 + W*0.24);
      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4 — FEATURE CARDS  (11.8 → 11.8 + FEAT_TOTAL)
    // ═══════════════════════════════════════════════════════════════════════
    function drawFeatures(e: number) {
      const rel     = e - P.features.s;
      const relCard = rel - FEAT_OFFSET; // time after the initial breathing room
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);

      // Background video — dim but visible
      ctx.save(); ctx.globalAlpha = 0.32;
      drawVideo(ctx, videoEl);
      ctx.restore();

      // Dark overlay
      ctx.fillStyle = "rgba(5,5,5,0.65)"; ctx.fillRect(0, 0, W, H);

      // During FEAT_OFFSET (breathing room), nothing more to draw
      if (relCard < 0) return;

      // Current feature index — all cards get exactly FEAT_DUR seconds
      const fi = Math.min(Math.floor(relCard / FEAT_DUR), FEATURES.length - 1);
      const fRel = relCard - fi * FEAT_DUR; // 0 → FEAT_DUR within this card
      const feat = FEATURES[fi];

      // Progress dots — which feature we're on
      const DOT_N = FEATURES.length;
      const dotSpacing = 36, dotsTotalW = (DOT_N - 1) * dotSpacing;
      const dotsX0 = W/2 - dotsTotalW/2;
      for (let d = 0; d < DOT_N; d++) {
        ctx.save();
        ctx.fillStyle = d === fi ? "#f59e0b" : "rgba(255,255,255,0.22)";
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(dotsX0 + d*dotSpacing, H*0.08, d===fi?7:5, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }

      // Feature number — large background watermark
      ctx.save(); ctx.globalAlpha = 0.13;
      ctx.font = `900 ${Math.round(W * 1.20)}px sans-serif`;
      ctx.fillStyle = "#f59e0b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`${fi + 1}`, W/2, H*0.50);
      ctx.textBaseline = "alphabetic"; ctx.restore();

      // Card slide-in animation
      const tIn  = FEAT_IN / FEAT_DUR;
      const tOut = 1 - FEAT_OUT / FEAT_DUR;
      const local = fRel / FEAT_DUR;
      let cardT = 0;
      if      (local < tIn)  cardT = eOut(local / tIn);
      else if (local > tOut) cardT = eOut(1 - (local - tOut) / (1 - tOut));
      else                   cardT = 1.0;

      const cardY = lerp(H * 0.62, H * 0.48, eOut(cardT));
      const cardAlpha = cardT;

      ctx.save(); ctx.globalAlpha = cardAlpha;

      // Icon — centered, large
      const iconSize = Math.round(W * 0.18);
      const iconY    = cardY - iconSize * 0.9;
      drawIcon(ctx, feat.icon, W/2, iconY, iconSize, feat.color);

      // Feature title
      shadow(ctx, "rgba(0,0,0,1)", 30);
      ctx.font = `900 ${Math.round(W * 0.112)}px sans-serif`;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
      ctx.fillText(feat.title, W/2, cardY + Math.round(W * 0.02));
      noShadow(ctx);

      // Sub-line (amber)
      const subP = eOut(pp(e, P.features.s + FEAT_OFFSET + fi*FEAT_DUR + 0.5, P.features.s + FEAT_OFFSET + fi*FEAT_DUR + 1.0));
      ctx.globalAlpha = cardAlpha * subP;
      shadow(ctx, "rgba(0,0,0,0.9)", 18);
      ctx.font = `700 ${Math.round(W * 0.052)}px sans-serif`;
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(feat.sub, W/2, cardY + Math.round(W * 0.135));

      // Detail line
      const detP = eOut(pp(e, P.features.s + FEAT_OFFSET + fi*FEAT_DUR + 0.9, P.features.s + FEAT_OFFSET + fi*FEAT_DUR + 1.5));
      ctx.globalAlpha = cardAlpha * detP * 0.80;
      noShadow(ctx);
      ctx.font = `400 ${Math.round(W * 0.038)}px sans-serif`;
      ctx.fillStyle = "rgba(212,212,216,0.90)";
      ctx.fillText(feat.detail, W/2, cardY + Math.round(W * 0.198));

      // Amber underline
      const lineP = eOut(pp(e, P.features.s + FEAT_OFFSET + fi*FEAT_DUR + 1.2, P.features.s + FEAT_OFFSET + fi*FEAT_DUR + 1.8));
      ctx.globalAlpha = cardAlpha * lineP * 0.65;
      ctx.strokeStyle = feat.color; ctx.lineWidth = 3;
      const lineW2 = W * 0.32 * lineP;
      ctx.beginPath();
      ctx.moveTo(W/2 - lineW2, cardY + Math.round(W * 0.23));
      ctx.lineTo(W/2 + lineW2, cardY + Math.round(W * 0.23));
      ctx.stroke();

      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5 — SPLIT  (15s total)
    // Slider sequence:
    //   0.5→3.5s   right → left  ~18%  (reveal edited)         3s easeOut
    //   3.5→5.5s   hold at 18%                                  2s
    //   5.5→7.5s   left → right  ~75%  (reveal more raw)        2s easeInOut
    //   7.5→8.5s   hold at 75%                                  1s
    //   8.5→10.0s  right → left  0%    (100% edited, fast)      1.5s easeOut
    //   10.0→13.4s divider fades, 100% edited holds             3.4s
    //   13.4→15s   fade out                                     1.6s
    // ═══════════════════════════════════════════════════════════════════════
    function drawSplit(e: number) {
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);
      const rel = e - P.split.s; // 0 → 15

      // ── Compute slider position ───────────────────────────────────────────
      let divX: number;
      if      (rel < 0.5)  { divX = W; }
      else if (rel < 3.5)  { divX = lerp(W,           W * 0.18, eOut((rel - 0.5)  / 3.0)); }
      else if (rel < 5.5)  { divX = W * 0.18; }
      else if (rel < 7.5)  { divX = lerp(W * 0.18,    W * 0.75, eIO((rel - 5.5)  / 2.0)); }
      else if (rel < 8.5)  { divX = W * 0.75; }
      else if (rel < 10.0) { divX = lerp(W * 0.75,    0,        eOut((rel - 8.5) / 1.5)); }
      else                 { divX = 0; }

      // Divider fades out after slider reaches 0
      const dividerAlpha = rel < 10.0 ? 1.0 : 1 - c01((rel - 10.0) / 1.5);

      // ── Full LENS background (always drawn first) ─────────────────────────
      drawVideo(ctx, videoEl);
      drawTelemetryOverlay(ctx, 1.0, peakSpeed, totalDist, e);

      // ── Left — grayscale RAW overlay (only when divX > 0) ────────────────
      if (divX > 1) {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, divX, H); ctx.clip();
        ctx.filter = "grayscale(100%) contrast(0.80)";
        drawVideo(ctx, videoEl);
        ctx.filter = "none";
        ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.fillRect(0, 0, divX, H);
        ctx.restore();
      }

      // ── Divider line (fades out at end) ───────────────────────────────────
      if (divX > 1 && dividerAlpha > 0.01) {
        ctx.save(); ctx.globalAlpha = dividerAlpha;
        ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 5;
        ctx.shadowColor = "rgba(245,158,11,0.8)"; ctx.shadowBlur = 22;
        ctx.beginPath(); ctx.moveTo(divX, 0); ctx.lineTo(divX, H); ctx.stroke();
        ctx.shadowBlur = 0; ctx.restore();
      }

      // ── RAW label — left half ─────────────────────────────────────────────
      const rawLabelAlpha = eOut(pp(e, P.split.s + 0.3, P.split.s + 1.2))
                          * (1 - eOut(pp(e, P.split.s + 8.8, P.split.s + 10.0))); // fades as slider closes
      if (rawLabelAlpha > 0.01 && divX > 80) {
        const rawCX = Math.min(divX / 2, divX - 30);
        ctx.save(); ctx.globalAlpha = rawLabelAlpha;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(rawCX - 160, H * 0.075, 320, 140);
        shadow(ctx, "rgba(0,0,0,1)", 20);
        ctx.font = `900 ${Math.round(W * 0.075)}px sans-serif`;
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
        ctx.fillText("RAW", rawCX, H * 0.125);
        ctx.font = `600 ${Math.round(W * 0.032)}px sans-serif`;
        ctx.fillStyle = "rgba(180,180,180,0.90)";
        ctx.fillText("Unedited footage", rawCX, H * 0.163);
        ctx.font = `500 ${Math.round(W * 0.026)}px sans-serif`;
        ctx.fillStyle = "rgba(120,120,120,0.80)";
        ctx.fillText("No data · No story", rawCX, H * 0.193);
        noShadow(ctx); ctx.restore();
      }

      // ── LENS watermark — centred, transparent, appears when slider reaches 0% ──
      // Fades in as the slider closes, holds while the edited video is full screen.
      const wmP = eOut(pp(e, P.split.s + 9.8, P.split.s + 11.5));
      if (wmP > 0.01) {
        ctx.save();
        ctx.globalAlpha = wmP * 0.10; // watermark — barely visible
        ctx.font = `900 ${Math.round(W * 0.26)}px sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("LENS", W / 2, H / 2);
        ctx.textBaseline = "alphabetic"; ctx.restore();
      }

      // ── LENS badge on divider ─────────────────────────────────────────────
      const badgeP = eOut(pp(e, P.split.s + 3.5, P.split.s + 4.8))
                   * (1 - eOut(pp(e, P.split.s + 8.5, P.split.s + 9.5)));
      if (badgeP > 0.01 && divX > 60 && divX < W - 60) {
        ctx.save(); ctx.globalAlpha = badgeP;
        ctx.fillStyle = "rgba(5,5,5,0.92)";
        ctx.fillRect(divX - 56, H / 2 - 44, 112, 88);
        ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 3;
        ctx.strokeRect(divX - 56, H / 2 - 44, 112, 88);
        shadow(ctx, "rgba(0,0,0,0.9)", 16);
        ctx.font = `900 ${Math.round(W * 0.065)}px sans-serif`;
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("LENS", divX, H / 2);
        noShadow(ctx); ctx.textBaseline = "alphabetic"; ctx.restore();
      }

      // ── "← RAW | LENS →" hint when slider is at 75% (showing more raw) ───
      const hintP = eOut(pp(e, P.split.s + 6.8, P.split.s + 7.6))
                  * (1 - eOut(pp(e, P.split.s + 8.2, P.split.s + 8.8)));
      if (hintP > 0.01) {
        ctx.save(); ctx.globalAlpha = hintP * 0.80;
        shadow(ctx, "rgba(0,0,0,0.9)", 12);
        ctx.font = `600 ${Math.round(W * 0.030)}px sans-serif`;
        ctx.fillStyle = "rgba(245,158,11,0.90)"; ctx.textAlign = "center";
        ctx.fillText("← RAW  |  LENS →", W / 2, H * 0.96);
        noShadow(ctx); ctx.restore();
      }

      const fo = eIn(pp(e, P.split.e - 0.8, P.split.e));
      if (fo > 0) { ctx.fillStyle = `rgba(5,5,5,${fo})`; ctx.fillRect(0, 0, W, H); }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6 — OUTRO  (split.e → outro.e)
    // ═══════════════════════════════════════════════════════════════════════
    function drawOutro(e: number) {
      ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W/2, H*0.38, 0, W/2, H*0.38, H*0.55);
      glow.addColorStop(0, "rgba(245,158,11,0.10)"); glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

      const p1 = eOut(pp(e, P.outro.s,        P.outro.s + 0.7));
      const p2 = eOut(pp(e, P.outro.s + 0.6,  P.outro.s + 1.3));
      const p3 = eOut(pp(e, P.outro.s + 1.2,  P.outro.s + 1.9));
      const p4 = eOut(pp(e, P.outro.s + 1.8,  P.outro.s + 2.5));
      const p5 = eOut(pp(e, P.outro.s + 2.4,  P.outro.s + 3.2));
      const p6 = eOut(pp(e, P.outro.s + 3.0,  P.outro.s + 3.8));

      // LENS — plain white, no effects
      ctx.save(); ctx.globalAlpha = p1;
      ctx.font = `900 ${Math.round(W * 0.22)}px sans-serif`;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("LENS", W/2, H * 0.30);
      ctx.textBaseline = "alphabetic"; ctx.restore();

      // Amber underline
      ctx.save(); ctx.globalAlpha = p2;
      const lw = W * 0.52 * p2;
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(W/2-lw, H*0.39); ctx.lineTo(W/2+lw, H*0.39); ctx.stroke();
      ctx.restore();

      // Tagline
      ctx.save(); ctx.globalAlpha = p2 * 0.75;
      ctx.font = `500 ${Math.round(W * 0.036)}px sans-serif`;
      ctx.fillStyle = "#a1a1aa"; ctx.textAlign = "center";
      ctx.fillText("Cinematic GPS Video Editor", W/2, H * 0.44);
      ctx.restore();

      // CTA pill
      ctx.save(); ctx.globalAlpha = p3;
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(W/2 - 260, H*0.50, 520, 96);
      shadow(ctx, "rgba(245,158,11,0.4)", 28);
      ctx.font = `900 ${Math.round(W * 0.050)}px sans-serif`;
      ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("TRY IT FREE →", W/2, H*0.50 + 48);
      noShadow(ctx); ctx.textBaseline = "alphabetic"; ctx.restore();

      // Stats row
      const stats = [
        { v: "<60s",   l: "RENDER TIME" },
        { v: "18Hz",   l: "GPS PRECISION" },
        { v: "9:16",   l: "FORMAT" },
      ];
      ctx.save(); ctx.globalAlpha = p4;
      const SW = W / 3;
      stats.forEach((s, i) => {
        const sx = SW * i + SW/2;
        ctx.font = `900 ${Math.round(W * 0.075)}px sans-serif`;
        ctx.fillStyle = "#f59e0b"; ctx.textAlign = "center";
        shadow(ctx, "rgba(0,0,0,0.8)", 14);
        ctx.fillText(s.v, sx, H * 0.62);
        noShadow(ctx);
        ctx.font = `600 ${Math.round(W * 0.026)}px sans-serif`;
        ctx.fillStyle = "rgba(161,161,170,0.85)";
        ctx.fillText(s.l, sx, H * 0.62 + Math.round(W * 0.044));
      });
      // Dividers
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(SW - 1, H*0.595, 2, Math.round(W*0.056));
      ctx.fillRect(SW*2 - 1, H*0.595, 2, Math.round(W*0.056));
      ctx.restore();

      // URL
      ctx.save(); ctx.globalAlpha = p5;
      ctx.font = `700 ${Math.round(W * 0.044)}px sans-serif`;
      ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      shadow(ctx, "rgba(0,0,0,0.8)", 14);
      ctx.fillText("lens.prorefuel.app", W/2, H * 0.73);
      noShadow(ctx); ctx.restore();

      // @LENS.video — text only, centred, no icon
      ctx.save(); ctx.globalAlpha = p6;
      ctx.font = `600 ${Math.round(W * 0.044)}px sans-serif`;
      ctx.textAlign = "left";
      shadow(ctx, "rgba(0,0,0,0.8)", 12);
      const atW2   = ctx.measureText("@").width;
      const restW  = ctx.measureText("LENS.video").width;
      const startX = W / 2 - (atW2 + restW) / 2;
      ctx.fillStyle = "#f472b6";
      ctx.fillText("@", startX, H * 0.787);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("LENS.video", startX + atW2, H * 0.787);
      noShadow(ctx);
      ctx.restore();

      // FREE BETA badge — box sized to fit the text
      ctx.save(); ctx.globalAlpha = p6 * 0.85;
      ctx.font = `700 ${Math.round(W * 0.030)}px sans-serif`;
      ctx.textAlign = "center";
      const badgeLabel = "FREE BETA · NO ACCOUNT";
      const badgeTW = ctx.measureText(badgeLabel).width;
      const badgePadX = 36, badgeH = 56;
      const badgeW = badgeTW + badgePadX * 2;
      const badgeX = W / 2 - badgeW / 2;
      const badgeY = H * 0.832;
      ctx.fillStyle = "rgba(245,158,11,0.14)";
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeStyle = "rgba(245,158,11,0.40)"; ctx.lineWidth = 2;
      ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(badgeLabel, W / 2, badgeY + badgeH * 0.62);
      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DRAW LOOP
    // ═══════════════════════════════════════════════════════════════════════
    const drawLoop = (now: DOMHighResTimeStamp) => {
      if (recStart === 0) recStart = now;
      const elapsed = (now - recStart) / 1000;

      if (elapsed >= TOTAL_S) {
        rec.stop();
        cancelAnimationFrame(rafId);
        return;
      }

      setProgress(Math.round((elapsed / TOTAL_S) * 96));
      ctx.clearRect(0, 0, W, H);

      // Keep raw video playing
      if (videoEl.paused) videoEl.play().catch(() => {});

      // Split phase: let the video continue naturally — no seek, no jump.

      if      (elapsed < P.hook.e)     drawHook(elapsed);
      else if (elapsed < P.before.e)   drawBefore(elapsed);
      else if (elapsed < P.slam.e)     drawSlam(elapsed);
      else if (elapsed < P.features.e) drawFeatures(elapsed);
      else if (elapsed < P.split.e)    drawSplit(elapsed);
      else                             drawOutro(elapsed);

      rafId = requestAnimationFrame(drawLoop);
    };

    // ── Start ───────────────────────────────────────────────────────────────
    const startRender = () => {
      videoEl.currentTime = seg.videoStartTime;
      videoEl.play().catch(() => {});
      if (afterVideoEl) {
        afterVideoEl.currentTime = (afterVideoEl.duration || 10) * 0.4;
        afterVideoEl.play().catch(() => {});
      }
      rec.start(250);
      setStatus("Recording…");
      rafId = requestAnimationFrame(drawLoop);
    };

    if (videoEl.readyState >= 2) {
      startRender();
    } else {
      videoEl.addEventListener("loadeddata", startRender, { once: true });
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (rec.state === "recording") rec.stop();
      URL.revokeObjectURL(videoUrl);
      videoEl.src = "";
      if (afterUrl) { URL.revokeObjectURL(afterUrl); }
      if (afterVideoEl) { afterVideoEl.src = ""; }
    };
  }, [videoFile, afterBlob, activityPoints.length, highlights.length]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-6">
      <p className="text-white text-xl font-black uppercase tracking-[0.2em] mb-1">
        Generating Social Video
      </p>
      <p className="text-amber-500 text-[11px] font-black uppercase tracking-widest mb-5 animate-pulse">
        {status}
      </p>

      <div className="w-[280px] h-2 bg-white/10 rounded-full mb-6 overflow-hidden">
        <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <div className="relative w-[200px] h-[355px] bg-black border-2 border-zinc-800 rounded-[1.5rem] overflow-hidden shadow-[0_0_60px_rgba(245,158,11,0.12)] pointer-events-none">
        <canvas ref={canvasRef} width={W} height={H} className="w-full h-full object-cover" />
      </div>

      <p className="text-zinc-600 text-[11px] mt-5 text-center max-w-xs">
        ~45 seconds · 1080×1920 · MP4
      </p>

      <button onClick={onCancel}
        className="mt-4 px-5 py-2 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-rose-500/20 hover:border-rose-500/40 transition-colors text-xs font-bold uppercase tracking-widest">
        Abort
      </button>
    </div>
  );
}
