"use client";

// Two full-size videos (each its own 9:16 source).
// CSS clip-path on wrapper divs animates between 90/10 and 10/90 splits.
// Only ONE video plays at any time — the other pauses after the transition.
// clip-path on wrappers (not on video elements) = GPU compositing, no repaint.

import { useEffect, useRef, useState } from "react";

const TRANSITION_MS = 480;
const START_TIME = 4; // seconds — point where RAW and LENS footage align

export default function VideoReveal() {
  const [side, setSide] = useState<"lens" | "raw">("lens");
  const [loaded, setLoaded] = useState(false);

  const rawRef      = useRef<HTMLVideoElement>(null);
  const lensRef     = useRef<HTMLVideoElement>(null);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const raw  = rawRef.current!;
    const lens = lensRef.current!;

    raw.muted  = true;
    lens.muted = true;

    // Load both upfront so switching feels instant
    raw.preload  = "auto";
    lens.preload = "auto";
    raw.load();
    lens.load();

    // Keep both videos at the same position (different files, same ride)
    const syncRaw = () => {
      if (Math.abs(raw.currentTime - lens.currentTime) > 0.15) {
        raw.currentTime = lens.currentTime;
      }
    };
    lens.addEventListener("timeupdate", syncRaw);

    const onReady = () => {
      setLoaded(true);
      lens.currentTime = START_TIME;
      raw.currentTime  = START_TIME;
      const play = () => lens.play().catch(() => {
        document.addEventListener("touchstart",
          () => lens.play().catch(() => {}),
          { once: true, passive: true }
        );
      });
      if (lens.readyState >= 3) play();
      else lens.addEventListener("canplay", play, { once: true });
    };

    lens.addEventListener("canplay",    onReady, { once: true });
    lens.addEventListener("loadeddata", onReady, { once: true });
    if (lens.readyState >= 3) onReady();

    return () => lens.removeEventListener("timeupdate", syncRaw);
  }, []);

  const switchTo = (next: "lens" | "raw") => {
    if (next === side) return;
    setSide(next);

    const raw  = rawRef.current!;
    const lens = lensRef.current!;

    // Sync incoming video to current position before playing
    if (next === "raw") {
      raw.currentTime = lens.currentTime;
      raw.play().catch(() => {});
      if (switchTimer.current) clearTimeout(switchTimer.current);
      switchTimer.current = setTimeout(() => lens.pause(), TRANSITION_MS);
    } else {
      lens.currentTime = raw.currentTime;
      lens.play().catch(() => {});
      if (switchTimer.current) clearTimeout(switchTimer.current);
      switchTimer.current = setTimeout(() => raw.pause(), TRANSITION_MS);
    }
  };

  // Clip-path values: 90% for active side, 10% for inactive hint
  const rawClip  = side === "raw"
    ? "polygon(0 0, 90% 0, 90% 100%, 0 100%)"
    : "polygon(0 0, 10% 0, 10% 100%, 0 100%)";
  const lensClip = side === "lens"
    ? "polygon(10% 0, 100% 0, 100% 100%, 10% 100%)"
    : "polygon(90% 0, 100% 0, 100% 100%, 90% 100%)";
  const dividerPct = side === "raw" ? "90%" : "10%";

  return (
    <div className="w-full">

      {/* Video frame */}
      <div className="relative w-full aspect-[9/16] rounded-[2rem] overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.9)] ring-1 ring-white/8 bg-zinc-950">

        {/* Loading spinner */}
        {!loaded && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
          </div>
        )}

        {/* RAW video — occupies 90% (active) or 10% (hint) of the container */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: rawClip,
            transition: `clip-path ${TRANSITION_MS}ms cubic-bezier(0.4,0,0.2,1)`,
          }}
        >
          <video
            ref={rawRef}
            src="/videos/hero-preview-raw-mobile.mp4"
            muted playsInline loop preload="none"
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* RAW watermark — centered in left 90% when active */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span
              className="font-black uppercase tracking-[0.2em] select-none"
              style={{ fontSize: "clamp(2.5rem,14vw,5rem)", color: "rgba(255,255,255,0.18)", textShadow: "0 2px 24px rgba(0,0,0,0.5)" }}
            >
              RAW
            </span>
          </div>
        </div>

        {/* LENS video — occupies 90% (active) or 10% (hint) of the container */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: lensClip,
            transition: `clip-path ${TRANSITION_MS}ms cubic-bezier(0.4,0,0.2,1)`,
          }}
        >
          <video
            ref={lensRef}
            src="/videos/hero-preview-mobile.mp4"
            muted playsInline loop preload="none"
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* LENS watermark — centered in right 90% when active */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span
              className="font-black uppercase tracking-[0.2em] select-none"
              style={{ fontSize: "clamp(2.5rem,14vw,5rem)", color: "rgba(251,191,36,0.35)", textShadow: "0 0 40px rgba(245,158,11,0.5), 0 2px 24px rgba(0,0,0,0.5)" }}
            >
              LENS
            </span>
          </div>
        </div>

        {/* Divider line at the 90%/10% boundary */}
        <div
          className="absolute top-0 bottom-0 w-[2px] z-20 pointer-events-none"
          style={{
            left: dividerPct,
            transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.5)",
            boxShadow: "0 0 8px rgba(255,255,255,0.4)",
            transition: `left ${TRANSITION_MS}ms cubic-bezier(0.4,0,0.2,1)`,
          }}
        />
      </div>

      {/* Toggle buttons */}
      <div className="flex mt-4 rounded-2xl overflow-hidden border border-zinc-800">
        <button
          onClick={() => switchTo("raw")}
          className="flex-1 py-4 text-[11px] font-black uppercase tracking-widest transition-all duration-300"
          style={side === "raw"
            ? { background: "rgba(255,255,255,0.07)", color: "#fff" }
            : { background: "transparent", color: "#52525b" }
          }
        >
          ← RAW
        </button>
        <div className="w-px bg-zinc-800" />
        <button
          onClick={() => switchTo("lens")}
          className="flex-1 py-4 text-[11px] font-black uppercase tracking-widest transition-all duration-300"
          style={side === "lens"
            ? { background: "rgba(245,158,11,0.1)", color: "#fbbf24" }
            : { background: "transparent", color: "#52525b" }
          }
        >
          LENS →
        </button>
      </div>

      <p className="text-center text-[10px] text-zinc-600 uppercase tracking-widest mt-2 font-bold">
        Tap to compare before &amp; after
      </p>
    </div>
  );
}
