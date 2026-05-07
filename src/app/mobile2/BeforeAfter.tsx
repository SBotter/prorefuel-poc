"use client";

import { useEffect, useRef, useState } from "react";

const SWITCH_MS = 4500;
type Side = "raw" | "lens";

export default function BeforeAfter() {
  const [active, setActive] = useState<Side>("lens");
  const [fading, setFading] = useState(false);

  const rawRef      = useRef<HTMLVideoElement>(null);
  const lensRef     = useRef<HTMLVideoElement>(null);
  const barRef      = useRef<HTMLDivElement>(null);     // progress bar — DOM only, no state
  const badgeRef    = useRef<HTMLDivElement>(null);     // badge label — DOM only
  const hintRef     = useRef<HTMLDivElement>(null);     // tap hint — DOM only
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef      = useRef<number | null>(null);
  const startTsRef  = useRef<number>(0);
  const activeRef   = useRef<Side>("lens");             // shadow of active for closures
  const fadingRef   = useRef(false);

  // Update badge + bar color directly in DOM (no re-render)
  const updateBadge = (side: Side) => {
    const b = badgeRef.current;
    const h = hintRef.current;
    if (b) {
      b.textContent = side === "raw" ? "RAW" : "LENS";
      b.style.background = side === "raw" ? "rgba(0,0,0,0.65)" : "rgba(245,158,11,0.18)";
      b.style.borderColor = side === "raw" ? "rgba(255,255,255,0.15)" : "rgba(245,158,11,0.5)";
      b.style.color = side === "raw" ? "#d4d4d8" : "#fbbf24";
    }
    if (h) {
      h.querySelector("span")!.textContent =
        `Tap to see ${side === "raw" ? "LENS edit" : "RAW footage"}`;
    }
    if (barRef.current) {
      barRef.current.style.background =
        side === "raw" ? "rgba(255,255,255,0.5)" : "rgba(245,158,11,0.8)";
    }
  };

  // Progress bar — pure RAF, zero React state
  const startProgressBar = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startTsRef.current = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(1, (now - startTsRef.current) / SWITCH_MS);
      if (barRef.current) barRef.current.style.width = `${pct * 100}%`;
      if (pct < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const switchTo = (next: Side) => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    setFading(true);

    setTimeout(() => {
      activeRef.current = next;
      setActive(next);
      setFading(false);
      fadingRef.current = false;
      updateBadge(next);
      startProgressBar();
      scheduleNext(next);
    }, 280);
  };

  const scheduleNext = (current: Side) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => switchTo(current === "raw" ? "lens" : "raw"),
      SWITCH_MS,
    );
  };

  // Deferred load: preload="none" in JSX keeps the SSR HTML from triggering
  // video downloads before JS loads. After hydration we set muted + load().
  useEffect(() => {
    const raw  = rawRef.current!;
    const lens = lensRef.current!;

    // iOS WebKit requires the attribute for muted autoplay permission
    raw.muted  = true;
    lens.muted = true;

    raw.preload  = "auto";
    lens.preload = "auto";
    raw.load();
    lens.load();

    const tryPlay = (v: HTMLVideoElement) => {
      v.play().catch(() => {
        document.addEventListener("touchstart", () => v.play().catch(() => {}),
          { once: true, passive: true });
      });
    };

    const onReady = (v: HTMLVideoElement, cb: () => void) => {
      if (v.readyState >= 3) { cb(); return; }
      v.addEventListener("canplay",    cb, { once: true });
      v.addEventListener("loadeddata", cb, { once: true });
    };

    onReady(raw,  () => tryPlay(raw));
    onReady(lens, () => tryPlay(lens));

    // Kick off auto-switch and progress bar
    updateBadge("lens");
    startProgressBar();
    scheduleNext("lens");

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current)   cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTap = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    switchTo(activeRef.current === "raw" ? "lens" : "raw");
  };

  const isRaw = active === "raw";

  return (
    <div className="relative w-full aspect-[9/16] rounded-[2rem] overflow-hidden select-none shadow-[0_0_60px_rgba(0,0,0,0.9)] ring-1 ring-white/8">

      {/* Both videos always in DOM — only one is visible at a time */}
      <video
        ref={rawRef}
        src="/videos/hero-preview-raw-mobile.mp4"
        muted playsInline loop preload="none"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: isRaw ? (fading ? 0 : 1) : (fading ? 1 : 0),
          transition: "opacity 280ms ease",
        }}
      />
      <video
        ref={lensRef}
        src="/videos/hero-preview-mobile.mp4"
        muted playsInline loop preload="none"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          opacity: isRaw ? (fading ? 1 : 0) : (fading ? 0 : 1),
          transition: "opacity 280ms ease",
        }}
      />

      {/* Badge — updated via DOM ref, no re-render */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none">
        <div
          ref={badgeRef}
          className="px-3 py-1.5 rounded-full backdrop-blur-sm border font-black text-xs uppercase tracking-widest"
          style={{
            background: "rgba(245,158,11,0.18)",
            borderColor: "rgba(245,158,11,0.5)",
            color: "#fbbf24",
          }}
        >
          LENS
        </div>
      </div>

      {/* Tap to switch */}
      <button
        onClick={handleTap}
        aria-label="Switch between RAW and LENS"
        className="absolute inset-0 z-10 w-full h-full"
      />

      {/* Hint */}
      <div ref={hintRef} className="absolute bottom-14 left-0 right-0 flex justify-center z-20 pointer-events-none">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            Tap to see RAW footage
          </span>
        </div>
      </div>

      {/* Progress bar — width updated via DOM ref, zero React re-renders */}
      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 z-20 pointer-events-none">
        <div
          ref={barRef}
          className="h-full"
          style={{
            width: "0%",
            background: "rgba(245,158,11,0.8)",
            transition: "background 280ms ease",
          }}
        />
      </div>
    </div>
  );
}
