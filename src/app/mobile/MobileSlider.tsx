"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export default function MobileSlider() {
  const [hasDragged, setHasDragged] = useState(false);

  const containerRef    = useRef<HTMLDivElement>(null);
  const rawRef          = useRef<HTMLVideoElement>(null);
  const lensRef         = useRef<HTMLVideoElement>(null);
  const rawClipRef      = useRef<HTMLDivElement>(null);
  const lensClipRef     = useRef<HTMLDivElement>(null);
  const dividerRef      = useRef<HTMLDivElement>(null);
  const handleElRef     = useRef<HTMLDivElement>(null);
  const draggingRef     = useRef(false);
  const hasDraggedRef   = useRef(false);

  const applySlider = useCallback((pct: number) => {
    const x = Math.min(95, Math.max(5, pct));
    if (rawClipRef.current)
      rawClipRef.current.style.clipPath = `polygon(0 0,${x}% 0,${x}% 100%,0 100%)`;
    if (lensClipRef.current)
      lensClipRef.current.style.clipPath = `polygon(${x}% 0,100% 0,100% 100%,${x}% 100%)`;
    if (dividerRef.current)
      dividerRef.current.style.left = `${x}%`;
    if (handleElRef.current)
      handleElRef.current.style.left = `${x}%`;
  }, []);

  const getXPct = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 50;
    return ((clientX - rect.left) / rect.width) * 100;
  }, []);

  // Native touch listeners — passive:false so preventDefault works
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let startX = 0, startY = 0;
    let isHorizontal: boolean | null = null;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isHorizontal = null;
      draggingRef.current = true;
      applySlider(getXPct(e.touches[0].clientX));
      if (!hasDraggedRef.current) { hasDraggedRef.current = true; setHasDragged(true); }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (isHorizontal === null && (dx > 4 || dy > 4)) isHorizontal = dx >= dy;
      if (isHorizontal) {
        e.preventDefault();
        applySlider(getXPct(e.touches[0].clientX));
      } else {
        draggingRef.current = false;
      }
    };

    const onTouchEnd = () => { draggingRef.current = false; isHorizontal = null; };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, [applySlider, getXPct]);

  // Muted autoplay — iOS WebKit requires the attribute, not just the JS property
  useEffect(() => {
    const raw  = rawRef.current;
    const lens = lensRef.current;
    if (!raw || !lens) return;

    raw.muted  = true;
    lens.muted = true;

    let played = false;
    const attempt = () => {
      if (played) return;
      played = true;
      Promise.all([raw.play(), lens.play()]).catch(() => {
        played = false;
        document.addEventListener("touchstart", attempt, { once: true, passive: true });
      });
    };

    raw.addEventListener("canplay",    attempt, { once: true });
    raw.addEventListener("loadeddata", attempt, { once: true });
    if (raw.readyState >= 3) attempt();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[9/16] rounded-[2rem] overflow-hidden select-none shadow-[0_0_80px_rgba(0,0,0,0.9)] ring-1 ring-white/8"
    >
      {/* RAW video — base layer, full size */}
      <div ref={rawClipRef} className="absolute inset-0" style={{ clipPath: "polygon(0 0,50% 0,50% 100%,0 100%)" }}>
        <video
          ref={rawRef}
          src="/videos/hero-preview-raw-mobile.mp4"
          muted playsInline loop preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span
            className="font-black text-white uppercase tracking-[0.15em] select-none"
            style={{ fontSize: "clamp(4rem, 22%, 7rem)", opacity: 0.18 }}
          >RAW</span>
        </div>
      </div>

      {/* LENS video — clipped to right side */}
      <div ref={lensClipRef} className="absolute inset-0" style={{ clipPath: "polygon(50% 0,100% 0,100% 100%,50% 100%)" }}>
        <video
          ref={lensRef}
          src="/videos/hero-preview-mobile.mp4"
          muted playsInline loop preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className="font-black uppercase tracking-[0.15em] select-none"
            style={{ fontSize: "clamp(4rem, 22%, 7rem)", opacity: 0.22, color: "#f59e0b" }}
          >LENS</span>
        </div>
      </div>

      {/* Divider */}
      <div
        ref={dividerRef}
        className="absolute top-0 bottom-0 w-[3px] bg-white shadow-[0_0_14px_rgba(255,255,255,0.9)] z-20 pointer-events-none"
        style={{ left: "50%", transform: "translateX(-50%)" }}
      />

      {/* Handle */}
      <div
        ref={handleElRef}
        className="absolute top-1/2 z-20 pointer-events-none"
        style={{ left: "50%", transform: "translate(-50%, -50%)" }}
      >
        <div className="w-11 h-11 rounded-full bg-white shadow-[0_0_24px_rgba(0,0,0,0.8)] flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 3 12 9 6" />
            <polyline points="15 6 21 12 15 18" />
          </svg>
        </div>
      </div>

      {/* Hint badge */}
      {!hasDragged && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 pointer-events-none animate-pulse">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/65 backdrop-blur-sm border border-white/12">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="9 18 3 12 9 6"/><polyline points="15 6 21 12 15 18"/>
            </svg>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-200">Drag to compare</span>
          </div>
        </div>
      )}
    </div>
  );
}
