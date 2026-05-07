"use client";

import { useEffect, useRef, useState } from "react";

const SWITCH_MS = 4500; // ms each side is shown before auto-switching

type Side = "raw" | "lens";

export default function BeforeAfter() {
  const [active, setActive]     = useState<Side>("lens");
  const [fading, setFading]     = useState(false);
  const [progress, setProgress] = useState(0);

  const rawRef     = useRef<HTMLVideoElement>(null);
  const lensRef    = useRef<HTMLVideoElement>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef     = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);

  // Switch to the other side with a brief fade
  const switchTo = (next: Side) => {
    setFading(true);
    setTimeout(() => {
      setActive(next);
      setFading(false);
      setProgress(0);
      startTsRef.current = performance.now();
    }, 280);
  };

  const scheduleNext = (current: Side) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => switchTo(current === "raw" ? "lens" : "raw"), SWITCH_MS);
  };

  // Progress bar animation
  useEffect(() => {
    startTsRef.current = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(1, (now - startTsRef.current) / SWITCH_MS);
      setProgress(pct);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active]);

  // Auto-switch timer restarts whenever active changes
  useEffect(() => {
    scheduleNext(active);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // iOS: set .muted via JS + start playback
  useEffect(() => {
    const raw  = rawRef.current!;
    const lens = lensRef.current!;
    raw.muted  = true;
    lens.muted = true;

    const tryPlay = (v: HTMLVideoElement) => {
      v.play().catch(() => {
        document.addEventListener("touchstart", () => v.play().catch(() => {}), { once: true, passive: true });
      });
    };

    const onReady = (v: HTMLVideoElement, cb: () => void) => {
      if (v.readyState >= 3) { cb(); return; }
      v.addEventListener("canplay", cb, { once: true });
      v.addEventListener("loadeddata", cb, { once: true });
    };

    onReady(raw,  () => tryPlay(raw));
    onReady(lens, () => tryPlay(lens));
  }, []);

  const handleTap = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setProgress(0);
    startTsRef.current = performance.now();
    const next: Side = active === "raw" ? "lens" : "raw";
    switchTo(next);
  };

  const isRaw = active === "raw";

  return (
    <div className="relative w-full aspect-[9/16] rounded-[2rem] overflow-hidden select-none shadow-[0_0_60px_rgba(0,0,0,0.9)] ring-1 ring-white/8">

      {/* Both videos always mounted so the inactive one stays buffered */}
      <video
        ref={rawRef}
        src="/videos/hero-preview-raw-mobile.mp4"
        muted playsInline loop preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: isRaw ? (fading ? 0 : 1) : (fading ? 1 : 0),
          transition: "opacity 280ms ease",
        }}
      />
      <video
        ref={lensRef}
        src="/videos/hero-preview-mobile.mp4"
        muted playsInline loop preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: isRaw ? (fading ? 1 : 0) : (fading ? 0 : 1),
          transition: "opacity 280ms ease",
        }}
      />

      {/* Badge */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none">
        <div
          className="px-3 py-1.5 rounded-full backdrop-blur-sm border font-black text-xs uppercase tracking-widest"
          style={{
            background: isRaw ? "rgba(0,0,0,0.65)" : "rgba(245,158,11,0.18)",
            borderColor: isRaw ? "rgba(255,255,255,0.15)" : "rgba(245,158,11,0.5)",
            color: isRaw ? "#d4d4d8" : "#fbbf24",
          }}
        >
          {isRaw ? "RAW" : "LENS"}
        </div>
      </div>

      {/* Tap to switch — full overlay */}
      <button
        onClick={handleTap}
        aria-label={`Switch to ${isRaw ? "LENS" : "RAW"}`}
        className="absolute inset-0 z-10 w-full h-full"
      />

      {/* Tap hint */}
      <div className="absolute bottom-14 left-0 right-0 flex justify-center z-20 pointer-events-none">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            Tap to see {isRaw ? "LENS edit" : "RAW footage"}
          </span>
        </div>
      </div>

      {/* Progress bar — shows time until auto-switch */}
      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-20 pointer-events-none">
        <div
          className="h-full"
          style={{
            width: `${progress * 100}%`,
            background: isRaw ? "rgba(255,255,255,0.5)" : "rgba(245,158,11,0.8)",
            transition: "background 280ms ease",
          }}
        />
      </div>
    </div>
  );
}
